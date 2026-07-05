// ============================================================================
// Battlefield themes. 白天 (day) borrows the reference capture's language:
// sun-baked golden grassland floating in a dark-navy void, white campuses,
// matte azure crystals, near-black machine decks. 黄昏 (dusk) is the original
// look, value-for-value. Pure view-layer data — the sim never reads this.
// ============================================================================
export const THEMES = {
  day: {
    key: 'day', label: '☀ 白天',
    sky: [[0, '#0a0d15'], [0.5, '#131c2a'], [0.82, '#2c405a'], [0.94, '#567394'], [1, '#8aa6c0']],
    sceneFog: { color: 0x1a2434, near: 170, far: 470 },
    starsOpacity: 0.45,
    hemi: { sky: 0xc6d8ee, ground: 0x6b5a40, intensity: 0.62 }, // warm bounce off the plain
    sun: { color: 0xffe3ac, intensity: 3.1, offset: [-75, 128, 42] },
    rim: { color: 0x8fb4ff, intensity: 0.3 },
    exposure: 1.12,
    envIntensity: 0.62,       // polished alloys need sky to mirror
    glowScale: 0.5,           // daylight tames every emissive accent
    bloom: { threshold: 0.88, strength: 0.62 }, // sun-kissed whites shimmer
    grade: { sat: 1.03, vig: 0.14, grain: 0.012, tone: 1.0 }, // radiant orange-teal
    terrain: { base: '#77653a', warm: '#98804b', low: '#544a2b', moss: '#6d6a41', path: '#8a7b52' },
    lawn: '#5c7047',
    warFog: '#0a0d16',
    scatter: {
      trunk: 0x52453a,
      canopyBase: 0xffffff,     // instance colors carry the whole value
      canopy: (r) => [0.205 + r() * 0.05, 0.2 + r() * 0.1, 0.16 + r() * 0.1],  // dark dry olive
      rock: (r) => [0.07 + r() * 0.05, 0.08 + r() * 0.08, 0.36 + r() * 0.16],  // dusty stone
      grass: (r) => [0.115 + r() * 0.045, 0.26 + r() * 0.12, 0.3 + r() * 0.16], // sun-cured straw
    },
    mats: {
      panelLift: 0.62,          // alloy panels → sunlit pearl, shy of pure white
      darkLift: 0.1,
      metalLift: 0.34,
      glassDay: true,           // curtain walls become lit white panels
      winBg: '#e0e3e9', winDark: '#232d3c', winLitScale: 0.5,
      nodeColor: 0x2a85c8, nodeEmissive: 0.5,   // matte azure in sunlight
      skirt: 0x7d6b4c,          // graded-earth blend ring
      paving: {                 // machined deck plates with inlaid light circuitry
        campus: { base: '#3d4250', ins: '#242832' },
        secure: { base: '#2c2f39', ins: '#1a1d25' },
      },
      aoDecal: 0.5,             // strong contact shadows under the noon sun
      facade: { wall: '#f2f4f8', glass: '#101c2b', mullion: '#d6dbe4', lit: 0.14, emissive: 0.5 },
      facadeDark: { wall: '#9ba3b6', glass: '#0c1522', mullion: '#c2c9d6', lit: 0.16, emissive: 0.5 },
    },
    selRing: 0xff9752,          // bold warm selection rings, reference-style
    minimap: ['#232818', '#141a10'],
    terrainTex: { tintLift: 0.58, gain: 2.1 },   // photo-albedo tint & exposure
    fogSoftPasses: 2,           // wider fog falloff → soft island-edge fade
    crystal: { canopy: 0xb8c4c6, emissive: 0x9fe8de, intensity: 0.12, trunk: 0xcfc7b4 }, // smoky ice, no candy
    boulder: { h: 0.58, s: 0.07, l: 0.36 },   // weathered slate, not blueberries
    lumen: { color: 0xffedc9, intensity: 0.4 }, // glowing pebbles, faint by day
    weather: { rainChance: 0.42, cloudTint: 1 },
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
    envIntensity: 0.5,
    glowScale: 1,
    bloom: { threshold: 0.72, strength: 0.85 },
    grade: { sat: 0.98, vig: 0.16, grain: 0.013, tone: 0.6 },
    terrain: { base: '#3f3a58', warm: '#6e4f52', low: '#2b2740', moss: '#3d4a49', path: '#524a63' },
    lawn: '#33503f',
    warFog: '#0b0918',
    scatter: {
      trunk: 0x3a3230,
      canopyBase: 0xffffff,     // instance colors carry the whole value
      canopy: (r) => [0.38 + r() * 0.06, 0.18 + r() * 0.08, 0.14 + r() * 0.07], // dark dusk pines
      rock: (r) => [0.72 + r() * 0.06, 0.06 + r() * 0.06, 0.3 + r() * 0.12],
      grass: (r) => [0.78 + r() * 0.1, 0.14 + r() * 0.08, 0.2 + r() * 0.1],     // muted mauve stubble
    },
    mats: {
      panelLift: 0.36, darkLift: 0, metalLift: 0.2,
      glassDay: false,
      winBg: '#07070d', winDark: '#1a2030', winLitScale: 1,
      nodeColor: 0x0e2030, nodeEmissive: 1.35,
      skirt: 0x443c55,
      paving: {
        campus: { base: '#3a3d52', ins: '#232638' },
        secure: { base: '#2b2e3d', ins: '#191c28' },
      },
      aoDecal: 0.36,
      facade: { wall: '#c3c9d6', glass: '#0a1120', mullion: '#959db2', lit: 0.58, emissive: 1.0 },
      facadeDark: { wall: '#717a90', glass: '#091020', mullion: '#9aa2b8', lit: 0.62, emissive: 1.1 },
    },
    selRing: 0xffffff,
    minimap: ['#171531', '#221a33'],
    terrainTex: { tintLift: 0.34, gain: 1.8 },   // keep the violet dusk cast
    fogSoftPasses: 1,
    crystal: { canopy: 0x86c4be, emissive: 0x59e8dc, intensity: 0.7, trunk: 0xa89e8c },
    boulder: { h: 0.6, s: 0.12, l: 0.28 },
    lumen: { color: 0xffd9a0, intensity: 1.0 },
    weather: { rainChance: 0.3, cloudTint: 0.8 },
  },
};

export let THEME = THEMES.day;
export function setTheme(key) {
  THEME = THEMES[key] || THEMES.day;
  return THEME;
}
