// TCP client for the Godot bridge (newline-delimited JSON, request/response matched by id).
import net from 'node:net';

export class GodotBridge {
  constructor(port = 9077, host = '127.0.0.1') {
    this.port = port; this.host = host;
    this.nextId = 1; this.waiting = new Map(); this.buf = '';
  }

  async connect(timeoutMs = 120_000) {
    const t0 = Date.now();
    for (;;) {
      try {
        await new Promise((ok, fail) => {
          this.sock = net.createConnection({ port: this.port, host: this.host }, ok);
          this.sock.once('error', fail);
        });
        break;
      } catch (e) {
        if (Date.now() - t0 > timeoutMs) throw new Error(`could not reach Godot on ${this.port}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    this.sock.setEncoding('utf8');
    this.sock.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const w = this.waiting.get(msg.id);
        if (w) { this.waiting.delete(msg.id); msg.ok === false ? w.fail(new Error(msg.error || 'godot error')) : w.ok(msg); }
      }
    });
    this.sock.on('close', () => { for (const w of this.waiting.values()) w.fail(new Error('Godot closed the bridge')); this.waiting.clear(); });
  }

  call(cmd, args = {}, timeoutMs = 600_000) {
    const id = this.nextId++;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(id); fail(new Error(`timeout: ${cmd}`)); }, timeoutMs);
      this.waiting.set(id, { ok: (m) => { clearTimeout(timer); ok(m); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.sock.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  close() { this.sock?.end(); }
}
