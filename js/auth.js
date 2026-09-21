// auth.js
// Wraps Supabase auth + cloud stat syncing. Designed to be optional:
//   • If supabase-config.js still has placeholders, the whole thing no-ops and
//     the game runs local-only (nothing here even loads the Supabase SDK).
//   • If configured, we lazy-load the SDK, restore the session, and keep the
//     player's stat history synced (pull → merge → push).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import { getStatsBlob, getPersonalStats, mergeIntoLocal, onStatsChange, setStatsPersist } from './stats.js';
import { applyEntitlement } from './pro.js';

const TABLE = 'player_stats';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let client = null;
let session = null;
let handlers = {};
let syncTimer = null;

/** Have real Supabase credentials been filled in? */
export function isConfigured() {
  return (
    /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL) &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.startsWith('YOUR_')
  );
}

/** Current signed-in session (or null). */
export function getSession() {
  return session;
}

/**
 * The shared Supabase client (lazy-loaded, cached). Used by auth *and* the
 * multiplayer module so there's only ever one realtime connection. Returns null
 * when Supabase isn't configured.
 */
export async function getSupabaseClient() {
  if (client) return client;
  if (!isConfigured()) return null;
  try {
    const { createClient } = await import(/* @vite-ignore */ SDK_URL);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('[Name the Hue] Supabase SDK failed to load.', e);
    return null;
  }
  return client;
}

/**
 * @param {{ onAuth?: (session)=>void, afterSync?: ()=>void }} h
 */
export async function initAuth(h = {}) {
  handlers = h;
  if (!isConfigured()) {
    h.onAuth?.(null); // local-only mode
    return;
  }
  client = await getSupabaseClient();
  if (!client) {
    console.warn('[Name the Hue] Supabase unavailable - running local-only.');
    h.onAuth?.(null);
    return;
  }

  // Push local changes up whenever the history changes while signed in.
  onStatsChange(() => scheduleSync());

  const { data } = await client.auth.getSession();
  await handleSession(data.session);
  client.auth.onAuthStateChange((_event, s) => handleSession(s));
}

async function handleSession(s) {
  session = s;
  setStatsPersist(!!s); // stats are saved to the browser only while signed in
  if (s) await syncOnLogin();
  else applyEntitlement(null); // configured but signed out ⇒ free tier
  handlers.onAuth?.(s);
}

/** Pull the cloud copy, merge with local, apply the entitlement, push back up. */
async function syncOnLogin() {
  try {
    // `pro_source` / `pro_current_period_end` are the server-owned entitlement
    // columns (see SUPABASE_SETUP.md). If they don't exist yet the select errors
    // and we simply fall back to free - Pro just stays locked until you migrate.
    const { data, error } = await client
      .from(TABLE)
      .select('days, pro_source, pro_current_period_end')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (!error && data) {
      if (data.days) mergeIntoLocal(data.days);
      applyEntitlement(data);
    } else {
      applyEntitlement(null);
    }
    await pushNow();
    handlers.afterSync?.();
  } catch (e) {
    console.warn('[Name the Hue] stat sync failed', e);
    applyEntitlement(null);
  }
}

/**
 * Re-pull the player's row and re-apply stats + entitlement. Used after returning
 * from Stripe Checkout to reconcile once the webhook has granted Pro. No-ops when
 * signed out or local-only.
 */
export async function refreshSync() {
  if (!session || !client) return;
  await syncOnLogin();
}

function scheduleSync() {
  if (!session) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushNow, 800);
}

async function pushNow() {
  if (!session || !client) return;
  const { days } = getStatsBlob();
  const s = getPersonalStats();
  const meta = session.user.user_metadata || {};

  // `days` stays the source of truth (needed for merge + "played" reconstruction);
  // the rest are readable summary columns, easy to browse/sort in the dashboard.
  const row = {
    user_id: session.user.id,
    name: meta.display_name || meta.full_name || meta.name || null,
    email: session.user.email || null,
    games_played: s.played,
    wins: s.wins,
    current_streak: s.curStreak,
    max_streak: s.maxStreak,
    avg_accuracy: s.avgAccuracy, // may be null until there's guess data
    days,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from(TABLE).upsert(row);
  if (error) {
    // Most likely the summary columns haven't been added yet - see the ALTER
    // TABLE migration in SUPABASE_SETUP.md.
    console.warn('[Name the Hue] cloud save failed:', error.message);
  }
}

// ---- auth actions (used by the profile modal) ------------------------------

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password, name = '') {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    // Stored on the account (auth.users.user_metadata) and shown in the profile.
    options: { data: { display_name: name } },
  });
  if (error) throw error;
  // If email confirmation is on, there's no session yet.
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  if (client) await client.auth.signOut();
}

/** Set the logged-in user's display name, then push it to their stats row. */
export async function updateDisplayName(name) {
  const { data, error } = await client.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  if (session && data.user) session.user = data.user; // reflect the new metadata
  await pushNow(); // writes the name into the readable `name` column
  return session;
}
