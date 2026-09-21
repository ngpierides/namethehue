// stats.js
// The player's own history across days - Played / Avg guesses / streaks and the
// guess distribution. There's no fail state (guesses are unlimited), so `won`
// really means "completed": every finished day counts, streaks are runs of
// consecutive completed days, and the headline metric is how few guesses it
// took vs the day's par. (Any legacy won:false record simply doesn't extend a
// streak.)
//
// The history is a simple map { dayNumber: { won, guesses } }. It's the unit
// that syncs to the cloud when a player logs in (see auth.js): the whole map is
// merged with the server copy and pushed back, so stats survive across devices.
//
// Persistence is ACCOUNT-GATED: stats are saved to the browser (localStorage)
// only while signed in. Signed-out guests keep their history in memory for the
// current page session only — it never touches localStorage and is gone on
// reload. auth.js flips the gate via setStatsPersist() on every session change.
// The working copy is always the in-memory `mem` object, so a guest's results
// modal is still coherent right after they solve.

import { CONFIG, resolvedTimeZone } from './config.js';

const STATS_KEY = 'colordle:stats';

// ---- Personal stats (real, from this browser's history) --------------------

let persist = false;   // true only while signed in — the account gate
let mem = null;        // the single in-memory working copy (lazily seeded)

/**
 * Turn browser persistence on/off. Called by auth.js: on when a session exists,
 * off when signed out. Turning it on flushes this session's in-memory history
 * so the login sync can push it up; turning it off forgets the browser copy.
 */
export function setStatsPersist(on) {
  const was = persist;
  persist = !!on;
  if (persist && !was) {
    save(loadRaw()); // signed in: flush in-memory history to localStorage for sync
  } else if (!persist && was) {
    mem = { days: {} }; // signed out: stats live only with an account
    try { localStorage.removeItem(STATS_KEY); } catch { /* ignore */ }
  }
}

function loadRaw() {
  if (mem) return mem;
  if (persist) {
    try { mem = JSON.parse(localStorage.getItem(STATS_KEY)) || { days: {} }; }
    catch { mem = { days: {} }; }
  } else {
    mem = { days: {} }; // guest: start clean, in memory only
  }
  return mem;
}

function save(raw) {
  mem = raw;
  if (!persist) return; // guests: in-memory only, nothing written to the browser
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(raw));
  } catch {
    /* ignore (private mode etc.) */
  }
}

// Anything that wants to know when the history changes (e.g. cloud sync) can
// subscribe. Fired after every local write.
const listeners = [];
export function onStatsChange(fn) {
  listeners.push(fn);
}
function emit() {
  listeners.forEach((f) => {
    try {
      f();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Record the outcome of a finished day. Idempotent - safe to call every time a
 * finished day is shown, so browsing back through history backfills your stats.
 * @param {number[]} [pcts] the closeness % of each guess that day, for the
 *   average-accuracy stat. Omitted/empty when reconstructing from synced stats
 *   (we then keep whatever percentages we already had).
 */
export function recordResult(dayNumber, won, guesses, pcts, par) {
  const raw = loadRaw();
  const prev = raw.days[dayNumber];
  const entry = { won, guesses };
  if (pcts && pcts.length) entry.pcts = pcts;
  else if (prev?.pcts) entry.pcts = prev.pcts; // don't lose percentages on a re-record
  // `par` is recorded per solve (used in the results header + share text); keep
  // any earlier value.
  if (par != null) entry.par = par;
  else if (prev?.par != null) entry.par = prev.par;

  if (
    prev &&
    prev.won === won &&
    prev.guesses === guesses &&
    prev.par === entry.par &&
    JSON.stringify(prev.pcts || null) === JSON.stringify(entry.pcts || null)
  ) {
    return; // no change
  }
  raw.days[dayNumber] = entry;
  save(raw);
  emit();
}

/** The full history blob (a copy), for pushing to the cloud. */
export function getStatsBlob() {
  return { days: { ...loadRaw().days } };
}

/** The recorded outcome for a day, e.g. { won, guesses }, or null if never finished. */
export function getDayResult(dayNumber) {
  return loadRaw().days[dayNumber] || null;
}

/**
 * Merge a cloud history into the local one and save. For any day both sides
 * know about, the better outcome wins (a win beats a loss; fewer guesses wins).
 * Returns the merged days map.
 */
export function mergeIntoLocal(cloudDays) {
  const raw = loadRaw();
  for (const [day, cloud] of Object.entries(cloudDays || {})) {
    raw.days[day] = betterOutcome(raw.days[day], cloud);
  }
  save(raw);
  emit();
  return raw.days;
}

function betterOutcome(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.won !== b.won) return a.won ? a : b; // a win beats a loss
  if (a.won && b.won && a.guesses !== b.guesses) return a.guesses < b.guesses ? a : b;
  // Same result on both sides - keep whichever has the detailed percentages.
  return a.pcts?.length ? a : b;
}

/** Derive all the summary numbers + personal guess distribution from history. */
export function getPersonalStats() {
  const days = loadRaw().days;
  const nums = Object.keys(days).map(Number).sort((a, b) => a - b);

  // The distribution is bucketed 1..distCap, with the final bucket holding
  // "distCap or more" so an unbounded guess count still fits a fixed chart.
  const distCap = CONFIG.distCap;
  const dist = {};
  for (let i = 1; i <= distCap; i++) dist[i] = 0;
  let wins = 0; // completed days (there's no fail state)
  let guessSum = 0; // total guesses across completed days, for the average
  let accSum = 0; // running total of every guess's closeness %
  let accCount = 0;

  nums.forEach((n) => {
    const r = days[n];
    if (r.won) {
      wins++;
      guessSum += r.guesses;
      const bucket = Math.min(r.guesses, distCap);
      dist[bucket] = (dist[bucket] || 0) + 1;
    }
    if (Array.isArray(r.pcts)) {
      r.pcts.forEach((p) => {
        accSum += p;
        accCount++;
      });
    }
  });

  // Streaks are runs of consecutive day numbers that were won.
  let maxStreak = 0;
  let run = 0;
  for (let i = 0; i < nums.length; i++) {
    const consecutive = i > 0 && nums[i] === nums[i - 1] + 1;
    run = days[nums[i]].won ? (consecutive && days[nums[i - 1]].won ? run + 1 : 1) : 0;
    maxStreak = Math.max(maxStreak, run);
  }
  // Current streak: consecutive wins ending at the most recent day played.
  let curStreak = 0;
  for (let i = nums.length - 1; i >= 0; i--) {
    if (!days[nums[i]].won) break;
    if (i < nums.length - 1 && nums[i + 1] !== nums[i] + 1) break;
    curStreak++;
  }

  const played = nums.length;
  const maxBar = Math.max(1, ...Object.values(dist));
  return {
    played,
    wins,
    curStreak,
    maxStreak,
    dist,
    distCap,
    maxBar,
    // Average guesses per completed day, one decimal (null until there's data).
    avgGuesses: wins ? Math.round((guessSum / wins) * 10) / 10 : null,
    // Average closeness across every guess ever made (null until there's data).
    avgAccuracy: accCount ? Math.round(accSum / accCount) : null,
  };
}

// ---- Sharing & countdown ---------------------------------------------------

/** Shareable text: guesses vs par, plus the closeness "heat" squares. */
export function buildShareText(dayNumber, game) {
  const n = game.guessesUsed;
  const par = game.puzzle.par;
  const tag = n === 1 ? ' 🎯 hole in one!' : n < par ? ' - under par!' : n === par ? ' - on par' : '';
  const squares = game.guesses
    .map((g) =>
      g.correct ? '🟩' : g.closeness >= 67 ? '🟨' : g.closeness >= 34 ? '🟧' : '🟥'
    )
    .join('');
  return `Name the Hue #${dayNumber} - solved in ${n} (par ${par})${tag}\n${squares}`;
}

/** Milliseconds until the next daily reset (midnight in the configured zone). */
export function msUntilNextReset() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolvedTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const secondsElapsed = get('hour') * 3600 + get('minute') * 60 + get('second');
  return (86400 - secondsElapsed) * 1000;
}

/** Human note describing when/where the puzzle resets, matching CONFIG.timeZone. */
export function resetZoneNote() {
  const local = CONFIG.timeZone === 'local';
  const zone = resolvedTimeZone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const city = zone.split('/').pop().replace(/_/g, ' ');
  const abbr = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  const suffix = abbr ? ` (${abbr})` : '';
  return local
    ? `Resets at your local midnight - ${city}${suffix}`
    : `Resets at midnight in ${city}${suffix}`;
}
