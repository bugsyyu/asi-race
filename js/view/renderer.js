// ============================================================================
// Renderer — scene, themed lighting (day/dusk), real shadows, bloom, camera
// rig, shake.
// ============================================================================
import * as THREE from 'three';
import { THEME } from './theme.js';

// ---------------------------------------------------------------------------
// Minimal bloom pipeline built on core three.js only (no addons needed):
// scene → HDR-ish target → bright-pass → 2× separable blur @ half res →
// additive composite with manual sRGB encode. Keeps the whole game on a
// single vendored file: build/three.module.js.
// ---------------------------------------------------------------------------
const FSQ_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function makeBloom(renderer, threshold = 0.72, strength = 0.85) {
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uThresh: { value: threshold }, uKnee: { value: 0.22 } },
    vertexShader: FSQ_VERT,
    fragmentShader: `
      uniform sampler2D tSrc; uniform float uThresh, uKnee; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float w = smoothstep(uThresh - uKnee, uThresh + uKnee, l);
        gl_FragColor = vec4(c * w, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FSQ_VERT,
    fragmentShader: `
      uniform sampler2D tSrc; uniform vec2 uDir, uTexel; varying vec2 vUv;
      void main() {
        vec2 o = uDir * uTexel;
        vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
        c += (texture2D(tSrc, vUv + o * 1.3846).rgb + texture2D(tSrc, vUv - o * 1.3846).rgb) * 0.316216;
        c += (texture2D(tSrc, vUv + o * 3.2308).rgb + texture2D(tSrc, vUv - o * 3.2308).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: { tBase: { value: null }, tBloom: { value: null }, uStrength: { value: strength } },
    vertexShader: FSQ_VERT,
    fragmentShader: `
      uniform sampler2D tBase, tBloom; uniform float uStrength; varying vec2 vUv;
      vec3 sRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
      }
      void main() {
        vec3 c = texture2D(tBase, vUv).rgb + texture2D(tBloom, vUv).rgb * uStrength;
        gl_FragColor = vec4(sRGB(clamp(c, 0.0, 1.0)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const opts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 };
  const half = { type: THREE.HalfFloatType, depthBuffer: false };
  let rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
  let rtA = new THREE.WebGLRenderTarget(1, 1, half);
  let rtB = new THREE.WebGLRenderTarget(1, 1, half);

  function setSize(w, h) {
    rtScene.setSize(w, h);
    rtA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    rtB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    blurMat.uniforms.uTexel.value.set(1 / rtA.width, 1 / rtA.height);
  }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  function render(scene, camera) {
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    brightMat.uniforms.tSrc.value = rtScene.texture;
    pass(brightMat, rtA);
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.tSrc.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(1 + i, 0);
      pass(blurMat, rtB);
      blurMat.uniforms.tSrc.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, 1 + i);
      pass(blurMat, rtA);
    }
    compMat.uniforms.tBase.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtA.texture;
    pass(compMat, null);
  }

  return { setSize, render };
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = THEME.exposure;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // final quad encodes sRGB itself
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(THEME.sceneFog.color, THEME.sceneFog.near, THEME.sceneFog.far);

  // Sky dome — themed gradient (dusk peach horizon / day navy void), on canvas.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const g = skyCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  for (const [stop, color] of THEME.sky) grad.addColorStop(stop, color);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 18),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.rotation.x = Math.PI; // gradient bottom = horizon peach
  scene.add(sky);

  // Stars, faint, upper hemisphere.
  {
    const n = 320, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.2, r = 660;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfc6ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: THEME.starsOpacity })));
  }

  // Lights — themed key/fill (dusk: sun on the horizon; day: high warm sun).
  scene.add(new THREE.HemisphereLight(THEME.hemi.sky, THEME.hemi.ground, THEME.hemi.intensity));
  const sun = new THREE.DirectionalLight(THEME.sun.color, THEME.sun.intensity);
  const sunOff = THEME.sun.offset;
  sun.position.set(sunOff[0], sunOff[1], sunOff[2]);
  sun.castShadow = true;
  // crisp 4K shadows on real GPUs; software rasterizers keep the old budget
  const glDbg = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const gpuName = glDbg ? renderer.getContext().getParameter(glDbg.UNMASKED_RENDERER_WEBGL) : '';
  const softGL = /swiftshader|llvmpipe|softpipe|software/i.test(String(gpuName));
  sun.shadow.mapSize.set(softGL ? 2048 : 4096, softGL ? 2048 : 4096);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 420;
  const S = 150;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(THEME.rim.color, THEME.rim.intensity);
  rim.position.set(90, 50, -80);
  scene.add(rim);

  // Environment map — the dusk sky baked through PMREM so metals, glass and
  // chrome pick up real reflections instead of reading flat.
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
    );
    envSky.rotation.x = Math.PI; // same orientation as the visible dome
    envScene.add(envSky);
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9b0 }));
    sunBall.position.set(-42, 16, 14);
    envScene.add(sunBall);
    const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(58, 24),
      new THREE.MeshBasicMaterial({ color: 0x201c30 }));
    groundDisc.rotation.x = Math.PI / 2; groundDisc.position.y = -2;
    envScene.add(groundDisc);
    scene.environment = pmrem.fromScene(envScene).texture;
    scene.environmentIntensity = 0.5; // keep the dusk mood, just lift the metals
    pmrem.dispose();
  }

  // Camera rig: yaw pivot → pitch boom → camera. Bird's-eye, tilted.
  // Default pitch ≈49° matches the reference capture's framing; the pitch is
  // player-adjustable down to a near-horizon cinematic angle ([ ] / alt+wheel).
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1, 1200);
  const rig = new THREE.Group();          // position = look target on the ground
  const boom = new THREE.Group();         // pitch
  rig.add(boom); boom.add(camera);
  camera.position.set(0, 0, 62);          // dolly distance
  scene.add(rig);
  const camState = {
    zoom: 62, minZoom: 20, maxZoom: 130,
    yaw: Math.PI * 0.25,
    pitch: -0.838, minPitch: -1.22, maxPitch: -0.34, // 48.0° — measured from the reference footage
  };
  rig.rotation.y = camState.yaw;
  boom.rotation.x = camState.pitch;

  // Post: bloom for emissives (screens, beams, tracers).
  const bloom = makeBloom(renderer, THEME.bloom.threshold, THEME.bloom.strength);
  bloom.setSize(innerWidth, innerHeight);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
  });

  // Screen shake — decaying noise applied to the boom.
  let shakeAmt = 0;
  const addShake = (a) => { shakeAmt = Math.min(1.6, shakeAmt + a); };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(dt) {
    sun.target.position.set(rig.position.x, 0, rig.position.z); // shadows follow camera
    sun.position.set(rig.position.x + sunOff[0], sunOff[1], rig.position.z + sunOff[2]);
    camera.position.z = camState.zoom;
    boom.rotation.x = camState.pitch;
    if (shakeAmt > 0.001 && !reduceMotion) {
      boom.position.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt, 0);
      shakeAmt *= Math.pow(0.0009, dt); // fast decay
    } else boom.position.set(0, 0, 0);
    bloom.render(scene, camera);
  }

  return { renderer, scene, camera, rig, boom, camState, render, addShake };
}
