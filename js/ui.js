// ui.js
// Everything that touches the DOM. It renders the grid and guess list from
// game state, and forwards clicks to the Game. Kept separate from game.js so
// the rules stay easy to read and test.

import { CONFIG } from './config.js';
import { luminance } from './color.js';
import { recordResult } from './stats.js';
import { attachColorField } from './colorfield.js';

export class UI {
  /** @param {import('./game.js').Game} game
   *  @param {{ isToday: boolean, dateLabel: string, results: import('./results.js').Results }} opts */
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.results = opts.results;
    this.gridEl = document.getElementById('grid');
    this.guessListEl = document.getElementById('guess-list');
    this.messageEl = document.getElementById('message');
    this.pipsEl = document.getElementById('pips');
    this.bestScoreEl = document.getElementById('best-score');
    this.tiles = [];
  }

  /** (Re)render for the current day: rebuild the grid, then paint state. */
  init() {
    document.getElementById('target-name').textContent = this.game.puzzle.target.name;

    const dayLabel = document.getElementById('day-label');
    if (this.opts.practice) {
      dayLabel.innerHTML = '<span class="hard-badge">Practice</span>';
    } else {
      const badge = this.opts.isToday ? ' <span class="today-badge">Today</span>' : '';
      dayLabel.innerHTML = `Day ${this.game.dayNumber} · ${this.opts.dateLabel}${badge}`;
    }

    // Running guess count, shown against the day's par so there's a goal.
    document.getElementById('guesses-label').textContent = `Guesses · Par ${this.game.puzzle.par}`;

    this.gridEl.style.setProperty('--cols', CONFIG.gridCols);
    this._buildGrid();
    this.render();

    // Backfill stats for a day that's already finished, but don't pop the
    // modal open just for revisiting it - that only happens on a fresh finish.
    if (this.game.isOver) this._record();
  }

  _record() {
    if (this.opts.practice) return; // practice never touches daily stats
    recordResult(
      this.game.dayNumber,
      this.game.status === 'won',
      this.game.guessesUsed,
      this.game.guessPercents,
      this.game.puzzle.par
    );
  }

  _buildGrid() {
    this.gridEl.innerHTML = '';
    this.tiles = this.game.puzzle.cells.map((cell, index) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.type = 'button';
      tile.style.setProperty('--swatch', cell.hex);
      tile.dataset.index = index;
      tile.setAttribute('aria-label', `Swatch ${index + 1}`);

      // A mark shown over eliminated / guessed tiles (chip holds the text).
      const mark = document.createElement('span');
      mark.className = 'tile-mark';
      const inner = document.createElement('span');
      inner.className = 'mark-inner';
      mark.appendChild(inner);
      tile.appendChild(mark);

      // Left-click / tap = guess. Right-click = flag (eliminate).
      tile.addEventListener('click', () => {
        if (tile._longPressed) { tile._longPressed = false; return; } // was a flag
        this._onGuess(index);
      });
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._onEliminate(index);
      });

      // Touch has no right-click, so a long-press flags instead. We cancel the
      // synthetic click that follows so a long-press never also guesses.
      let timer = null;
      const cancel = () => { clearTimeout(timer); timer = null; };
      tile.addEventListener('touchstart', () => {
        tile._longPressed = false;
        timer = setTimeout(() => {
          tile._longPressed = true;
          this._onEliminate(index);
          if (navigator.vibrate) navigator.vibrate(15);
        }, 450);
      }, { passive: true });
      tile.addEventListener('touchmove', cancel, { passive: true });
      tile.addEventListener('touchend', cancel);
      tile.addEventListener('touchcancel', cancel);

      this.gridEl.appendChild(tile);
      return tile;
    });
  }

  _onGuess(index) {
    const result = this.game.guess(index);
    if (!result) return;
    this.render();
    // A guess that ends the game records the result and shows the modal.
    if (this.game.isOver) {
      this._record();
      if (this.results) this.results.open({ game: this.game, dayNumber: this.game.dayNumber });
    }
  }

  _onEliminate(index) {
    this.game.toggleEliminated(index);
    this.render();
  }

  /** Repaint everything from game state. Safe to call any time. */
  render() {
    const g = this.game;

    // Meta: guesses used/left, best match so far.
    this._renderGuessMeter(g.guessesUsed);
    const best = g.guesses.reduce((m, x) => Math.max(m, x.closeness), 0);
    this.bestScoreEl.textContent = g.guesses.length ? `${best}%` : '-';

    // Tiles.
    this.tiles.forEach((tile, index) => {
      const guessed = g.guesses.find((x) => x.index === index);
      const eliminated = g.eliminated.has(index);
      const isAnswer = index === g.puzzle.targetIndex;

      tile.classList.toggle('is-eliminated', eliminated && !guessed);
      tile.classList.toggle('is-guessed', !!guessed);
      tile.classList.toggle('is-correct', !!guessed?.correct);
      tile.classList.toggle('is-answer', g.isOver && isAnswer);
      // Dark swatches need light marks; light swatches need dark ones.
      tile.classList.toggle('on-dark', luminance(g.puzzle.cells[index].hex) < 0.4);

      const inner = tile.querySelector('.mark-inner');
      if (guessed) inner.textContent = `${guessed.closeness}%`;
      else if (eliminated) inner.textContent = '✕';
      else inner.textContent = '';
    });

    this._renderGuessList();
    this._renderMessage();
  }

  _renderGuessMeter(used) {
    // A running count of guesses made, tinted once it climbs past par.
    this.pipsEl.classList.add('pips--count');
    this.pipsEl.classList.toggle('pips--overpar', used > this.game.puzzle.par);
    this.pipsEl.textContent = String(used);
  }

  _renderGuessList() {
    // A compact history strip - the tiles already carry name/hex/%, so each
    // past guess is just a swatch chip + its closeness, newest first.
    this.guessListEl.innerHTML = '';
    [...this.game.guesses].reverse().forEach((x) => {
      const li = document.createElement('li');
      li.className = 'guess-chip' + (x.correct ? ' guess-chip--correct' : '');
      li.title = x.name;
      li.dataset.hex = x.hex; // shown as a tooltip on hover (see .guess-chip:hover)
      li.innerHTML = `
        <span class="guess-chip-swatch" style="background:${x.hex}"></span>
        <span class="guess-chip-pct">${x.closeness}%</span>`;
      this.guessListEl.appendChild(li);
    });
  }

  _renderMessage() {
    const g = this.game;
    const el = this.messageEl;

    // Only-shown-on-its-day banner. When the current day isn't over we fully
    // reset the element - clearing its contents and forcing it hidden via an
    // inline style - so a previous day's banner can never linger, regardless
    // of any stale/cached CSS.
    if (!g.isOver) {
      el.hidden = true;
      el.style.display = 'none';
      el.className = 'message';
      el.innerHTML = '';
      return;
    }

    el.hidden = false;
    el.style.display = '';
    const t = g.puzzle.target;
    const n = g.guessesUsed;
    const par = g.puzzle.par;
    const verdict =
      n === 1 ? '🎯 Hole in one!' : n < par ? 'Under par!' : n === par ? 'On par.' : 'Solved.';
    el.className = 'message message--win';
    el.innerHTML = `
      <span class="message-swatch" style="background:${t.hex}"></span>
      <span><strong>${verdict}</strong> <em>${escapeHtml(t.name)}</em> (${t.hex}),
      found in ${n} guess${n === 1 ? '' : 'es'} · par ${par}.</span>`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- Hard Mode UI ("mix the colour") ---------------------------------------

/**
 * The Pro Hard-Mode board: same layout shell as the grid game (plate, meta,
 * message, guess history, results modal) but the grid is replaced by an HSL
 * mixer. Talks to a HardGame, records into the same stats.
 */
export class HardUI {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.results = opts.results;
    this.hardEl = document.getElementById('hard');
    this.guessListEl = document.getElementById('guess-list');
    this.messageEl = document.getElementById('message');
    this.pipsEl = document.getElementById('pips');
    this.bestScoreEl = document.getElementById('best-score');
    this.guessBtn = document.getElementById('hard-guess');
  }

  init() {
    document.getElementById('target-name').textContent = this.game.puzzle.target.name;
    const hardBadge = ' <span class="hard-badge">Hard</span>';
    if (this.opts.practice) {
      document.getElementById('day-label').innerHTML =
        `<span class="hard-badge">Practice</span>${hardBadge}`;
    } else {
      const badge = this.opts.isToday ? ' <span class="today-badge">Today</span>' : '';
      document.getElementById('day-label').innerHTML =
        `Day ${this.game.dayNumber} · ${this.opts.dateLabel}${badge}${hardBadge}`;
    }
    document.getElementById('guesses-label').textContent = `Guesses · Par ${this.game.puzzle.par}`;

    // Show the mixer, hide the grid.
    document.getElementById('grid').hidden = true;
    this.hardEl.hidden = false;

    this.field = attachColorField({
      field: document.getElementById('hard-field'),
      gray: document.getElementById('hard-gray'),
      marker: document.getElementById('hard-marker'),
      circle: document.getElementById('hard-preview'),
      hex: document.getElementById('hard-hex'),
    });
    this.guessBtn.onclick = () => this._onGuess();

    // Start from the last mix tried, else a neutral grey (marker hidden until a pick).
    const last = this.game.guesses[this.game.guesses.length - 1];
    this.field.set(last ? last.hex : '#808080', null);

    this.render();
    if (this.game.isOver) this._record();
  }

  destroy() {
    // Leaving hard mode: put the grid back for the normal game.
    this.hardEl.hidden = true;
    document.getElementById('grid').hidden = false;
  }

  _record() {
    if (this.opts.practice) return; // practice never touches daily stats
    recordResult(
      this.game.dayNumber,
      this.game.status === 'won',
      this.game.guessesUsed,
      this.game.guessPercents,
      this.game.puzzle.par
    );
  }

  _onGuess() {
    const result = this.game.guess(this.field.get());
    if (!result) return;
    this.render();
    if (this.game.isOver) {
      this._record();
      if (this.results) this.results.open({ game: this.game, dayNumber: this.game.dayNumber });
    }
  }

  render() {
    const g = this.game;
    // Meta: guess count vs par, best match so far.
    this.pipsEl.classList.add('pips--count');
    this.pipsEl.classList.toggle('pips--overpar', g.guessesUsed > g.puzzle.par);
    this.pipsEl.textContent = String(g.guessesUsed);
    const best = g.guesses.reduce((m, x) => Math.max(m, x.closeness), 0);
    this.bestScoreEl.textContent = g.guesses.length ? `${best}%` : '-';

    // Lock the mixer once solved.
    this.guessBtn.disabled = g.isOver;
    this.field.setLocked(g.isOver);

    this._renderHistory();
    this._renderMessage();
  }

  _renderHistory() {
    this.guessListEl.innerHTML = '';
    [...this.game.guesses].reverse().forEach((x) => {
      const li = document.createElement('li');
      li.className = 'guess-chip' + (x.correct ? ' guess-chip--correct' : '');
      li.title = `ΔE ${x.deltaE}`;
      li.dataset.hex = x.hex;
      li.innerHTML = `
        <span class="guess-chip-swatch" style="background:${x.hex}"></span>
        <span class="guess-chip-pct">${x.closeness}%</span>`;
      this.guessListEl.appendChild(li);
    });
  }

  _renderMessage() {
    const g = this.game;
    const el = this.messageEl;
    if (!g.isOver) {
      el.hidden = true;
      el.style.display = 'none';
      el.className = 'message';
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.style.display = '';
    const t = g.puzzle.target;
    const n = g.guessesUsed;
    const par = g.puzzle.par;
    const verdict = n === 1 ? '🎯 First-mix match!' : n <= par ? 'Nailed it!' : 'Mixed it.';
    el.className = 'message message--win';
    el.innerHTML = `
      <span class="message-swatch" style="background:${t.hex}"></span>
      <span><strong>${verdict}</strong> <em>${escapeHtml(t.name)}</em> was ${t.hex},
      mixed in ${n} guess${n === 1 ? '' : 'es'} · par ${par}.</span>`;
  }
}

