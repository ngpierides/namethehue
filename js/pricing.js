// pricing.js
// Fetches live Name the Hue Pro pricing from the get-prices Edge Function and derives
// display strings + the annual saving, so Settings and the upsell popup can show
// real amounts. Cached in localStorage for instant paint; refreshed every few
// hours. Degrades to null (UI just hides prices) when payments aren't set up.

import { getSupabaseClient, isConfigured } from './auth.js';

const KEY = 'colordle:prices';
const TTL = 6 * 60 * 60 * 1000; // re-check prices every 6h

// Currencies Stripe quotes without a minor unit (amount is already whole).
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
  'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

let mem = null; // { prices, t }

/**
 * @returns {Promise<null | {
 *   monthly: { price: string, per: string } | null,
 *   yearly:  { price: string, per: string } | null,
 *   discountPct: number, savings: string
 * }>}
 */
export async function getPrices() {
  const now = Date.now();
  if (!mem) mem = loadCache();
  if (mem && now - mem.t < TTL) return mem.prices;

  const fresh = await fetchPrices();
  if (fresh) {
    mem = { prices: fresh, t: now };
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ }
    return fresh;
  }
  return mem?.prices ?? null; // fall back to stale cache if the fetch failed
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

async function fetchPrices() {
  if (!isConfigured()) return null;
  const client = await getSupabaseClient();
  if (!client) return null;
  try {
    const { data, error } = await client.functions.invoke('get-prices');
    if (error || !data || data.error) return null;
    return computed(data.monthly, data.yearly);
  } catch {
    return null;
  }
}

function computed(monthly, yearly) {
  const m = monthly ? { price: money(monthly.amount, monthly.currency), per: per(monthly.interval) } : null;
  const y = yearly ? { price: money(yearly.amount, yearly.currency), per: per(yearly.interval) } : null;

  let discountPct = 0;
  let savings = '';
  if (monthly && yearly && monthly.currency === yearly.currency) {
    const annualIfMonthly = monthly.amount * 12;
    const saved = annualIfMonthly - yearly.amount;
    if (saved > 0) {
      discountPct = Math.round((saved / annualIfMonthly) * 100);
      savings = money(saved, yearly.currency);
    }
  }
  return { monthly: m, yearly: y, discountPct, savings };
}

function per(interval) {
  return interval === 'year' ? '/yr' : interval === 'month' ? '/mo' : '';
}

function money(amount, currency) {
  const zero = ZERO_DECIMAL.has(currency);
  const value = zero ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero ? 0 : 2,
    }).format(value);
  } catch {
    return `${value} ${currency.toUpperCase()}`;
  }
}
