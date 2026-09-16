// colorfield.js
// A reusable 2D colour picker: a canvas painted with the full spectrum
// (x → hue, y → lightness) + a grey ramp for neutrals + a draggable marker and
// a large circle showing the pick. Used by the daily Hard Mode (ui.js) and by
// Hard-Mode multiplayer (multiplayer.js) so there's one implementation.
//
// Painting the field and reading a click both call fieldColor(), so what's
// displayed and what's selected can never drift.

import { luminance } from './color.js';

/** x → hue across the rainbow; y → lightness 95 (top) down to 8 (bottom). */
export function fieldColor(px, py, w, h) {
  const hue = (px / (w - 1)) * 360;
  const light = 95 - (py / (h - 1)) * 87;
  return hslToHex(hue, 90, light);
}

/** The grey ramp: x → lightness at zero saturation. */
export function grayColor(px, w) {
  return hslToHex(0, 0, Math.round((px / (w - 1)) * 100));
}

const _cache = new WeakMap();

/** Get (or lazily create) the single ColorField bound to these elements. */
export function attachColorField(refs) {
  let cf = _cache.get(refs.field);
  if (!cf) {
    cf = new ColorField(refs);
    _cache.set(refs.field, cf);
  }
  return cf;
}

class ColorField {
  /** @param {{field, gray, marker, circle, hex}} refs element references */
  constructor(refs) {
    Object.assign(this, refs);
    this.current = '#808080';
    this.locked = false;
    this._paint();
    this._attach();
  }

  get() { return this.current; }

  set(hex, markerXY) {
    this.current = hex;
    if (this.circle) this.circle.style.background = hex;
    if (this.hex) this.hex.textContent = hex;
    if (markerXY && this.marker) {
      this.marker.hidden = false;
      this.marker.style.left = `${markerXY.x}px`;
      this.marker.style.top = `${markerXY.y}px`;
      this.marker.style.background = hex;
      this.marker.classList.toggle('on-dark', luminance(hex) < 0.4);
    } else if (this.marker) {
      this.marker.hidden = true;
    }
  }

  setLocked(on) {
    this.locked = on;
    this.field.closest('.hard, .mp-hard')?.classList.toggle('hard--locked', on);
  }

  _paint() {
    paintField(this.field);
    paintGray(this.gray);
  }

  _attach() {
    this._bind(this.field, (px, py, w, h) => fieldColor(px, py, w, h), true);
    this._bind(this.gray, (px, _py, w) => grayColor(px, w), false);
  }

  _bind(el, colorAt, isField) {
    let down = false;
    const pick = (e) => {
      if (this.locked) return;
      const r = el.getBoundingClientRect();
      const cssX = Math.max(0, Math.min(r.width, e.clientX - r.left));
      const cssY = Math.max(0, Math.min(r.height, e.clientY - r.top));
      const px = (cssX / r.width) * el.width;
      const py = (cssY / r.height) * el.height;
      this.set(colorAt(px, py, el.width, el.height), isField ? { x: cssX, y: cssY } : null);
    };
    el.addEventListener('pointerdown', (e) => { down = true; el.setPointerCapture?.(e.pointerId); pick(e); });
    el.addEventListener('pointermove', (e) => { if (down) pick(e); });
    el.addEventListener('pointerup', () => { down = false; });
    el.addEventListener('pointercancel', () => { down = false; });
  }
}

// --- painting + colour maths ------------------------------------------------

function paintField(canvas) {
  if (!canvas || canvas.dataset.painted) return; // the field never changes
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = fieldColor(x, y, w, h);
      const i = (y * w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  canvas.dataset.painted = '1';
}

function paintGray(canvas) {
  if (!canvas || canvas.dataset.painted) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = grayColor(x, w);
    ctx.fillRect(x, 0, 1, h);
  }
  canvas.dataset.painted = '1';
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
