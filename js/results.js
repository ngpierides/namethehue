// results.js
// The NYT-Wordle-style results overlay: outcome, personal stats, the personal
// guess distribution, the (estimated) community distribution, a countdown to
// the next puzzle, and a share button. Reads state; owns only the modal DOM.

import {
  getPersonalStats,
  buildShareText,
  msUntilNextReset,
  resetZoneNote,
} from './stats.js';
import { isConfigured, getSession, signUp } from './auth.js';
import { escapeHtml, flash } from './dom.js';

export class Results {
  /** @param {{ onLoginClick?: ()=>void }} opts */
  constructor(opts = {}) {
    this.el = document.getElementById('results');
    this.card = document.getElementById('results-card');
    this.countdownTimer = null;
    this.onLoginClick = opts.onLoginClick;
    this.onChallengeClick = opts.onChallengeClick;
    this.onArchiveClick = opts.onArchiveClick;

    // "Play past puzzles" jumps to the Archive (which itself gates on Pro).
    document.getElementById('results-archive').addEventListener('click', () => {
      this.close();
      this.onArchiveClick?.();
    });

    // "Challenge a friend" jumps from the results screen into multiplayer.
    document.getElementById('mp-invite-btn').addEventListener('click', () => {
      this.close();
      this.onChallengeClick?.();
    });

    // Close on the ✕, on backdrop click, or on Escape.
    document.getElementById('results-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });

    // Inline account-creation form (guests only): the form signs up via auth.js;
    // "Log in" hands existing users off to the full profile modal.
    document.getElementById('rs-login').addEventListener('click', () => {
      this.close();
      this.onLoginClick?.();
    });
    document.getElementById('results-signup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._signup();
    });
  }

  async _signup() {
    const q = (id) => document.getElementById(id);
    const msg = q('rs-msg');
    const btn = q('results-signup-form').querySelector('button[type="submit"]');
    const name = q('rs-name').value.trim();
    const email = q('rs-email').value.trim();
    const pass = q('rs-pass').value;
    msg.className = 'auth-msg';
    msg.textContent = 'Creating account…';
    btn.disabled = true;
    try {
      const { needsConfirmation } = await signUp(email, pass, name);
      msg.className = 'auth-msg auth-msg--ok';
      msg.textContent = needsConfirmation
        ? `Thanks, ${name || 'there'}! Check your email to confirm, then log in.`
        : 'Account created - your stats are now being saved!';
    } catch (err) {
      msg.className = 'auth-msg auth-msg--error';
      msg.textContent = err?.message || 'Something went wrong.';
    } finally {
      btn.disabled = false;
    }
  }

  /** @param {{ game, dayNumber }} ctx */
  open(ctx) {
    this._render(ctx);
    this.el.hidden = false;
    this._startCountdown();
  }

  close() {
    this.el.hidden = true;
    clearInterval(this.countdownTimer);
  }

  _render({ game, dayNumber }) {
    const over = game.isOver;
    const t = game.puzzle.target;

    // Outcome header (only meaningful once the game is over). There's no fail
    // state, so it's always a solve - headlined against the day's par.
    const outcome = document.getElementById('results-outcome');
    if (over) {
      const n = game.guessesUsed;
      const par = game.puzzle.par;
      const verdict =
        n === 1 ? '🎯 Hole in one!' : n < par ? 'Under par!' : n === par ? 'On par' : 'Solved';
      outcome.innerHTML = `
        <span class="results-swatch" style="background:${t.hex}"></span>
        <span class="results-outcome-text">
          <strong>${verdict}</strong>
          <span class="results-answer">${escapeHtml(t.name)} · solved in ${n} · par ${par}</span>
        </span>`;
      outcome.hidden = false;
    } else {
      outcome.hidden = true;
    }

    // Stats + distribution are an account perk: signed-out guests (cloud
    // configured but not logged in) get the account-creation nudge instead, so
    // there's a real reason to sign up. Local-only mode still shows them (there's
    // no account to create there).
    const guest = isConfigured() && !getSession();
    document.getElementById('results-stats').hidden = guest;

    // Personal summary numbers.
    const s = getPersonalStats();
    document.getElementById('stat-played').textContent = s.played;
    document.getElementById('stat-avgguesses').textContent =
      s.avgGuesses == null ? '-' : s.avgGuesses;
    document.getElementById('stat-accuracy').textContent =
      s.avgAccuracy == null ? '-' : `${s.avgAccuracy}%`;
    document.getElementById('stat-streak').textContent = s.curStreak;
    document.getElementById('stat-maxstreak').textContent = s.maxStreak;

    // Personal distribution - highlight this game's row if it was solved here
    // (capped to the final "N+" bucket for a very high guess count).
    const highlight =
      over && game.status === 'won' ? Math.min(game.guessesUsed, s.distCap) : -1;
    document.getElementById('dist-personal').innerHTML = personalBars(s, highlight);

    // Share is only useful once there's a result to share.
    const shareBtn = document.getElementById('share-btn');
    shareBtn.hidden = !over;
    shareBtn.onclick = () => this._share(dayNumber, game, shareBtn);

    // Support link - only after a win or loss, not when peeking at stats mid-game.
    document.getElementById('coffee-link').hidden = !over;

    // Archive CTA - same "post-game only" rule. The Archive shows the Pro upsell
    // to free players, so this doubles as the results-screen funnel into Pro.
    document.getElementById('results-archive').hidden = !over;

    // Guests get the inline account-creation form instead of the stats above
    // (hidden in local-only mode, where there's no account to create).
    document.getElementById('results-signup').hidden = !guest;
  }

  async _share(dayNumber, game, btn) {
    const text = buildShareText(dayNumber, game);
    try {
      await navigator.clipboard.writeText(text);
      flash(btn, 'Copied!', { disable: true });
    } catch {
      // Clipboard blocked (e.g. insecure context): fall back to a prompt.
      window.prompt('Copy your result:', text);
    }
  }

  _startCountdown() {
    const el = document.getElementById('countdown');
    document.getElementById('countdown-note').textContent = resetZoneNote();
    const tick = () => {
      let ms = msUntilNextReset();
      if (ms <= 0) ms = 0;
      const h = Math.floor(ms / 3.6e6);
      const m = Math.floor((ms % 3.6e6) / 6e4);
      const sec = Math.floor((ms % 6e4) / 1000);
      el.textContent = `${pad(h)}:${pad(m)}:${pad(sec)}`;
    };
    tick();
    clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(tick, 1000);
  }
}

// ---- bar-chart renderers ---------------------------------------------------

function personalBars(stats, highlight) {
  let rows = '';
  const cap = stats.distCap;
  for (let k = 1; k <= cap; k++) {
    const count = stats.dist[k];
    const width = Math.max(8, (count / stats.maxBar) * 100);
    // The final bucket lumps together "k or more" guesses.
    const label = k === cap ? `${k}+` : `${k}`;
    rows += `
      <div class="dist-row">
        <span class="dist-key">${label}</span>
        <span class="dist-track">
          <span class="dist-fill ${k === highlight ? 'dist-fill--now' : ''}"
                style="width:${width}%">${count}</span>
        </span>
      </div>`;
  }
  return rows;
}

// ---- helpers ---------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}
