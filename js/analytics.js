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
 * Where a load came from, as a coarse label (no full URL, no query string):
 * 'direct' (typed/bookmark), 'internal' (navigated within the site), or the
 * bare hostname of an external referrer (e.g. 'www.google.com', 't.co'). This
 * is what lets the dashboard answer "search vs shared link vs direct".
 */
function referrerLabel() {
  const ref = document.referrer;
  if (!ref) return 'direct';
  try {
    const host = new URL(ref).hostname;
    return host === location.hostname ? 'internal' : host;
  } catch {
    return 'direct';
  }
}

/**
 * Record one page view. Best-effort, fire-and-forget — call once per page load.
 * Stores a timestamp, the path, the user-agent (so the dashboard can separate
 * bots from humans), and a coarse referrer label — no cookies, no user id, no
 * IP, and never the query string (room codes / ?day previews stay out).
 */
export async function logPageView() {
  if (!isConfigured()) return;
  try {
    const client = await getSupabaseClient();
    if (!client) return;
    // Write-only like game_events (RLS has an insert policy but no read policy),
    // so no .select() is chained.
    await client.from('page_views').insert({
      path: location.pathname,
      user_agent: navigator.userAgent,
      referrer: referrerLabel(),
    });
  } catch {
    /* telemetry must never break the game */
  }
}
