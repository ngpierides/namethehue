// settings.js
// The settings overlay (cog button). Holds the account name editor (when signed
// in), the Name the Hue Pro controls, plus appearance/accessibility/data preferences.
// Preferences persist in localStorage and apply to the whole app;
// `applyStoredPrefs()` runs at boot so they take effect before the first paint.

import { isPro, setPro, isHardMode, setHardMode, isCloudManaged, proSource } from './pro.js';
import { isConfigured, getSession, updateDisplayName } from './auth.js';
import { getPrices } from './pricing.js';
import { escapeHtml } from './dom.js';

const THEME_KEY = 'colordle:theme'; // 'light' | 'dark' (default light)
const MOTION_KEY = 'colordle:reducemotion'; // '1' when reduced

// ---- preference read/apply (also used at boot) -----------------------------

function readStr(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function readBool(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** The saved theme. Anything that isn't 'dark' (incl. the legacy 'system') is light. */
export function getTheme() {
  return readStr(THEME_KEY, 'light') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

export function applyReduceMotion(on) {
  document.documentElement.classList.toggle('reduce-motion', on);
}

/** Apply saved appearance prefs. Call once at startup. */
export function applyStoredPrefs() {
  applyTheme(getTheme());
  applyReduceMotion(readBool(MOTION_KEY));
}

// ---- the modal -------------------------------------------------------------

export class Settings {
  /** @param {{ onSubscribe?: ()=>void, onManage?: ()=>void, onUpsell?: ()=>void }} opts */
  constructor(opts = {}) {
    this.onSubscribe = opts.onSubscribe;
    this.onManage = opts.onManage;
    this.onUpsell = opts.onUpsell;
    this.el = document.getElementById('settings');
    this.body = document.getElementById('settings-body');
    this._confirmReset = false;

    document.getElementById('settings-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
  }

  open() {
    this._confirmReset = false;
    this.render();
    this.el.hidden = false;
  }

  close() {
    this.el.hidden = true;
  }

  render() {
    const pro = isPro();
    const cloud = isCloudManaged(); // Pro is server-granted, not a free toggle
    const theme = getTheme();
    const motion = readBool(MOTION_KEY);
    const session = isConfigured() ? getSession() : null;
    const seg = (val, label) =>
      `<button type="button" class="set-seg-btn${theme === val ? ' is-active' : ''}" data-theme="${val}">${label}</button>`;

    // Account name editor, shown only when signed in.
    let accountHtml = '';
    if (session) {
      const meta = session.user.user_metadata || {};
      const name = meta.display_name || meta.full_name || meta.name || '';
      accountHtml = `
        <h3 class="modal-h">Account</h3>
        <form id="set-name-form" class="name-form">
          <input id="set-name-input" class="field" type="text" maxlength="40"
                 placeholder="Add your name" value="${escapeHtml(name)}" />
          <button type="submit" class="btn" id="set-name-save">Save</button>
        </form>
        <p id="set-name-msg" class="auth-msg"></p>`;
    }

    this.body.innerHTML = `
      ${accountHtml}

      <h3 class="modal-h">Appearance</h3>
      <div class="set-row">
        <span class="set-row-text"><strong>Theme</strong></span>
        <div class="set-seg" role="group" aria-label="Theme">
          ${seg('light', 'Light')}${seg('dark', 'Dark')}
        </div>
      </div>
      <label class="pro-toggle">
        <span class="pro-toggle-text">
          <strong>Reduce motion</strong>
          <span class="pro-sub">Turn off tile animations and hover effects.</span>
        </span>
        <input id="set-motion" type="checkbox" ${motion ? 'checked' : ''} />
      </label>

      <h3 class="modal-h">Name the Hue Pro</h3>
      <p class="plan-line">You're on the <strong>${pro ? 'Name the Hue Pro' : 'Free'}</strong> plan.</p>
      <div class="tier-compare">
        <div class="tier tier--free${pro ? '' : ' tier--current'}">
          <span class="tier-name">Free${pro ? '' : '<span class="tier-badge tier-badge--plain">Your plan</span>'}</span>
          <ul class="tier-list">
            <li>A new colour every day</li>
            <li>Stats, streaks &amp; sharing</li>
            <li>Play a friend online</li>
          </ul>
        </div>
        <div class="tier tier--pro${pro ? ' tier--current' : ''}">
          <span class="tier-name">Pro${pro ? '<span class="tier-badge">Your plan</span>' : ''}</span>
          <ul class="tier-list">
            <li>Hard Mode colour mixer</li>
            <li>Archive of every past day</li>
            <li>Unlimited Practice puzzles</li>
          </ul>
        </div>
      </div>
      ${cloud
        ? (pro
            ? `<div class="pro-toggle pro-toggle--status">
                <span class="pro-toggle-text">
                  <strong>Pro mode</strong>
                  <span class="pro-sub">Active on your account.</span>
                </span>
                <span class="pro-status-actions">
                  <span class="pro-status-pill is-on">Active</span>
                  ${proSource() === 'paid' ? '<button id="pro-manage" class="set-link-btn" type="button">Manage</button>' : ''}
                </span>
              </div>`
            : `<div class="pro-subscribe-box">
                <p class="pro-sub">Start with a <strong>7-day free trial</strong>. Cancel anytime.</p>
                <div class="pro-plan-choice">
                  <button id="pro-sub-monthly" class="share-btn plan-btn" type="button">
                    <span class="plan-name">Monthly</span>
                    <span class="plan-price" id="price-monthly"></span>
                  </button>
                  <button id="pro-sub-yearly" class="share-btn pro-subscribe--alt plan-btn" type="button">
                    <span class="plan-name">Yearly <span class="plan-save" id="plan-save" hidden></span></span>
                    <span class="plan-price" id="price-yearly"></span>
                  </button>
                </div>
                <p class="plan-savings" id="plan-savings" hidden></p>
              </div>`)
        : `<label class="pro-toggle">
            <span class="pro-toggle-text">
              <strong>Pro mode</strong>
              <span class="pro-sub">${pro ? 'Every Pro feature is unlocked.' : 'Unlock the Pro features above.'}</span>
            </span>
            <input id="pro-on" type="checkbox" ${pro ? 'checked' : ''} />
          </label>`}
      <label class="pro-toggle${pro ? '' : ' pro-toggle--off'}">
        <span class="pro-toggle-text">
          <strong>Hard mode</strong>
          <span class="pro-sub">Mix the colour with a picker instead of picking from the grid.</span>
        </span>
        <input id="hard-on" type="checkbox" ${isHardMode() ? 'checked' : ''} />
      </label>

      <h3 class="modal-h">Data</h3>
      <div class="set-data">
        <p class="set-data-note">Clears your stats and saved boards on this device. This can't be undone.</p>
        <button id="set-reset" class="set-danger" type="button">
          ${this._confirmReset ? 'Tap again to confirm' : 'Reset progress'}
        </button>
      </div>`;

    // Account: save display name.
    const nameForm = this.body.querySelector('#set-name-form');
    if (nameForm) {
      const nameMsg = this.body.querySelector('#set-name-msg');
      nameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = this.body.querySelector('#set-name-input').value.trim();
        nameMsg.className = 'auth-msg';
        nameMsg.textContent = 'Saving…';
        try {
          await updateDisplayName(val);
          this.render();
        } catch (err) {
          nameMsg.className = 'auth-msg auth-msg--error';
          nameMsg.textContent = err?.message || 'Could not save name.';
        }
      });
    }

    // Theme segmented control.
    this.body.querySelectorAll('.set-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.theme;
        try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
        applyTheme(t);
        this.render();
      });
    });

    // Reduce motion.
    this.body.querySelector('#set-motion').addEventListener('change', (e) => {
      try { localStorage.setItem(MOTION_KEY, e.target.checked ? '1' : '0'); } catch { /* ignore */ }
      applyReduceMotion(e.target.checked);
    });

    // Pro controls. In local (dev) mode Pro is a free toggle; in cloud mode it's
    // server-granted, so instead we surface a Subscribe button.
    const proOn = this.body.querySelector('#pro-on');
    if (proOn) proOn.addEventListener('change', (e) => {
      setPro(e.target.checked);
      this.render();
    });
    const subMonthly = this.body.querySelector('#pro-sub-monthly');
    if (subMonthly) subMonthly.addEventListener('click', () => {
      this.close();
      this.onSubscribe?.('monthly');
    });
    const subYearly = this.body.querySelector('#pro-sub-yearly');
    if (subYearly) subYearly.addEventListener('click', () => {
      this.close();
      this.onSubscribe?.('yearly');
    });
    const manage = this.body.querySelector('#pro-manage');
    if (manage) manage.addEventListener('click', () => {
      this.close();
      this.onManage?.();
    });

    // Hard mode is Pro-only: a free player ticking it gets the upgrade prompt.
    this.body.querySelector('#hard-on').addEventListener('change', (e) => {
      if (!isPro()) {
        e.target.checked = false;
        this.close();
        this.onUpsell?.();
        return;
      }
      setHardMode(e.target.checked);
    });

    // Reset progress: two taps to confirm.
    this.body.querySelector('#set-reset').addEventListener('click', () => {
      if (!this._confirmReset) { this._confirmReset = true; this.render(); return; }
      this._resetProgress();
    });

    this._fillPrices(); // async: fills real prices onto the Subscribe buttons
  }

  /** Fetch live prices and drop them onto the monthly/yearly buttons + saving line. */
  async _fillPrices() {
    const monthlyEl = this.body.querySelector('#price-monthly');
    if (!monthlyEl) return; // subscribe box not on screen
    const p = await getPrices();
    if (!p || !this.body.querySelector('#price-monthly')) return; // gone / re-rendered
    if (p.monthly) monthlyEl.textContent = `${p.monthly.price}${p.monthly.per}`;

    const yearlyBtn = this.body.querySelector('#pro-sub-yearly');
    if (p.yearly) {
      const yearlyEl = this.body.querySelector('#price-yearly');
      if (yearlyEl) yearlyEl.textContent = `${p.yearly.price}${p.yearly.per}`;
      if (p.discountPct) {
        const saveEl = this.body.querySelector('#plan-save');
        if (saveEl) { saveEl.textContent = `Save ${p.discountPct}%`; saveEl.hidden = false; }
        const savingsEl = this.body.querySelector('#plan-savings');
        if (savingsEl) {
          savingsEl.textContent = `You save ${p.savings} a year vs paying monthly.`;
          savingsEl.hidden = false;
        }
      }
    } else if (yearlyBtn) {
      yearlyBtn.hidden = true; // no yearly price configured in Stripe
    }
  }

  _resetProgress() {
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === 'colordle:stats' || k.startsWith('colordle:day:')) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    location.reload(); // rebuild the board + stats from a clean slate
  }
}
