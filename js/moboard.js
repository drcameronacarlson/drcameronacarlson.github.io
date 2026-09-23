// Digital maneuvering board: 10-ring polar plot with distance and speed scales,
// live relative plot, pencil tools, and solution overlays from the problem engine.
(function (MB) {
  const { n360, brg, len, sub, add, D2R, pad3, YD_PER_NM } = MB;
  const NM_SCALES = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10];
  const YD_SCALES = [100, 200, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000];
  const SPD_SCALES = [1, 2, 3, 4, 5, 6];

  class MoBoard {
    constructor(pane) {
      this.pane = pane; this.canvas = pane.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
      this.readout = pane.querySelector('.readout');
      this.distUnit = 'nm'; this.nmScale = 2; this.ydScale = 1000; this.speedScale = 2;
      this.center = 'own'; this.showLive = true; this.showSolution = false; this.overlay = null;
      this.marks = []; this.tool = 'none'; this.drag = null; this.cursor = null;
      new ResizeObserver(() => { this.resize(); this.draw(); }).observe(this.canvas);
      this.canvas.addEventListener('pointerdown', e => this.down(e));
      this.canvas.addEventListener('pointermove', e => this.move(e));
      this.canvas.addEventListener('pointerup', e => this.up(e));
      this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = r.width; this.h = r.height; this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    scaleNm() { return this.distUnit === 'yd' ? this.ydScale / YD_PER_NM : this.nmScale; }
    distLabel(nm) { return this.distUnit === 'yd' ? Math.round(nm * YD_PER_NM).toLocaleString('en-US') + ' yds' : nm.toFixed(2) + ' nm'; }
    // Leaves a strip at the bottom for the scale readout
    geom() { return { cx: this.w / 2, cy: (this.h - 20) / 2, R: Math.max(20, Math.min(this.w, this.h - 20) / 2 - 30) }; }
    // Draws a label, nudging it down until it clears labels already placed this frame
    label(text, x, y) {
      const c = this.ctx, w = c.measureText(text).width, h = 13;
      let yy = y;
      for (let i = 0; i < 6; i++) {
        const hit = this.boxes.some(bx => x < bx.x + bx.w && x + w > bx.x && yy - h < bx.y && yy > bx.y - bx.h);
        if (!hit) break;
        yy += h + 1;
      }
      this.boxes.push({ x, y: yy, w, h });
      c.fillText(text, x, yy);
    }
    dS(p) { const g = this.geom(), k = g.R / (10 * this.scaleNm()); return { x: g.cx + p.x * k, y: g.cy - p.y * k }; }
    vS(v) { const g = this.geom(), k = g.R / (10 * this.speedScale); return { x: g.cx + v.x * k, y: g.cy - v.y * k }; }
    fromEvent(e) {
      const rc = this.canvas.getBoundingClientRect(), g = this.geom(), k = g.R / (10 * this.scaleNm());
      return { x: (e.clientX - rc.left - g.cx) / k, y: -(e.clientY - rc.top - g.cy) / k };
    }
    autoscale(ov) {
      this.distUnit = ov.distUnit || 'nm';
      let dmax = 0.5, vmax = 1;
      (ov.points || []).forEach(p => (dmax = Math.max(dmax, len(p.p))));
      (ov.lines || []).forEach(l => { if (!l.speed) dmax = Math.max(dmax, len(l.a), len(l.b)); });
      (ov.circles || []).forEach(c => { if (c.speed) vmax = Math.max(vmax, c.r); else dmax = Math.max(dmax, c.r); });
      (ov.vectors || []).forEach(v => (vmax = Math.max(vmax, len(v.a), len(v.b))));
      if (this.distUnit === 'yd') this.ydScale = YD_SCALES.find(s => dmax * YD_PER_NM <= s * 9.4) || 5000;
      else this.nmScale = NM_SCALES.find(s => dmax <= s * 9.4) || 10;
      this.speedScale = SPD_SCALES.find(s => vmax <= s * 9.4) || 6;
      MB.emit('moboard-scale');
    }
    scaleOptions() { return this.distUnit === 'yd' ? YD_SCALES : NM_SCALES; }
    setScale(v) { if (this.distUnit === 'yd') this.ydScale = v; else this.nmScale = v; this.draw(); }

    down(e) {
      const p = this.fromEvent(e);
      if (this.tool === 'point') { this.marks.push({ t: 'p', p }); this.draw(); }
      else if (this.tool === 'line') { this.drag = { a: p, b: p }; this.canvas.setPointerCapture(e.pointerId); }
    }
    move(e) {
      this.cursor = this.fromEvent(e);
      if (this.drag) this.drag.b = this.cursor;
      this.updateReadout(); this.draw();
    }
    up() {
      if (this.drag) { if (len(sub(this.drag.b, this.drag.a)) > this.scaleNm() * 0.05) this.marks.push({ t: 'l', a: this.drag.a, b: this.drag.b }); this.drag = null; this.draw(); }
    }
    updateReadout() {
      const parts = [];
      const unitsPerRing = this.distUnit === 'yd' ? this.ydScale.toLocaleString('en-US') + ' yds' : this.nmScale + ' nm';
      parts.push(`<span>Distance ${unitsPerRing}/ring</span><span>Speed ${this.speedScale} kts/ring</span>`);
      const seg = this.drag ? sub(this.drag.b, this.drag.a) : this.cursor;
      if (seg) {
        const kts = len(seg) / this.scaleNm() * this.speedScale;
        parts.push(`<span class="acc">${this.drag ? 'LINE' : 'CURSOR'} ${pad3(brg(seg))}° · ${this.distLabel(len(seg))} · ${kts.toFixed(1)} kts</span>`);
      }
      this.readout.innerHTML = parts.join('');
    }
    tokens() {
      const cs = getComputedStyle(document.documentElement), t = k => cs.getPropertyValue(k).trim();
      return { paper: t('--paper'), grid: t('--grid'), gridStrong: t('--grid-strong'), ink: t('--ink'), muted: t('--muted'), speed: t('--speed-ink'),
        own: t('--v-own'), other: t('--v-other'), rel: t('--v-rel'), live: t('--live'), pencil: t('--pencil'), accent: t('--accent') };
    }
    draw() {
      const c = this.ctx, g = this.geom(), T = this.tokens();
      c.clearRect(0, 0, this.w, this.h); this.boxes = [];
      c.fillStyle = T.paper; c.fillRect(0, 0, this.w, this.h);
      // Rings
      for (let i = 1; i <= 10; i++) {
        c.strokeStyle = i % 5 === 0 ? T.gridStrong : T.grid; c.lineWidth = i % 5 === 0 ? 1.2 : 0.8;
        c.beginPath(); c.arc(g.cx, g.cy, g.R * i / 10, 0, Math.PI * 2); c.stroke();
      }
      // Radials & degree ticks
      c.lineWidth = 0.6;
      for (let d = 0; d < 360; d++) {
        const s = Math.sin(d * D2R), co = Math.cos(d * D2R);
        if (d % 10 === 0) {
          c.strokeStyle = d % 30 === 0 ? T.gridStrong : T.grid;
          c.beginPath(); c.moveTo(g.cx + s * g.R * 0.1, g.cy - co * g.R * 0.1); c.lineTo(g.cx + s * g.R, g.cy - co * g.R); c.stroke();
        }
        const l = d % 10 === 0 ? 8 : d % 5 === 0 ? 5 : 2.5;
        c.strokeStyle = T.gridStrong;
        c.beginPath(); c.moveTo(g.cx + s * g.R, g.cy - co * g.R); c.lineTo(g.cx + s * (g.R + l), g.cy - co * (g.R + l)); c.stroke();
      }
      c.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 10) {
        const s = Math.sin(d * D2R), co = Math.cos(d * D2R);
        c.fillStyle = T.ink; c.fillText(pad3(d), g.cx + s * (g.R + 18), g.cy - co * (g.R + 18));
        if (d % 30 === 0) { c.fillStyle = T.muted; c.fillText(pad3(n360(d + 180)), g.cx + s * (g.R - 12), g.cy - co * (g.R - 12)); }
      }
      // Scale labels: distance along 090, speed along 270
      c.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
      for (let i = 2; i <= 10; i += 2) {
        const dv = this.distUnit === 'yd' ? (this.ydScale * i / 1000) + 'k' : +(this.nmScale * i).toFixed(2);
        c.fillStyle = T.ink; c.fillText(dv, g.cx + g.R * i / 10, g.cy + 8);
        c.fillStyle = T.speed; c.fillText(this.speedScale * i, g.cx - g.R * i / 10, g.cy + 8);
      }
      c.fillStyle = T.ink; c.textAlign = 'left'; c.fillText(this.distUnit === 'yd' ? 'yds →' : 'nm →', g.cx + 4, g.cy + 20);
      c.fillStyle = T.speed; c.textAlign = 'right'; c.fillText('← kts', g.cx - 4, g.cy + 20);

      // Solution overlay
      const ov = this.overlay;
      if (ov && this.showSolution) this.drawOverlay(ov, T);
      // Live relative plot
      if (this.showLive) this.drawLive(T);
      // Pencil marks
      c.strokeStyle = T.pencil; c.fillStyle = T.pencil; c.lineWidth = 1.6;
      for (const m of this.marks) {
        if (m.t === 'p') { const q = this.dS(m.p); c.beginPath(); c.arc(q.x, q.y, 3, 0, Math.PI * 2); c.fill(); }
        else { const a = this.dS(m.a), b = this.dS(m.b); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      }
      if (this.drag) {
        const a = this.dS(this.drag.a), b = this.dS(this.drag.b);
        c.setLineDash([5, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      }
      // Center
      c.fillStyle = T.ink; c.beginPath(); c.arc(g.cx, g.cy, 3, 0, Math.PI * 2); c.fill();
      c.font = '600 10px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'left';
      const lbl = ov && this.showSolution ? ov.centerLabel : (this.center === 'guide' && MB.guide() ? 'G' : 'OS');
      this.label(lbl + ' / e', g.cx + 6, g.cy - 8);
    }
    arrow(a, b, color, width, dash) {
      const c = this.ctx; c.strokeStyle = color; c.fillStyle = color; c.lineWidth = width;
      c.setLineDash(dash || []); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 9;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
      c.beginPath(); c.moveTo(b.x, b.y);
      c.lineTo(b.x - h * Math.cos(ang - 0.35), b.y - h * Math.sin(ang - 0.35));
      c.lineTo(b.x - h * Math.cos(ang + 0.35), b.y - h * Math.sin(ang + 0.35)); c.closePath(); c.fill();
    }
    drawOverlay(ov, T) {
      const c = this.ctx, g = this.geom(), step = this.revealStep == null ? Infinity : this.revealStep;
      const shown = it => (it.s == null ? 99 : it.s) <= step;
      (ov.circles || []).filter(shown).forEach(ci => {
        const px = ci.speed ? ci.r / this.speedScale * g.R / 10 : ci.r / this.scaleNm() * g.R / 10;
        c.strokeStyle = ci.speed ? T.speed : T.rel; c.setLineDash([3, 4]); c.lineWidth = 1.2;
        c.beginPath(); c.arc(g.cx, g.cy, px, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      });
      (ov.lines || []).filter(shown).forEach(l => {
        const map = l.speed ? this.vS.bind(this) : this.dS.bind(this);
        const a = map(l.a), b = map(l.b);
        if (l.kind === 'aux' || l.kind === 'arc') {
          c.strokeStyle = l.kind === 'arc' ? T.accent : T.muted; c.setLineDash(l.kind === 'arc' ? [] : [2, 4]); c.lineWidth = l.kind === 'arc' ? 2 : 1;
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
        } else this.arrow(a, b, T.accent, 2, l.kind === 'rml2' ? [8, 5] : null);
      });
      c.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'left';
      (ov.points || []).filter(shown).forEach(p => {
        const q = this.dS(p.p); c.fillStyle = T.accent;
        c.beginPath(); c.arc(q.x, q.y, 4, 0, Math.PI * 2); c.fill();
        c.fillStyle = T.ink; this.label(p.label, q.x + 7, q.y - 8);
      });
      const col = { own: T.own, own2: T.own, other: T.other, rel: T.rel, rel2: T.rel };
      (ov.vectors || []).filter(shown).forEach(v => {
        const a = this.vS(v.a), b = this.vS(v.b);
        this.arrow(a, b, col[v.kind] || T.ink, 2.2, /2$/.test(v.kind) ? [7, 4] : null);
        if (v.label) { c.fillStyle = col[v.kind] || T.ink; c.font = 'italic 700 13px "IBM Plex Sans", system-ui, sans-serif'; this.label(v.label, b.x + 6, b.y + 4); }
      });
    }
    drawLive(T) {
      const c = this.ctx, own = MB.own(); if (!own) return;
      const ref = this.center === 'guide' && MB.guide() ? MB.guide() : own;
      c.font = '500 10px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'left';
      for (const s of MB.sim.ships) {
        if (s === ref) continue;
        const tr = MB.relTrail(s, ref, 45);
        c.strokeStyle = T.live; c.lineWidth = 1.2; c.globalAlpha = 0.75; c.beginPath();
        tr.forEach((p, i) => { const q = this.dS(p); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); });
        const cur = this.dS(sub(s, ref)); if (tr.length) c.lineTo(cur.x, cur.y); c.stroke();
        // 3-minute ticks
        c.fillStyle = T.live;
        let bucket = null;
        tr.forEach(p => {
          const bk = Math.floor(p.t / 180);
          if (bucket !== null && bk !== bucket) { const q = this.dS(p); c.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); }
          bucket = bk;
        });
        c.globalAlpha = 1;
        c.beginPath(); c.arc(cur.x, cur.y, s === own ? 5 : 4, 0, Math.PI * 2);
        if (s === own) { c.fillStyle = T.own; c.fill(); } else { c.strokeStyle = T.live; c.lineWidth = 2; c.stroke(); }
        c.fillStyle = s === own ? T.own : T.live; this.label(s === own ? 'Own ship' : s.name, cur.x + 7, cur.y + 12);
      }
    }
  }
  MoBoard.NM_SCALES = NM_SCALES; MoBoard.YD_SCALES = YD_SCALES; MoBoard.SPD_SCALES = SPD_SCALES;
  MB.MoBoard = MoBoard;
})(window.MB);
