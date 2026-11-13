import * as THREE from 'three';
import Net from './net.js';

// ============================================================
// ZNIPERS — sniper game (Three.js + PeerJS, up to 3 players)
// ============================================================

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

// ---------------- AUDIO ----------------
const AudioSys = {
  ctx: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  shoot() {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.13);
    const len = c.sampleRate * 0.25, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const n = c.createBufferSource(); n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.22);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(f).connect(ng).connect(c.destination); n.start(t);
    const s = c.createOscillator(), sg = c.createGain();
    s.type = 'sine'; s.frequency.setValueAtTime(90, t); s.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    sg.gain.setValueAtTime(0.8, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(sg).connect(c.destination); s.start(t); s.stop(t + 0.36);
  },
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
    const len = c.sampleRate * 0.08, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = c.createBufferSource(); n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t + 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    n.connect(f).connect(g).connect(c.destination); n.start(t + 0.55);
  },
  hit() {
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
  joyVec: { x: 0, y: 0 },
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
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0021));
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

  toggleAds() { this.ads = !this.ads; AudioSys.ui(); return this.ads; },

  initTouch() {
    const joyZone = $('joyZone'), base = $('joyBase'), knob = $('joyKnob');
    let joyId = null, joyCX = 0, joyCY = 0;
    addEventListener('touchstart', e => {
      if (Game.state !== 'playing') return;
      for (const t of e.changedTouches) {
        if (t.target.closest('.touch-btn')) continue;
        const x = t.clientX, y = t.clientY;
        if (x > innerWidth * 0.42 && this.lookTouchId === null) {
          this.lookTouchId = t.identifier; this.lookLast = { x, y };
        } else if (this.lookTouchId === null && x <= innerWidth * 0.42 && joyId === null) {
          joyId = t.identifier; joyCX = x; joyCY = y;
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
          joyId = null; this.joyVec.x = this.joyVec.y = 0;
          base.style.display = 'none';
        }
      }
    };
    addEventListener('touchend', endTouch);
    addEventListener('touchcancel', endTouch);
    const bind = (id, down, up) => {
      const el = $(id);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      if (up) el.addEventListener('touchend', e => { e.preventDefault(); up(); });
    };
    bind('btnAds', () => { this.adsTouch = this.toggleAds(); });
    bind('btnShoot', () => { this.shootQueued = true; });
    bind('btnJump', () => { this.jumpQueued = true; this.jumpHeld = true; }, () => { this.jumpHeld = false; });
  }
};

// ---------------- THREE ----------------
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

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x3a4a3a, 0.75));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -140; sun.shadow.camera.right = 140;
sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140;
sun.shadow.camera.far = 320;
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const texLoader = new THREE.TextureLoader();
const playerTex = texLoader.load('assets/player.jpg');
playerTex.colorSpace = THREE.SRGBColorSpace;
const hipTex = texLoader.load('assets/sniper_hip.jpg');
hipTex.colorSpace = THREE.SRGBColorSpace;

const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: 0x9aa7b5, roughness: 0.9 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x5d6a78, roughness: 0.95 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8d8d84, roughness: 0.95 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7, metalness: 0.4 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3c4450, roughness: 0.5, metalness: 0.7 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x7a5c34, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.9 }),
};

// ---------------- WORLD ----------------
let colliders = [], shootables = [], mapGroup = null;
let spawnPoints = [], checkpoints = [], stairStrip = null, roofArea = null;

function addBox(w, h, d, x, y, z, mat = MAT.wall, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  mapGroup.add(m);
  if (opts.collide !== false) {
    colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) });
    shootables.push(m);
  }
  return m;
}
function groundPlane(size, color = 0x4c5a48) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; mapGroup.add(g);
  colliders.push({ min: new THREE.Vector3(-size / 2, -1, -size / 2), max: new THREE.Vector3(size / 2, 0, size / 2) });
}
function clearWorld() {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse(o => { o.geometry && o.geometry.dispose(); }); }
  mapGroup = new THREE.Group(); scene.add(mapGroup);
  colliders = []; shootables = []; spawnPoints = []; checkpoints = [];
  stairStrip = null; roofArea = null;
}

// ============ MAP 1: 1v1 ARENA ============
function buildArena() {
  clearWorld();
  groundPlane(140, 0x555f4e);
  const B = 26, H = 22;
  addBox(B, H, 6, 0, 0, -55, MAT.wallDark);
  addBox(B, H, 6, 0, 0, 55, MAT.wallDark);
  addBox(6, H, B, -55, 0, 0, MAT.wallDark);
  addBox(6, H, B, 55, 0, 0, MAT.wallDark);
  addBox(16, 12, 16, -22, 0, -18, MAT.wall);
  addBox(16, 12, 16, 22, 0, 18, MAT.wall);
  addBox(12, 8, 12, -24, 0, 20, MAT.concrete);
  addBox(12, 8, 12, 24, 0, -20, MAT.concrete);
  addBox(10, 16, 10, 0, 0, -30, MAT.wall);
  addBox(10, 16, 10, 0, 0, 30, MAT.wall);
  addBox(8, 1.4, 1, -10, 0, 0, MAT.crate);
  addBox(8, 1.4, 1, 10, 0, 2, MAT.crate);
  addBox(1, 1.4, 8, 0, 0, -8, MAT.crate);
  addBox(1, 1.4, 8, 2, 0, 10, MAT.crate);
  addBox(2.2, 2.2, 2.2, -6, 0, 14, MAT.crate);
  addBox(2.2, 2.2, 2.2, 7, 0, -14, MAT.crate);
  addBox(2.2, 2.2, 2.2, -14, 0, -4, MAT.crate);
  addBox(2.2, 2.2, 2.2, 15, 0, 6, MAT.crate);
  addBox(6, 1.1, 1, 18, 0, -6, MAT.wallDark);
  addBox(6, 1.1, 1, -18, 0, 6, MAT.wallDark);
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
  spawnPoints = [
    { pos: new THREE.Vector3(-30, 0, -30), yaw: Math.PI * 0.25 },
    { pos: new THREE.Vector3(30, 0, 30), yaw: -Math.PI * 0.75 },
    { pos: new THREE.Vector3(0, 0, -40), yaw: 0 },
  ];
}

// ============ MAP 2: ROOFTOP ============
// Runner building: 18x18, floor height 3, 5 levels. West 3m strip is an
// open stairwell; switchback stairs climb it. Sniper tower 95m west.
function buildRooftop() {
  clearWorld();
  groundPlane(320, 0x3d4a42);

  const BX = 0, W = 18, D = 18, FH = 3;
  const xw = BX - W / 2;          // west edge = -9
  const slabX0 = xw + 3;          // slabs start 3m in → stair strip x∈[-9,-6]
  const slabW = W - 3;            // 15
  const slabCX = slabX0 + slabW / 2;
  stairStrip = { x0: xw, x1: slabX0, z0: -D / 2, z1: D / 2 };

  // ---------- SNIPER TOWER ----------
  const TX = -95;
  addBox(26, 4, 26, TX, 0, 0, MAT.concrete);
  addBox(18, 26, 18, TX, 4, 0, MAT.wall);
  addBox(24, 1.2, 24, TX, 30, 0, MAT.roof);
  addBox(24, 1.1, 1, TX, 31.2, -11.5, MAT.wallDark);
  addBox(24, 1.1, 1, TX, 31.2, 11.5, MAT.wallDark);
  addBox(1, 1.1, 24, TX - 11.5, 31.2, 0, MAT.wallDark);
  addBox(1, 1.1, 24, TX + 11.5, 31.2, 0, MAT.wallDark);
  addBox(2.5, 1.1, 2.5, TX + 4, 31.2, -4, MAT.dark);
  addBox(3, 1.5, 3, TX - 5, 31.2, 5, MAT.metal);
  addBox(2, 1.2, 2, TX + 6, 31.2, 6, MAT.dark);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 14, 6), MAT.metal);
  ant.position.set(TX - 8, 38, -8); ant.castShadow = true; mapGroup.add(ant);
  spawnPoints.push({ pos: new THREE.Vector3(TX + 4, 31.2, -4), yaw: Math.PI / 2 }); // id0 = sniper

  // ---------- RUNNER BUILDING ----------
  // ground floor: full slab + perimeter walls
  addBox(W, 0.5, D, BX, 0, 0, MAT.concrete);
  addBox(W, FH, 1, BX, 0.5, -D / 2 + 0.5, MAT.wall);
  addBox(W, FH, 1, BX, 0.5, D / 2 - 0.5, MAT.wall);
  addBox(1, FH, D, xw + 0.5, 0.5, 0, MAT.wall);
  addBox(1, FH, D, BX + W / 2 - 0.5, 0.5, 0, MAT.wall);

  // upper floors lvl1-4: slab covers x>slabX0 only (stair strip stays open)
  const cpY = [];
  for (let lvl = 1; lvl <= 4; lvl++) {
    const fy = 0.5 + lvl * FH;
    addBox(slabW, 0.4, D, slabCX, fy - 0.4, 0, MAT.concrete);
    // cover walls on the slab area
    addBox(6, 1.1, 0.6, BX + 1, fy, -D / 2 + 3, MAT.wallDark);
    addBox(6, 1.1, 0.6, BX + 1, fy, D / 2 - 3, MAT.wallDark);
    addBox(0.6, 1.1, 6, BX + W / 2 - 3, fy, 3, MAT.wallDark);
    addBox(0.6, 1.1, 6, BX + W / 2 - 3, fy, -3, MAT.wallDark);
    addBox(2, 2.6, 2, BX + (lvl % 2 ? 4 : -1), fy, (lvl % 2 ? 4 : -4), MAT.wall);
    cpY.push(fy);
  }
  // roof slab (level 5) — also split, parapet on slab edges
  const roofY = 0.5 + 5 * FH;
  addBox(slabW, 0.4, D, slabCX, roofY - 0.4, 0, MAT.roof);
  addBox(slabW, 1.1, 0.6, slabCX, roofY, -D / 2 + 1, MAT.wallDark);
  addBox(slabW, 1.1, 0.6, slabCX, roofY, D / 2 - 1, MAT.wallDark);
  addBox(0.6, 1.1, D, BX + W / 2 - 1, roofY, 0, MAT.wallDark);
  roofArea = { x0: xw, x1: BX + W / 2, z0: -D / 2, z1: D / 2, y: roofY };

  // checkpoints: positions on the stairs/floors in the strip
  const IX = xw + 1.5; // stair center x = -7.5
  checkpoints = [
    { pos: new THREE.Vector3(IX, 3.5, 0), level: 1 },
    { pos: new THREE.Vector3(IX, 6.5, 7), level: 2 },
    { pos: new THREE.Vector3(IX, 9.5, 0), level: 3 },
    { pos: new THREE.Vector3(IX, 12.5, -7), level: 4 },
    { pos: new THREE.Vector3(IX, 15.5, 7), level: 5 },
  ];
  spawnPoints.push({ pos: new THREE.Vector3(-6, 0.5, 0), yaw: Math.PI / 2 });   // runner A
  spawnPoints.push({ pos: new THREE.Vector3(-4, 0.5, 5), yaw: Math.PI / 2 });   // runner B

  // ---------- STAIRS in the west strip (switchback) ----------
  function flight(x, z0, z1, y0, y1, width = 2.4) {
    const len = Math.abs(z1 - z0);
    const steps = Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.42));
    const rise = (y1 - y0) / steps, run = len / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const sz = z0 + (z1 - z0) * t;
      const sy = y0 + rise * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, Math.abs(run) + 0.12), MAT.metal);
      step.position.set(x, sy - 0.09, sz);
      step.castShadow = step.receiveShadow = true;
      mapGroup.add(step);
      const ex = width / 2 + 0.05, ez = Math.abs(run) / 2 + 0.15;
      colliders.push({ min: new THREE.Vector3(x - ex, sy - 0.18, sz - ez), max: new THREE.Vector3(x + ex, sy, sz + ez) });
      shootables.push(step);
    }
  }
  const zA = -D / 2 + 2, zB = D / 2 - 2; // -7 .. 7
  flight(IX, zA, zB, 0.5, 6.5);            // F0: ground → lvl2
  flight(IX, zB, zA, 6.5, 12.5);           // F1: lvl2 → lvl4
  flight(IX, zA, zB, 12.5, roofY);         // F2: lvl4 → roof

  // ---------- city filler ----------
  for (let i = 0; i < 12; i++) {
    const x = -60 + ((i * 37) % 170) - 45, z = -95 + ((i * 53) % 190);
    if (Math.abs(x - BX) < 24 && Math.abs(z) < 24) continue;
    if (Math.abs(x - TX) < 24 && Math.abs(z) < 24) continue;
    const h = 8 + (i % 4) * 6;
    addBox(14 + (i % 3) * 4, h, 14 + (i % 2) * 5, x, 0, z, i % 2 ? MAT.wallDark : MAT.wall);
  }
}

// ---------------- PHYSICS (shared by player & bots) ----------------
const EYE = 1.62, HEIGHT = 1.7, HALF = 0.35;
const GRAV = 22, JUMPV = 8.2, SPEED = 6.4, STEP_UP = 0.55;

function aabbAt(px, py, pz) {
  return { min: new THREE.Vector3(px - HALF, py, pz - HALF), max: new THREE.Vector3(px + HALF, py + HEIGHT, pz + HALF) };
}
function overlaps(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z;
}
function collidesAt(px, py, pz) {
  const b = aabbAt(px, py, pz);
  for (const c of colliders) if (overlaps(b, c)) return c;
  return null;
}
function moveAxis(axis, delta, b) {
  if (!delta) return;
  const p = b.pos;
  let nx = p.x, ny = p.y, nz = p.z;
  if (axis === 'x') nx += delta; else if (axis === 'z') nz += delta; else ny += delta;
  if (axis === 'y') {
    const oldFeet = p.y, oldHead = p.y + HEIGHT;
    const hit = collidesAt(nx, ny, nz);
    if (!hit) { p.y = ny; return; }
    if (b.vel.y <= 0 && hit.max.y <= oldFeet + 0.3 && hit.max.y >= ny) {
      p.y = hit.max.y; b.vel.y = 0; b.grounded = true;
    } else if (b.vel.y > 0 && hit.min.y >= oldHead - 0.3 && hit.min.y <= ny + HEIGHT) {
      p.y = hit.min.y - HEIGHT; b.vel.y = 0;
    } else if (b.vel.y <= 0) { p.y = hit.max.y; b.vel.y = 0; b.grounded = true; }
    else { p.y = hit.min.y - HEIGHT; b.vel.y = 0; }
    return;
  }
  const hit = collidesAt(nx, ny, nz);
  if (!hit) { if (axis === 'x') p.x = nx; else p.z = nz; return; }
  const stepY = hit.max.y;
  if (stepY - p.y <= STEP_UP && stepY - p.y > 0.01 && !collidesAt(nx, stepY, nz)) {
    p.y = stepY; b.grounded = true;
    if (axis === 'x') p.x = nx; else p.z = nz;
    return;
  }
  if (axis === 'x') p.x = delta > 0 ? hit.min.x - HALF - 0.001 : hit.max.x + HALF + 0.001;
  else p.z = delta > 0 ? hit.min.z - HALF - 0.001 : hit.max.z + HALF + 0.001;
}
// wishX/wishZ = desired velocity; jump = want jump
function stepBody(b, wishX, wishZ, jump, dt) {
  b.vel.x = wishX; b.vel.z = wishZ;
  if (jump && b.grounded) { b.vel.y = JUMPV; b.grounded = false; }
  b.vel.y -= GRAV * dt;
  if (b.vel.y < -40) b.vel.y = -40;
  b.grounded = false;
  moveAxis('x', b.vel.x * dt, b);
  moveAxis('z', b.vel.z * dt, b);
  moveAxis('y', b.vel.y * dt, b);
  b.pos.x = Math.max(-150, Math.min(150, b.pos.x));
  b.pos.z = Math.max(-150, Math.min(150, b.pos.z));
  if (b.pos.y < -5) { b.pos.y = -5; b.vel.y = 0; }
}

// ---------------- PLAYER ----------------
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, grounded: false, alive: true,
  ammo: 1, maxAmmo: 1, lastShot: 0, deadTimer: 0,
  level: 0, respawnCp: 0, adsT: 0,
};

function updatePlayer(dt) {
  if (!player.alive) {
    player.deadTimer -= dt;
    if (player.deadTimer <= 0) respawnLocal();
    // still apply gravity so body doesn't float
    player.vel.y -= GRAV * dt;
    return;
  }
  let fx = 0, fz = 0;
  if (Input.keys['KeyW']) fz -= 1;
  if (Input.keys['KeyS']) fz += 1;
  if (Input.keys['KeyA']) fx -= 1;
  if (Input.keys['KeyD']) fx += 1;
  if (isTouch) { fx += Input.joyVec.x; fz += Input.joyVec.y; }
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const wx = Math.sin(Input.yaw) * fz + Math.cos(Input.yaw) * fx;
  const wz = Math.cos(Input.yaw) * fz - Math.sin(Input.yaw) * fx;
  const jump = Input.jumpQueued || Input.jumpHeld;
  Input.jumpQueued = false;
  stepBody(player, wx * SPEED, wz * SPEED, jump, dt);
  player.yaw = Input.yaw; player.pitch = Input.pitch;
  if (player.pos.y < -2) knockLocal();
}

// ---------------- VIEWMODEL ----------------
const viewmodel = new THREE.Group();
let vmMuzzle;
function buildViewmodel() {
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.55, metalness: 0.65 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.8 });
  const g = viewmodel;
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  const sideMat = new THREE.MeshStandardMaterial({ map: hipTex, roughness: 0.6, metalness: 0.3 });
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), [dark, dark, dark, dark, sideMat, sideMat]);
  rec.position.set(0, 0, -0.1); g.add(rec);
  add(new THREE.BoxGeometry(0.07, 0.09, 0.3), wood, 0, -0.005, 0.32);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 10), dark, 0, 0.015, -0.62, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), dark, 0, 0.015, -0.95, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), dark, 0, 0.1, -0.15, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), dark, 0, 0.1, 0.0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10), dark, 0, 0.1, -0.3, Math.PI / 2);
  add(new THREE.BoxGeometry(0.02, 0.05, 0.02), dark, 0, -0.09, 0.28);
  add(new THREE.BoxGeometry(0.02, 0.07, 0.02), dark, 0, -0.08, -0.35);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), dark, 0.05, -0.02, -0.35, 0);
  vmMuzzle = new THREE.Object3D(); vmMuzzle.position.set(0, 0.015, -1.15); g.add(vmMuzzle);
  g.traverse(o => { o.frustumCulled = false; });
  camera.add(g); scene.add(camera);
}

// ---------------- EFFECTS ----------------
const tracers = [], flashes = [];
function spawnTracer(from, to, color = 0xffe9a8) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  scene.add(line); tracers.push({ line, life: 0.12 });
}
function spawnFlash(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true }));
  m.position.copy(pos); scene.add(m); flashes.push({ m, life: 0.1 });
}

// ---------------- ENTITIES (remote players + bots share this) ----------------
function makeAvatar(label) {
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
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.95; hit.userData.isPlayer = true;
  g.add(body, head, legL, legR, gun, hit);
  scene.add(g);
  return {
    id: label, group: g, hit,
    parts: { body, head, legL, legR },
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, grounded: false,
    targetPos: new THREE.Vector3(), targetYaw: 0, targetPitch: 0,
    alive: true, isBot: false,
  };
}
const remotes = new Map();   // id -> avatar (network players)
const bots = [];             // bot avatars with ai

function allTargets() {
  const t = shootables.slice();
  for (const r of remotes.values()) if (r.alive) t.push(r.hit);
  for (const b of bots) if (b.alive) t.push(b.hit);
  return t;
}
function avatarById(id) {
  if (remotes.has(id)) return remotes.get(id);
  return bots.find(b => b.id === id) || null;
}

// ---------------- GAME STATE ----------------
const Game = {
  state: 'menu', mode: '1v1', timeLimit: 60,
  role: 'ffa', myId: 0,
  scores: {}, online: false,
  timeLeft: 0, difficulty: 'medium',
};

function myLabel() { return Game.online ? (Game.myId === 0 ? 'YOU' : 'P' + Game.myId) : 'YOU'; }
function labelFor(id) {
  if (Game.online) {
    if (id === Game.myId) return 'YOU';
    if (id === 0) return Game.mode === 'rooftop' ? 'SNIPER' : 'P1';
    return 'P' + id;
  }
  return id === 'me' ? 'YOU' : 'BOT';
}

function renderScores() {
  const el = $('scoreboard');
  el.innerHTML = '';
  const ids = Object.keys(Game.scores).map(Number).filter(n => !isNaN(n) || true);
  const seen = new Set();
  const add = (id, label, cls) => {
    if (seen.has(String(id))) return; seen.add(String(id));
    const s = Game.scores[id] || 0;
    const chip = document.createElement('div');
    chip.className = 'score-chip ' + cls;
    chip.textContent = `${label} ${s}`;
    el.appendChild(chip);
  };
  // ensure self always shows
  const meId = Game.online ? Game.myId : 'me';
  add(meId, 'YOU', 'me');
  for (const id of ids) {
    if (String(id) === String(meId)) continue;
    add(id, labelFor(id), 'foe');
  }
  // bots not yet in scores
  for (const b of bots) if (!seen.has(b.id)) add(b.id, 'BOT', 'bot');
}
function addScore(id) {
  Game.scores[id] = (Game.scores[id] || 0) + 1;
  renderScores();
}
function addKillfeed(killerId, victimId) {
  const d = document.createElement('div');
  d.className = killerId === (Game.online ? Game.myId : 'me') ? 'me' : 'foe';
  d.textContent = `${labelFor(killerId)}  ✕  ${labelFor(victimId)}`;
  $('killfeed').prepend(d);
  setTimeout(() => d.remove(), 4000);
}
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------- SHOOTING ----------------
const raycaster = new THREE.Raycaster();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

function updateAmmoHUD() {
  $('ammoText').textContent = `${player.ammo} / ${player.maxAmmo}`;
  $('bulletIcon').classList.toggle('empty', player.ammo <= 0);
}

function tryShoot() {
  const now = performance.now();
  const cd = Game.mode === 'rooftop' && Game.role === 'sniper' ? 4000 : (Game.mode === '1v1' ? 1e9 : 1500);
  if (player.ammo <= 0 || now - player.lastShot < cd) return;
  player.lastShot = now; player.ammo--;
  AudioSys.shoot();
  if (player.adsT > 0.6) setTimeout(() => AudioSys.reload(), 750);

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 800;
  const hits = raycaster.intersectObjects(allTargets(), false);
  vmMuzzle.getWorldPosition(_v1);
  let end;
  if (hits.length) {
    end = hits[0].point.clone();
    const obj = hits[0].object;
    if (obj.userData.isPlayer) {
      // find which entity owns this hitbox
      let victim = null;
      for (const [id, r] of remotes) if (r.hit === obj) victim = id;
      if (!victim) { const b = bots.find(b => b.hit === obj); if (b) victim = b.id; }
      onLocalHit(victim);
    } else spawnFlash(end);
  } else end = raycaster.ray.at(300, new THREE.Vector3());
  spawnTracer(_v1, end);
  if (Game.online) Net.send({ t: 'shoot', o: [_v1.x, _v1.y, _v1.z], d: [end.x, end.y, end.z] });
  updateAmmoHUD();
}

function onLocalHit(victimId) {
  if (victimId == null) return;
  AudioSys.hit();
  $('hitmarker').classList.remove('show'); void $('hitmarker').offsetWidth; $('hitmarker').classList.add('show');
  const me = Game.online ? Game.myId : 'me';
  if (Game.online) {
    if (Net.isHost) hostApplyKill(me, victimId);
    else Net.send({ t: 'killed', victim: victimId });
  } else {
    localApplyKill(me, victimId);
  }
}

// ---- kill application (host-authoritative online, local offline) ----
function syncHostScores() { Game.scores = { ...Net.scores }; renderScores(); }
function hostApplyKill(killer, victim) {
  Net._broadcast({ t: 'killfeed', killer, victim });
  addKillfeed(killer, victim);
  if (Game.mode === '1v1') {
    Net.addScore(killer);           // broadcasts scores to clients
    syncHostScores();
    if (victim !== 0) Net.sendTo(victim, { t: 'youDied', by: killer });
  } else {
    // rooftop: hit = knockdown to checkpoint, no score
    if (victim !== 0) Net.sendTo(victim, { t: 'youDied', by: killer });
  }
}
function localApplyKill(killer, victim) {
  if (Game.mode === 'rooftop') {
    const b = bots.find(b => b.id === victim);
    if (b) botKnockdown(b);
    addKillfeed(killer, victim);
    return;
  }
  addScore(killer);
  const b = bots.find(b => b.id === victim);
  if (b) botDie(b);
  addKillfeed(killer, victim);
}

// ---------------- DEATH / RESPAWN ----------------
function flashDamage() {
  $('damageFlash').style.opacity = 1;
  setTimeout(() => $('damageFlash').style.opacity = 0, 250);
}
function knockLocal() { // I got shot / fell
  if (!player.alive) return;
  player.alive = false;
  player.deadTimer = Game.mode === 'rooftop' ? 2.5 : 3;
  AudioSys.hurt(); flashDamage();
}
function killLocal() { // 1v1 death → counts as kill for shooter already
  knockLocal();
}
function respawnLocal() {
  player.alive = true;
  let sp;
  if (Game.mode === 'rooftop') {
    if (Game.role === 'sniper') sp = spawnPoints[0];
    else {
      const cp = checkpoints[player.respawnCp] || checkpoints[0];
      sp = { pos: cp.pos.clone(), yaw: Math.PI / 2 };
    }
  } else {
    sp = spawnPoints[Game.online ? (Game.myId % spawnPoints.length) : 0] || spawnPoints[0];
  }
  player.pos.copy(sp.pos); player.pos.y += 0.1;
  player.vel.set(0, 0, 0);
  player.yaw = sp.yaw; player.pitch = 0;
  Input.yaw = sp.yaw; Input.pitch = 0;
  if (Game.mode === '1v1') { player.maxAmmo = 1; player.ammo = 1; }
  else if (Game.role === 'sniper') { player.maxAmmo = 3; player.ammo = 3; }
  else { player.maxAmmo = 1; player.ammo = 1; }
  updateAmmoHUD();
}

// ---------------- NET MESSAGE HANDLING ----------------
Net.on('msg', m => {
  if (!m || !m.t) return;
  switch (m.t) {
    case 'start': startGame(m.mode, m.time, m.role); break;
    case 'state': {
      let r = remotes.get(m.from);
      if (!r) { r = makeAvatar(m.from); remotes.set(m.from, r); }
      r.targetPos.set(m.p[0], m.p[1], m.p[2]);
      r.targetYaw = m.yaw; r.targetPitch = m.pit || 0;
      r.alive = m.alive !== false;
      r.group.visible = r.alive;
      break;
    }
    case 'shoot': {
      const f = remotes.get(m.from);
      spawnTracer(new THREE.Vector3(...m.o), new THREE.Vector3(...m.d), 0xff9a7a);
      if (f) AudioSys.shoot();
      break;
    }
    case 'killfeed': addKillfeed(m.killer, m.victim); break;
    case 'scores': Game.scores = m.scores || {}; renderScores(); break;
    case 'time': Game.timeLeft = m.left; break;
    case 'cp': {
      if (Game.mode === 'rooftop' && Game.role === 'sniper') {
        const tag = $('levelTag');
        tag.textContent = `RUNNER${m.from > 1 ? ' ' + m.from : ''} — LEVEL ${m.level}/5`;
        tag.classList.remove('hidden');
      }
      break;
    }
    case 'youDied':
      if (Game.mode === 'rooftop') knockLocal();
      else killLocal();
      break;
    case 'end': endGameNet(m); break;
    case 'roster': {
      // remove avatars for departed players
      for (const id of [...remotes.keys()]) if (!m.ids.includes(id)) { scene.remove(remotes.get(id).group); remotes.delete(id); }
      break;
    }
  }
});

Net.on('peer', ({ id }) => {
  if (Game.state !== 'playing') {
    const n = Net.ids().length;
    $('btnStart').disabled = false;
    $('btnStart').textContent = `START GAME (${n}/3)`;
    $('netStatus').textContent = `${n - 1} player(s) in room — pick mode and START`;
  }
});
Net.on('peerleft', ({ id }) => {
  if (id != null && remotes.has(id)) { scene.remove(remotes.get(id).group); remotes.delete(id); }
  if (Game.state === 'playing') {
    // if everyone left, end
    if (Net.isHost && Net.ids().length <= 1) endGame(true, 'Everyone left');
  } else if (Net.isHost) {
    const n = Net.ids().length;
    $('btnStart').disabled = n < 2;
    $('btnStart').textContent = `START GAME (${n}/3)`;
    $('netStatus').textContent = n < 2 ? 'Waiting for players…' : `${n - 1} player(s) in room`;
  }
});
function endGameNet(m) {
  if (Game.mode !== 'rooftop') return;
  const winnerId = m.winner === 'sniper' ? 0 : m.winner;
  const iWon = Game.myId === winnerId;
  const wasPlaying = Game.state === 'playing';
  endGame(iWon, m.reason || '');
  // host scores the round for the winner
  if (Net.isHost && wasPlaying && winnerId != null) {
    Net.addScore(winnerId);
    syncHostScores();
  }
}

// ---------------- REMOTE AVATAR UPDATE ----------------
function updateRemotes(dt) {
  const t = Math.min(1, dt * 12);
  for (const r of remotes.values()) {
    if (!r.alive) continue;
    r.pos.lerp(r.targetPos, t);
    let dy = r.targetYaw - r.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.yaw += dy * t;
    r.group.position.copy(r.pos);
    r.group.rotation.y = r.yaw + Math.PI;
    r.hit.position.copy(r.pos); r.hit.position.y += 0.95;
    const spd = r.pos.distanceTo(r.targetPos);
    const w = performance.now() / 130;
    r.parts.legL.rotation.x = Math.sin(w) * Math.min(0.5, spd * 0.4);
    r.parts.legR.rotation.x = -Math.sin(w) * Math.min(0.5, spd * 0.4);
  }
}

// ============================================================
// BOT AI
// ============================================================
const DIFF = {
  easy:   { speed: 3.4, react: 1.0,  cool: 3.8, spread: 0.055, lead: 0.0, strafe: 0.4, pause: 0.6 },
  medium: { speed: 4.6, react: 0.5,  cool: 2.6, spread: 0.024, lead: 0.6, strafe: 0.8, pause: 0.15 },
  expert: { speed: 5.5, react: 0.16, cool: 1.7, spread: 0.007, lead: 1.0, strafe: 1.0, pause: 0 },
};

function spawnBot(id, role) {
  const b = makeAvatar(id);
  b.isBot = true;
  b.d = DIFF[Game.difficulty] || DIFF.medium;
  b.role = role; // 'ffa' | 'runner'
  b.ai = {
    thinkT: 0, reactT: 0, lastSeen: -99, strafeDir: 1, wp: 0,
    waypoint: null, pauseT: 0, stuckT: 0, lastPos: new THREE.Vector3(),
    ammo: 1, lastShot: 0, coolJitter: 0,
  };
  bots.push(b);
  botRespawn(b);
  return b;
}
function botRespawn(b) {
  let sp;
  if (Game.mode === 'rooftop' && b.role === 'runner') {
    const idx = 1 + bots.indexOf(b);
    sp = spawnPoints[Math.min(idx, spawnPoints.length - 1)];
    b.ai.wp = 0;
  } else {
    sp = spawnPoints[1 + bots.indexOf(b)] || spawnPoints[1] || spawnPoints[0];
  }
  b.pos.copy(sp.pos); b.pos.y += 0.1;
  b.vel.set(0, 0, 0); b.yaw = sp.yaw; b.alive = true;
  b.ai.ammo = 1; b.ai.wp = b.ai.wp || 0;
  b.group.visible = true;
  b.targetPos.copy(b.pos);
}
function clearBots() { for (const b of bots) scene.remove(b.group); bots.length = 0; }

function botKnockdown(b) {
  b.alive = false; b.group.visible = false;
  setTimeout(() => { if (Game.state === 'playing') botRespawn(b); }, 2500);
}
function botDie(b) {
  b.alive = false; b.group.visible = false;
  setTimeout(() => { if (Game.state === 'playing') botRespawn(b); }, 3000);
}

const _eye = new THREE.Vector3(), _tgt = new THREE.Vector3(), _dir = new THREE.Vector3();

function botCanSee(b, targetPos) {
  _eye.set(b.pos.x, b.pos.y + EYE, b.pos.z);
  _tgt.set(targetPos.x, targetPos.y + 1.1, targetPos.z);
  _dir.copy(_tgt).sub(_eye);
  const dist = _dir.length();
  if (dist > 400) return -1;
  _dir.normalize();
  raycaster.set(_eye, _dir); raycaster.far = dist + 2;
  const hits = raycaster.intersectObjects(shootables, false);
  if (hits.length && hits[0].distance < dist - 0.5) return -1; // wall blocked
  return dist;
}

function updateBot(b, dt, now) {
  if (!b.alive) return;
  const d = b.d, ai = b.ai;
  ai.thinkT -= dt;

  if (Game.mode === 'rooftop' && b.role === 'runner') {
    updateBotRunner(b, dt, now);
  } else {
    updateBotFfa(b, dt, now);
  }

  // integrate physics — ai.mx/mz is a ~unit world-space wish dir
  const ml = Math.hypot(ai.mx, ai.mz);
  const spd = ml > 0.01 ? d.speed : 0;
  stepBody(b, ml > 0.01 ? ai.mx / ml * spd : 0, ml > 0.01 ? ai.mz / ml * spd : 0, ai.jump, dt);
  ai.jump = false;

  // visuals
  b.group.position.copy(b.pos);
  b.group.rotation.y = b.yaw + Math.PI;
  b.hit.position.copy(b.pos); b.hit.position.y += 0.95;
  b.targetPos.copy(b.pos);
  const w = now / 130;
  const moving = Math.hypot(b.vel.x, b.vel.z) > 0.5;
  b.parts.legL.rotation.x = moving ? Math.sin(w) * 0.5 : 0;
  b.parts.legR.rotation.x = moving ? -Math.sin(w) * 0.5 : 0;
}

// ---- FFA bot: hunt the player ----
function updateBotFfa(b, dt, now) {
  const ai = b.ai, d = b.d;
  ai.mx = 0; ai.mz = 0; ai.jump = false;
  const dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z;
  const dist = Math.hypot(dx, dz);

  // perception
  const seeDist = player.alive ? botCanSee(b, player.pos) : -1;
  const sees = seeDist > 0;
  if (sees) { ai.lastSeen = now; ai.reactT = d.react * 1000; }

  // movement: strafe orbit + approach/retreat to preferred range
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.5 + Math.random() * 0.7;
    ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.3) ai.strafeDir *= -1;
  }
  const prefRange = 35 + (b.id.charCodeAt(1) || 0) % 3 * 15;
  let mx = 0, mz = 0;
  if (dist > 3) {
    // strafe perpendicular
    const px = -dz / dist * ai.strafeDir, pz = dx / dist * ai.strafeDir;
    const strafeAmt = d.strafe;
    let ax = 0, az = 0;
    if (dist > prefRange + 15) { ax += dx / dist; az += dz / dist; }
    else if (dist < prefRange - 15) { ax -= dx / dist; az -= dz / dist; }
    mx = px * strafeAmt + ax * (1 - strafeAmt * 0.5);
    mz = pz * strafeAmt + az * (1 - strafeAmt * 0.5);
    // face the player
    b.yaw = Math.atan2(-dx, -dz) + Math.PI;
  } else {
    b.yaw += dt * 2;
  }
  ai.mx = mx; ai.mz = mz;

  // unstick: if barely moved, jump
  if (b.grounded && Math.hypot(b.vel.x, b.vel.z) < 0.4 && dist > 2) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.8) { ai.jump = true; ai.stuckT = 0; }
  } else ai.stuckT = 0;

  // shooting
  const aimed = sees && now - ai.lastSeen < ai.reactT + 400;
  if (aimed && ai.ammo > 0 && now - ai.lastShot > d.cool * 1000 + ai.coolJitter) {
    // lead the target if expert
    let tx = player.pos.x, tz = player.pos.z;
    if (d.lead > 0) {
      tx += player.vel.x * dist / 300 * d.lead;
      tz += player.vel.z * dist / 300 * d.lead;
    }
    _eye.set(b.pos.x, b.pos.y + EYE, b.pos.z);
    _tgt.set(tx, player.pos.y + 1.0 + (Math.random() - 0.5) * d.spread * 2 * dist * 0.3, tz);
    _dir.copy(_tgt).sub(_eye).normalize();
    // add spread
    _dir.x += (Math.random() - 0.5) * d.spread * 2;
    _dir.y += (Math.random() - 0.5) * d.spread * 2;
    _dir.z += (Math.random() - 0.5) * d.spread * 2;
    _dir.normalize();
    raycaster.set(_eye, _dir); raycaster.far = 500;
    const targets = shootables.slice();
    if (player.alive) targets.push(playerProxy());
    const hits = raycaster.intersectObjects(targets, false);
    ai.lastShot = now; ai.coolJitter = Math.random() * 800;
    ai.ammo--;
    const end = hits.length ? hits[0].point.clone() : _eye.clone().addScaledVector(_dir, 300);
    spawnTracer(_eye.clone(), end, 0xff9a7a);
    AudioSys.shoot();
    if (Game.online) Net.send({ t: 'shoot', o: [_eye.x, _eye.y, _eye.z], d: [end.x, end.y, end.z], from: b.id });
    if (hits.length && hits[0].object.userData.isPlayer && player.alive) {
      // bot hit the player
      if (Game.online) { /* n/a offline */ }
      killLocal();
      addScore(b.id);
      addKillfeed(b.id, Game.online ? Game.myId : 'me');
      botRespawn(b);
    }
  }
}
let _pp = null;
function playerProxy() {
  if (!_pp) { _pp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.9), new THREE.MeshBasicMaterial({ visible: false })); _pp.userData.isPlayer = true; }
  _pp.position.set(player.pos.x, player.pos.y + 0.95, player.pos.z);
  if (!_pp.parent) scene.add(_pp);
  return _pp;
}

// ---- Rooftop runner bot: climb the stairwell waypoints ----
const BOT_WAYPOINTS = [
  { x: -7.5, z: -7,  y: 0.5 },   // F0 start
  { x: -7.5, z: 0,   y: 3.5 },   // cp1 mid F0
  { x: -7.5, z: 7,   y: 6.5 },   // cp2 top F0
  { x: -7.5, z: 0,   y: 9.5 },   // cp3 mid F1
  { x: -7.5, z: -7,  y: 12.5 },  // cp4 top F1
  { x: -7.5, z: 7,   y: 15.5 },  // cp5 top F2
  { x: 0,    z: 0,   y: 15.5 },  // roof center → win
];
function updateBotRunner(b, dt, now) {
  const ai = b.ai, d = b.d;
  ai.mx = 0; ai.mz = 0; ai.jump = false;
  // advance waypoint when close (x/z) and near its height
  const wp = BOT_WAYPOINTS[Math.min(ai.wp, BOT_WAYPOINTS.length - 1)];
  const dx = wp.x - b.pos.x, dz = wp.z - b.pos.z;
  const dy = wp.y - b.pos.y;
  const hd = Math.hypot(dx, dz);
  if (hd < 1.4 && Math.abs(dy) < 1.2) {
    ai.wp = Math.min(ai.wp + 1, BOT_WAYPOINTS.length - 1);
    // reached roof center → that runner wins the round (sniper loses)
    if (ai.wp >= BOT_WAYPOINTS.length - 1 && Math.abs(b.pos.y - 15.5) < 0.8) {
      if (Game.online) Net.send({ t: 'reached' });
      else endGame(false, 'A runner reached the roof — you lose');
    }
  }
  // difficulty pause (hesitation)
  if (ai.pauseT > 0) { ai.pauseT -= dt; ai.mx = 0; ai.mz = 0; return; }
  if (Math.random() < dt * d.pause * 0.4) ai.pauseT = 0.4 + Math.random() * 0.8;

  const w = BOT_WAYPOINTS[Math.min(ai.wp, BOT_WAYPOINTS.length - 1)];
  const wx = w.x - b.pos.x, wz = w.z - b.pos.z;
  const wl = Math.hypot(wx, wz) || 1;
  // small lateral offset per bot so they don't stack
  const off = (bots.indexOf(b) - 0.5) * 0.5;
  ai.mx = wx / wl + (-wz / wl) * off;
  ai.mz = wz / wl + (wx / wl) * off;
  b.yaw = Math.atan2(-wx, -wz) + Math.PI;

  // unstick jump
  if (b.grounded && Math.hypot(b.vel.x, b.vel.z) < 0.4) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.7) { ai.jump = true; ai.stuckT = 0; }
  } else ai.stuckT = 0;

  // runners can take pot shots at the sniper
  const sees = player.alive && Game.role === 'sniper' ? botCanSee(b, player.pos) : -1;
  if (sees > 0 && ai.ammo > 0 && now - ai.lastShot > (3000 - d.speed * 200) && Math.random() < dt * 0.3) {
    ai.lastShot = now; ai.ammo--;
    _eye.set(b.pos.x, b.pos.y + EYE, b.pos.z);
    _tgt.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
    _dir.copy(_tgt).sub(_eye).normalize();
    _dir.x += (Math.random() - 0.5) * 0.09; _dir.y += (Math.random() - 0.5) * 0.05; _dir.z += (Math.random() - 0.5) * 0.09;
    _dir.normalize();
    raycaster.set(_eye, _dir); raycaster.far = 500;
    const targets = shootables.slice();
    if (player.alive) targets.push(playerProxy());
    const hits = raycaster.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point.clone() : _eye.clone().addScaledVector(_dir, 300);
    spawnTracer(_eye.clone(), end, 0xff9a7a);
    AudioSys.shoot();
    if (hits.length && hits[0].object.userData.isPlayer && player.alive) {
      knockLocal();
      setTimeout(() => { if (Game.state === 'playing') botRespawn(b); }, 100);
    }
  }
}

// ---------------- ROOFTOP PLAYER logic ----------------
function updateRooftopPlayer() {
  if (Game.role !== 'runner' || !player.alive) return;
  // level from height
  const lvl = Math.max(0, Math.min(5, Math.floor((player.pos.y - 0.5) / 3)));
  if (lvl > player.level) {
    player.level = lvl; player.respawnCp = lvl - 1;
    $('levelTag').textContent = `LEVEL ${lvl} / 5 — reach the roof!`;
    if (lvl < 5) AudioSys.ui();
    if (Game.online) Net.send({ t: 'cp', level: lvl });
  }
  // reached roof?
  if (player.pos.y > 15.3 && player.pos.x > -9 && player.pos.x < 9 && Math.abs(player.pos.z) < 9) {
    if (Game.online) Net.send({ t: 'reached' });
    endGame(true, 'You reached the roof — you win');
    player.alive = false;
  }
}

// ============================================================
// GAME FLOW
// ============================================================
let hostTimerInt = null;

function startGame(mode, time, role) {
  if (Game.state === 'playing') return;
  Game.mode = mode; Game.timeLimit = time || 60;
  Game.role = role || 'ffa';
  Game.myId = Game.online ? Net.myId : 'me';
  Game.timeLeft = Game.timeLimit;
  Game.scores = {};

  if (mode === '1v1') buildArena(); else buildRooftop();
  clearBots();

  // spawn entities
  if (Game.online) {
    // ensure remote avatars for known ids
    for (const id of Net.ids()) if (id !== Game.myId && id !== 0) {
      if (!remotes.has(id)) remotes.set(id, makeAvatar(id));
    }
    if (Net.isHost) for (const id of Net.ids()) if (id !== 0 && !remotes.has(id)) remotes.set(id, makeAvatar(id));
  } else {
    // offline: player is always the sniper in rooftop, else ffa
    if (mode === 'rooftop') {
      Game.role = 'sniper';
      spawnBot('b1', 'runner'); spawnBot('b2', 'runner');
    } else {
      Game.role = 'ffa';
      spawnBot('b1', 'ffa');
    }
  }

  player.maxAmmo = mode === '1v1' ? 1 : (Game.role === 'sniper' ? 3 : 1);
  player.ammo = player.maxAmmo;
  player.level = 0; player.respawnCp = 0;
  respawnLocal();

  $('menu').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touchUI').classList.toggle('hidden', !isTouch);
  $('minimap').classList.toggle('hidden', mode === 'rooftop');
  $('timer').classList.toggle('hidden', mode !== 'rooftop');
  $('levelTag').classList.toggle('hidden', !(mode === 'rooftop' && Game.role === 'runner'));
  if (mode === 'rooftop' && Game.role === 'runner') $('levelTag').textContent = 'LEVEL 0 / 5 — reach the roof!';
  updateAmmoHUD();
  renderScores();
  document.exitPointerLock && document.exitPointerLock();

  // prefill scoreboard
  if (Game.online) {
    if (Net.isHost) {
      Net.scores = {};
      for (const id of Net.ids()) Net.scores[id] = 0;
      Net.broadcastScores();
      Game.scores = { ...Net.scores };
    } else {
      Game.scores = {};
      for (const id of Net.ids()) Game.scores[id] = 0;
      Game.scores[Game.myId] = Game.scores[Game.myId] || 0;
    }
  } else {
    Game.scores = { me: 0 };
    for (const b of bots) Game.scores[b.id] = 0;
  }

  if (hostTimerInt) clearInterval(hostTimerInt);
  hostTimerInt = null;
  if (mode === 'rooftop') {
    const isAuthority = Game.online ? Net.isHost : true;
    if (isAuthority) {
      hostTimerInt = setInterval(() => {
        Game.timeLeft -= 0.5;
        if (Game.online) Net.send({ t: 'time', left: Game.timeLeft });
        if (Game.timeLeft <= 0) {
          clearInterval(hostTimerInt); hostTimerInt = null;
          const reason = 'Time ran out — the sniper wins';
          if (Game.online) {
            Net.send({ t: 'end', winner: 0, reason });
            Net.addScore(0);
            syncHostScores();
          } else {
            addScore('me');
          }
          endGame(Game.role === 'sniper', reason);
        }
      }, 500);
    }
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
  $('endSub').textContent = reason || '';
  if (iWon) AudioSys.win(); else AudioSys.hurt();
  if (hostTimerInt) { clearInterval(hostTimerInt); hostTimerInt = null; }
  // offline rooftop round score
  if (!Game.online && Game.mode === 'rooftop') {
    if (iWon) addScore('me'); else for (const b of bots) addScore(b.id);
  }
}

function backToMenu() {
  Game.state = 'menu';
  $('endScreen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('menuMain').classList.remove('hidden');
  $('menuOnline').classList.add('hidden');
  $('menuOffline').classList.add('hidden');
  $('netStatus').textContent = '';
  // cleanup world entities but keep menu backdrop
  for (const r of remotes.values()) scene.remove(r.group);
  remotes.clear(); clearBots();
  if (Game.online) { /* keep connection for replay */ }
}

// ---------------- MINIMAP ----------------
const mm = $('minimap'), mmc = mm.getContext('2d');
let mmT = 0;
function drawMinimap(dt) {
  mmT += dt;
  if (mmT < 0.12) return;
  mmT = 0;
  const S = mm.width, world = 150, scale = S / world;
  mmc.clearRect(0, 0, S, S);
  mmc.fillStyle = 'rgba(10,16,24,.85)';
  mmc.fillRect(0, 0, S, S);
  mmc.fillStyle = '#5d6a78';
  for (const c of colliders) {
    if (c.max.y - c.min.y < 4) continue;
    mmc.fillRect((c.min.x + world / 2) * scale, (c.min.z + world / 2) * scale,
      (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
  }
  const dot = (p, color, r = 5) => {
    mmc.fillStyle = color;
    mmc.beginPath();
    mmc.arc((p.x + world / 2) * scale, (p.z + world / 2) * scale, r, 0, 7);
    mmc.fill();
  };
  for (const r of remotes.values()) if (r.alive) dot(r.pos, '#ff6b6b');
  for (const b of bots) if (b.alive) dot(b.pos, '#ffb43c');
  dot(player.pos, '#7fd0ff');
  mmc.strokeStyle = '#7fd0ff88';
  mmc.beginPath();
  mmc.moveTo((player.pos.x + world / 2) * scale, (player.pos.z + world / 2) * scale);
  mmc.lineTo(((player.pos.x - Math.sin(player.yaw) * 6) + world / 2) * scale,
             ((player.pos.z - Math.cos(player.yaw) * 6) + world / 2) * scale);
  mmc.stroke();
}

// ---------------- CAMERA ----------------
function updateCamera(dt) {
  const target = (Input.ads || Input.adsTouch) ? 1 : 0;
  player.adsT += (target - player.adsT) * Math.min(1, dt * 10);
  const fov = 75 - player.adsT * 53;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5 && player.grounded;
  const bobT = performance.now() / 1000;
  const bobY = moving ? Math.sin(bobT * 9) * 0.025 : 0;
  const bobX = moving ? Math.cos(bobT * 4.5) * 0.015 : 0;
  camera.position.set(
    player.pos.x + bobX * Math.cos(player.yaw),
    player.pos.y + EYE + bobY,
    player.pos.z - bobX * Math.sin(player.yaw));
  camera.rotation.set(Input.pitch, Input.yaw, 0);
  const hipPos = _v1.set(0.28, -0.26, -0.55);
  const adsPos = _v2.set(0, -0.185, -0.42);
  viewmodel.position.lerp(adsPos, player.adsT);
  viewmodel.position.lerp(hipPos, 1 - player.adsT);
  viewmodel.position.y += bobY * 0.6;
  viewmodel.rotation.set(player.adsT * 0.02, player.adsT * -0.06, 0);
  const scoped = player.adsT > 0.65;
  $('scopeOverlay').classList.toggle('hidden', !scoped);
  $('crosshair').style.display = scoped ? 'none' : '';
  $('crosshair').style.setProperty('--sp', (6 + (1 - player.adsT) * 4) + 'px');
}

// ---------------- STATE SEND ----------------
let stateTimer = 0;
function sendState() {
  Net.send({
    t: 'state', from: Game.myId,
    p: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw, pit: player.pitch, alive: player.alive,
  });
}

// ---------------- MAIN LOOP ----------------
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (Game.state === 'playing') {
    updatePlayer(dt);
    updateCamera(dt);
    updateRemotes(dt);
    for (const b of bots) updateBot(b, dt, now);
    if (Game.mode === 'rooftop') updateRooftopPlayer();
    if (Input.shootQueued) { Input.shootQueued = false; tryShoot(); }

    if (Game.mode === 'rooftop') {
      $('timer').textContent = fmtTime(Game.timeLeft);
      $('timer').classList.toggle('low', Game.timeLeft < 10);
    }
    // rooftop ammo regen: sniper 3 shells / 4s, runners 1 shell / 6s
    if (Game.mode === 'rooftop' && player.ammo < player.maxAmmo) {
      const rt = Game.role === 'sniper' ? 4000 : 6000;
      if (now - player.lastShot > rt) { player.ammo = player.maxAmmo; updateAmmoHUD(); }
    }
    // 1v1: nothing else

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

    stateTimer += dt;
    if (Game.online && stateTimer > 0.066) { stateTimer = 0; sendState(); }
    if (Game.mode === '1v1') drawMinimap(dt);
  } else {
    const t = now / 10000;
    camera.position.set(Math.sin(t) * 40, 16, Math.cos(t) * 40);
    camera.lookAt(0, 4, 0);
  }
  renderer.render(scene, camera);
}

// ---------------- MENU WIRING ----------------
let hostMode = '1v1', hostTime = 60;
let offMode = '1v1', offTime = 60, offDiff = 'medium';

$('btnOnline').onclick = () => { AudioSys.ui(); $('menuMain').classList.add('hidden'); $('menuOnline').classList.remove('hidden'); };
$('btnOffline').onclick = () => { AudioSys.ui(); $('menuMain').classList.add('hidden'); $('menuOffline').classList.remove('hidden'); };
$('btnMenuBack').onclick = () => { AudioSys.ui(); $('menuOnline').classList.add('hidden'); $('menuMain').classList.remove('hidden'); $('netStatus').textContent = ''; };
$('btnOfflineBack').onclick = () => { AudioSys.ui(); $('menuOffline').classList.add('hidden'); $('menuMain').classList.remove('hidden'); };
$('btnAgain').onclick = () => { AudioSys.ui(); backToMenu(); };
$('btnQuit').onclick = () => { AudioSys.ui(); backToMenu(); };

$('btnHost').onclick = async () => {
  AudioSys.ui();
  $('netStatus').textContent = 'creating room…';
  $('hostSetup').classList.remove('hidden');
  try {
    const code = await Net.host();
    Game.online = true;
    $('roomCode').textContent = code;
    $('netStatus').textContent = 'Room created — share the code!';
    $('btnStart').textContent = 'START GAME (1/3)';
    $('btnStart').disabled = true;
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
    Game.online = true;
    $('loading').classList.add('hidden');
    $('netStatus').textContent = 'Connected! Waiting for host to start…';
    $('hostSetup').classList.add('hidden');
    $('joinRow').classList.add('hidden');
  } catch (e) {
    $('loading').classList.add('hidden');
    Game.online = false;
    $('netStatus').textContent = 'Error: ' + (e.message || e);
  }
};

function selectMode(id, mode, scope) {
  $(id).onclick = () => {
    AudioSys.ui();
    if (scope === 'host') hostMode = mode; else offMode = mode;
    document.querySelectorAll(scope === 'host' ? '#menuOnline .mode-btn' : '#menuOffline .mode-btn')
      .forEach(b => b.classList.remove('selected'));
    $(id).classList.add('selected');
    const timeRow = scope === 'host' ? $('timeRow') : $('offTimeRow');
    const timeLbl = scope === 'host' ? $('timeLabel') : $('offTimeLabel');
    timeRow.style.display = mode === 'rooftop' ? 'flex' : 'none';
    timeLbl.style.display = mode === 'rooftop' ? '' : 'none';
  };
}
selectMode('mode1v1', '1v1', 'host');
selectMode('modeRooftop', 'rooftop', 'host');
selectMode('offMode1v1', '1v1', 'off');
selectMode('offModeRooftop', 'rooftop', 'off');

function selectTime(id, t, scope) {
  $(id).onclick = () => {
    AudioSys.ui();
    if (scope === 'host') hostTime = t; else offTime = t;
    document.querySelectorAll(scope === 'host' ? '#menuOnline .time-btn' : '#menuOffline .time-btn')
      .forEach(b => b.classList.remove('selected'));
    $(id).classList.add('selected');
  };
}
selectTime('time60', 60, 'host'); selectTime('time120', 120, 'host');
selectTime('offTime60', 60, 'off'); selectTime('offTime120', 120, 'off');

for (const [id, df] of [['diffEasy', 'easy'], ['diffMid', 'medium'], ['diffExpert', 'expert']]) {
  $(id).onclick = () => {
    AudioSys.ui(); offDiff = df;
    document.querySelectorAll('#menuOffline .diff-btn').forEach(b => b.classList.remove('selected'));
    $(id).classList.add('selected');
  };
}

$('btnOfflineStart').onclick = () => {
  AudioSys.ui();
  Game.online = false; Game.difficulty = offDiff;
  startGame(offMode, offMode === 'rooftop' ? offTime : 0, offMode === 'rooftop' ? 'sniper' : 'ffa');
};

$('btnStart').onclick = () => {
  if (Net.ids().length < 2) return;
  AudioSys.ui();
  const role = hostMode === 'rooftop' ? 'sniper' : 'ffa';
  Net.send({ t: 'start', mode: hostMode, time: hostTime, role: hostMode === 'rooftop' ? 'runner' : 'ffa' });
  startGame(hostMode, hostTime, role);
};

// client-originated kills: host scores them (host's own kills go through hostApplyKill)
Net.on('kill', ({ killer }) => {
  if (!Net.isHost || Game.mode !== '1v1' || Game.state !== 'playing') return;
  Net.addScore(killer);
  syncHostScores();
});
// host can be the victim too
Net.on('youDied', () => { if (Game.mode === 'rooftop') knockLocal(); else killLocal(); });

// boot
buildArena(); // menu backdrop
buildViewmodel();
Input.init(renderer.domElement);
updateAmmoHUD();
loop();
