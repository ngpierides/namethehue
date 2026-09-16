// proupsell.js
// One shared "Get Name the Hue Pro" popup, reused by every gated Pro feature (the
// Archive and Practice) so a free player meets the identical upsell wherever
// they bump into a Pro-only door. `onGoPro` links through to where Pro is
// toggled (the Settings modal). Follows the modal conventions: hidden via the
// `hidden` attribute, closed on ✕ / backdrop / Escape.

import { getPrices } from './pricing.js';

export class ProUpsell {
  /** @param {{ onGoPro?: ()=>void }} opts */
  constructor(opts = {}) {
    this.onGoPro = opts.onGoPro;
    this.el = document.getElementById('pro-upsell');
    this.priceEl = document.getElementById('pro-upsell-price');

    document.getElementById('pro-upsell-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    document.getElementById('pro-upsell-go').addEventListener('click', () => {
      this.close();
      this.onGoPro?.();
    });
  }

  open() {
    this.el.hidden = false;
    this._fillPrice();
  }
  close() { this.el.hidden = true; }

  /** Show real pricing (with the annual saving) under the description, if available. */
  async _fillPrice() {
    if (!this.priceEl) return;
    const p = await getPrices();
    if (!p || !p.monthly) { this.priceEl.hidden = true; return; }
    let text = `${p.monthly.price}${p.monthly.per}`;
    if (p.yearly) {
      text += ` or ${p.yearly.price}${p.yearly.per}`;
      if (p.discountPct) text += ` (save ${p.discountPct}%)`;
    }
    text += ' - 7-day free trial';
    this.priceEl.textContent = text;
    this.priceEl.hidden = false;
  }
}
