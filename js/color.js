// color.js
// Colour maths: hex <-> RGB <-> CIELAB, and a perceptual "closeness" score.
//
// The closeness percentage is based on CIEDE2000 (a.k.a. ΔE2000), the
// industry-standard formula for how different two colours look to the human
// eye. A ΔE of 0 means identical; larger numbers mean more different.
// We turn that distance into a friendly 0–100% score for the game.

/** "#aabbcc" -> {r,g,b} in 0..255 */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** sRGB channel (0..255) -> linear light (0..1) */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** {r,g,b} 0..255 -> CIE XYZ (D65) */
function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return {
    x: R * 0.4124 + G * 0.3576 + B * 0.1805,
    y: R * 0.2126 + G * 0.7152 + B * 0.0722,
    z: R * 0.0193 + G * 0.1192 + B * 0.9505,
  };
}

/** CIE XYZ -> CIELAB (D65 reference white) */
function xyzToLab({ x, y, z }) {
  // D65 reference white
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** "#aabbcc" -> CIELAB {L,a,b} */
export function hexToLab(hex) {
  return xyzToLab(rgbToXyz(hexToRgb(hex)));
}

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

/**
 * CIEDE2000 colour difference between two CIELAB colours.
 * Returns ΔE00 (0 = identical). Reference: Sharma, Wu & Dalal (2005).
 */
export function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;

  let h1p = rad2deg(Math.atan2(b1, a1p));
  if (h1p < 0) h1p += 360;
  let h2p = rad2deg(Math.atan2(b2, a2p));
  if (h2p < 0) h2p += 360;

  const deltLp = L2 - L1;
  const deltCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const deltHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);

  let avgHp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) avgHp += h1p + h2p < 360 ? 360 : -360;
    avgHp /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(avgHp - 30)) +
    0.24 * Math.cos(deg2rad(2 * avgHp)) +
    0.32 * Math.cos(deg2rad(3 * avgHp + 6)) -
    0.20 * Math.cos(deg2rad(4 * avgHp - 63));

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(deg2rad(2 * deltaTheta)) * Rc;

  return Math.sqrt(
    Math.pow(deltLp / Sl, 2) +
      Math.pow(deltCp / Sc, 2) +
      Math.pow(deltHp / Sh, 2) +
      Rt * (deltCp / Sc) * (deltHp / Sh)
  );
}

/**
 * Turn a ΔE00 distance into a 0–100 "closeness" percentage.
 * @param {number} deltaE   the ΔE00 between guess and target
 * @param {number} maxDelta the ΔE at (or above) which closeness hits 0%
 */
export function closenessPercent(deltaE, maxDelta) {
  const clamped = Math.min(deltaE, maxDelta);
  return Math.round(100 * (1 - clamped / maxDelta));
}

/** Convenience: closeness % straight from two hex strings. */
export function hexCloseness(hexA, hexB, maxDelta) {
  return closenessPercent(deltaE00(hexToLab(hexA), hexToLab(hexB)), maxDelta);
}

/** Perceived luminance 0..1 - used to decide black vs white text/overlay on a swatch. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b));
}
