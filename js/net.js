// Tiny evented wrapper around PeerJS (free WebRTC broker, no server needed)
const Net = {
  peer: null,
  conn: null,
  isHost: false,
  code: null,
  _cbs: {},

  on(ev, fn) { (this._cbs[ev] = this._cbs[ev] || []).push(fn); },
  emit(ev, data) { (this._cbs[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); },

  ensurePeer() {
    if (this.peer) return Promise.resolve(this.peer);
    if (typeof Peer === 'undefined') return Promise.reject(new Error('PeerJS failed to load (needs internet)'));
    return new Promise((res, rej) => {
      const p = new Peer(); // random id for joiner
      p.on('open', () => res(p));
      p.on('error', e => rej(e));
    });
  },

  async host() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    this.code = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join('');
    const id = 'znipers-' + this.code;
    return new Promise((res, rej) => {
      const p = new Peer(id);
      p.on('open', () => { this.peer = p; this.isHost = true; this._wireHost(p); res(this.code); });
      p.on('error', e => rej(e.type === 'unavailable-id' ? new Error('Room code taken, try again') : e));
    });
  },

  _wireHost(p) {
    p.on('connection', conn => {
      if (this.conn) { conn.close(); return; } // 1v1 only
      this.conn = conn;
      conn.on('open', () => this.emit('peer', { conn }));
      conn.on('data', d => this.emit('msg', d));
      conn.on('close', () => { this.conn = null; this.emit('peerleft'); });
    });
    p.on('disconnected', () => p.reconnect());
  },

  async join(code) {
    code = code.trim().toUpperCase();
    const p = await this.ensurePeer();
    const conn = p.connect('znipers-' + code, { reliable: true });
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Timed out — check the code')), 12000);
      conn.on('open', () => {
        clearTimeout(to);
        this.conn = conn; this.isHost = false; this.code = code;
        conn.on('data', d => this.emit('msg', d));
        conn.on('close', () => this.emit('peerleft'));
        res(conn);
      });
      conn.on('error', () => { clearTimeout(to); rej(new Error('Could not connect')); });
    });
  },

  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); },

  destroy() {
    try { this.conn && this.conn.close(); } catch {}
    try { this.peer && this.peer.destroy(); } catch {}
    this.peer = this.conn = null; this.isHost = false; this.code = null; this._cbs = {};
  }
};

export default Net;
