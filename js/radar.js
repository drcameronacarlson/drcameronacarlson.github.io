// Surface-search radar PPI: rotating sweep, afterglow, relative trails, EBL/VRM.
(function (MB) {
  const { n360, brg, len, sub, D2R, pad3 } = MB;
  const RANGES = [0.75, 1.5, 3, 6, 12, 24, 48];
  const RING = { 0.75: 0.25, 1.5: 0.25, 3: 0.5, 6: 1, 12: 2, 24: 4, 48: 8 };
  const PH = '#8dffb4', PH_DIM = 'rgba(141,255,180,', AMBER = '#ffc15e';
  const SIZE = { carrier: 5, tanker: 4.2, merchant: 4, warship: 3.4, fishing: 2.2, sail: 1.8 };

  class Radar {
    constructor(pane) {
      this.pane = pane; this.canvas = pane.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
      this.readout = pane.querySelector('.readout'); this.table = pane.querySelector('.targets');
      this.range = 12; this.headUp = false; this.trails = true; this.vectors = 'rel'; this.showTargets = false;
      this.sweep = 0; this.painted = {}; this.ebl = null; this.vrm = null; this.cursor = null;
      new ResizeObserver(() => this.resize()).observe(this.canvas);
      this.canvas.addEventListener('pointermove', e => { this.cursor = this.fromEvent(e); this.updateReadout(); });
      this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.updateReadout(); });
      this.canvas.addEventListener('click', e => {
        const p = this.fromEvent(e); if (!p) return;
        this.ebl = brg(p); this.vrm = len(p); this.updateReadout();
      });
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = r.width; this.h = r.height; this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    rot() { const o = MB.own(); return this.headUp && o ? o.course : 0; }
    // Leave a strip at the top for the range/EBL readout so it never covers the bearing ring
    geom() { return { cx: this.w / 2, cy: this.h / 2 + 9, R: Math.max(20, Math.min(this.w, this.h - 18) / 2 - 26) }; }
    toS(rel) {
      const g = this.geom(), k = g.R / this.range, a = (brg(rel) - this.rot()) * D2R, r = len(rel) * k;
      return { x: g.cx + r * Math.sin(a), y: g.cy - r * Math.cos(a) };
    }
    fromEvent(e) {
      const rc = this.canvas.getBoundingClientRect(), g = this.geom();
      const dx = e.clientX - rc.left - g.cx, dy = -(e.clientY - rc.top - g.cy);
      const r = Math.hypot(dx, dy); if (r > g.R) return null;
      const a = (Math.atan2(dx, dy) / D2R + this.rot()) * D2R, d = r / g.R * this.range;
      return { x: d * Math.sin(a), y: d * Math.cos(a) };
    }
    setRange(dir) { const i = RANGES.indexOf(this.range); this.range = RANGES[Math.max(0, Math.min(RANGES.length - 1, i + dir))]; this.painted = {}; }
    fitTo(maxNm) { this.range = RANGES.find(r => r >= maxNm * 1.15) || 48; this.painted = {}; }
    updateReadout() {
      const parts = [`<span>${this.range} nm</span><span>rings ${RING[this.range]}</span><span>${this.headUp ? 'HEAD-UP' : 'NORTH-UP'}</span>`];
      if (this.ebl != null) parts.push(`<span class="amb">EBL ${pad3(this.ebl)}°</span><span class="amb">VRM ${this.vrm.toFixed(2)} nm</span>`);
      if (this.cursor) parts.push(`<span>CURSOR ${pad3(brg(this.cursor))}° ${len(this.cursor).toFixed(2)} nm</span>`);
      this.readout.innerHTML = parts.join('');
    }
    updateTable() {
      if (!this.showTargets) { this.table.hidden = true; return; }
      const own = MB.own(); if (!own) return;
      const rows = MB.sim.ships.filter(s => s !== own).map(s => {
        const d = MB.cpaData(s, own);
        const cpa = d.tcpaMin > 0 ? `${d.cpaRng.toFixed(1)} / ${Math.round(d.tcpaMin)}m` : 'opening';
        return `<tr><td>${s.name}</td><td>${pad3(d.brg)}</td><td>${d.rng.toFixed(1)}</td><td>${cpa}</td><td>${pad3(s.course)}</td><td>${s.speed.toFixed(1)}</td></tr>`;
      }).join('');
      this.table.hidden = false;
      this.table.innerHTML = `<table><thead><tr><th>TGT</th><th>BRG</th><th>RNG</th><th>CPA/TCPA</th><th>CRS</th><th>SPD</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    draw(realDt) {
      const c = this.ctx, g = this.geom(), own = MB.own(), rot = this.rot();
      c.fillStyle = '#03100c'; c.fillRect(0, 0, this.w, this.h);
      if (!own) return;
      // Scope face
      const grd = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.R);
      grd.addColorStop(0, '#062019'); grd.addColorStop(1, '#020b08');
      c.fillStyle = grd; c.beginPath(); c.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); c.fill();
      // Range rings
      c.strokeStyle = PH_DIM + '0.22)'; c.lineWidth = 1;
      for (let r = RING[this.range]; r <= this.range + 1e-6; r += RING[this.range]) {
        c.beginPath(); c.arc(g.cx, g.cy, r / this.range * g.R, 0, Math.PI * 2); c.stroke();
      }
      // Bearing ring
      c.fillStyle = PH_DIM + '0.75)'; c.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) {
        const a = (d - rot) * D2R, s = Math.sin(a), co = Math.cos(a), l = d % 10 === 0 ? 7 : 3.5;
        c.strokeStyle = PH_DIM + (d % 30 === 0 ? '0.8)' : '0.4)');
        c.beginPath(); c.moveTo(g.cx + s * g.R, g.cy - co * g.R); c.lineTo(g.cx + s * (g.R + l), g.cy - co * (g.R + l)); c.stroke();
        if (d % 30 === 0) c.fillText(pad3(d), g.cx + s * (g.R + 17), g.cy - co * (g.R + 17));
      }
      // Heading flash
      const ha = (own.course - rot) * D2R;
      c.strokeStyle = PH_DIM + '0.6)'; c.beginPath(); c.moveTo(g.cx, g.cy); c.lineTo(g.cx + Math.sin(ha) * g.R, g.cy - Math.cos(ha) * g.R); c.stroke();
      // Sea clutter
      c.fillStyle = PH_DIM + '0.35)';
      const clutterR = Math.min(g.R * 0.2, 0.8 / this.range * g.R);
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() ** 2 * clutterR;
        c.fillRect(g.cx + Math.sin(a) * r, g.cy - Math.cos(a) * r, 1.3, 1.3);
      }
      // Sweep
      const prev = this.sweep;
      this.sweep = n360(this.sweep + realDt * 360 / 2.5);
      if (c.createConicGradient) {
        const cg = c.createConicGradient((this.sweep - 90) * D2R - Math.PI * 0.5 + Math.PI / 2, g.cx, g.cy);
        cg.addColorStop(0, 'rgba(141,255,180,0)'); cg.addColorStop(0.9, 'rgba(141,255,180,0)'); cg.addColorStop(1, 'rgba(141,255,180,0.16)');
        c.fillStyle = cg; c.beginPath(); c.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); c.fill();
      }
      const sa = this.sweep * D2R;
      c.strokeStyle = PH_DIM + '0.7)'; c.beginPath(); c.moveTo(g.cx, g.cy); c.lineTo(g.cx + Math.sin(sa) * g.R, g.cy - Math.cos(sa) * g.R); c.stroke();
      // Trails (relative motion afterglow)
      const others = MB.sim.ships.filter(s => s !== own);
      if (this.trails) {
        for (const s of others) {
          const tr = MB.relTrail(s, own, 12);
          tr.forEach((p, i) => {
            if (len(p) > this.range) return;
            const q = this.toS(p); c.fillStyle = PH_DIM + (0.1 + 0.35 * i / tr.length) + ')'; c.fillRect(q.x - 1, q.y - 1, 2, 2);
          });
        }
      }
      // Paint echoes when the sweep passes their bearing
      const swept = n360(this.sweep - prev);
      for (const s of others) {
        const rel = sub(s, own), a = n360(brg(rel) - rot);
        if (n360(a - prev) <= swept || !this.painted[s.id]) this.painted[s.id] = { x: rel.x, y: rel.y, a };
      }
      c.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'left';
      for (const s of others) {
        const p = this.painted[s.id]; if (!p || len(p) > this.range) continue;
        const age = n360(this.sweep - p.a) / 360, alpha = 1 - age * 0.78, q = this.toS(p);
        const sz = (SIZE[s.type] || 3) * Math.max(0.7, Math.min(1.6, 12 / this.range));
        c.fillStyle = PH_DIM + alpha + ')';
        c.beginPath(); c.ellipse(q.x, q.y, sz, sz * 0.7, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = PH_DIM + (0.35 + 0.5 * alpha) + ')'; c.fillText(s.name, q.x + sz + 4, q.y - sz - 2);
        if (this.vectors !== 'off') {
          const v = this.vectors === 'rel' ? sub(MB.velOf(s), MB.velOf(own)) : MB.velOf(s);
          const e = this.toS({ x: p.x + v.x * 0.1, y: p.y + v.y * 0.1 });
          c.strokeStyle = PH_DIM + '0.65)'; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(e.x, e.y); c.stroke();
        }
      }
      // EBL / VRM
      if (this.ebl != null) {
        const a = (this.ebl - rot) * D2R;
        c.strokeStyle = AMBER; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(g.cx, g.cy); c.lineTo(g.cx + Math.sin(a) * g.R, g.cy - Math.cos(a) * g.R); c.stroke();
        c.beginPath(); c.arc(g.cx, g.cy, this.vrm / this.range * g.R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
      // Own ship
      c.fillStyle = PH; c.beginPath(); c.arc(g.cx, g.cy, 2.5, 0, Math.PI * 2); c.fill();
    }
  }
  MB.Radar = Radar;
})(window.MB);
