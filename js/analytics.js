// analytics.js
// Fire-and-forget ANONYMOUS gameplay telemetry: one row per completed game into
// the Supabase `game_events` table, so total games played + solve stats can be
// counted across ALL players (logged in or not). No personal data and no user
// id is stored — just day / guesses / par / mode. No-ops entirely when Supabase
// isn't configured, and it must never throw into gameplay. The table + its
// insert-only RLS policy live in SUPABASE_SETUP.md.

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
