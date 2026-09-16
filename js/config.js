// config.js
// All the knobs for the game live here. Tweak these to change how it plays.

export const CONFIG = {
  // Day 1 of Name the Hue. The puzzle for a date is decided by how many days have
  // passed since this date (measured in the player's day, see timeZone).
  epoch: '2026-09-12',

  // When a new day's puzzle unlocks.
  //   'local'  -> each player rolls over at THEIR OWN local midnight. This is
  //              what NYT Wordle does: it feels like "a new colour each morning"
  //              everywhere, and players on the same calendar date still get the
  //              same colour. Trade-off: across the date line, "today" can differ
  //              by a day, which only matters for a single global cutoff.
  //   an IANA zone e.g. 'America/New_York' or 'Australia/Melbourne' -> ONE
  //              shared global cutoff: everyone flips at that zone's midnight
  //              (best if you later add a global leaderboard). Pick a US zone if
  //              your audience is mostly US.
  timeZone: 'local',

  // Grid size. cols * rows = number of colour swatches shown.
  gridCols: 8,
  gridRows: 6, // 8 x 6 = 48 swatches

  // Name the Hue uses the "Globle" model: there is NO fail state. You keep guessing
  // until you find the colour; the score is how FEW guesses it took, measured
  // against a per-day "par" derived from the puzzle's difficulty (see puzzle.js).

  // The guess distribution buckets counts 1..distCap and lumps the rest into a
  // final "distCap+" row (guess counts are unbounded).
  distCap: 6,

  // Of the 47 non-answer swatches, how many are the *closest* colours to the
  // answer (hard distractors). The rest are picked at random from the list.
  // More = harder, because near-misses look almost right.
  hardDistractors: 10,

  // ΔE2000 distance at (or above) which the closeness score reads 0%.
  // Smaller = harsher scoring. ~60 is a good "obviously different" threshold.
  closenessMaxDeltaE: 40,
};

/**
 * The IANA zone to pass to Intl for date maths - or `undefined`, which makes
 * Intl use the player's own local zone (that's the 'local' setting above).
 */
export function resolvedTimeZone() {
  return CONFIG.timeZone === 'local' ? undefined : CONFIG.timeZone;
}
