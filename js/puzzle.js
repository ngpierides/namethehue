// puzzle.js
// Turns a day number into a fully-specified puzzle: the target colour (name +
// hex) and the grid of swatches it lives in. Everything is deterministic, so
// the same day always yields the same puzzle for every player.

import { CONFIG, resolvedTimeZone } from './config.js';
import { hashSeed, makeRng, shuffle } from './rng.js';
import { deltaE00, hexToLab } from './color.js';

/** The calendar {y,m,d} of `date` as seen in a given IANA time zone. */
function ymdInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function epochYmd() {
  const [y, m, d] = CONFIG.epoch.split('-').map(Number);
  return { y, m, d };
}

/** Whole days between two calendar dates (order: later - earlier). */
function daysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/** The day number playing "right now" in the configured time zone (epoch = day 1). */
export function currentDayNumber() {
  const today = ymdInTimeZone(new Date(), resolvedTimeZone());
  return daysBetween(epochYmd(), today) + 1;
}

/** The calendar Date (UTC midnight) that a given day number falls on. */
export function dateForDay(dayNumber) {
  const e = epochYmd();
  return new Date(Date.UTC(e.y, e.m - 1, e.d) + (dayNumber - 1) * 86400000);
}

/** A human label for a day number, e.g. "Fri, 12 Sep 2026". */
export function formatDayDate(dayNumber) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(dateForDay(dayNumber));
}

/**
 * Pick the target colour for a day.
 * - If puzzles.json defines an override for this day, that wins.
 * - Otherwise we walk a fixed, shuffled ordering of the master list, so days
 *   never repeat a colour until the whole list is exhausted.
 */
function pickTarget(dayNumber, colors, overrides) {
  const override = overrides && overrides[String(dayNumber)];
  if (override && override.hex) {
    return { name: override.name || 'Mystery colour', hex: override.hex.toLowerCase() };
  }
  // Fixed global shuffle (seed is constant) => a stable "deck" of colours.
  const deck = shuffle(colors, makeRng(hashSeed('colordle-deck')));
  return deck[(dayNumber - 1) % deck.length];
}

/**
 * Build the grid of swatches for a day. Includes the target plus a mix of
 * "hard" near-miss distractors and random colours from the list. Positions
 * are shuffled deterministically per day.
 * @returns {{ target, targetIndex, cells: Array<{name,hex}> }}
 */
export function buildPuzzle(dayNumber, dataset, overrides) {
  const colors = dataset.colors;
  const target = pickTarget(dayNumber, colors, overrides);
  return assemblePuzzle(target, hashSeed(`colordle-grid-${dayNumber}`), colors);
}

/**
 * Build a random (non-daily) puzzle for multiplayer. Given the same `seedStr`,
 * every client produces the *identical* target + grid, so a match only needs to
 * share the seed - never the grid itself. `excludeHex` (the day's colour) is
 * skipped so a multiplayer round never reuses today's puzzle.
 * @returns {{ target, targetIndex, cells, difficulty }}
 */
export function buildRandomPuzzle(seedStr, dataset, excludeHex) {
  const colors = dataset.colors;
  const rng = makeRng(hashSeed(`colordle-mp-target-${seedStr}`));
  let idx = Math.floor(rng() * colors.length);
  // Never pick the day's colour (walk forward until it's something else).
  for (let guard = 0; guard < colors.length && colors[idx].hex === excludeHex; guard++) {
    idx = (idx + 1) % colors.length;
  }
  return assemblePuzzle(colors[idx], hashSeed(`colordle-mp-grid-${seedStr}`), colors);
}

/**
 * Shared grid assembly for both the daily and multiplayer puzzles: place the
 * target among N nearest-ΔE "hard" distractors and random fillers, then shuffle
 * everything into slots. Deterministic in `gridSeed`.
 */
function assemblePuzzle(target, gridSeed, colors) {
  const size = CONFIG.gridCols * CONFIG.gridRows;
  const rng = makeRng(gridSeed);

  // Candidate pool: every colour except any sharing the target's hex.
  const pool = colors.filter((c) => c.hex !== target.hex);

  // Hard distractors: the colours that look most like the target.
  const targetLab = hexToLab(target.hex);
  const byCloseness = pool
    .map((c) => ({ c, d: deltaE00(targetLab, hexToLab(c.hex)) }))
    .sort((a, b) => a.d - b.d);

  const hardCount = Math.min(CONFIG.hardDistractors, size - 1);
  const hard = byCloseness.slice(0, hardCount).map((x) => x.c);
  const hardHexes = new Set(hard.map((c) => c.hex));

  // Random distractors: fill the rest from whatever's left.
  const remaining = pool.filter((c) => !hardHexes.has(c.hex));
  const randomNeeded = size - 1 - hard.length;
  const random = shuffle(remaining, rng).slice(0, randomNeeded);

  // Combine, place the target, then shuffle every swatch into its slot.
  const cells = shuffle([target, ...hard, ...random], rng);
  const targetIndex = cells.findIndex((c) => c.hex === target.hex && c.name === target.name);

  // Difficulty (0 = easy, 1 = hard): how confusingly close the nearest
  // distractors are. Small ΔE among neighbours => easy to mistake => harder.
  const avgNear =
    byCloseness.slice(0, hardCount).reduce((s, x) => s + x.d, 0) / Math.max(1, hardCount);
  const difficulty = Math.max(0.05, Math.min(0.95, 1 - avgNear / 40));

  // "Par": the guess count to beat, from difficulty. Easier days => tighter par.
  // Range 2 (very easy) … 6 (very hard). This is the daily goal: solve at or
  // under par. (Solving in 1 is a "hole in one".)
  const par = Math.max(2, Math.min(6, Math.round(2 + difficulty * 4)));

  return { target, targetIndex, cells, difficulty, par };
}
