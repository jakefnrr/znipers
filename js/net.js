// PeerJS mesh-via-host: host accepts up to 2 joiners (3 players total).
// Clients send everything to the host; the host relays state/shoot messages
// to everyone and is authoritative for scores, hits and round end.
const Net = {
  peer: null,
  conns: new Map(),      // host side: id -> conn   (id 0 = host itself)
  conn: null,            // client side: conn to host
  isHost: false,
  code: null,
  myId: 0,
  roster: [],          // all player ids (host: conns keys, client: from welcome/roster msgs)
  _cbs: {},
  _nextId: 1,

  MAX_PLAYERS: 3,

  on(ev, fn) { (this._cbs[ev] = this._cbs[ev] || []).push(fn); },
  emit(ev, data) { (this._cbs[ev] = this._cbs[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); },

  ids() { return this.isHost ? [...this.conns.keys()] : this.roster.slice(); },

  // ---------- HOST ----------
  host() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    this.code = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join('');
    const id = 'znipers-' + this.code;
    return new Promise((res, rej) => {
      const p = new Peer(id);
      p.on('open', () => {
        this.peer = p; this.isHost = true; this.myId = 0;
        this.conns.set(0, null); // host pseudo-conn
        p.on('connection', conn => this._onJoin(conn));
        p.on('disconnected', () => p.reconnect());
        res(this.code);
      });
      p.on('error', e => rej(e.type === 'unavailable-id' ? new Error('Room code taken, try again') : e));
    });
  },

  _onJoin(conn) {
    if (this.conns.size >= this.MAX_PLAYERS) { conn.on('open', () => conn.send({ t: 'full' })); setTimeout(() => conn.close(), 500); return; }
    const id = this._nextId++;
    conn.on('open', () => {
      this.conns.set(id, conn);
      conn.on('data', d => this._hostMsg(id, d));
      conn.on('close', () => this._hostLeft(id));
      conn.send({ t: 'welcome', id, ids: this.ids() });
      this.roster = this.ids();
      this.emit('peer', { id });
      // tell everyone the roster changed
      this._broadcast({ t: 'roster', ids: this.ids() }, id);
    });
  },

  _hostMsg(from, m) {
    if (!m || !m.t) return;
    switch (m.t) {
      // cosmetic relays — forward to all OTHER players with origin id
      case 'state':
      case 'shoot':
        this._broadcast({ ...m, from }, from);
        this.emit('msg', { ...m, from }); // host sees it too
        break;
      // host-authoritative events
      case 'killed':   // shooter says it hit victim
        this._onKill(from, m.victim);
        break;
      case 'cp':       // runner checkpoint
        this._broadcast({ t: 'cp', from, level: m.level });
        break;
      case 'reached': { // a runner made it to the roof — that runner wins the round
        const reason = 'A runner reached the roof';
        this._broadcast({ t: 'end', winner: from, reason });
        this.emit('msg', { t: 'end', winner: from, reason }); // host too
        break;
      }
      case 'hitclaim': // (unused, kept for compat)
        break;
      default:
        this._broadcast({ ...m, from }, from);
    }
  },

  _onKill(killer, victim) {
    if (victim === killer || victim == null) return;
    this.emit('kill', { killer, victim }); // main.js tracks scores
    if (victim === 0) this.emit('youDied', { by: killer }); // victim is the host
    else {
      const vc = this.conns.get(victim);
      if (vc) vc.send({ t: 'youDied', by: killer });
    }
    this._broadcast({ t: 'killfeed', killer, victim });
    this.emit('msg', { t: 'killfeed', killer, victim }); // host sees its own feed
  },

  scores: {},
  addScore(id) { this.scores[id] = (this.scores[id] || 0) + 1; this.broadcastScores(); },
  broadcastScores() {
    this._broadcast({ t: 'scores', scores: { ...this.scores } });
  },

  _broadcast(msg, exceptId = -1) {
    for (const [id, conn] of this.conns) {
      if (id === exceptId || id === 0) continue;
      if (conn && conn.open) conn.send(msg);
    }
  },

  // host sends to a specific player (or all if id undefined)
  sendTo(id, msg) {
    if (id === undefined) { this._broadcast(msg); return; }
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  },

  send(msg) { // host "send" = broadcast to clients
    this._broadcast(msg);
  },

  _hostLeft(id) {
    this.conns.delete(id);
    this.roster = this.ids();
    this.emit('peerleft', { id });
    this._broadcast({ t: 'roster', ids: this.ids(), gone: id });
  },

  // ---------- CLIENT ----------
  join(code) {
    code = code.trim().toUpperCase();
    return this.ensurePeer().then(p => new Promise((res, rej) => {
      const conn = p.connect('znipers-' + code, { reliable: true });
      const to = setTimeout(() => rej(new Error('Timed out — check the code')), 12000);
      conn.on('open', () => {
        this.conn = conn; this.isHost = false;
        conn.on('data', d => {
          if (d && d.t === 'welcome') {
            clearTimeout(to);
            this.myId = d.id;
            this.roster = d.ids || [];
            this._wireClient(conn);
            res(conn);
          } else if (d && d.t === 'full') {
            clearTimeout(to); rej(new Error('Room is full (3 players max)'));
          } else {
            this.emit('msg', d);
          }
        });
      });
      conn.on('error', () => { clearTimeout(to); rej(new Error('Could not connect')); });
    }));
  },

  _wireClient(conn) {
    conn.on('data', d => {
      if (d && d.t === 'roster') { this.roster = (d.ids || []).filter(i => i !== d.gone); }
      this.emit('msg', d);
    });
    conn.on('close', () => this.emit('peerleft', {}));
  },

  ensurePeer() {
    if (this.peer) return Promise.resolve(this.peer);
    if (typeof Peer === 'undefined') return Promise.reject(new Error('PeerJS failed to load (needs internet)'));
    return new Promise((res, rej) => {
      const p = new Peer();
      p.on('open', () => res(p));
      p.on('error', e => rej(e));
    });
  },

  // client→host send
  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); },

  destroy() {
    try { this.conn && this.conn.close(); } catch {}
    try { this.peer && this.peer.destroy(); } catch {}
    this.peer = this.conn = null;
    this.conns = new Map(); this.isHost = false; this.code = null;
    this.myId = 0; this._nextId = 1; this.scores = {};
    this._cbs = {};
  }
};

export default Net;
