// profile.js
// The profile overlay: sign in / sign up when logged out, or the account +
// stats summary when logged in. Falls back to a "local only" panel when
// Supabase isn't configured. Talks to auth.js; renders from stats.js.

import {
  isConfigured,
  getSession,
  isAuthReady,
  signIn,
  signUp,
  signOut,
  deleteAccount,
  saveCredential,
} from './auth.js';
import { getPersonalStats } from './stats.js';
import { escapeHtml } from './dom.js';

export class Profile {
  constructor() {
    this.el = document.getElementById('profile');
    this.body = document.getElementById('profile-body');

    document.getElementById('profile-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
  }

  /** @param {'login'|'signup'} [mode] preselect the auth form (guests only). */
  open(mode) {
    this._confirmDelete = false;
    if (mode) this.authMode = mode;
    this.render(getSession());
    this.el.hidden = false;
  }

  close() {
    this._confirmDelete = false;
    this.el.hidden = true;
  }

  /** Called by auth state changes; only repaints if the modal is open. */
  refresh(session) {
    if (!this.el.hidden) this.render(session);
  }

  render(session) {
    if (!isConfigured()) this._renderLocalOnly();
    else if (session) this._renderAccount(session);
    // Configured but auth hasn't resolved yet: don't flash the login form when
    // the player is actually signed in, so show a loader; refresh() repaints once
    // handleSession fires (main.js wires onAuth → profile.refresh).
    else if (!isAuthReady()) this._renderLoading();
    else this._renderAuthForm();
  }

  _renderLoading() {
    this.body.innerHTML = `<p class="profile-lead" style="text-align:center;">Loading your account…</p>`;
  }

  // -- Logged in ------------------------------------------------------------
  _renderAccount(session) {
    const meta = session.user.user_metadata || {};
    const email = session.user.email || '';
    const name = meta.display_name || meta.full_name || meta.name || '';
    const heading = name || email || 'Signed in';
    const initial = (heading[0] || '?').toUpperCase();
    // Show the email as a subtitle only when we also have a name to headline.
    const sub = name && email ? escapeHtml(email) : '✓ Synced to the cloud';
    // Admin-only shortcut to the live stats dashboard. Gated on the same
    // server-controlled role that stats.html itself re-checks (app_metadata is
    // only settable via service-role SQL, so users can't grant themselves this).
    const isAdmin = session.user.app_metadata?.role === 'admin';
    const adminLink = isAdmin
      ? `<a class="btn btn--wide profile-admin" href="stats.html">📊 Live stats dashboard</a>`
      : '';
    this.body.innerHTML = `
      <div class="profile-account">
        <div class="profile-avatar">${escapeHtml(initial)}</div>
        <div class="profile-id">
          <div class="profile-email">${escapeHtml(heading)}</div>
          <div class="profile-synced">${sub}</div>
        </div>
      </div>
      <p class="profile-hint">Change your display name in Settings.</p>
      ${statsGrid()}
      ${adminLink}
      <button id="signout-btn" class="btn btn--wide">Log out</button>
      <button id="delete-account" class="set-danger profile-delete" type="button">
        ${this._confirmDelete ? 'Tap again to permanently delete' : 'Delete account'}
      </button>
      <p id="delete-msg" class="auth-msg" role="alert"></p>`;

    this.body.querySelector('#signout-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await signOut();
    });

    // Delete account: irreversible, so two taps to confirm.
    const delBtn = this.body.querySelector('#delete-account');
    delBtn.addEventListener('click', async () => {
      if (!this._confirmDelete) { this._confirmDelete = true; this.render(getSession()); return; }
      const msg = this.body.querySelector('#delete-msg');
      delBtn.disabled = true;
      delBtn.textContent = 'Deleting…';
      try {
        await deleteAccount(); // signs out on success → onAuth repaints the login form
      } catch (err) {
        this._confirmDelete = false;
        msg.className = 'auth-msg auth-msg--error';
        msg.textContent = err?.message || 'Could not delete your account.';
        delBtn.disabled = false;
        delBtn.textContent = 'Delete account';
      }
    });
  }

  // -- Logged out (Supabase configured) ------------------------------------
  // Has two modes, toggled in place: 'login' and 'signup'. Sign-up also asks
  // for a display name, which is stored on the account and shown in the profile.
  _renderAuthForm() {
    const signup = this.authMode === 'signup';
    this.body.innerHTML = `
      <p class="profile-lead">${
        signup
          ? "Stats are only saved with an account. Create one to keep your streak and stats across every device."
          : "Stats are only saved with an account. Log in to keep your streak and stats across every device."
      }</p>
      <form id="auth-form" class="auth-form">
        ${
          signup
            ? `<input id="auth-name" class="field" type="text" name="name" placeholder="Name"
                      autocomplete="name" maxlength="40" required />`
            : ''
        }
        <input id="auth-email" class="field" type="email" name="username" placeholder="Email"
               autocomplete="username" required />
        <input id="auth-pass" class="field" type="password" name="password" placeholder="Password"
               autocomplete="${signup ? 'new-password' : 'current-password'}"
               minlength="6" required />
        <button type="submit" class="btn btn--primary btn--wide">
          ${signup ? 'Create account' : 'Log in'}
        </button>
        <p id="auth-msg" class="auth-msg" role="alert"></p>
        <p class="auth-switch">
          ${signup ? 'Already have an account?' : 'New to Name the Hue?'}
          <button type="button" id="auth-toggle" class="linkbtn">
            ${signup ? 'Log in' : 'Create account'}
          </button>
        </p>
      </form>`;

    const q = (sel) => this.body.querySelector(sel);
    const msg = q('#auth-msg');
    const email = () => q('#auth-email').value.trim();
    const pass = () => q('#auth-pass').value;
    const name = () => q('#auth-name')?.value.trim() || '';

    const run = async (fn, working) => {
      msg.className = 'auth-msg';
      msg.textContent = working;
      try {
        return await fn();
      } catch (err) {
        msg.className = 'auth-msg auth-msg--error';
        msg.textContent = err?.message || 'Something went wrong.';
      }
    };

    q('#auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      // Capture now: a successful sign-in re-renders (removes) the form.
      const em = email();
      const pw = pass();
      const nm = name();
      if (signup) {
        run(async () => {
          const { needsConfirmation } = await signUp(em, pw, nm);
          await saveCredential(em, pw); // offer to save in the password manager
          if (needsConfirmation) {
            msg.className = 'auth-msg auth-msg--ok';
            msg.textContent = `Thanks, ${nm || 'there'}! Check your email to confirm, then log in.`;
          }
        }, 'Creating account…');
      } else {
        run(async () => {
          await signIn(em, pw);
          await saveCredential(em, pw);
        }, 'Logging in…');
      }
    });

    q('#auth-toggle').addEventListener('click', () => {
      this.authMode = signup ? 'login' : 'signup';
      this._renderAuthForm();
    });
  }

  // -- Supabase not set up --------------------------------------------------
  _renderLocalOnly() {
    this.body.innerHTML = `
      <div class="profile-note">
        <strong>Playing as a guest.</strong>
        Your stats are saved on <em>this device only</em>. To create an account and
        sync across devices, add your Supabase keys in
        <code>js/supabase-config.js</code> - see the README's “Cloud login” section.
      </div>
      ${statsGrid()}`;
  }
}

// ---- helpers ---------------------------------------------------------------

function statsGrid() {
  const s = getPersonalStats();
  const cell = (n, cap) => `<div class="stat"><span class="stat-num">${n}</span><span class="stat-cap">${cap}</span></div>`;
  const accuracy = s.avgAccuracy == null ? '-' : `${s.avgAccuracy}%`;
  const avgGuesses = s.avgGuesses == null ? '-' : s.avgGuesses;
  return `
    <h3 class="modal-h">Your statistics</h3>
    <div class="stats-grid">
      ${cell(s.played, 'Played')}
      ${cell(avgGuesses, 'Avg guesses')}
      ${cell(accuracy, 'Avg accuracy')}
      ${cell(s.curStreak, 'Streak')}
      ${cell(s.maxStreak, 'Max streak')}
    </div>`;
}
