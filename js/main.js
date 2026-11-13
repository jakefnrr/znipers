import * as THREE from 'three';
import Net from './net.js';

// ============================================================
// ZNIPERS — 1v1 sniper game (Three.js + PeerJS)
// ============================================================

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

// ---------------- AUDIO (synthesized) ----------------
const AudioSys = {
  ctx: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // "chuchu" — sniper report: sharp crack + body thump
  shoot() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    // crack
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.13);
    // noise blast
    const len = c.sampleRate * 0.25, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const n = c.createBufferSource(); n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.22);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(f).connect(ng).connect(c.destination); n.start(t);
    // sub boom
    const s = c.createOscillator(), sg = c.createGain();
    s.type = 'sine'; s.frequency.setValueAtTime(90, t); s.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    sg.gain.setValueAtTime(0.8, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(sg).connect(c.destination); s.start(t); s.stop(t + 0.36);
  },
  // reload ratchet — the "chuchu" reload you hear after an ADS shot
  reload() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator(), g = c.createGain();
      const tt = t + i * 0.14;
      o.type = 'square'; o.frequency.setValueAtTime(900 - i * 120, tt);
      g.gain.setValueAtTime(0.12, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.05);
      o.connect(g).connect(c.destination); o.start(tt); o.stop(tt + 0.06);
    }
    // bolt slide
    const n = c.createBufferSource();
    const len = c.sampleRate * 0.08, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t + 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    n.buffer = buf; n.connect(f).connect(g).connect(c.destination); n.start(t + 0.55);
  },
  hit() { // hitmarker tick
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1800, t);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.08);
  },
  hurt() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.23);
  },
  ui() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.setValueAtTime(780, t + 0.06);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.16);
  },
  win() {
    const c = this.ensure(); if (!c) return;
    [440, 554, 659, 880].forEach((f, i) => {
      const t = c.currentTime + i * 0.12, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.32);
    });
  }
};

// ---------------- INPUT ----------------
const Input = {
  keys: {}, yaw: 0, pitch: 0,
  ads: false, adsTouch: false,
  jumpQueued: false, shootQueued: false,
  lookTouchId: null, lookLast: null,
  joyVec: { x: 0, y: 0 }, joyActive: false,
  jumpHeld: false,

  init(canvas) {
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });

    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    canvas.addEventListener('click', () => {
      if (Game.state === 'playing' && !isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock();
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousedown', e => {
      if (Game.state !== 'playing' || isTouch) return;
      if (e.button === 2) this.toggleAds();
      if (e.button === 0) this.shootQueued = true;
    });

    this.initTouch();
  },

  toggleAds() {
    this.ads = !this.ads;
    AudioSys.ui();
    return this.ads;
  },

  initTouch() {
    const joyZone = $('joyZone'), base = $('joyBase'), knob = $('joyKnob');
    let joyId = null, joyCX = 0, joyCY = 0;

    addEventListener('touchstart', e => {
      if (Game.state !== 'playing') return;
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        // UI buttons handled by their own handlers; ignore touches on them
        if (t.target.closest('.touch-btn')) continue;
        // right ~55% of screen = look drag
        if (x > innerWidth * 0.42 && this.lookTouchId === null) {
          this.lookTouchId = t.identifier; this.lookLast = { x, y };
        } else if (this.lookTouchId === null && x <= innerWidth * 0.42 && joyId === null) {
          joyId = t.identifier;
          joyCX = x; joyCY = y;
          base.style.display = 'block';
          base.style.left = (x - 55) + 'px'; base.style.top = (y - 55) + 'px';
          knob.style.left = '31px'; knob.style.top = '31px';
        }
      }
      e.preventDefault();
    }, { passive: false });

    addEventListener('touchmove', e => {
      if (Game.state !== 'playing') return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookTouchId && this.lookLast) {
          const dx = t.clientX - this.lookLast.x, dy = t.clientY - this.lookLast.y;
          this.lookLast = { x: t.clientX, y: t.clientY };
          this.yaw -= dx * 0.005;
          this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.005));
        } else if (t.identifier === joyId) {
          let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
          const max = 55, len = Math.hypot(dx, dy);
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          knob.style.left = (31 + dx) + 'px'; knob.style.top = (31 + dy) + 'px';
          this.joyVec.x = dx / max; this.joyVec.y = dy / max;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookTouchId) { this.lookTouchId = null; this.lookLast = null; }
        if (t.identifier === joyId) {
          joyId = null; this.joyVec.x = this.joyVec.y = 0; this.joyActive = false;
          base.style.display = 'none';
        }
      }
    };
    addEventListener('touchend', endTouch);
    addEventListener('touchcancel', endTouch);

    // buttons
    const bind = (id, down, up) => {
      const el = $(id);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      if (up) el.addEventListener('touchend', e => { e.preventDefault(); up(); });
    };
    bind('btnAds', () => { this.adsTouch = this.toggleAds(); }, () => {});
    bind('btnShoot', () => { this.shootQueued = true; }, () => {});
    bind('btnJump', () => { this.jumpQueued = true; this.jumpHeld = true; }, () => { this.jumpHeld = false; });
  }
};

// ---------------- THREE SETUP ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.className = 'game';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.Fog(0x87b5d9, 120, 420);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a4a3a, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 300;
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- TEXTURES ----------------
const texLoader = new THREE.TextureLoader();
const playerTex = texLoader.load('assets/player.jpg');
playerTex.colorSpace = THREE.SRGBColorSpace;
const hipTex = texLoader.load('assets/sniper_hip.jpg');
hipTex.colorSpace = THREE.SRGBColorSpace;

// ---------------- MATERIALS / BUILDERS ----------------
const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: 0x9aa7b5, roughness: 0.9 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x5d6a78, roughness: 0.95 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8d8d84, roughness: 0.95 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7, metalness: 0.4 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3c4450, roughness: 0.5, metalness: 0.7 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x7a5c34, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x7fb3d5, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.55 }),
};

// ---------------- WORLD STATE ----------------
let colliders = [];   // {min:Vector3,max:Vector3}
let shootables = [];  // meshes raycast can hit (walls)
let mapGroup = null;
let spawnPoints = [];
let checkpoints = []; // rooftop runner checkpoints {pos:Vector3, level:int}
let topTrigger = null;

function addBox(w, h, d, x, y, z, mat = MAT.wall, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  mapGroup.add(m);
  if (opts.collide !== false) {
    colliders.push({
      min: new THREE.Vector3(x - w / 2, y, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    });
    shootables.push(m);
  }
  return m;
}

function groundPlane(size, color = 0x4c5a48) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  mapGroup.add(g);
  colliders.push({ min: new THREE.Vector3(-size / 2, -1, -size / 2), max: new THREE.Vector3(size / 2, 0, size / 2) });
  return g;
}

function clearWorld() {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse(o => { o.geometry && o.geometry.dispose(); }); }
  mapGroup = new THREE.Group();
  scene.add(mapGroup);
  colliders = []; shootables = []; spawnPoints = []; checkpoints = []; topTrigger = null;
}

// ============================================================
// MAP 1 — 1v1 ARENA (city block, ~90x90)
// ============================================================
function buildArena() {
  clearWorld();
  groundPlane(140, 0x555f4e);

  // perimeter buildings
  const B = 26, H = 22;
  addBox(B, H, 6, 0, 0, -55, MAT.wallDark);            // north
  addBox(B, H, 6, 0, 0, 55, MAT.wallDark);             // south
  addBox(6, H, B, -55, 0, 0, MAT.wallDark);            // west
  addBox(6, H, B, 55, 0, 0, MAT.wallDark);             // east

  // interior buildings (cover / sniper perches)
  addBox(16, 12, 16, -22, 0, -18, MAT.wall);
  addBox(16, 12, 16, 22, 0, 18, MAT.wall);
  addBox(12, 8, 12, -24, 0, 20, MAT.concrete);
  addBox(12, 8, 12, 24, 0, -20, MAT.concrete);
  addBox(10, 16, 10, 0, 0, -30, MAT.wall);
  addBox(10, 16, 10, 0, 0, 30, MAT.wall);

  // low walls / crates for mid-field cover
  addBox(8, 1.4, 1, -10, 0, 0, MAT.crate);
  addBox(8, 1.4, 1, 10, 0, 2, MAT.crate);
  addBox(1, 1.4, 8, 0, 0, -8, MAT.crate);
  addBox(1, 1.4, 8, 2, 0, 10, MAT.crate);
  addBox(2.2, 2.2, 2.2, -6, 0, 14, MAT.crate);
  addBox(2.2, 2.2, 2.2, 7, 0, -14, MAT.crate);
  addBox(2.2, 2.2, 2.2, -14, 0, -4, MAT.crate);
  addBox(2.2, 2.2, 2.2, 15, 0, 6, MAT.crate);
  // sandbag lines
  addBox(6, 1.1, 1, 18, 0, -6, MAT.wallDark);
  addBox(6, 1.1, 1, -18, 0, 6, MAT.wallDark);

  spawnPoints = [
    { pos: new THREE.Vector3(-30, 0, -30), yaw: Math.PI * 0.25 },
    { pos: new THREE.Vector3(30, 0, 30), yaw: -Math.PI * 0.75 },
  ];

  // scattered detail: trees / lamps (non-collide decor on top ok)
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, r = 38 + (i % 3) * 6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 34 && Math.abs(z) < 34) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), MAT.crate);
      trunk.position.set(x, 1.5, z); trunk.castShadow = true; mapGroup.add(trunk);
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1, flatShading: true }));
      leaf.position.set(x, 4.2, z); leaf.castShadow = true; mapGroup.add(leaf);
    }
  }
}

// ============================================================
// MAP 2 — ROOFTOP (sniper tower vs 5-level climbable building)
// ============================================================
function buildRooftop() {
  clearWorld();
  groundPlane(320, 0x3d4a42);

  // ---------- SNIPER TOWER (far building, west) ----------
  const TX = -95;
  addBox(26, 4, 26, TX, 0, 0, MAT.concrete);            // base block
  addBox(18, 26, 18, TX, 4, 0, MAT.wall);              // tower shaft
  addBox(24, 1.2, 24, TX, 30, 0, MAT.roof);            // roof slab
  // parapet walls (low cover) around roof edge
  addBox(24, 1.1, 1, TX, 31.2, -11.5, MAT.wallDark);
  addBox(24, 1.1, 1, TX, 31.2, 11.5, MAT.wallDark);
  addBox(1, 1.1, 24, TX - 11.5, 31.2, 0, MAT.wallDark);
  addBox(1, 1.1, 24, TX + 11.5, 31.2, 0, MAT.wallDark);
  // sniper perch box
  addBox(2.5, 1.1, 2.5, TX + 4, 31.2, -4, MAT.dark);
  spawnPoints.push({ pos: new THREE.Vector3(TX + 4, 31.2, -4), yaw: Math.PI / 2 }); // facing +x (east, toward runner bldg)

  // ---------- RUNNER BUILDING (east) — 5 levels ----------
  const BX = 0, W = 18, D = 18, FH = 3; // floor-to-floor height
  // ground floor slab + outer walls with door gap on west side
  addBox(W, 0.5, D, BX, 0, 0, MAT.concrete);
  addBox(W, FH, 1, BX, 0.5, -D / 2 + 0.5, MAT.wall);   // north wall
  addBox(W, FH, 1, BX, 0.5, D / 2 - 0.5, MAT.wall);    // south wall
  addBox(1, FH, D, BX - W / 2 + 0.5, 0.5, 0, MAT.wall);// west wall
  addBox(1, FH, D, BX + W / 2 - 0.5, 0.5, 0, MAT.wall);// east wall

  // door opening on west wall (ground floor entrance faces sniper? keep closed-ish: gap)
  // carve: rebuild west wall as two segments leaving 3-wide door
  colliders.pop(); shootables.pop(); // remove the solid west wall we just added
  const wm = mapGroup.children[mapGroup.children.length - 1]; mapGroup.remove(wm);
  addBox(1, FH, (D - 3) / 2, BX - W / 2 + 0.5, 0.5, -(3 / 2 + (D - 3) / 4), MAT.wall);
  addBox(1, FH, (D - 3) / 2, BX - W / 2 + 0.5, 0.5, (3 / 2 + (D - 3) / 4), MAT.wall);
  addBox(1, 1.2, 3, BX - W / 2 + 0.5, FH - 1.2, 0, MAT.wall); // lintel

  checkpoints.push({ pos: new THREE.Vector3(BX - W / 2 + 2, 0.5, 0), level: 0 });
  spawnPoints.push({ pos: new THREE.Vector3(BX - 6, 0.5, 0), yaw: Math.PI / 2 }); // runner spawn inside ground floor

  // upper floors: slab + partial walls (cover) — levels 1..4, roof = level 5 top
  for (let lvl = 1; lvl <= 4; lvl++) {
    const fy = 0.5 + lvl * FH; // floor surface y
    addBox(W, 0.4, D, BX, fy - 0.4, 0, MAT.concrete);          // floor slab
    // waist-high cover walls on this level (gaps to pass)
    addBox(6, 1.1, 0.6, BX - 4, fy, -D / 2 + 3, MAT.wallDark);
    addBox(6, 1.1, 0.6, BX + 4, fy, D / 2 - 3, MAT.wallDark);
    addBox(0.6, 1.1, 6, BX - W / 2 + 3, fy, 3, MAT.wallDark);
    addBox(0.6, 1.1, 6, BX + W / 2 - 3, fy, -3, MAT.wallDark);
    // taller pillar cover
    addBox(2, 2.6, 2, BX + (lvl % 2 ? 4 : -4), fy, (lvl % 2 ? 4 : -4), MAT.wall);
    checkpoints.push({ pos: new THREE.Vector3(BX - W / 2 + 2, fy, 0), level: lvl });
  }
  // roof (level 5)
  const roofY = 0.5 + 5 * FH;
  addBox(W, 0.4, D, BX, roofY - 0.4, 0, MAT.roof);
  addBox(W, 1.1, 0.6, BX, roofY, -D / 2 + 1, MAT.wallDark);   // roof parapet
  addBox(W, 1.1, 0.6, BX, roofY, D / 2 - 1, MAT.wallDark);
  addBox(0.6, 1.1, D, BX - W / 2 + 1, roofY, 0, MAT.wallDark);
  addBox(0.6, 1.1, D, BX + W / 2 - 1, roofY, 0, MAT.wallDark);
  checkpoints.push({ pos: new THREE.Vector3(BX - W / 2 + 2, roofY, 0), level: 5 });
  topTrigger = { min: new THREE.Vector3(BX - W / 2, roofY, -D / 2), max: new THREE.Vector3(BX + W / 2, roofY + 2, D / 2) };

  // ---------- STAIRS: switchback along the west side, outside wall ----------
  // staircase hugging the west face: flights going up along z, landings at each level
  const SX = BX - W / 2 - 3; // stair center x (3m west of wall)
  const stepD = 0.5, stepH = 0.42;
  // For each level, a straight flight along +z inside a stairwell shaft attached to wall
  // Simpler: exterior switchback stairs on the west side.
  // Flight A (levels 0->2) along south edge, Flight B (2->4) along north edge — zigzag.
  // We'll build steps as thin boxes; step-up assist (0.55) makes them climbable.
  function flight(x0, z0, x1, z1, y0, y1, width = 2.2) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(Math.abs(y1 - y0) / stepH);
    const rise = (y1 - y0) / steps;
    const run = len / steps;
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const sx = x0 + (x1 - x0) * t, sz = z0 + (z1 - z0) * t;
      const sy = y0 + rise * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(run, rise) + 0.15, 0.18, width), MAT.metal);
      step.position.set(sx, sy - 0.09, sz);
      step.rotation.y = -ang;
      step.rotation.x = Math.atan2(y1 - y0, len); // pitch along run — approx via z-rot? use lookAt instead
      // simpler: keep steps horizontal (0.42 rise <= step-up 0.55? no—0.42 ok)
      step.rotation.set(0, -ang, 0);
      step.castShadow = step.receiveShadow = true;
      mapGroup.add(step);
      // collider approx: thin box aligned — use conservative AABB
      const hw = width / 2, hl = (Math.hypot(run, rise)) / 2 + 0.1;
      const ex = Math.abs(Math.cos(ang)) * hl + Math.abs(Math.sin(ang)) * hw;
      const ez = Math.abs(Math.sin(ang)) * hl + Math.abs(Math.cos(ang)) * hw;
      colliders.push({ min: new THREE.Vector3(sx - ex, sy - 0.18, sz - ez), max: new THREE.Vector3(sx + ex, sy, sz + ez) });
      shootables.push(step);
    }
  }
  // Zigzag exterior staircase on west side:
  // ground(0.5) -> L2 (6.5): flight along south edge going +x? Keep it on west face:
  // Flight 1: from (SX, z=-8) at y0.5 up to (SX, z=+8) y6.5  (along +z, 16m run, 6m rise → ~15 steps of .4)
  // Landing at L2 inside? Door on west wall each level.
  // To keep climbable & simple: stairs OUTSIDE west wall, with openings (doors) in west wall per level.
  // West wall currently solid except ground door. Punch visual doors: add dark door frames (non-collide) per level.
  for (let lvl = 1; lvl <= 4; lvl++) {
    const fy = 0.5 + lvl * FH;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 3), MAT.dark);
    door.position.set(BX - W / 2 + 0.4, fy + 1.1, 0);
    mapGroup.add(door); // visual door; wall behind is solid — runner enters via stair gap instead
  }
  // Instead of doors in walls: leave the west wall solid and put stairs INSIDE? Rework:
  // Simplest robust design: interior switchback stairwell in the SW corner.
  // Remove exterior flight approach; build interior stairs against west wall inside.
  // (We already have interior floor slabs; add stair flights inside along west wall.)
  const IX = BX - W / 2 + 1.6; // interior stair x
  // Stair flights inside, zigzag in z: each flight climbs 2 levels (6m) along z length 12
  for (let f = 0; f < 2; f++) {
    const y0 = 0.5 + f * 2 * FH, y1 = y0 + 2 * FH;
    const zA = f % 2 === 0 ? -D / 2 + 2 : D / 2 - 2;
    const zB = -zA;
    flight(IX, zA, IX, zB, y0, y1, 2.4);
    // landing slab at top connecting to floor edge
    addBox(3.2, 0.3, 3, IX, y1 - 0.3, zB, MAT.metal, { collide: false });
  }
  // final flight roof: from level4 floor (12.5) to roof (15.5) — short flight along east interior wall
  flight(BX + W / 2 - 1.6, D / 2 - 2, BX + W / 2 - 1.6, -D / 2 + 2, 0.5 + 4 * FH, roofY, 2.4);

  // decorative: AC units on roof, antenna on tower
  addBox(3, 1.5, 3, TX - 5, 31.2, 5, MAT.metal);
  addBox(2, 1.2, 2, TX + 6, 31.2, 6, MAT.dark);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 14, 6), MAT.metal);
  ant.position.set(TX - 8, 38, -8); ant.castShadow = true; mapGroup.add(ant);

  // city filler blocks around (visual only, colliding low)
  for (let i = 0; i < 10; i++) {
    const x = -60 + (i * 37) % 160 - 40, z = -90 + (i * 53) % 180;
    if (Math.abs(x - BX) < 20 && Math.abs(z) < 20) continue;
    if (Math.abs(x - TX) < 22 && Math.abs(z) < 22) continue;
    const h = 8 + (i % 4) * 6;
    addBox(14 + (i % 3) * 4, h, 14 + (i % 2) * 5, x, 0, z, i % 2 ? MAT.wallDark : MAT.wall);
  }
}

// ============================================================
// PLAYERS
// ============================================================
const EYE = 1.62, HEIGHT = 1.7, HALF = 0.35;
const GRAV = 22, JUMPV = 8.2, SPEED = 6.4;
const STEP_UP = 0.55;

function makeRemotePlayer() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ map: playerTex, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.4), bodyMat);
  body.position.y = 0.95; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 }));
  head.position.y = 1.72; head.castShadow = true;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.3), MAT.dark);
  legL.position.set(-0.16, 0.25, 0); legL.castShadow = true;
  const legR = legL.clone(); legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.1), MAT.metal);
  gun.position.set(0.35, 1.25, 0.3);
  // invisible generous hitbox
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.95;
  hit.userData.isPlayer = true;
  g.add(body, head, legL, legR, gun, hit);
  scene.add(g);
  return { group: g, parts: { body, head, legL, legR }, hit, pos: new THREE.Vector3(), yaw: 0, pitch: 0, targetPos: new THREE.Vector3(), targetYaw: 0 };
}

// ---------------- LOCAL PLAYER ----------------
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, grounded: false, alive: true,
  ammo: 1, maxAmmo: 1, lastShot: 0, deadTimer: 0,
  checkpoint: null, level: 0,
  adsT: 0,
};

function aabbAt(px, py, pz) {
  return {
    min: new THREE.Vector3(px - HALF, py, pz - HALF),
    max: new THREE.Vector3(px + HALF, py + HEIGHT, pz + HALF),
  };
}
function overlaps(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x &&
         a.min.y < b.max.y && a.max.y > b.min.y &&
         a.min.z < b.max.z && a.max.z > b.min.z;
}
function collides(px, py, pz) {
  const b = aabbAt(px, py, pz);
  for (const c of colliders) if (overlaps(b, c)) return c;
  return null;
}

function moveAxis(axis, delta) {
  if (delta === 0) return;
  const p = player.pos;
  let nx = p.x, ny = p.y, nz = p.z;
  if (axis === 'x') nx += delta; else if (axis === 'z') nz += delta; else ny += delta;

  if (axis === 'y') {
    // vertical: land on tops / bump heads
    const oldFeet = p.y, oldHead = p.y + HEIGHT;
    const hit = collides(nx, ny, nz);
    if (!hit) { p.y = ny; return; }
    if (player.vel.y <= 0 && hit.max.y <= oldFeet + 0.3 && hit.max.y >= ny) {
      p.y = hit.max.y; player.vel.y = 0; player.grounded = true;
    } else if (player.vel.y > 0 && hit.min.y >= oldHead - 0.3 && hit.min.y <= ny + HEIGHT) {
      p.y = hit.min.y - HEIGHT; player.vel.y = 0;
    } else {
      // stepped into side while airborne — clamp to nearest face
      p.y = player.vel.y <= 0 ? Math.min(ny, hit.max.y) : Math.max(ny, hit.min.y - HEIGHT);
      if (player.vel.y <= 0 && p.y < hit.max.y) { p.y = hit.max.y; player.vel.y = 0; player.grounded = true; }
    }
    return;
  }

  // horizontal axis with step-up assist
  const hit = collides(nx, ny, nz);
  if (!hit) { if (axis === 'x') p.x = nx; else p.z = nz; return; }
  // try step up
  const stepY = hit.max.y;
  if (stepY - p.y <= STEP_UP && stepY - p.y > 0.01) {
    if (!collides(nx, stepY, nz)) {
      p.y = stepY; player.grounded = true;
      if (axis === 'x') p.x = nx; else p.z = nz;
      return;
    }
  }
  // clamp to face
  if (axis === 'x') p.x = delta > 0 ? hit.min.x - HALF - 0.001 : hit.max.x + HALF + 0.001;
  else p.z = delta > 0 ? hit.min.z - HALF - 0.001 : hit.max.z + HALF + 0.001;
}

function updatePlayer(dt) {
  if (!player.alive) {
    player.deadTimer -= dt;
    if (player.deadTimer <= 0) respawnLocal();
    return;
  }
  // wish dir in camera space
  let fx = 0, fz = 0;
  if (Input.keys['KeyW']) fz -= 1;
  if (Input.keys['KeyS']) fz += 1;
  if (Input.keys['KeyA']) fx -= 1;
  if (Input.keys['KeyD']) fx += 1;
  if (isTouch) { fx += Input.joyVec.x; fz += Input.joyVec.y; }
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = (fx * cos - fz * sin), wz = (fx * sin + fz * cos);
  // NOTE: with yaw convention, forward = (-sin(yaw), -cos(yaw))
  const fwx = -fz * Math.sin(player.yaw) + fx * Math.cos(player.yaw);
  const fwz = -fz * Math.cos(player.yaw) - fx * Math.sin(player.yaw);
  const spd = SPEED;
  player.vel.x = fwx * spd; player.vel.z = fwz * spd;

  if ((Input.jumpQueued || Input.jumpHeld) && player.grounded) {
    player.vel.y = JUMPV; player.grounded = false;
    Input.jumpQueued = false;
  }
  Input.jumpQueued = false;
  player.vel.y -= GRAV * dt;
  if (player.vel.y < -40) player.vel.y = -40;

  player.grounded = false;
  moveAxis('x', player.vel.x * dt);
  moveAxis('z', player.vel.z * dt);
  moveAxis('y', player.vel.y * dt);

  // world bounds
  player.pos.x = Math.max(-140, Math.min(140, player.pos.x));
  player.pos.z = Math.max(-140, Math.min(140, player.pos.z));
  if (player.pos.y < -5) { player.pos.y = -5; player.vel.y = 0; }

  // fell out of world safety
  if (player.pos.y < -2) killLocal('fell');
}

// ---------------- VIEWMODEL (the sniper) ----------------
const viewmodel = new THREE.Group();
let vmMuzzle;
function buildViewmodel() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.55, metalness: 0.65 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.8 });
  const g = viewmodel;
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  // receiver — textured with the sniper reference image on both sides
  const sideMat = new THREE.MeshStandardMaterial({ map: hipTex, roughness: 0.6, metalness: 0.3 });
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), [dark, dark, dark, dark, sideMat, sideMat]);
  rec.position.set(0, 0, -0.1); g.add(rec);
  add(new THREE.BoxGeometry(0.07, 0.09, 0.3), wood, 0, -0.005, 0.32);          // stock/grip area
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 10), dark, 0, 0.015, -0.62, Math.PI / 2); // barrel
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), dark, 0, 0.015, -0.95, Math.PI / 2); // muzzle brake
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), dark, 0, 0.1, -0.15, Math.PI / 2);    // scope tube
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), dark, 0, 0.1, 0.0, Math.PI / 2);     // scope bell front
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10), dark, 0, 0.1, -0.3, Math.PI / 2);      // scope eyepiece
  add(new THREE.BoxGeometry(0.02, 0.05, 0.02), dark, 0, -0.09, 0.28);          // mag
  add(new THREE.BoxGeometry(0.02, 0.07, 0.02), dark, 0, -0.08, -0.35);         // bolt handle
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), dark, 0.05, -0.02, -0.35, 0); // bipod leg hint
  vmMuzzle = new THREE.Object3D(); vmMuzzle.position.set(0, 0.015, -1.15); g.add(vmMuzzle);
  g.traverse(o => { o.frustumCulled = false; });
  camera.add(g);
  scene.add(camera);
}

// ---------------- TRACERS / EFFECTS ----------------
const tracers = [];
function spawnTracer(from, to, color = 0xffe9a8) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.12 });
}
const flashes = [];
function spawnFlash(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true }));
  m.position.copy(pos); scene.add(m);
  flashes.push({ m, life: 0.1 });
}

// ---------------- SHOOTING ----------------
const raycaster = new THREE.Raycaster();
let remote = null;
let bot = null;

function muzzleWorld(out) {
  vmMuzzle.getWorldPosition(out);
  return out;
}

function tryShoot() {
  const now = performance.now();
  const reloadTime = Game.mode === 'rooftop' && player.role === 'sniper' ? 4000 : 1e9;
  if (player.ammo <= 0 || now - player.lastShot < reloadTime + (Game.mode === '1v1' ? 600 : 1200)) return;
  player.lastShot = now;
  player.ammo--;
  AudioSys.shoot();
  if (player.adsT > 0.6) setTimeout(() => AudioSys.reload(), 750); // reload chuchu after ADS shot

  // ray from camera center
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 800;
  const targets = shootables.slice();
  const foeHit = remote && remote.hit;
  const botHit = bot && bot.hit;
  if (foeHit) targets.push(foeHit);
  if (botHit) targets.push(botHit);
  const hits = raycaster.intersectObjects(targets, false);
  const origin = new THREE.Vector3();
  muzzleWorld(origin);

  let endPoint;
  if (hits.length) {
    endPoint = hits[0].point.clone();
    if (hits[0].object.userData.isPlayer) {
      onHitFoe();
    } else {
      spawnFlash(endPoint);
    }
  } else {
    endPoint = raycaster.ray.at(300, new THREE.Vector3());
  }
  spawnTracer(origin, endPoint);
  updateAmmoHUD();
}

function onHitFoe() {
  AudioSys.hit();
  $('hitmarker').classList.remove('show'); void $('hitmarker').offsetWidth; $('hitmarker').classList.add('show');
  if (Net.conn) Net.send({ t: 'hit' });
  else if (bot) botDie();
  addKillfeed('me');
}

function updateAmmoHUD() {
  $('ammoText').textContent = `${player.ammo} / ${player.maxAmmo}`;
  $('bulletIcon').classList.toggle('empty', player.ammo <= 0);
}

// ---------------- DEATH / RESPAWN ----------------
function killLocal(cause) {
  if (!player.alive) return;
  player.alive = false;
  player.deadTimer = 3;
  AudioSys.hurt();
  $('damageFlash').style.opacity = 1;
  setTimeout(() => $('damageFlash').style.opacity = 0, 250);
  if (Net.conn) Net.send({ t: 'die', cause });
  else if (bot) botScore('me');
}

function respawnLocal() {
  player.alive = true;
  const sp = spawnPoints[player.roleIndex] || spawnPoints[0];
  player.pos.copy(sp.pos);
  player.pos.y += 0.1;
  player.vel.set(0, 0, 0);
  player.yaw = sp.yaw; player.pitch = 0;
  Input.yaw = sp.yaw; Input.pitch = 0;
  if (Game.mode === '1v1') { player.ammo = player.maxAmmo = 1; }
  else if (player.role === 'sniper') { player.ammo = 3; player.maxAmmo = 3; }
  updateAmmoHUD();
}

// ============================================================
// GAME STATE
// ============================================================
const Game = {
  state: 'menu',       // menu | playing | end
  mode: '1v1',         // '1v1' | 'rooftop'
  timeLimit: 60,
  role: 'p1',          // p1 | sniper | runner
  roleIndex: 0,
  scoreYou: 0, scoreFoe: 0,
  timeLeft: 0,
  remoteHp: {},
};

// ---------------- HUD helpers ----------------
function addKillfeed(who) {
  const d = document.createElement('div');
  d.className = who;
  d.textContent = who === 'me' ? 'You  ✕  Enemy' : 'Enemy  ✕  You';
  $('killfeed').prepend(d);
  setTimeout(() => d.remove(), 4000);
}

function setScore() {
  $('scoreYou').textContent = `YOU ${Game.scoreYou}`;
  $('scoreFoe').textContent = `${Game.scoreFoe} FOE`;
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ============================================================
// NET PROTOCOL
// ============================================================
let stateTimer = 0;

Net.on('msg', m => {
  if (!m || !m.t) return;
  switch (m.t) {
    case 'start':
      startGame(m.mode, m.time, m.role);
      break;
    case 'state':
      if (remote) {
        remote.targetPos.set(m.p[0], m.p[1], m.p[2]);
        remote.targetYaw = m.yaw;
        remote.targetPitch = m.pit || 0;
      }
      break;
    case 'shoot':
      // remote tracer
      {
        const from = new THREE.Vector3(...m.o), to = new THREE.Vector3(...m.d);
        spawnTracer(from, to, 0xff9a7a);
        AudioSys.shoot();
      }
      break;
    case 'hit':
      // enemy hit ME
      onEnemyHitMe();
      break;
    case 'die':
      enemyDied(m.cause);
      break;
    case 'respawn':
      if (remote) { remote.pos.copy(remote.targetPos); }
      break;
    case 'score':
      if (m.winner === 'me') { Game.scoreYou++; addKillfeed('foe'); }
      else { Game.scoreFoe++; addKillfeed('me'); }
      setScore();
      break;
    case 'time':
      Game.timeLeft = m.left;
      break;
    case 'cp':
      if (Game.mode === 'rooftop' && Game.role === 'runner') {
        player.checkpoint = checkpoints[m.level] || player.checkpoint;
        player.level = m.level;
        updateLevelTag();
      } else if (Game.mode === 'rooftop') {
        // sniper sees runner level
        const tag = $('levelTag');
        tag.textContent = `RUNNER — LEVEL ${m.level}/5`;
        tag.classList.remove('hidden');
      }
      break;
    case 'end':
      endGame(m.winner === 'me', m.reason || '');
      break;
    case 'bye':
      backToMenu();
      break;
  }
});

Net.on('peerleft', () => {
  if (Game.state === 'playing') {
    endGame(true, 'Opponent left');
  } else {
    $('netStatus').textContent = 'Opponent disconnected.';
    $('btnStart').disabled = true;
  }
});

function onEnemyHitMe() {
  // I got shot
  if (!player.alive) return;
  if (Game.mode === '1v1') {
    killLocal('shot');
    // score handled via 'score' msg from shooter? shooter sends 'score' too — we handle below
  } else if (Game.mode === 'rooftop') {
    if (Game.role === 'runner') {
      // knocked down → respawn at checkpoint
      player.alive = false;
      player.deadTimer = 2.5;
      AudioSys.hurt();
      $('damageFlash').style.opacity = 1;
      setTimeout(() => $('damageFlash').style.opacity = 0, 250);
      Net.send({ t: 'knock' });
    } else {
      // sniper got shot?? shouldn't happen; ignore
    }
  }
}

function enemyDied() {
  // remote player died — visual: hide briefly
  if (remote) remote.group.visible = false;
  setTimeout(() => { if (remote) remote.group.visible = true; }, 3000);
}

function botDie() {
  if (bot) bot.group.visible = false;
  setTimeout(() => { if (bot) bot.group.visible = true; botRespawn(); }, 3000);
}

function botScore(who) {
  if (who === 'me') { Game.scoreYou++; addKillfeed('foe'); }
  else { Game.scoreFoe++; addKillfeed('me'); }
  setScore();
}

// ============================================================
// REMOTE PLAYER SYNC
// ============================================================
function sendState() {
  if (!Net.conn) return;
  Net.send({
    t: 'state',
    p: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw, pit: player.pitch,
  });
}

function updateRemote(dt) {
  if (!remote) return;
  // interpolate toward target
  remote.pos.lerp(remote.targetPos, Math.min(1, dt * 12));
  let dy = remote.targetYaw - remote.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  remote.yaw += dy * Math.min(1, dt * 12);
  remote.group.position.copy(remote.pos);
  remote.group.rotation.y = remote.yaw + Math.PI; // model faces +z? adjust: box gun at +z front
  remote.hit.position.copy(remote.pos).y += 0.95;
  // walk anim: swing legs by speed estimate
  const speed = remote.pos.distanceTo(remote.targetPos);
  const t = performance.now() / 130;
  remote.parts.legL.rotation.x = Math.sin(t) * Math.min(0.5, speed * 0.4);
  remote.parts.legR.rotation.x = -Math.sin(t) * Math.min(0.5, speed * 0.4);
}

// ============================================================
// BOT (practice mode)
// ============================================================
const botState = {
  active: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0,
  alive: true, ammo: 1, lastShot: 0, target: new THREE.Vector3(),
  thinkT: 0, waypoint: 0,
};

function makeBot() {
  if (bot) scene.remove(bot.group);
  bot = makeRemotePlayer();
  botState.active = true;
  bot.group.visible = true;
  botRespawn();
}
function botRespawn() {
  const sp = spawnPoints[1] || spawnPoints[0];
  botState.pos.copy(sp.pos); botState.pos.y += 0.1;
  botState.alive = true; botState.ammo = 1;
  bot.targetPos.copy(botState.pos);
  if (bot) { bot.pos.copy(botState.pos); bot.group.position.copy(botState.pos); bot.group.visible = true; }
}

function updateBot(dt) {
  if (!botState.active || !bot) return;
  if (!botState.alive) return;
  botState.thinkT -= dt;
  // pick target: in 1v1 hunt player; in rooftop (player is sniper) climb checkpoints
  if (botState.thinkT <= 0) {
    botState.thinkT = 0.6 + Math.random() * 0.8;
    if (Game.mode === 'rooftop') {
      // bot is the runner: head to next checkpoint then roof
      const lvl = Math.min(player.level || 0, checkpoints.length - 1); // approximate: use own progress
      const cps = checkpoints.filter(c => c.level <= (botState.wpLevel || 0) + 1);
      botState.target.copy(checkpoints[Math.min(botState.wpLevel || 0, checkpoints.length - 1)].pos);
      // advance waypoint when close & on floor
      if (botState.pos.distanceTo(botState.target) < 2.5) botState.wpLevel = (botState.wpLevel || 0) + 1;
      if ((botState.wpLevel || 0) >= checkpoints.length) {
        botState.target.set(0, 16.5, 0); // roof center
      }
    } else {
      // 1v1: drift toward player with noise
      botState.target.set(
        player.pos.x + (Math.random() - 0.5) * 20,
        0,
        player.pos.z + (Math.random() - 0.5) * 20
      );
    }
  }
  // move toward target (simple, no collision—map is forgiving; clamp to bounds)
  const dx = botState.target.x - botState.pos.x, dz = botState.target.z - botState.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.6) {
    const sp = Game.mode === 'rooftop' ? 4.6 : 4.2;
    botState.pos.x += dx / d * sp * dt;
    botState.pos.z += dz / d * sp * dt;
    botState.yaw = Math.atan2(-dx, -dz) + Math.PI;
  }
  // stair climbing: in rooftop, lift y toward next checkpoint/floor height progressively
  if (Game.mode === 'rooftop') {
    const tgt = botState.target;
    // simple: y eases toward target.y when horizontally close to stair line; else follow checkpoint y if reached
    const cp = checkpoints[Math.min(botState.wpLevel || 0, checkpoints.length - 1)];
    const desiredY = botState.target.y !== undefined ? botState.target.y : cp.pos.y;
    if (Math.abs(botState.pos.x - cp.pos.x) < 6 && Math.abs(botState.pos.z - cp.pos.z) < 6) {
      botState.pos.y += (cp.pos.y - botState.pos.y) * Math.min(1, dt * 2.2);
    } else {
      botState.pos.y += (cp.pos.y - botState.pos.y) * Math.min(1, dt * 1.2);
    }
    botState.pos.y = Math.max(0, Math.min(roofY(), botState.pos.y));
  } else {
    botState.pos.y = 0;
  }
  botState.pos.x = Math.max(-130, Math.min(130, botState.pos.x));
  botState.pos.z = Math.max(-130, Math.min(130, botState.pos.z));

  // bot shooting (1v1 only): if LOS & roughly facing & ammo
  const now = performance.now();
  if (Game.mode === '1v1' && botState.ammo > 0 && now - botState.lastShot > 2600 && Math.random() < dt * 0.5) {
    const eye = new THREE.Vector3(botState.pos.x, botState.pos.y + EYE, botState.pos.z);
    const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.0, player.pos.z);
    const dir = target.clone().sub(eye).normalize();
    raycaster.set(eye, dir); raycaster.far = 400;
    const hits = raycaster.intersectObjects(shootables.concat(player.alive ? [playerHitProxy()] : []), false);
    if (hits.length && hits[0].distance < eye.distanceTo(target) + 1.5) {
      botState.lastShot = now; botState.ammo--;
      AudioSys.shoot();
      spawnTracer(eye, hits[0].point.clone());
      if (player.alive) { killLocal('shot'); botScore('foe'); }
    }
  }

  // sync visuals
  bot.pos.copy(botState.pos);
  bot.targetPos.copy(botState.pos);
  bot.group.position.copy(botState.pos);
  bot.group.rotation.y = botState.yaw + Math.PI;
  bot.hit.position.copy(botState.pos); bot.hit.position.y += 0.95;
  bot.group.visible = botState.alive;
}
let _php = null;
function playerHitProxy() {
  if (!_php) {
    _php = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
    _php.userData.isPlayer = true;
  }
  _php.position.set(player.pos.x, player.pos.y + 0.95, player.pos.z);
  if (!_php.parent) scene.add(_php);
  return _php;
}
function roofY() { return 0.5 + 5 * 3; }

// ============================================================
// ROOFTOP LOGIC
// ============================================================
let hostTimerInt = null;

function updateRooftop(dt) {
  if (Game.role === 'runner' && player.alive) {
    // checkpoint detection
    for (const cp of checkpoints) {
      if (player.pos.y > cp.pos.y - 0.5 && player.pos.y < cp.pos.y + 1.2) {
        const dx = player.pos.x - cp.pos.x, dz = player.pos.z - cp.pos.z;
        if (dx * dx + dz * dz < 9 && cp.level > player.level) {
          player.level = cp.level;
          player.checkpoint = cp;
          updateLevelTag();
          if (Net.conn) Net.send({ t: 'cp', level: cp.level });
          if (cp.level >= 5) {
            // reached roof!
            if (Net.conn) Net.send({ t: 'end', winner: 'sniper', reason: 'Runner reached the roof' });
            endGame(false, 'The runner reached the roof — you lose');
          }
        }
      }
    }
  }
  // sniper ammo regen display only; runner has infinite? give runner no gun use — they still have sniper lol.
}

function updateLevelTag() {
  const tag = $('levelTag');
  if (Game.mode === 'rooftop' && Game.role === 'runner') {
    tag.textContent = `LEVEL ${player.level} / 5 — reach the roof!`;
    tag.classList.remove('hidden');
  }
}

// ============================================================
// GAME FLOW
// ============================================================
function startGame(mode, time, role) {
  Game.mode = mode; Game.timeLimit = time || 60;
  Game.role = role || 'p1';
  Game.roleIndex = role === 'runner' ? 1 : 0;
  Game.scoreYou = 0; Game.scoreFoe = 0;
  Game.timeLeft = Game.timeLimit;
  setScore();

  if (mode === '1v1') buildArena(); else buildRooftop();

  // sniper ammo
  player.maxAmmo = mode === '1v1' ? 1 : (Game.role === 'sniper' ? 3 : 1);
  player.ammo = player.maxAmmo;
  player.checkpoint = checkpoints[0] || null;
  player.level = 0;
  respawnLocal();

  // remote / bot
  if (Net.conn) {
    if (!remote) remote = makeRemotePlayer();
    remote.group.visible = true;
    remote.pos.set(0, -100, 0); remote.targetPos.copy(remote.pos);
  } else if (mode === 'rooftop') {
    // practice: player is sniper, bot is runner
    makeBot();
  } else {
    makeBot();
  }
  if (botState.active && Game.mode === 'rooftop') { botState.wpLevel = 0; }

  // UI
  $('menu').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touchUI').classList.toggle('hidden', !isTouch);
  $('minimap').classList.toggle('hidden', mode === 'rooftop');
  $('timer').classList.toggle('hidden', mode !== 'rooftop');
  $('levelTag').classList.toggle('hidden', !(mode === 'rooftop' && Game.role === 'runner'));
  updateAmmoHUD();
  updateLevelTag();

  Input.yaw = player.yaw; Input.pitch = 0;
  document.exitPointerLock && document.exitPointerLock();

  // host runs rooftop timer
  if (hostTimerInt) clearInterval(hostTimerInt);
  if (mode === 'rooftop' && Net.isHost) {
    hostTimerInt = setInterval(() => {
      Game.timeLeft -= 0.5;
      if (Game.timeLeft <= 0) {
        clearInterval(hostTimerInt);
        Net.send({ t: 'end', winner: 'runner', reason: 'Time ran out' });
        endGame(Game.role === 'runner', 'Time ran out');
      } else if (Math.abs(Game.timeLeft % 1) < 0.01) {
        Net.send({ t: 'time', left: Game.timeLeft });
      }
    }, 500);
  }

  Game.state = 'playing';
  AudioSys.ensure();
}

function endGame(iWon, reason) {
  if (Game.state !== 'playing') return;
  Game.state = 'end';
  document.exitPointerLock && document.exitPointerLock();
  $('hud').classList.add('hidden');
  $('endScreen').classList.remove('hidden');
  $('endTitle').textContent = iWon ? 'VICTORY' : 'DEFEAT';
  $('endTitle').className = iWon ? 'win' : 'lose';
  $('endSub').textContent = reason || `Final score — You ${Game.scoreYou} · Foe ${Game.scoreFoe}`;
  if (iWon) AudioSys.win();
  if (hostTimerInt) { clearInterval(hostTimerInt); hostTimerInt = null; }
}

function backToMenu() {
  Game.state = 'menu';
  $('endScreen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('menuMain').classList.remove('hidden');
  $('menuOnline').classList.add('hidden');
  $('netStatus').textContent = '';
}

// ============================================================
// MINIMAP (1v1 only)
// ============================================================
const mm = $('minimap'), mmc = mm.getContext('2d');
function drawMinimap() {
  if (Game.mode !== '1v1') return;
  const S = mm.width, world = 150, scale = S / world;
  mmc.clearRect(0, 0, S, S);
  mmc.fillStyle = 'rgba(10,16,24,.85)';
  mmc.fillRect(0, 0, S, S);
  // walls
  mmc.fillStyle = '#5d6a78';
  for (const c of colliders) {
    if (c.max.y - c.min.y < 1.5) continue; // skip low cover for clarity? keep tall only
    const x = (c.min.x + world / 2) * scale, z = (c.min.z + world / 2) * scale;
    mmc.fillRect(x, z, (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
  }
  // players
  const dot = (p, color) => {
    mmc.fillStyle = color;
    mmc.beginPath();
    mmc.arc((p.x + world / 2) * scale, (p.z + world / 2) * scale, 5, 0, 7);
    mmc.fill();
  };
  if (remote) dot(remote.pos, '#ff6b6b');
  if (botState.active && bot) dot(bot.pos, '#ff6b6b');
  dot(player.pos, '#7fd0ff');
  // view cone
  mmc.strokeStyle = '#7fd0ff88';
  mmc.beginPath();
  mmc.moveTo((player.pos.x + world / 2) * scale, (player.pos.z + world / 2) * scale);
  mmc.lineTo(((player.pos.x - Math.sin(player.yaw) * 6) + world / 2) * scale,
             ((player.pos.z - Math.cos(player.yaw) * 6) + world / 2) * scale);
  mmc.stroke();
}

// ============================================================
// ADS / CAMERA per-frame
// ============================================================
const _v = new THREE.Vector3();
function updateCamera(dt) {
  // ads toggle smoothing
  const target = (Input.ads || Input.adsTouch) ? 1 : 0;
  player.adsT += (target - player.adsT) * Math.min(1, dt * 10);

  const fov = 75 - player.adsT * 53; // 75 → 22
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  // head bob
  const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5 && player.grounded;
  const bobT = performance.now() / 1000;
  const bobY = moving ? Math.sin(bobT * 9) * 0.025 : 0;
  const bobX = moving ? Math.cos(bobT * 4.5) * 0.015 : 0;

  camera.position.set(
    player.pos.x + bobX * Math.cos(player.yaw),
    player.pos.y + EYE + bobY,
    player.pos.z - bobX * Math.sin(player.yaw)
  );
  camera.rotation.set(player.pitch + Input.pitch * 0, Input.yaw * 0, 0); // yaw/pitch synced below
  // NOTE: Input.yaw/pitch are the authority
  camera.rotation.set(Input.pitch, Input.yaw, 0);

  // sync player.yaw/pitch from input authority
  player.yaw = Input.yaw; player.pitch = Input.pitch;

  // viewmodel pose: hip → centered
  const hipPos = _v.set(0.28, -0.26, -0.55);
  const adsPos = _v.set(0, -0.185, -0.42);
  viewmodel.position.lerp(adsPos, player.adsT);
  viewmodel.position.lerp(hipPos, 1 - player.adsT);
  // compensate bob slightly
  viewmodel.position.y += bobY * 0.6;
  viewmodel.rotation.set(player.adsT * 0.02, player.adsT * -0.06, 0);

  // scope overlay + crosshair
  const scoped = player.adsT > 0.65;
  $('scopeOverlay').classList.toggle('hidden', !scoped);
  $('crosshair').style.display = scoped ? 'none' : '';
  $('crosshair').style.setProperty('--sp', (6 + (1 - player.adsT) * 4) + 'px');
}

// ============================================================
// MAIN LOOP
// ============================================================
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (Game.state === 'playing') {
    updatePlayer(dt);
    updateCamera(dt);
    updateRemote(dt);
    updateBot(dt);
    if (Game.mode === 'rooftop') updateRooftop(dt);

    // shooting
    if (Input.shootQueued) { Input.shootQueued = false; tryShoot(); }

    // ADS FOV already handled; timer display
    if (Game.mode === 'rooftop') {
      $('timer').textContent = fmtTime(Game.timeLeft);
      $('timer').classList.toggle('low', Game.timeLeft < 10);
    }

    // tracers/flashes decay
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i]; t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12);
      if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; f.life -= dt;
      f.m.scale.setScalar(1 + (0.1 - f.life) * 8);
      f.m.material.opacity = Math.max(0, f.life / 0.1);
      if (f.life <= 0) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); flashes.splice(i, 1); }
    }

    // net state @ 15hz
    stateTimer += dt;
    if (stateTimer > 0.066) { stateTimer = 0; sendState(); }

    // sniper ammo regen for rooftop (3 shells, one reloads every 4s after shot)
    if (Game.mode === 'rooftop' && Game.role === 'sniper' && player.ammo < player.maxAmmo) {
      if (now - player.lastShot > 4000) { player.ammo = player.maxAmmo; updateAmmoHUD(); }
    }

    if (Math.random() < dt * 8) drawMinimap();
  } else {
    // menu idle camera drift
    const t = now / 10000;
    camera.position.set(Math.sin(t) * 30, 14, Math.cos(t) * 30);
    camera.lookAt(0, 4, 0);
  }

  renderer.render(scene, camera);
}

// ============================================================
// MENU / LOBBY WIRING
// ============================================================
let hostMode = '1v1', hostTime = 60, hostReady = false;

$('btnOnline').onclick = () => { AudioSys.ui(); $('menuMain').classList.add('hidden'); $('menuOnline').classList.remove('hidden'); };
$('btnMenuBack').onclick = () => { AudioSys.ui(); $('menuOnline').classList.add('hidden'); $('menuMain').classList.remove('hidden'); $('netStatus').textContent = ''; };
$('btnBot').onclick = () => { AudioSys.ui(); startGame('1v1', 0, 'p1'); };
$('btnAgain').onclick = () => { AudioSys.ui(); backToMenu(); };
$('btnQuit').onclick = () => { AudioSys.ui(); backToMenu(); };

$('btnHost').onclick = async () => {
  AudioSys.ui();
  $('netStatus').textContent = 'creating room…';
  $('hostSetup').classList.remove('hidden');
  try {
    const code = await Net.host();
    $('roomCode').textContent = code;
    $('netStatus').textContent = 'Room created — share the code!';
    Net.on('peer', () => {
      hostReady = true;
      $('btnStart').disabled = false;
      $('netStatus').textContent = 'Player connected! Pick a mode and press START.';
      AudioSys.ui();
    });
  } catch (e) {
    $('netStatus').textContent = 'Error: ' + (e.message || e);
    $('hostSetup').classList.add('hidden');
  }
};

$('btnJoin').onclick = () => { AudioSys.ui(); $('joinRow').classList.toggle('hidden'); };
$('btnJoinGo').onclick = async () => {
  const code = $('joinCode').value;
  if (!code || code.length !== 4) { $('netStatus').textContent = 'Enter the 4-letter code'; return; }
  AudioSys.ui();
  $('netStatus').textContent = 'connecting…';
  $('loading').classList.remove('hidden');
  try {
    await Net.join(code);
    $('loading').classList.add('hidden');
    $('netStatus').textContent = 'Connected! Waiting for host to start…';
    $('hostSetup').classList.add('hidden');
    $('joinRow').classList.add('hidden');
  } catch (e) {
    $('loading').classList.add('hidden');
    $('netStatus').textContent = 'Error: ' + (e.message || e);
  }
};

// mode + time pickers
for (const [id, mode] of [['mode1v1', '1v1'], ['modeRooftop', 'rooftop']]) {
  $(id).onclick = () => {
    AudioSys.ui();
    hostMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    $(id).classList.add('selected');
    $('timeRow').style.display = mode === 'rooftop' ? 'flex' : 'none';
    $('timeLabel').style.display = mode === 'rooftop' ? '' : 'none';
  };
}
for (const [id, t] of [['time60', 60], ['time120', 120]]) {
  $(id).onclick = () => {
    AudioSys.ui();
    hostTime = t;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
    $(id).classList.add('selected');
  };
}

$('btnStart').onclick = () => {
  if (!hostReady) return;
  AudioSys.ui();
  // host is sniper in rooftop, p1 in 1v1; joiner is runner / p2
  const role = hostMode === 'rooftop' ? 'sniper' : 'p1';
  Net.send({ t: 'start', mode: hostMode, time: hostTime, role });
  startGame(hostMode, hostTime, role);
  Net.send({ t: 'time', left: hostTime });
};

// ============================================================
// BOOT
// ============================================================
buildViewmodel();
Input.init(renderer.domElement);
updateAmmoHUD();
loop();
