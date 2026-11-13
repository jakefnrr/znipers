/* global THREE, Net */

window.__err = [];
function pushErr(s) {
  window.__err.push(s);
  const el = document.getElementById('errbox');
  if (el) { el.textContent = window.__err.slice(-8).join(' | '); el.classList.remove('hidden'); }
}
addEventListener('error', e => pushErr(String(e.message || e.error)));
addEventListener('unhandledrejection', e => pushErr('rej:' + String(e.reason && e.reason.message || e.reason)));

// ---------------- SETTINGS (persisted in localStorage) ----------------
const CFG_KEY = 'znipers_cfg';
const CFG = (() => {
  const def = {
    sens: 1,
    binds: { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', ads: 'MouseR', shoot: 'MouseL' },
    btns: {},
  };
  try {
    const s = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    return {
      sens: typeof s.sens === 'number' ? s.sens : 1,
      binds: { ...def.binds, ...(s.binds || {}) },
      btns: s.btns || {},
    };
  } catch (e) { return def; }
})();
let layoutEditing = false;
function saveCFG() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {} }
function bindName(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) return { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB' }[code] || code;
  return code.replace('Key', '').replace('Digit', '').replace('Numpad', 'Num ');
}

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
      const b = CFG.binds;
      if (e.code === b.jump) { this.jumpQueued = true; e.preventDefault(); }
      if (!e.repeat && e.code === b.shoot && !b.shoot.startsWith('Mouse')) this.shootQueued = true;
      if (!e.repeat && e.code === b.ads && !b.ads.startsWith('Mouse')) this.toggleAds();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      const s = 0.0021 * CFG.sens;
      this.yaw -= e.movementX * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * s));
    });
    canvas.addEventListener('click', () => {
      if (Game.state === 'playing' && !isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock();
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousedown', e => {
      if (Game.state !== 'playing' || isTouch) return;
      const mb = 'Mouse' + e.button;
      if (mb === CFG.binds.ads) this.toggleAds();
      if (mb === CFG.binds.shoot) this.shootQueued = true;
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
        if (x > innerWidth * 0.48 && this.lookTouchId === null) {
          this.lookTouchId = t.identifier; this.lookLast = { x, y };
        } else if (this.lookTouchId === null && x <= innerWidth * 0.48 && joyId === null) {
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
          this.yaw -= dx * 0.008 * CFG.sens;
          this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.008 * CFG.sens));
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
      el.addEventListener('touchstart', e => { if (layoutEditing) return; e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      if (up) el.addEventListener('touchend', e => { if (layoutEditing) return; e.preventDefault(); up(); });
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
texLoader.crossOrigin = undefined; // allow file:// loading (no CORS attr)
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
let spawnPoints = [], checkpoints = [], ramps = [], stairStrip = null, roofArea = null;

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
  colliders = []; shootables = []; spawnPoints = []; checkpoints = []; ramps = [];
  stairStrip = null; roofArea = null;
}

// ============ MAP 1: 1v1 ARENA ============
function buildArena() {
  clearWorld();
  groundPlane(140, 0x555f4e);
  // big wall around the whole map — can't leave
  const WL = 128, WH = 26, WT = 4;
  addBox(WL, WH, WT, 0, 0, -66, MAT.wallDark);
  addBox(WL, WH, WT, 0, 0, 66, MAT.wallDark);
  addBox(WT, WH, WL, -66, 0, 0, MAT.wallDark);
  addBox(WT, WH, WL, 66, 0, 0, MAT.wallDark);
  // just 2 buildings for cover — clean, fast fights
  addBox(16, 12, 16, -22, 0, -18, MAT.wall);
  addBox(16, 12, 16, 22, 0, 18, MAT.wall);
  spawnPoints = [
    { pos: new THREE.Vector3(-30, 0, -30), yaw: Math.PI * 0.25 },
    { pos: new THREE.Vector3(30, 0, 30), yaw: -Math.PI * 0.75 },
    { pos: new THREE.Vector3(0, 0, -40), yaw: 0 },
  ];
}

// ============ MAP 2: ROOFTOP ============
// VERY long runner building (~5x): flat deck x-30..20, runners sprint +x,
// switchback stairs at x8..20 climb 5 flights to the goal tower x20..56.
// Sniper sits on a tiny tower platform and cannot move.
function buildRooftop() {
  clearWorld();
  groundPlane(340, 0x3d4a42);

  // ---------- SNIPER TOWER: tiny platform ----------
  const TX = -48;
  addBox(5, 1.5, 5, TX, 0, 0, MAT.concrete);
  addBox(0.8, 28, 0.8, TX, 1.5, 0, MAT.wallDark);
  addBox(3.4, 0.5, 3.4, TX, 29.5, 0, MAT.metal);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 10, 6), MAT.metal);
  ant.position.set(TX + 1.2, 35, 1.2); ant.castShadow = true; mapGroup.add(ant);
  spawnPoints.push({ pos: new THREE.Vector3(TX, 30.1, 0), yaw: -Math.PI / 2 }); // id0 = sniper, faces +x

  // ---------- LONG RUNNER BUILDING ----------
  // flat deck: x -30..20, z -9..9, walking surface y=1
  addBox(50, 1, 18, -5, 0, 0, MAT.concrete);
  // low parapets — 1.6 high so nobody jumps off the edge
  addBox(50, 1.6, 0.5, -5, 1, -8.75, MAT.wallDark);
  addBox(50, 1.6, 0.5, -5, 1, 8.75, MAT.wallDark);
  addBox(0.5, 1.6, 18, -30, 1, 0, MAT.wallDark);
  // goal tower at the far right: x20..56, top y=15.5
  addBox(36, 1, 18, 38, 14.5, 0, MAT.roof);
  addBox(36, 0.9, 0.5, 38, 15.5, -8.75, MAT.wallDark);
  addBox(36, 0.9, 0.5, 38, 15.5, 8.75, MAT.wallDark);
  addBox(0.5, 0.9, 18, 56, 15.5, 0, MAT.wallDark);
  // support pillars (visual only)
  for (const px of [24, 32, 40, 48, 54]) {
    addBox(1.4, 14.5, 1.4, px, 0, -6.5, MAT.concrete, { collide: false });
    addBox(1.4, 14.5, 1.4, px, 0, 6.5, MAT.concrete, { collide: false });
  }
  roofArea = { x0: 20, x1: 56, z0: -9, z1: 9, y: 15.5 };

  // ---------- small body-sized cover on the deck (left/center/right) ----------
  const coverSpots = [
    [-22, -5.5], [-18, 5.5], [-14, -5.5], [-10, 5.5], [-6, -5.5], [-2, 5.5],
    [-20, 0], [-12, 0], [-4, 0], [-16, 2.5], [-8, -2.5], [-24, 2],
  ];
  coverSpots.forEach(([cx, cz], i) => {
    addBox(2.4 + (i % 3) * 0.5, 1.1 + (i % 2) * 0.3, 1.3, cx, 1, cz, i % 2 ? MAT.crate : MAT.wallDark);
  });

  // runner spawns at the far left end
  spawnPoints.push({ pos: new THREE.Vector3(-26, 1.1, -4), yaw: -Math.PI / 2 });  // runner A
  spawnPoints.push({ pos: new THREE.Vector3(-26, 1.1, 4), yaw: -Math.PI / 2 });   // runner B

  // checkpoints at each flight top
  checkpoints = [
    { pos: new THREE.Vector3(20, 4.5, -4), level: 1 },
    { pos: new THREE.Vector3(8, 7.7, 4), level: 2 },
    { pos: new THREE.Vector3(20, 10.9, -4), level: 3 },
    { pos: new THREE.Vector3(8, 14.1, 4), level: 4 },
    { pos: new THREE.Vector3(20, 15.8, -4), level: 5 },
  ];

  // ---------- STAIRS: 5 switchback flights in shaft x8..20 ----------
  // lanes: A = z[-8,0], B = z[0,8]; flights run along +x/-x alternating
  const rampMeshMat = new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.6, metalness: 0.5 });
  function ramp(axis, u0, u1, c0, c1, y0, y1) {
    // physics record: axis 'x' → coord is x, lateral range is z
    ramps.push(axis === 'x'
      ? { axis, u0, u1, cA: c0, yA: y0, cB: c1, yB: y1 }
      : { axis, u0, u1, cA: c0, yA: y0, cB: c1, yB: y1 });
    const cLo = Math.min(c0, c1), cHi = Math.max(c0, c1);
    const yLo = c0 < c1 ? y0 : y1, yHi = c0 < c1 ? y1 : y0;
    const len = Math.hypot(cHi - cLo, yHi - yLo);
    const slope = Math.atan2(yHi - yLo, cHi - cLo);
    const midC = (cLo + cHi) / 2, midY = (yLo + yHi) / 2, midU = (u0 + u1) / 2, w = u1 - u0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? len + 0.4 : w, 0.3, axis === 'x' ? w : len + 0.4), rampMeshMat);
    m.position.set(axis === 'x' ? midC : midU, midY - 0.15, axis === 'x' ? midU : midC);
    if (axis === 'x') m.rotation.z = slope; else m.rotation.x = -slope;
    m.castShadow = m.receiveShadow = true;
    mapGroup.add(m);
    shootables.push(m);
    // side rails (visual only)
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? len : 0.15, 0.9, axis === 'x' ? 0.15 : len), MAT.wallDark);
      rail.position.set(
        axis === 'x' ? midC : u0 + (s > 0 ? w : 0),
        midY + 0.3,
        axis === 'x' ? u0 + (s > 0 ? w : 0) : midC);
      if (axis === 'x') rail.rotation.z = slope; else rail.rotation.x = -slope;
      rail.castShadow = true; mapGroup.add(rail);
    }
    // underside blockers for the lowest flight so deck runners can't clip their heads
    if (y0 <= 1.01 && y1 <= 4.3) {
      const n = Math.ceil(Math.abs(c1 - c0));
      for (let i = 0; i <= n; i++) {
        const t = i / n, cc = c0 + (c1 - c0) * t, sy = y0 + (y1 - y0) * t;
        if (sy > 2.4) {
          colliders.push(axis === 'x'
            ? { min: new THREE.Vector3(cc - 0.6, 1, u0), max: new THREE.Vector3(cc + 0.6, sy - 0.2, u1) }
            : { min: new THREE.Vector3(u0, 1, cc - 0.6), max: new THREE.Vector3(u1, sy - 0.2, cc + 0.6) });
        }
      }
    }
  }
  // landings bridging the two lanes at each flight end
  for (const ly of [4.2, 7.4, 10.6, 13.8]) {
    addBox(1.6, 0.3, 16, 20.8, ly - 0.3, 0, MAT.concrete);
    addBox(1.6, 0.3, 16, 7.2, ly - 0.3, 0, MAT.concrete);
  }
  ramp('x', -8, 0, 8, 20, 1, 4.2);     // F1 lane A →
  ramp('x', 0, 8, 20, 8, 4.2, 7.4);    // F2 lane B ←
  ramp('x', -8, 0, 8, 20, 7.4, 10.6);  // F3 lane A →
  ramp('x', 0, 8, 20, 8, 10.6, 13.8);  // F4 lane B ←
  ramp('x', -8, 0, 8, 20, 13.8, 15.5); // F5 lane A → goal
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
  // ramp surfaces act as ground (rooftop stairwell)
  if (b.vel.y <= 0.01 && ramps.length) {
    let best = null, bestD = 1e9;
    for (const r of ramps) {
      const lat = r.axis === 'x' ? b.pos.z : b.pos.x;
      if (lat <= r.u0 || lat >= r.u1) continue;
      const c = r.axis === 'x' ? b.pos.x : b.pos.z;
      const t = (c - r.cA) / (r.cB - r.cA);
      if (t < 0 || t > 1) continue;
      const surf = r.yA + (r.yB - r.yA) * t;
      const d = b.pos.y - surf;
      if (d <= 0.35 && d >= -0.9 && Math.abs(d) < bestD) { bestD = Math.abs(d); best = surf; }
    }
    if (best != null) { b.pos.y = best; b.vel.y = 0; b.grounded = true; }
  }
  b.pos.x = Math.max(-150, Math.min(150, b.pos.x));
  b.pos.z = Math.max(-150, Math.min(150, b.pos.z));
  if (b.pos.y < -5) { b.pos.y = -5; b.vel.y = 0; }
}

// ---------------- PLAYER ----------------
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, grounded: false, alive: true,
  ammo: 1, maxAmmo: 1, lastShot: 0, deadTimer: 0,
  level: 0, respawnCp: 0, respawnPos: null, adsT: 0,
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
  const b = CFG.binds;
  if (Input.keys[b.fwd]) fz -= 1;
  if (Input.keys[b.back]) fz += 1;
  if (Input.keys[b.left]) fx -= 1;
  if (Input.keys[b.right]) fx += 1;
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
  g.scale.setScalar(3.0); // big chunky players
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
  const cd = Game.mode === 'rooftop' && Game.role === 'sniper' ? 4000 : (Game.mode === '1v1' ? 1200 : 1500);
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
    else if (player.respawnPos) sp = { pos: player.respawnPos.clone(), yaw: Math.PI / 2 };
    else sp = spawnPoints[Math.min(Game.myId || 1, spawnPoints.length - 1)] || spawnPoints[1];
  } else {
    // random spawn point on the map
    sp = spawnPoints[(Math.random() * spawnPoints.length) | 0] || spawnPoints[0];
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
  if (location.hash.includes('debug')) pushErr('msg:' + m.t + (m.from != null ? ' f' + m.from : ''));
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

function updateLobbyCount() {
  const n = Net.ids().length;
  const pc = $('playerCount');
  pc.textContent = `👤 ${n}/3 players`;
  pc.classList.toggle('full', n >= Net.MAX_PLAYERS);
  const hw = $('hostWait');
  hw.textContent = n < 2 ? 'Waiting for players to join…' : `${n - 1} player(s) in room — press START when ready`;
  $('btnStart').disabled = n < 2;
  $('btnStart').textContent = 'START GAME';
  $('netStatus').textContent = '';
}
Net.on('peer', () => { if (Game.state !== 'playing') updateLobbyCount(); });
Net.on('peerleft', ({ id }) => {
  if (id != null && remotes.has(id)) { scene.remove(remotes.get(id).group); remotes.delete(id); }
  if (Game.state === 'playing') {
    // if everyone left, end
    if (Net.isHost && Net.ids().length <= 1) endGame(true, 'Everyone left');
  } else if (Net.isHost && !$('roomCodeBox').classList.contains('hidden')) {
    updateLobbyCount();
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
    sp = spawnPoints[(Math.random() * spawnPoints.length) | 0] || spawnPoints[0];
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
  const isRunner = Game.mode === 'rooftop' && b.role === 'runner';
  const spd = ml > 0.01 ? d.speed * (isRunner ? 0.42 : 1) : 0;
  if (isRunner) {
    // kinematic climb — no collision fighting on the stairwell
    b._kx = ml > 0.01 ? ai.mx / ml * spd : 0;
    b._kz = ml > 0.01 ? ai.mz / ml * spd : 0;
    b._ky = BOT_WAYPOINTS[Math.min(ai.wp, BOT_WAYPOINTS.length - 1)].y;
    botKinematic(b, dt);
  } else {
    stepBody(b, ml > 0.01 ? ai.mx / ml * spd : 0, ml > 0.01 ? ai.mz / ml * spd : 0, ai.jump, dt);
  }
  ai.jump = false;

  // visuals
  b.group.position.copy(b.pos);
  b.group.rotation.y = b.yaw + Math.PI;
  b.targetPos.copy(b.pos);
  const w = now / 130;
  const moving = Math.hypot(b.vel.x, b.vel.z) > 0.5;
  b.parts.legL.rotation.x = moving ? Math.sin(w) * 0.5 : 0;
  b.parts.legR.rotation.x = moving ? -Math.sin(w) * 0.5 : 0;
}

// kinematic move for rooftop runner bots — follows waypoints, y eases to path height
function botKinematic(b, dt) {
  b.pos.x += b._kx * dt; b.pos.z += b._kz * dt;
  b.pos.y += (b._ky - b.pos.y) * Math.min(1, dt * 3.5);
  b.vel.set(b._kx, 0, b._kz); b.grounded = true;
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

  // bot reloads its bolt-action (chuchu) so it keeps shooting back
  if (ai.ammo <= 0 && now - ai.lastShot > 1400 + (4.6 - d.speed) * 900) ai.ammo = 1;
}
let _pp = null;
function playerProxy() {
  if (!_pp) { _pp = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.4, 1.7), new THREE.MeshBasicMaterial({ visible: false })); _pp.userData.isPlayer = true; }
  _pp.position.set(player.pos.x, player.pos.y + 1.7, player.pos.z);
  if (!_pp.parent) scene.add(_pp);
  return _pp;
}

// ---- Rooftop runner bot: climb the stairwell waypoints ----
const BOT_WAYPOINTS = [
  { x: -22,  y: 1.0,  z: -4 },    // deck, back stretch
  { x: -6,   y: 1.0,  z: -4 },    // mid deck
  { x: 8,    y: 1.0,  z: -4 },    // shaft entry, F1 lane A
  { x: 20,   y: 4.2,  z: -4 },    // F1 top
  { x: 20.8, y: 4.2,  z: 4 },     // landing → lane B
  { x: 8,    y: 7.4,  z: 4 },     // F2 top
  { x: 7.2,  y: 7.4,  z: -4 },    // landing → lane A
  { x: 20,   y: 10.6, z: -4 },    // F3 top
  { x: 20.8, y: 10.6, z: 4 },     // landing → lane B
  { x: 8,    y: 13.8, z: 4 },     // F4 top
  { x: 7.2,  y: 13.8, z: -4 },    // landing → lane A
  { x: 20,   y: 15.5, z: -4 },    // F5 top = goal edge
  { x: 40,   y: 15.5, z: 0 },     // goal center → win
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
    player.level = lvl;
    if (lvl >= 1 && lvl <= 5) player.respawnPos = checkpoints[lvl - 1].pos.clone();
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
    // ensure remote avatars for known ids (clients also see the host, id 0)
    for (const id of Net.ids()) {
      if (id === Game.myId) continue;
      if (Net.isHost && id === 0) continue;
      if (!remotes.has(id)) remotes.set(id, makeAvatar(id));
    }
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
  player.respawnPos = null;
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
let dbgT = 0;
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
    // fast reload: pew → chuchu (sniper rifle cycles quickly)
    if (player.ammo < player.maxAmmo) {
      const rt = Game.mode === '1v1' ? 700 : (Game.role === 'sniper' ? 1100 : 1600);
      if (now - player.lastShot > rt) { player.ammo = player.maxAmmo; updateAmmoHUD(); AudioSys.reload(); }
    }

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

    // debug/spectate line (only with #debug in URL)
    const dbgOn = location.hash.includes('debug');
    dbgT += dt;
    if (dbgOn && dbgT > 0.5) {
      dbgT = 0;
      const el = $('dbg');
      el.classList.remove('hidden');
      el.textContent = `pos ${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)},${player.pos.z.toFixed(0)} lvl${player.level}` +
        (bots.length ? ' | bots ' + bots.map(b => `${b.id}:${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)} wp${b.ai.wp}${b.alive ? '' : '✝'}`).join(' ') : '') +
        (remotes.size ? ' | remotes ' + [...remotes.keys()].join(',') : '');
    }
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
$('btnMenuBack').onclick = () => { AudioSys.ui(); resetOnlineUI(); $('menuOnline').classList.add('hidden'); $('menuMain').classList.remove('hidden'); };
$('btnOfflineBack').onclick = () => { AudioSys.ui(); $('menuOffline').classList.add('hidden'); $('menuMain').classList.remove('hidden'); };
$('btnAgain').onclick = () => { AudioSys.ui(); backToMenu(); };
$('btnQuit').onclick = () => { AudioSys.ui(); backToMenu(); };

// ---- online lobby tabs (host / join, chess-style) ----
function showOnlineTab(which) {
  AudioSys.ui();
  const host = which === 'host';
  $('tabHost').classList.toggle('selected', host);
  $('tabJoin').classList.toggle('selected', !host);
  $('hostPane').classList.toggle('hidden', !host);
  $('joinPane').classList.toggle('hidden', host);
}
$('tabHost').onclick = () => showOnlineTab('host');
$('tabJoin').onclick = () => showOnlineTab('join');

// teardown any live session and reset the lobby UI
function resetOnlineUI() {
  try { Net.destroy(); } catch (e) {}
  Game.online = false;
  $('roomCodeBox').classList.add('hidden');
  $('btnCreateRoom').disabled = false;
  $('btnJoinGo').disabled = false;
  $('joinWait').style.display = 'none';
  $('netStatus').textContent = '';
}

$('btnCreateRoom').onclick = async () => {
  AudioSys.ui();
  resetOnlineUI();
  $('btnCreateRoom').disabled = true;
  $('netStatus').textContent = 'creating room…';
  try {
    let code = null, lastErr = null;
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      try { code = await Net.host(); }
      catch (e) { lastErr = e; if (!/taken/i.test(e.message || '')) break; }
    }
    if (!code) throw lastErr || new Error('Could not create room');
    Game.online = true;
    $('roomCode').textContent = code;
    $('roomCodeBox').classList.remove('hidden');
    updateLobbyCount();
    $('netStatus').textContent = '';
  } catch (e) {
    $('netStatus').textContent = 'Error: ' + (e.message || e);
    $('btnCreateRoom').disabled = false;
  }
};

$('btnJoinGo').onclick = async () => {
  const code = $('joinCode').value;
  if (!code || code.length !== 4) { $('netStatus').textContent = 'Enter the 4-letter code'; return; }
  AudioSys.ui();
  resetOnlineUI();
  $('btnJoinGo').disabled = true;
  $('joinWait').textContent = 'Connecting…';
  $('joinWait').style.display = '';
  $('netStatus').textContent = '';
  try {
    await Net.join(code);
    Game.online = true;
    $('joinWait').textContent = 'Connected — waiting for the host to start…';
  } catch (e) {
    Game.online = false;
    $('joinWait').style.display = 'none';
    $('netStatus').textContent = 'Error: ' + (e.message || e);
    $('btnJoinGo').disabled = false;
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
  if (location.hash.includes('debug')) pushErr('btnStart ids=' + Net.ids().length);
  if (Net.ids().length < 2) return;
  AudioSys.ui();
  const role = hostMode === 'rooftop' ? 'sniper' : 'ffa';
  Net.send({ t: 'start', mode: hostMode, time: hostTime, role: hostMode === 'rooftop' ? 'runner' : 'ffa' });
  if (location.hash.includes('debug')) pushErr('sent start');
  startGame(hostMode, hostTime, role);
};

// ---------------- SETTINGS ----------------
$('btnSettings').onclick = () => { AudioSys.ui(); $('menuMain').classList.add('hidden'); $('menuSettings').classList.remove('hidden'); };
$('btnSettingsBack').onclick = () => { AudioSys.ui(); $('menuSettings').classList.add('hidden'); $('menuMain').classList.remove('hidden'); };

function showSetTab(which) {
  AudioSys.ui();
  const kb = which === 'kb';
  $('setTabKb').classList.toggle('selected', kb);
  $('setTabMob').classList.toggle('selected', !kb);
  $('setKb').classList.toggle('hidden', !kb);
  $('setMob').classList.toggle('hidden', kb);
}
$('setTabKb').onclick = () => showSetTab('kb');
$('setTabMob').onclick = () => showSetTab('mob');

// sensitivity
$('sensRange').value = CFG.sens;
$('sensVal').textContent = CFG.sens.toFixed(2) + 'x';
$('sensRange').oninput = e => {
  CFG.sens = +e.target.value;
  $('sensVal').textContent = CFG.sens.toFixed(2) + 'x';
  saveCFG();
};

// key binds
const BIND_DEFS = [
  ['fwd', 'MOVE FORWARD'], ['back', 'MOVE BACK'], ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'],
  ['jump', 'JUMP'], ['ads', 'AIM / ADS'], ['shoot', 'SHOOT'],
];
function renderBinds() {
  const wrap = $('bindRows');
  wrap.innerHTML = '';
  for (const [action, label] of BIND_DEFS) {
    const row = document.createElement('div');
    row.className = 'bind-row';
    row.innerHTML = `<span class="blabel">${label}</span><span class="bkey">${bindName(CFG.binds[action])}</span>`;
    row.onclick = () => startRebind(action, row);
    wrap.appendChild(row);
  }
}
function startRebind(action, row) {
  AudioSys.ui();
  document.querySelectorAll('.bind-row.listening').forEach(r => r.classList.remove('listening'));
  row.classList.add('listening');
  row.querySelector('.bkey').textContent = '…';
  const cleanup = () => {
    removeEventListener('keydown', kd, true);
    removeEventListener('mousedown', md, true);
  };
  const kd = e => {
    e.preventDefault(); e.stopPropagation(); cleanup();
    CFG.binds[action] = e.code; saveCFG(); renderBinds(); AudioSys.ui();
  };
  const md = e => {
    e.preventDefault(); e.stopPropagation(); cleanup();
    CFG.binds[action] = 'Mouse' + e.button; saveCFG(); renderBinds(); AudioSys.ui();
  };
  addEventListener('keydown', kd, true);
  addEventListener('mousedown', md, true);
}
renderBinds();

// mobile button layout editor
function applyBtnPos() {
  for (const id of ['btnAds', 'btnShoot', 'btnJump']) {
    const el = $(id), p = CFG.btns[id];
    el.style.left = el.style.top = el.style.right = el.style.bottom = '';
    if (p) {
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = Math.min(p.x, innerWidth - el.offsetWidth) + 'px';
      el.style.top = Math.min(p.y, innerHeight - el.offsetHeight) + 'px';
    }
  }
}
$('btnEditLayout').onclick = () => {
  layoutEditing = !layoutEditing;
  AudioSys.ui();
  for (const id of ['btnAds', 'btnShoot', 'btnJump']) $(id).classList.toggle('editing', layoutEditing);
  $('btnEditLayout').textContent = layoutEditing ? 'DONE' : 'EDIT LAYOUT';
  $('layoutHint').textContent = layoutEditing ? 'drag the buttons — tap DONE when finished' : '';
};
$('btnResetLayout').onclick = () => { CFG.btns = {}; saveCFG(); applyBtnPos(); AudioSys.ui(); };
let dragEl = null, dragOff = { x: 0, y: 0 };
document.querySelectorAll('.touch-btn').forEach(el => {
  el.addEventListener('pointerdown', e => {
    if (!layoutEditing) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    dragEl = el; dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
});
addEventListener('pointermove', e => {
  if (!dragEl) return;
  const w = dragEl.offsetWidth, h = dragEl.offsetHeight;
  const x = Math.min(Math.max(0, e.clientX - dragOff.x), innerWidth - w);
  const y = Math.min(Math.max(0, e.clientY - dragOff.y), innerHeight - h);
  dragEl.style.right = 'auto'; dragEl.style.bottom = 'auto';
  dragEl.style.left = x + 'px'; dragEl.style.top = y + 'px';
});
addEventListener('pointerup', () => {
  if (!dragEl) return;
  CFG.btns[dragEl.id] = { x: parseFloat(dragEl.style.left), y: parseFloat(dragEl.style.top) };
  saveCFG(); dragEl = null;
});

// client-originated kills: host scores them (host's own kills go through hostApplyKill)
Net.on('kill', ({ killer }) => {
  if (!Net.isHost || Game.mode !== '1v1' || Game.state !== 'playing') return;
  Net.addScore(killer);
  syncHostScores();
});
// host can be the victim too
Net.on('youDied', () => { if (Game.mode === 'rooftop') knockLocal(); else killLocal(); });

// boot
window.__znipers = { Game, player, bots, remotes, Net, Input };
buildArena(); // menu backdrop
buildViewmodel();
Input.init(renderer.domElement);
applyBtnPos(); // restore custom mobile button layout
updateAmmoHUD();
loop();
