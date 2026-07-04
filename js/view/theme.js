// ============================================================================
// Battlefield themes. 白天 (day) borrows the reference capture's language:
// sun-baked golden grassland floating in a dark-navy void, white campuses,
// matte azure crystals, near-black machine decks. 黄昏 (dusk) is the original
// look, value-for-value. Pure view-layer data — the sim never reads this.
// ============================================================================
export const THEMES = {
  day: {
    key: 'day', label: '☀ 白天',
    sky: [[0, '#0a0d15'], [0.5, '#121a26'], [0.82, '#28384e'], [0.94, '#4a627f'], [1, '#71889f']],
    sceneFog: { color: 0x1a2434, near: 170, far: 470 },
    starsOpacity: 0.45,
    hemi: { sky: 0xbfd2e8, ground: 0x5e5540, intensity: 0.92 },
    sun: { color: 0xffe3ac, intensity: 2.5, offset: [-75, 128, 42] },
    rim: { color: 0x8fb4ff, intensity: 0.3 },
    exposure: 1.05,
    bloom: { threshold: 0.93, strength: 0.5 }, // whites stay crisp, only emissives glow
    terrain: { base: '#77653a', warm: '#98804b', low: '#544a2b', moss: '#68713d', path: '#8a7b52' },
    lawn: '#54794c',
    warFog: '#0a0d16',
    scatter: {
      trunk: 0x6b543f,
      canopyBase: 0xc2c8b0,     // instance colors multiply this
      canopy: (r) => [0.21 + r() * 0.07, 0.26, 0.3 + r() * 0.1],  // olive, not toy green
      rock: (r) => [0.09 + r() * 0.04, 0.14 + r() * 0.1, 0.55 + r() * 0.16],
      grass: (r) => [0.15 + r() * 0.1, 0.28 + r() * 0.1, 0.3 + r() * 0.12],
    },
    mats: {
      concreteLift: 0.46,       // concrete → warm campus stone, shy of pure white
      darkLift: 0.14,
      metalLift: 0.26,
      glassDay: true,           // curtain walls become lit white panels
      winBg: '#d3d7de', winDark: '#2c3646', winLitScale: 0.5,
      nodeColor: 0x2a85c8, nodeEmissive: 0.5,   // matte azure in sunlight
    },
  },
  dusk: {
    key: 'dusk', label: '🌆 黄昏',
    sky: [[0, '#0d0c1e'], [0.42, '#1c1838'], [0.72, '#4b2f52'], [0.88, '#c96a4e'], [1, '#ffb27a']],
    sceneFog: { color: 0x2a2140, near: 150, far: 420 },
    starsOpacity: 0.7,
    hemi: { sky: 0x5a5f9e, ground: 0x241a26, intensity: 0.55 },
    sun: { color: 0xffb27a, intensity: 2.3, offset: [-120, 68, 40] },
    rim: { color: 0x6a7dff, intensity: 0.5 },
    exposure: 1.06,
    bloom: { threshold: 0.72, strength: 0.85 },
    terrain: { base: '#3f3a58', warm: '#6e4f52', low: '#2b2740', moss: '#3d4a49', path: '#524a63' },
    lawn: '#33503f',
    warFog: '#0b0918',
    scatter: {
      trunk: 0x3c2f33,
      canopyBase: 0x2e4a44,     // instance colors multiply this
      canopy: (r) => [0.42 + r() * 0.06, 0.32, 0.2 + r() * 0.1],
      rock: (r) => [0.68 + r() * 0.08, 0.05 + r() * 0.09, 0.3 + r() * 0.14],
      grass: (r) => [0.35 + r() * 0.35, 0.16 + r() * 0.14, 0.24 + r() * 0.1],
    },
    mats: {
      concreteLift: 0, darkLift: 0, metalLift: 0,
      glassDay: false,
      winBg: '#07070d', winDark: '#1a2030', winLitScale: 1,
      nodeColor: 0x0e2030, nodeEmissive: 1.35,
    },
  },
};

export let THEME = THEMES.day;
export function setTheme(key) {
  THEME = THEMES[key] || THEMES.day;
  return THEME;
}
