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
import { isConfigured, getSession } from './auth.js';
import { escapeHtml, flash } from './dom.js';

export class Results {
  /** @param {{ onLoginClick?: ()=>void }} opts */
  constructor(opts = {}) {
    this.el = document.getElementById('results');
    this.card = document.getElementById('results-card');
    this.countdownTimer = null;
    this.onLoginClick = opts.onLoginClick;
    this.onChallengeClick = opts.onChallengeClick;

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

    // "Log in to save your streak" nudge (shown to guests only).
    document.getElementById('results-nudge').addEventListener('click', () => {
      this.close();
      this.onLoginClick?.();
    });
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

    // Nudge guests to log in - only when cloud login is available but nobody's
    // signed in. (Hidden in local-only mode, where there's nothing to log into.)
    const nudge = document.getElementById('results-nudge');
    nudge.hidden = !(isConfigured() && !getSession());
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
