// main.js
// Bootstraps the game: load data, work out the day, and let the player step
// between days with the prev/next controls.

import { currentDayNumber, buildPuzzle, buildRandomPuzzle, formatDayDate } from './puzzle.js';
import { Game, HardGame } from './game.js';
import { UI, HardUI } from './ui.js';
import { Results } from './results.js';
import { Profile } from './profile.js';
import { Settings, applyStoredPrefs } from './settings.js';
import { Multiplayer } from './multiplayer.js';
import { Archive } from './archive.js';
import { ProUpsell } from './proupsell.js';
import { isPro, isHardMode, onProChange, setCloudMode } from './pro.js';
import { initAuth, isConfigured, refreshSync } from './auth.js';
import { startCheckout, openPortal } from './billing.js';
import { showToast } from './toast.js';
import { logPageView } from './analytics.js';

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

async function main() {
  applyStoredPrefs(); // theme + reduce-motion, before the board paints

  logPageView(); // anonymous traffic count (fire-and-forget; no-op without Supabase)

  // Decide where Pro comes from before anything reads isPro(): the server when
  // Supabase is configured, else the local self-serve toggle. auth.js reconciles
  // the real entitlement once the session loads.
  setCloudMode(isConfigured());

  // The master colour list is required; per-day overrides are optional.
  const [dataset, overrides] = await Promise.all([
    loadJson('data/colors.json'),
    loadJson('data/puzzles.json', {}),
  ]);

  const today = currentDayNumber();

  // Days run 1..today - never the future. ?day=N still works for testing but is
  // clamped (and only honoured for Pro, since free players get today only).
  const clampDay = (day) => Math.max(1, Math.min(today, day));
  const params = new URLSearchParams(location.search);
  const forced = parseInt(params.get('day'), 10);

  const profile = new Profile();
  const settings = new Settings({
    onSubscribe: (plan) => startCheckout(plan),
    onManage: () => openPortal(),
    onUpsell: () => proUpsell.open(), // free player ticked a Pro-only control
  });
  document.getElementById('settings-btn').addEventListener('click', () => settings.open());

  // Multiplayer uses a random colour each round, but never today's - pass the
  // day's target hex so it can be excluded.
  const todayHex = buildPuzzle(today, dataset, overrides).target.hex;
  const mp = new Multiplayer({ dataset, todayHex });
  document.getElementById('mp-btn').addEventListener('click', () => mp.open());

  // The guest nudge on the results screen opens the login modal.
  const results = new Results({
    onLoginClick: () => profile.open(),
    onChallengeClick: () => mp.open(),
    onArchiveClick: () => archive.open({ today, current }),
  });

  // One shared "Get Name the Hue Pro" popup for every gated feature (archive +
  // practice); its button opens Settings, where Pro is toggled.
  const proUpsell = new ProUpsell({ onGoPro: () => settings.open() });

  // The archive button is always visible; without Pro it shows the shared Pro
  // upsell popup instead of the day list.
  const archive = new Archive({ onPick: (day) => show(day), onUpsell: () => proUpsell.open() });
  const archiveBtn = document.getElementById('archive-btn');
  archiveBtn.hidden = false;
  archiveBtn.addEventListener('click', () => archive.open({ today, current }));

  let current = 0;
  let currentGame = null;
  let currentUI = null;
  let practiceOn = false;
  let practiceSeed = 0;

  // Build the right Game/UI pair for a puzzle (daily or practice, grid or hard).
  function mount({ dayNumber, puzzle, isToday, dateLabel, practice }) {
    currentUI?.destroy?.(); // if leaving Hard Mode, restore the grid
    const opts = { isToday, dateLabel, practice, results: practice ? null : results };
    if (isHardMode()) {
      currentGame = new HardGame({ dayNumber, puzzle, practice });
      currentUI = new HardUI(currentGame, opts);
    } else {
      currentGame = new Game({ dayNumber, puzzle, practice });
      currentUI = new UI(currentGame, opts);
    }
    currentUI.init();
  }

  const practiceBar = document.getElementById('practice-bar');

  function show(day) {
    practiceOn = false;
    practiceBar.hidden = true;
    current = clampDay(day);
    const puzzle = buildPuzzle(current, dataset, overrides);
    mount({ dayNumber: current, puzzle, isToday: current === today, dateLabel: formatDayDate(current), practice: false });
  }

  // Practice: a fresh random puzzle (never the day's), no stats, unlimited retries.
  function showPractice(fresh) {
    if (!isPro()) { proUpsell.open(); return; } // gated - show the Pro upsell popup
    practiceOn = true;
    if (fresh || !practiceSeed) practiceSeed = Date.now() ^ Math.floor(Math.random() * 1e9);
    practiceBar.hidden = false;
    const puzzle = buildRandomPuzzle(`practice-${practiceSeed}`, dataset, todayHex);
    mount({ dayNumber: 0, puzzle, isToday: false, dateLabel: 'Practice', practice: true });
  }

  document.getElementById('practice-btn').addEventListener('click', () => showPractice(true));
  document.getElementById('practice-new').addEventListener('click', () => showPractice(true));
  document.getElementById('practice-exit').addEventListener('click', () => show(current));

  // Toggling Pro (or Hard Mode) repaints the board. In practice, re-mount the
  // same puzzle in the new mode; otherwise repaint the day (lapsed Pro → today).
  onProChange(() => {
    if (practiceOn && isPro()) showPractice(false);
    else show(isPro() ? current : today);
  });

  // The stats icon reopens the results for whatever day is showing.
  document
    .getElementById('stats-btn')
    .addEventListener('click', () => results.open({ game: currentGame, dayNumber: current }));

  // The ? icon opens the (static) how-to-play overlay.
  const help = document.getElementById('help');
  const closeHelp = () => (help.hidden = true);
  document.getElementById('help-btn').addEventListener('click', () => (help.hidden = false));
  document.getElementById('help-close').addEventListener('click', closeHelp);
  help.addEventListener('click', (e) => {
    if (e.target === help) closeHelp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHelp();
  });

  // Profile / login (top-right). Works local-only until Supabase is configured.
  document.getElementById('profile-btn').addEventListener('click', () => profile.open());

  // Free players get today only; Pro may deep-link to a past day via ?day=N.
  const startDay = isPro() && Number.isFinite(forced) ? clampDay(forced) : today;
  show(startDay);

  // Route between the daily game and the full multiplayer page from the URL, so
  // a shared ?room=CODE link deep-links into a match and the browser back button
  // steps in and out of multiplayer.
  function syncRoute() {
    const p = new URLSearchParams(location.search);
    const room = p.get('room');
    const wantsMP = room || location.hash === '#mp';
    if (wantsMP && !mp.isOpen()) {
      if (room) mp.join(room, { fromRoute: true });
      else mp.open({ fromRoute: true });
    } else if (!wantsMP && mp.isOpen()) {
      mp.close({ fromRoute: true });
    }
  }
  window.addEventListener('popstate', syncRoute);
  syncRoute(); // honour a ?room / #mp already in the URL on first load

  // Auth boots after the game is on screen so a slow network never blocks play.
  initAuth({
    onAuth: (session) => profile.refresh(session),
    afterSync: () => show(current), // repaint with cloud-merged stats
  });

  handleCheckoutReturn();

  // Checkout opens in a small window, so the game tab can be stale after a player
  // subscribes there. Re-check entitlement when they return to the game - only
  // while not yet Pro, throttled so refocusing doesn't spam the server.
  let lastEntitlementCheck = 0;
  window.addEventListener('focus', () => {
    if (isPro() || Date.now() - lastEntitlementCheck < 4000) return;
    lastEntitlementCheck = Date.now();
    refreshSync();
  });
}

// Coming back from Stripe Checkout (?pro=success|cancel): reassure the player and,
// on success, poll the entitlement until the webhook has granted Pro - the redirect
// can beat the webhook, so we reconcile rather than assume. Cleans the URL either way.
function handleCheckoutReturn() {
  const p = new URLSearchParams(location.search);
  const status = p.get('pro');
  if (!status) return;

  p.delete('pro');
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);

  if (status === 'cancel') { showToast('Checkout cancelled - no charge was made.'); return; }
  if (status !== 'success') return;
  if (isPro()) { showToast('Name the Hue Pro is active - enjoy! ✨'); return; }

  showToast('Payment received - activating Name the Hue Pro…', { duration: 0 });
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    await refreshSync(); // re-pull the row; onProChange repaints if it flips
    if (isPro()) {
      clearInterval(timer);
      showToast('Name the Hue Pro is active - enjoy! ✨');
    } else if (tries >= 8) {
      clearInterval(timer);
      showToast('Payment received. Pro will unlock shortly - try reloading in a minute.');
    }
  }, 1500);
}

main().catch((err) => {
  console.error(err);
  const grid = document.getElementById('grid');
  if (grid) grid.textContent = 'Failed to load the game. Is the local server running?';
});
