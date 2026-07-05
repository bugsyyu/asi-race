// ============================================================================
// Fog-of-war overlay — a terrain-conforming sheet whose alpha is driven by
// the sim's fog grid. Unexplored ground is near-black, explored-but-unseen
// ground is dimmed, visible ground is clear. A 3×3 box blur plus bilinear
// texture filtering keeps the edges soft, and a permanently dark one-cell
// border swallows the decorative terrain rim outside the playable map.
// ============================================================================
import * as THREE from 'three';
import { sampleGroundY as groundHeight } from './terrain.js';
import { TUNE } from '../sim/constants.js';
import { THEME } from './theme.js';

const UNSEEN = 242, EXPLORED = 122; // alpha levels, 0-255

// ---------------------------------------------------------------------------
// Material hook: scenery (trees, rocks, crystals, glow pebbles, the lawn)
// samples the same fog texture and sinks into the fog color — otherwise
// sunlit highlights and emissives shine through the darkness, which reads
// as a lighting bug. Register any material here; the overlay wires them up.
// ---------------------------------------------------------------------------
let WARFOG = null;          // { tex, span, color } once the overlay exists
const PENDING = [];
export function warFogify(mat) {
  PENDING.push(mat);
  if (WARFOG) hookFog(mat);
  return mat;
}
function hookFog(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    if (prev) prev(sh);
    sh.uniforms.tWarFog = { value: WARFOG.tex };
    sh.uniforms.uWarSpan = { value: WARFOG.span };
    sh.uniforms.uWarColor = { value: WARFOG.color };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWarSpan; varying vec2 vWarUv;')
      .replace('#include <project_vertex>', `
        vec4 warPos = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          warPos = instanceMatrix * warPos;
        #endif
        vWarUv = ( ( modelMatrix * warPos ).xz / uWarSpan ) + 0.5;
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWarFog; uniform vec3 uWarColor; varying vec2 vWarUv;')
      .replace('#include <dithering_fragment>', `
        float war = texture2D( tWarFog, vWarUv ).r;
        gl_FragColor.rgb = mix( gl_FragColor.rgb, uWarColor, war * 0.93 );
        #include <dithering_fragment>`);
  };
  mat.needsUpdate = true;
}

export function createFogOverlay(scene, game) {
  const fog = game.fog;
  const n = fog.n, res = fog.res;
  const N = n + 2;                        // +1 always-dark border cell per side
  const span = N * res;                   // world width the texture covers
  const data = new Uint8Array(N * N).fill(255);
  const raw = new Uint8Array(n * n);      // pre-blur levels
  const tmp = new Uint8Array(n * n);      // scratch for multi-pass soft blur
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  // Same footprint as the decorated terrain sheet, hugging its heights.
  const size = TUNE.mapSize + 60, segs = 132;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z) + 0.42);
    uv.setXY(i, (x + span / 2) / span, (z + span / 2) / span);
  }
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: { tFog: { value: tex }, uColor: { value: new THREE.Color(THEME.warFog) } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tFog; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(uColor, texture2D(tFog, vUv).r);
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2; // after ground pads / rings, so they dim under fog
  scene.add(mesh);

  // wire every registered scenery material to this fog texture
  WARFOG = { tex, span, color: new THREE.Color(THEME.warFog) };
  for (const m of PENDING) hookFog(m);

  let lastStamp = -1, lastReveal = null;

  function boxBlur(src, dst) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = Math.min(n - 1, Math.max(0, j + dj)) * n;
          for (let di = -1; di <= 1; di++) {
            sum += src[jj + Math.min(n - 1, Math.max(0, i + di))];
          }
        }
        dst[j * n + i] = (sum / 9) | 0;
      }
    }
  }

  function rebuild(reveal) {
    if (reveal) { data.fill(0); tex.needsUpdate = true; return; }
    data.fill(255); // border ring stays dark
    const { visible, explored } = fog;
    for (let k = 0; k < n * n; k++) raw[k] = visible[k] ? 0 : explored[k] ? EXPLORED : UNSEEN;
    // day mode blurs twice for the reference capture's wide island-edge fade
    let src = raw;
    for (let p = 0; p < (THEME.fogSoftPasses || 1); p++) {
      const dst = src === raw ? tmp : raw;
      boxBlur(src, dst);
      src = dst;
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) data[(j + 1) * N + (i + 1)] = src[j * n + i];
    }
    tex.needsUpdate = true;
  }

  function update() {
    const pf = game.playerFaction;
    const reveal = pf < 0 || game.over != null || !game.factions[pf].alive;
    if (fog.stamp === lastStamp && reveal === lastReveal) return;
    lastStamp = fog.stamp; lastReveal = reveal;
    rebuild(reveal);
  }
  update();
  return { update, mesh };
}
