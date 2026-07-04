// Deterministic ground height, shared by terrain mesh, unit placement, the
// pathfinder and the minimap. Pure math — no three.js, safe to import from
// Node. Terrain is a gameplay system: mesa walls funnel armies through the
// GPU-cluster passes, knolls near the center offer contested high ground,
// slopes slow movement and steep flanks are unbuildable/unpathable.
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

// Mesa: steep flanks, flat walkable summit (a real plateau, not a bump).
function mesa(x, z, cx, cz, rx, rz, h) {
  const dx = (x - cx) / rx, dz = (z - cz) / rz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= 1) return 0;
  const t = Math.min(1, (1 - d) / 0.38);
  return h * smooth(t);
}
// Knoll: gentle quartic dome — slow to climb, buildable only near the crown.
function knoll(x, z, cx, cz, r, h) {
  const dx = (x - cx) / r, dz = (z - cz) / r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= 1) return 0;
  const k = 1 - d2;
  return h * k * k;
}

// Four mesa walls block the outer corner-to-corner lanes, so armies between
// neighbours must file past the contested GPU clusters; four knolls overlook
// the approaches to the capitol.
const MESAS = [
  [94, 0, 17, 13, 4.8], [-94, 0, 17, 13, 4.8],   // east/west walls across the edge lanes
  [0, 94, 13, 17, 4.8], [0, -94, 13, 17, 4.8],   // north/south walls
];
const KNOLLS = [
  [31, 31, 13, 3.3], [-31, -31, 13, 3.3],
  [-31, 31, 13, 3.1], [31, -31, 13, 3.1],
];

// Gentle rolling dunes, flattened near the four HQ corners, the capitol and cluster pads.
const FLATS = [
  [0, 0, 16], [0, 62, 11], [0, -62, 11], [62, 0, 11], [-62, 0, 11],
  [78, 78, 15], [-78, 78, 15], [78, -78, 15], [-78, -78, 15],
];
export function groundHeight(x, z) {
  let h = vnoise(x * 0.022 + 31.4, z * 0.022 + 17.9) * 2.9
        + vnoise(x * 0.075 + 3.7, z * 0.075 + 9.1) * 0.7 - 1.7;
  for (const [mx, mz, rx, rz, mh] of MESAS) h += mesa(x, z, mx, mz, rx, rz, mh);
  for (const [kx, kz, kr, kh] of KNOLLS) h += knoll(x, z, kx, kz, kr, kh);
  for (const [fx, fz, fr] of FLATS) {
    const d = Math.hypot(x - fx, z - fz);
    if (d < fr + 10) {
      const t = Math.min(1, Math.max(0, (d - fr) / 10));
      h *= smooth(t);
    }
  }
  return h;
}

// Slope magnitude (rise per world unit) by central difference. The sim uses
// it for move speed, buildability and pathfinding; the view for rock styling.
export function slopeAt(x, z) {
  const e = 0.9;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
