// Deterministic ground height, shared by terrain mesh, unit placement and minimap.
// Pure math — no three.js, safe to import from Node.
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// Gentle rolling dunes, flattened near the four HQ corners, the capitol and cluster pads.
const FLATS = [
  [0, 0, 16], [0, 62, 11], [0, -62, 11], [62, 0, 11], [-62, 0, 11],
  [78, 78, 15], [-78, 78, 15], [78, -78, 15], [-78, -78, 15],
];
export function groundHeight(x, z) {
  let h = vnoise(x * 0.022 + 31.4, z * 0.022 + 17.9) * 2.6
        + vnoise(x * 0.075 + 3.7, z * 0.075 + 9.1) * 0.7 - 1.6;
  for (const [fx, fz, fr] of FLATS) {
    const d = Math.hypot(x - fx, z - fz);
    if (d < fr + 10) {
      const t = Math.min(1, Math.max(0, (d - fr) / 10));
      h *= smooth(t);
    }
  }
  return h;
}
