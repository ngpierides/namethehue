// multiplayer.js
// Online "challenge a friend" mode: two players share a link, get a random
// starter colour (never the day's), and snake-draft swatches until one clicks
// the target. Rounds cycle endlessly with a fresh random colour each time.
//
// Transport is Supabase Realtime *Broadcast + Presence* - ephemeral channels,
// so there are no tables, no SQL and no login required (a friend just opens the
// link). The grid is derived locally from a shared seed, so only picks + turn
// travel. The HOST is authoritative: it owns the match state, applies every
// pick, and re-broadcasts state whenever someone joins so refreshes recover.

import { CONFIG } from './config.js';
import { deltaE00, hexToLab, closenessPercent, luminance } from './color.js';
import { buildRandomPuzzle } from './puzzle.js';
import { getSupabaseClient, getSession } from './auth.js';
import { isHardMode } from './pro.js';
import { attachColorField } from './colorfield.js';

const PID_KEY = 'colordle:pid';
const NAME_KEY = 'colordle:name'; // the name a signed-out player typed for multiplayer
const WIN_TARGET = 5; // first to this many rounds wins the match
const HARD_GUESSES = 5; // Hard-Mode multiplayer: each player mixes this many, best % wins

export class Multiplayer {
  /** @param {{ dataset: object, todayHex: string }} opts */
  constructor({ dataset, todayHex }) {
    this.dataset = dataset;
    this.todayHex = todayHex;
    this.el = document.getElementById('mp');
    this.app = document.querySelector('.app'); // the daily game, hidden while in MP
    this.channel = null;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.match = null; // authoritative match state (host owns it)
    this._puzzleCache = { seed: null, puzzle: null };
    this.tiles = [];
    // Per-tab player id, kept in sessionStorage: unique to this tab (so two
    // tabs - or two devices - never collide) yet stable across a refresh, so a
    // reload rejoins the same match as the same player.
    this.pid = readOrMake(
      PID_KEY,
      () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
      sessionStorage
    );

    document.getElementById('mp-back').addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    document.getElementById('mp-copy').addEventListener('click', () => this._copyLink());
    document.getElementById('mp-code').addEventListener('click', () => this._copyCode());
    document.getElementById('mp-next').addEventListener('click', () => this._advance());
    document.getElementById('mp-rematch').addEventListener('click', () => this._rematch());
    document.getElementById('mp-share').addEventListener('click', () => this._shareResult());

    // Join by pasting a link or typing a code (Enter or the Join button).
    document.getElementById('mp-join-btn').addEventListener('click', () => this._joinFromInput());
    document.getElementById('mp-join-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._joinFromInput();
    });

    // Name step (signed-out players): Continue or Enter.
    document.getElementById('mp-name-continue').addEventListener('click', () => this._submitName());
    document.getElementById('mp-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitName();
    });
  }

  _joinFromInput() {
    const input = document.getElementById('mp-join-input');
    const err = document.getElementById('mp-join-error');
    const code = parseRoomCode(input.value);
    if (!code) { err.hidden = false; input.focus(); return; }
    err.hidden = true;
    input.value = '';
    this.join(code); // tears down the host channel and reconnects as guest
  }

  // ---- entry points --------------------------------------------------------

  /** Is the multiplayer page currently showing? */
  isOpen() {
    return !this.el.hidden;
  }

  /**
   * Host a new match: mint a room code, show the shareable link, connect.
   * @param {{ fromRoute?: boolean }} [o] fromRoute = navigated here by the
   *   router (back/forward), so don't push another history entry.
   */
  open(o = {}) {
    this.role = 'host';
    this.code = randomCode();
    this._route(this.code, o.fromRoute);
    this._show();
    this._connectOrName();
  }

  /** Join an existing match from a shared link. */
  join(code, o = {}) {
    this.role = 'guest';
    this.code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!this.code) return this.open(o);
    this._route(this.code, o.fromRoute);
    this._show();
    this._connectOrName();
  }

  /** Connect now, or first ask a signed-out player for a name (then connect). */
  _connectOrName() {
    if (haveName()) { this.gated = false; this._connect(); return; }
    this.gated = true;
    this._pending = () => this._connect();
    this._render();
    const input = document.getElementById('mp-name-input');
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }

  _submitName() {
    const input = document.getElementById('mp-name-input');
    const err = document.getElementById('mp-name-error');
    const name = input.value.trim().slice(0, 20);
    if (!name) { err.hidden = false; input.focus(); return; }
    err.hidden = true;
    try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
    this.gated = false;
    const pending = this._pending;
    this._pending = null;
    this._render();
    if (pending) pending();
  }

  /** Leave multiplayer and return to the daily game. */
  close(o = {}) {
    if (this.channel) {
      try { this.channel.unsubscribe(); } catch { /* ignore */ }
      this.channel = null;
    }
    this.match = null;
    this.opponent = null;
    this.el.hidden = true;
    if (this.app) this.app.hidden = false;
    if (!o.fromRoute) this._route(null); // clean the URL back to the daily game
  }

  // ---- connection ----------------------------------------------------------

  async _connect() {
    // Drop any previous channel first (e.g. hosting, then joining by code).
    if (this.channel) {
      try { this.channel.unsubscribe(); } catch { /* ignore */ }
      this.channel = null;
    }
    this.match = null;
    this.opponent = null;
    this.hadOpponent = false;
    this._hardWired = false;
    // The match mode is fixed by the host when the match is created.
    if (this.role === 'host') this.matchMode = isHardMode() ? 'hard' : 'grid';
    this._status('Connecting…');
    const client = await getSupabaseClient();
    if (!client) {
      this._status('Multiplayer needs the cloud connection, which isn’t available right now.');
      return;
    }
    const name = myName();
    const channel = client.channel(`colordle:room:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.pid } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'state' }, ({ payload }) => this._onState(payload));
    channel.on('broadcast', { event: 'pick' }, ({ payload }) => this._onPick(payload));
    channel.on('broadcast', { event: 'hardpick' }, ({ payload }) => { if (this.role === 'host') this._applyHardPick(payload.id, payload.hex); });
    channel.on('broadcast', { event: 'requestState' }, () => { if (this.role === 'host') this._broadcastState(); });
    channel.on('broadcast', { event: 'advance' }, () => { if (this.role === 'host') this._startRound((this.match?.round || 0) + 1); });
    channel.on('broadcast', { event: 'rematch' }, () => { if (this.role === 'host') this._rematch(); });
    channel.on('presence', { event: 'sync' }, () => this._onPresence());

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ id: this.pid, name, role: this.role });
        if (this.role === 'host') {
          if (!this.match) this._startRound(1, /*silent*/ true);
          this._render();
        } else {
          channel.send({ type: 'broadcast', event: 'requestState', payload: {} });
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this._status('Connection problem - check that Realtime is enabled for this Supabase project.');
      }
    });
  }

  _onPresence() {
    const state = this.channel?.presenceState() || {};
    const people = Object.values(state).flat();
    const others = people.filter((p) => p.id !== this.pid);
    this.opponent = others[0] || null;
    if (this.opponent) this.hadOpponent = true; // for "friend disconnected" detection

    if (this.role === 'host') {
      // A guest (re)joined - hand them the current state.
      if (this.opponent) this._broadcastState();
    }
    this._render();
  }

  // ---- match state (host authoritative) ------------------------------------

  _startRound(round, silent) {
    // firstPicker alternates each round; snake order fans out from there.
    this.match = {
      round,
      seed: `${this.code}-r${round}`,
      mode: this.matchMode || 'grid',
      turnPos: 0,
      picks: {}, // grid mode: index -> { by, closeness, correct }
      hard: {}, // hard mode: playerId -> [{ hex, closeness }]
      status: 'playing', // 'playing' | 'roundOver'
      winner: null,
      scores: this.match?.scores || {},
      hostId: this.pid,
    };
    if (!silent) this._broadcastState();
    this._render();
  }

  // Hard Mode: apply one mixed-colour guess. Each player gets HARD_GUESSES; when
  // both are spent, the higher best-% wins the round.
  _applyHardPick(playerId, hex) {
    const m = this.match;
    if (!m || m.mode !== 'hard' || m.status !== 'playing') return;
    m.hard = m.hard || {};
    const arr = (m.hard[playerId] = m.hard[playerId] || []);
    if (arr.length >= HARD_GUESSES) return;

    const targetLab = hexToLab(this._puzzle().target.hex);
    const closeness = closenessPercent(deltaE00(targetLab, hexToLab(hex)), CONFIG.closenessMaxDeltaE);
    arr.push({ hex, closeness });

    const hostArr = m.hard[m.hostId] || [];
    const guestArr = this.opponent ? m.hard[this.opponent.id] || [] : [];
    if (hostArr.length >= HARD_GUESSES && guestArr.length >= HARD_GUESSES) {
      const hb = bestPct(hostArr);
      const gb = bestPct(guestArr);
      m.status = 'roundOver';
      m.winner = hb > gb ? m.hostId : gb > hb ? this.opponent.id : null; // tie => draw
      if (m.winner) {
        m.scores[m.winner] = (m.scores[m.winner] || 0) + 1;
        if (m.scores[m.winner] >= WIN_TARGET) { m.matchOver = true; m.matchWinner = m.winner; }
      }
    }
    this._broadcastState();
    this._render();
  }

  _doHardGuess() {
    const m = this.match;
    if (!m || m.mode !== 'hard' || m.status !== 'playing') return;
    if ((m.hard?.[this.pid]?.length || 0) >= HARD_GUESSES) return;
    const hex = this.hardField.get();
    if (this.role === 'host') this._applyHardPick(this.pid, hex);
    else this.channel.send({ type: 'broadcast', event: 'hardpick', payload: { id: this.pid, hex } });
  }

  _applyPick(playerId, index) {
    const m = this.match;
    if (!m || m.status !== 'playing') return;
    if (this._turnPlayerId() !== playerId) return; // not their turn
    if (m.picks[index]) return; // already taken

    const puzzle = this._puzzle();
    const correct = index === puzzle.targetIndex;
    const dE = deltaE00(hexToLab(puzzle.target.hex), hexToLab(puzzle.cells[index].hex));
    const closeness = correct ? 100 : closenessPercent(dE, CONFIG.closenessMaxDeltaE);
    m.picks[index] = { by: playerId, closeness, correct };

    if (correct) {
      m.status = 'roundOver';
      m.winner = playerId;
      m.scores[playerId] = (m.scores[playerId] || 0) + 1;
      if (m.scores[playerId] >= WIN_TARGET) { m.matchOver = true; m.matchWinner = playerId; }
    } else if (Object.keys(m.picks).length >= puzzle.cells.length) {
      m.status = 'roundOver'; // board exhausted (essentially never with 48 tiles)
      m.winner = null;
    } else {
      m.turnPos += 1;
    }
    this._broadcastState();
    this._render();
  }

  _turnPlayerId() {
    const m = this.match;
    if (!m || !this.opponent) return null;
    const hostId = m.hostId;
    const guestId = this.role === 'host' ? this.opponent.id : this.pid;
    // Round 1 host starts, round 2 guest starts, … ; snake pattern [A,B,B,A].
    const order = m.round % 2 === 1 ? [hostId, guestId] : [guestId, hostId];
    const pat = [0, 1, 1, 0][m.turnPos % 4];
    return order[pat];
  }

  _puzzle() {
    if (this._puzzleCache.seed !== this.match.seed) {
      this._puzzleCache = {
        seed: this.match.seed,
        puzzle: buildRandomPuzzle(this.match.seed, this.dataset, this.todayHex),
      };
    }
    return this._puzzleCache.puzzle;
  }

  // ---- transport helpers ---------------------------------------------------

  _broadcastState() {
    if (this.role !== 'host' || !this.channel || !this.match) return;
    this.channel.send({ type: 'broadcast', event: 'state', payload: this.match });
  }

  _onState(payload) {
    if (this.role === 'host') return; // host is the source of truth
    this.match = payload;
    this._render();
  }

  _onPick(payload) {
    if (this.role !== 'host') return; // only the host applies picks
    this._applyPick(payload.id, payload.index);
  }

  _doPick(index) {
    if (!this.match || this.match.status !== 'playing') return;
    if (this._turnPlayerId() !== this.pid) return; // not my turn
    if (this.match.picks[index]) return;
    if (this.role === 'host') this._applyPick(this.pid, index);
    else this.channel.send({ type: 'broadcast', event: 'pick', payload: { id: this.pid, index } });
  }

  _advance() {
    if (this.role === 'host') this._startRound((this.match?.round || 0) + 1);
    else this.channel?.send({ type: 'broadcast', event: 'advance', payload: {} });
  }

  /** Reset the score and start a fresh match from round 1. */
  _rematch() {
    if (this.role === 'host') {
      if (this.match) this.match.scores = {};
      this._startRound(1);
    } else {
      this.channel?.send({ type: 'broadcast', event: 'rematch', payload: {} });
    }
  }

  async _shareResult() {
    const m = this.match;
    const me = m.scores[this.pid] || 0;
    const opp = m.scores[this.opponent?.id] || 0;
    const oppName = this.opponent?.name || 'a friend';
    const verb = me > opp ? `I beat ${oppName}` : me < opp ? `${oppName} beat me` : `I tied with ${oppName}`;
    const link = `${location.origin}${location.pathname}`;
    const text = `🎨 ${verb} ${Math.max(me, opp)}–${Math.min(me, opp)} at Name the Hue! ${link}`;
    const btn = document.getElementById('mp-share');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); flashBtn(btn, 'Copied!'); }
    } catch { /* user dismissed the share sheet, or clipboard blocked */ }
  }

  // ---- rendering -----------------------------------------------------------

  _render() {
    const gate = document.getElementById('mp-namegate');
    const lobby = document.getElementById('mp-lobby');
    const game = document.getElementById('mp-game');

    // Name step takes over the page until a signed-out player has named themself.
    if (this.gated) {
      gate.hidden = false;
      lobby.hidden = true;
      game.hidden = true;
      document.getElementById('mp-topbar-title').textContent = 'Multiplayer';
      return;
    }
    gate.hidden = true;
    const disc = document.getElementById('mp-disconnect');

    const connected = !!this.opponent && !!this.match;
    // Opponent vanished after a match had started = a disconnect.
    const dropped = !connected && !!this.match && this.hadOpponent;

    lobby.hidden = connected || dropped;
    game.hidden = !connected;
    disc.hidden = !dropped;
    document.getElementById('mp-topbar-title').textContent =
      connected || dropped ? 'Live match' : 'Multiplayer';

    if (dropped) {
      document.getElementById('mp-disconnect-sub').textContent =
        this.role === 'guest'
          ? 'Your host left - this match has ended. Head back and start your own.'
          : 'Waiting for them to rejoin… your room link still works.';
      return;
    }
    if (!connected) {
      this._status(
        this.role === 'host'
          ? 'Waiting for a friend to open your link…'
          : 'Connecting you to the room…'
      );
      return;
    }

    const m = this.match;
    const puzzle = this._puzzle();
    document.getElementById('mp-round').textContent = m.round;
    document.getElementById('mp-target-name').textContent = puzzle.target.name;

    // Scoreboard.
    const oppId = this.opponent.id;
    document.getElementById('mp-name-me').textContent = myName();
    document.getElementById('mp-name-them').textContent = this.opponent.name || 'Friend';
    document.getElementById('mp-score-me').textContent = m.scores[this.pid] || 0;
    document.getElementById('mp-score-them').textContent = m.scores[oppId] || 0;

    // Board: grid (snake draft) or the Hard-Mode mixer.
    const turnEl = document.getElementById('mp-turn');
    const isHard = m.mode === 'hard';
    document.getElementById('mp-grid').hidden = isHard;
    document.getElementById('mp-hard').hidden = !isHard;

    if (isHard) {
      this._renderHard(m, turnEl);
    } else {
      const myTurn = this._turnPlayerId() === this.pid;
      if (m.status === 'playing') {
        turnEl.textContent = myTurn ? 'Your turn - pick a swatch' : `${this.opponent.name || 'Friend'}’s turn…`;
        turnEl.className = 'mp-turn' + (myTurn ? ' mp-turn--mine' : '');
      } else {
        turnEl.textContent = '';
        turnEl.className = 'mp-turn';
      }
      this._buildGrid(puzzle);
      this._paintGrid(puzzle, myTurn);
    }

    // Round-over / match-over banner.
    const over = document.getElementById('mp-roundover');
    over.hidden = m.status !== 'roundOver';
    if (m.status === 'roundOver') {
      const txt = document.getElementById('mp-roundover-text');
      const oppName = this.opponent.name || 'Friend';
      const nextBtn = document.getElementById('mp-next');
      const rematchBtn = document.getElementById('mp-rematch');
      const shareBtn = document.getElementById('mp-share');

      if (m.matchOver) {
        const mine = m.scores[this.pid] || 0;
        const theirs = m.scores[oppId] || 0;
        const iWon = m.matchWinner === this.pid;
        txt.textContent = iWon
          ? `🏆 You win the match ${mine}–${theirs}!`
          : `${oppName} wins the match ${theirs}–${mine}.`;
        nextBtn.hidden = true;
        rematchBtn.hidden = false;
        shareBtn.hidden = false;
      } else {
        txt.textContent = isHard
          ? this._hardRoundLine(m, oppName)
          : !m.winner
            ? 'No one found it.'
            : m.winner === this.pid ? '🎉 You found it!' : `${oppName} found it.`;
        nextBtn.hidden = false;
        rematchBtn.hidden = false; // let either player reset the score any time
        shareBtn.hidden = true;
      }
    }
  }

  _renderHard(m, turnEl) {
    // Wire the shared colour field once per match (attachColorField is cached).
    if (!this._hardWired) {
      this.hardField = attachColorField({
        field: document.getElementById('mp-hard-field'),
        gray: document.getElementById('mp-hard-gray'),
        marker: document.getElementById('mp-hard-marker'),
        circle: document.getElementById('mp-hard-circle'),
        hex: document.getElementById('mp-hard-hex'),
      });
      this.hardField.set('#808080', null);
      document.getElementById('mp-hard-guess').onclick = () => this._doHardGuess();
      this._hardWired = true;
    }

    const mineArr = m.hard?.[this.pid] || [];
    const oppArr = m.hard?.[this.opponent.id] || [];
    const left = HARD_GUESSES - mineArr.length;
    const done = m.status !== 'playing';
    const oppName = this.opponent.name || 'Friend';

    // Progress: my best is shown, the opponent's best stays hidden until reveal.
    turnEl.className = 'mp-turn';
    turnEl.textContent = done
      ? ''
      : `You ${mineArr.length}/${HARD_GUESSES} · best ${bestPct(mineArr)}%   -   ${oppName} ${oppArr.length}/${HARD_GUESSES}`;

    const btn = document.getElementById('mp-hard-guess');
    btn.disabled = done || left <= 0;
    btn.textContent = done ? 'Round over' : left > 0 ? `Guess (${left} left)` : 'Waiting for friend…';
    this.hardField.setLocked(done || left <= 0);
  }

  _hardRoundLine(m, oppName) {
    const mine = bestPct(m.hard?.[this.pid] || []);
    const opp = bestPct(m.hard?.[this.opponent.id] || []);
    if (m.winner === this.pid) return `🎉 You win the round - ${mine}% vs ${opp}%`;
    if (m.winner) return `${oppName} wins - ${opp}% vs ${mine}%`;
    return `Draw - ${mine}% each`;
  }

  _buildGrid(puzzle) {
    const grid = document.getElementById('mp-grid');
    if (this.tiles.length === puzzle.cells.length && grid.dataset.seed === this.match.seed) return;
    grid.dataset.seed = this.match.seed;
    grid.style.setProperty('--cols', CONFIG.gridCols);
    grid.innerHTML = '';
    this.tiles = puzzle.cells.map((cell, index) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.type = 'button';
      tile.style.setProperty('--swatch', cell.hex);
      const mark = document.createElement('span');
      mark.className = 'tile-mark';
      const inner = document.createElement('span');
      inner.className = 'mark-inner';
      mark.appendChild(inner);
      tile.appendChild(mark);
      tile.addEventListener('click', () => this._doPick(index));
      grid.appendChild(tile);
      return tile;
    });
  }

  _paintGrid(puzzle, myTurn) {
    const m = this.match;
    this.tiles.forEach((tile, index) => {
      const pick = m.picks[index];
      const isAnswer = index === puzzle.targetIndex;
      tile.classList.toggle('on-dark', luminance(puzzle.cells[index].hex) < 0.4);
      tile.classList.toggle('is-guessed', !!pick);
      tile.classList.toggle('mp-mine', !!pick && pick.by === this.pid);
      tile.classList.toggle('mp-theirs', !!pick && pick.by !== this.pid);
      tile.classList.toggle('is-correct', !!pick && pick.correct);
      tile.classList.toggle('is-answer', m.status === 'roundOver' && isAnswer);
      tile.disabled = !!pick || m.status !== 'playing' || !myTurn;
      const inner = tile.querySelector('.mark-inner');
      inner.textContent = pick ? `${pick.closeness}%` : '';
    });
  }

  // ---- small helpers -------------------------------------------------------

  _show() {
    if (this.app) this.app.hidden = true; // take over the whole page
    this.el.hidden = false;
    this.opponent = null;
    document.getElementById('mp-link').value = this._roomLink();
    document.getElementById('mp-code').textContent = this.code;
    window.scrollTo(0, 0);
  }

  _status(text) {
    document.getElementById('mp-lobby-status').textContent = text;
  }

  _roomLink() {
    const u = new URL(location.href);
    u.searchParams.set('room', this.code);
    u.hash = '';
    return u.toString();
  }

  async _copyLink() {
    const link = this._roomLink();
    const btn = document.getElementById('mp-copy');
    try {
      await navigator.clipboard.writeText(link);
      const t = btn.textContent; btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = t), 1400);
    } catch {
      document.getElementById('mp-link').select();
    }
  }

  async _copyCode() {
    const el = document.getElementById('mp-code');
    try {
      await navigator.clipboard.writeText(this.code);
      const t = el.textContent; el.textContent = 'Copied!';
      setTimeout(() => (el.textContent = this.code), 1200);
    } catch { /* ignore - the code is right there to read */ }
  }

  /**
   * Reflect the multiplayer route in the URL so the browser back button and
   * shareable links work. `code` present => in a room (#mp); null => the daily
   * game. A fresh entry (push) unless we're only syncing to a route change.
   */
  _route(code, replace) {
    const u = new URL(location.href);
    if (code) { u.searchParams.set('room', code); u.hash = 'mp'; }
    else { u.searchParams.delete('room'); u.hash = ''; }
    const url = u.toString().replace(/#$/, '');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }
}

// ---- module helpers --------------------------------------------------------

/** Do we already have a name (a logged-in one, or one the player typed)? */
function haveName() {
  if (getSession()?.user?.user_metadata?.display_name) return true;
  try { return !!localStorage.getItem(NAME_KEY); } catch { return false; }
}

function myName() {
  const dn = getSession()?.user?.user_metadata?.display_name;
  if (dn) return dn;
  try { return localStorage.getItem(NAME_KEY) || 'Player'; } catch { return 'Player'; }
}

/** Best (highest) closeness across a player's Hard-Mode guesses. */
function bestPct(arr) {
  return arr && arr.length ? Math.max(...arr.map((g) => g.closeness)) : 0;
}

function flashBtn(btn, msg) {
  if (!btn) return;
  const t = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = t; }, 1400);
}

function readOrMake(key, make, store = localStorage) {
  try {
    let v = store.getItem(key);
    if (!v) { v = make(); store.setItem(key, v); }
    return v;
  } catch {
    return make();
  }
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/**
 * Pull a room code out of whatever the player pasted - a full link
 * (…?room=ABC123), a bare code, even lower-case. Returns '' if it's too short
 * to be a real code.
 */
function parseRoomCode(raw) {
  if (!raw) return '';
  const fromUrl = String(raw).match(/[?&]room=([A-Za-z0-9]+)/);
  const code = (fromUrl ? fromUrl[1] : String(raw)).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 ? code.slice(0, 8) : '';
}
