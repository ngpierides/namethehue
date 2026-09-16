// game.js
// The rules engine. Holds the state of one day's game and exposes the two
// player actions (guess, eliminate). Knows nothing about the DOM.

import { CONFIG } from './config.js';
import { deltaE00, hexToLab, closenessPercent } from './color.js';
import { loadState, saveState } from './storage.js';
import { getDayResult } from './stats.js';

export class Game {
  constructor({ dayNumber, puzzle, practice = false }) {
    this.dayNumber = dayNumber;
    this.puzzle = puzzle; // { target, targetIndex, cells }
    this.practice = practice; // ephemeral: no persistence, no stats, no reconstruction
    this.targetLab = hexToLab(puzzle.target.hex);

    // Restore saved progress for today, if any (never in practice).
    const saved = practice ? null : loadState(dayNumber);
    this.guesses = saved?.guesses ?? []; // [{ index, name, hex, closeness, correct }]
    this.eliminated = new Set(saved?.eliminated ?? []); // Set<index>
    this.status = saved?.status ?? 'playing'; // 'playing' | 'won' (no fail state)
    this._syncedGuesses = 0; // guess count reconstructed from synced stats

    // No local board, but the (cloud-synced) stats say this day was finished?
    // Reflect that so a played day shows as done on every device - locked, with
    // the result revealed. The exact per-guess board doesn't sync (stats only
    // store the outcome), so we reconstruct just the outcome + guess count.
    if (!practice && this.status === 'playing' && this.guesses.length === 0) {
      const rec = getDayResult(dayNumber);
      if (rec) {
        this.status = 'won'; // any finished day is a completed/solved day
        this._syncedGuesses = rec.guesses;
      }
    }
  }

  get guessesUsed() {
    return this.guesses.length || this._syncedGuesses;
  }

  /** Closeness % of each guess this game - feeds the average-accuracy stat. */
  get guessPercents() {
    return this.guesses.map((g) => g.closeness);
  }

  get isOver() {
    return this.status !== 'playing';
  }

  /** Has this cell index already been guessed? */
  hasGuessed(index) {
    return this.guesses.some((g) => g.index === index);
  }

  /** Right-click action: flag/unflag a swatch as ruled out. Doesn't cost a guess. */
  toggleEliminated(index) {
    if (this.isOver) return;
    if (this.hasGuessed(index)) return; // already-guessed tiles can't be flagged
    if (this.eliminated.has(index)) this.eliminated.delete(index);
    else this.eliminated.add(index);
    this._persist();
  }

  /**
   * Left-click action: guess a swatch.
   * @returns the guess record { index, name, hex, closeness, correct } or null
   *          if the click was a no-op (game over, eliminated, or repeat).
   */
  guess(index) {
    if (this.isOver) return null;
    if (this.eliminated.has(index)) return null; // ignore flagged tiles
    if (this.hasGuessed(index)) return null; // don't spend a guess twice

    const cell = this.puzzle.cells[index];
    const correct = index === this.puzzle.targetIndex;
    const dE = deltaE00(this.targetLab, hexToLab(cell.hex));
    const closeness = correct ? 100 : closenessPercent(dE, CONFIG.closenessMaxDeltaE);

    const record = { index, name: cell.name, hex: cell.hex, closeness, correct };
    this.guesses.push(record);

    if (correct) this.status = 'won';

    this._persist();
    return record;
  }

  _persist() {
    if (this.practice) return; // practice puzzles are ephemeral
    saveState(this.dayNumber, {
      guesses: this.guesses,
      eliminated: [...this.eliminated],
      status: this.status,
    });
  }
}

// Solved in Hard Mode when your mix is within this ΔE2000 of the true colour.
// ~5 is a small, achievable-with-care difference (2–3 is near-imperceptible).
const HARD_WIN_DE = 5;

/**
 * HardGame - the Pro "mix the colour" mode. Same public shape as Game (so the
 * results modal / stats / share work unchanged), but a guess is an arbitrary
 * hex the player mixed rather than a grid index. There's no grid and no
 * eliminate. Its board is saved separately (storage mode 'hard') and it never
 * reconstructs from the shared daily stats, so Hard Mode is played on its own
 * even on a day already solved in the normal grid game.
 */
export class HardGame {
  constructor({ dayNumber, puzzle, practice = false }) {
    this.dayNumber = dayNumber;
    this.puzzle = puzzle; // { target, par, ... }
    this.mode = 'hard';
    this.practice = practice;
    this.targetLab = hexToLab(puzzle.target.hex);

    const saved = practice ? null : loadState(dayNumber, 'hard');
    this.guesses = saved?.guesses ?? []; // [{ hex, closeness, correct }]
    this.status = saved?.status ?? 'playing'; // 'playing' | 'won'
    this._syncedGuesses = 0;
  }

  get guessesUsed() {
    return this.guesses.length || this._syncedGuesses;
  }
  get guessPercents() {
    return this.guesses.map((g) => g.closeness);
  }
  get isOver() {
    return this.status !== 'playing';
  }

  /**
   * Submit a mixed colour.
   * @param {string} hex e.g. "#3c7d5a"
   * @returns the guess record { hex, closeness, correct, deltaE } or null if over.
   */
  guess(hex) {
    if (this.isOver) return null;
    const dE = deltaE00(this.targetLab, hexToLab(hex));
    const correct = dE <= HARD_WIN_DE;
    const closeness = correct ? 100 : closenessPercent(dE, CONFIG.closenessMaxDeltaE);
    const record = { hex, closeness, correct, deltaE: Math.round(dE * 10) / 10 };
    this.guesses.push(record);
    if (correct) this.status = 'won';
    this._persist();
    return record;
  }

  _persist() {
    if (this.practice) return;
    saveState(this.dayNumber, { guesses: this.guesses, status: this.status }, 'hard');
  }
}
