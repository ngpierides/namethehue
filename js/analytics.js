// analytics.js
// Fire-and-forget ANONYMOUS gameplay telemetry: one row per completed game into
// the Supabase `game_events` table, so total games played + solve stats can be
// counted across ALL players (logged in or not). No personal data and no user
// id is stored — just day / guesses / par / mode. No-ops entirely when Supabase
// isn't configured, and it must never throw into gameplay. The table + its
// insert-only RLS policy live in SUPABASE_SETUP.md.
//
// Also logs one anonymous `page_views` row per page load (traffic count on the
// admin dashboard), same insert-only + write-only contract as game_events.

import { getSupabaseClient, getSession, isConfigured } from './auth.js';

/**
 * Record one completed game. Best-effort — failures are swallowed so telemetry
 * can never affect the player. Not awaited by callers.
 * @param {{day:number, guesses:number, par:number, mode:'grid'|'hard'}} e
 */
export async function logGameCompleted({ day, guesses, par, mode }) {
  if (!isConfigured()) return;
  try {
    const client = await getSupabaseClient();
    if (!client) return;
    // No .select() chained: the row is write-only (RLS has no read policy), so
    // we deliberately don't ask PostgREST to return it.
    await client.from('game_events').insert({
      day,
      guesses,
      par,
      mode,
      logged_in: !!getSession(),
    });
  } catch {
    /* telemetry must never break the game */
  }
}

/**
 * Record one page view. Best-effort, fire-and-forget — call once per page load.
 * Stores nothing personal: just a timestamp (server default) and the path, so
 * the admin dashboard can show traffic without cookies or a user id.
 */
export async function logPageView() {
  if (!isConfigured()) return;
  try {
    const client = await getSupabaseClient();
    if (!client) return;
    // Write-only like game_events (RLS has an insert policy but no read policy),
    // so no .select() is chained. Path only — never query strings, which can
    // carry room codes / ?day previews we don't want to store.
    await client.from('page_views').insert({ path: location.pathname });
  } catch {
    /* telemetry must never break the game */
  }
}
