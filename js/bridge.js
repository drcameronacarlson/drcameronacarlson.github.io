// 3D bridge window (three.js r128). World: metres, x = east, z = south (north is -z), own ship at origin.
(function (MB) {
  const { D2R, n360, brg, len, sub, pad3 } = MB;
  const NM = 1852, R_EFF = 6371000 * 7 / 6, EYE = 24;

  const LIGHTS = {
    day: { zen: '#3f7fc6', hor: '#d3e4ec', sea: '#2d5f78', fog: '#bcd3de', hemi: 1.0, sun: 0.85, far: 60000, nav: false },
    dusk: { zen: '#1b2748', hor: '#e0976a', sea: '#233b4b', fog: '#7d7580', hemi: 0.45, sun: 0.3, far: 42000, nav: true },
    night: { zen: '#01030a', hor: '#0a1322', sea: '#03080d', fog: '#060a11', hemi: 0.07, sun: 0.02, far: 30000, nav: true },
  };

  function hullGeo(L, B, H) {
    const s = new THREE.Shape();
    s.moveTo(-B / 2, -L / 2); s.lineTo(B / 2, -L / 2); s.lineTo(B / 2, L * 0.22);
    s.quadraticCurveTo(B / 2, L * 0.42, 0, L / 2); s.quadraticCurveTo(-B / 2, L * 0.42, -B / 2, L * 0.22); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, -H * 0.3, 0);
    return g;
  }
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  function box(grp, w, h, l, x, y, z, m) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); b.position.set(x, y + h / 2, z); grp.add(b); return b; }

  let glowTex = null;
  function glow() {
    if (glowTex) return glowTex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (glowTex = new THREE.CanvasTexture(cv));
  }
  function light(color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, fog: false, depthWrite: false, transparent: true, sizeAttenuation: false, blending: THREE.AdditiveBlending }));
    s.scale.set(0.016, 0.016, 1); return s;
  }

  function buildShip(type) {
    const g = new THREE.Group(); let L, B, mast;
    const grey = mat('#8a949c'), white = mat('#e8e8e2'), dark = mat('#2b2f33');
    if (type === 'carrier') {
      L = 330; B = 40; mast = 60;
      g.add(new THREE.Mesh(hullGeo(L, B, 20), grey));
      box(g, 76, 3, L * 0.98, 4, 14, 0, mat('#5f676d'));
      box(g, 12, 22, 40, 30, 17, 20, grey); box(g, 2, 20, 2, 30, 39, 20, dark);
    } else if (type === 'warship') {
      L = 155; B = 20; mast = 42;
      g.add(new THREE.Mesh(hullGeo(L, B, 10), grey));
      box(g, 14, 12, 40, 0, 7, -5, grey); box(g, 9, 7, 16, 0, 19, -10, grey); box(g, 5, 8, 8, 0, 7, 30, grey);
      box(g, 1.5, 20, 1.5, 0, 26, -8, dark); box(g, 4, 3, 6, 0, 7, -50, grey);
    } else if (type === 'tanker') {
      L = 240; B = 42; mast = 42;
      g.add(new THREE.Mesh(hullGeo(L, B, 14), mat('#7b2a22')));
      box(g, B * 0.9, 1.5, L * 0.7, 0, 10, -20, mat('#6e6e5e'));
      box(g, 30, 20, 20, 0, 10, 95, white); box(g, 6, 12, 6, 0, 30, 102, mat('#b33'));
      box(g, 1.2, 25, 1.2, 0, 10, -100, dark);
    } else if (type === 'fishing') {
      L = 28; B = 7; mast = 11;
      g.add(new THREE.Mesh(hullGeo(L, B, 3.5), mat('#2f4d7a')));
      box(g, 5, 3, 7, 0, 2.4, -3, white); box(g, 0.4, 8, 0.4, 0, 2.4, -8, dark);
    } else if (type === 'sail') {
      L = 13; B = 4; mast = 17;
      g.add(new THREE.Mesh(hullGeo(L, B, 1.6), white));
      box(g, 0.25, 16, 0.25, 0, 1, -1, dark);
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 15); sh.lineTo(5.5, 0); sh.closePath();
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: '#f4f1e6', side: THREE.DoubleSide }));
      sail.rotation.y = -Math.PI / 2; sail.position.set(0, 2, -1); g.add(sail);
    } else { // merchant / container ship
      L = 200; B = 32; mast = 45;
      g.add(new THREE.Mesh(hullGeo(L, B, 14), mat('#1f3a57')));
      const cols = ['#b5452f', '#2f6f8f', '#c9a13b', '#5f7d3a', '#8a8a8a'];
      for (let i = 0; i < 7; i++) box(g, B * 0.85, 6 + (i % 3) * 3, 18, 0, 10, -70 + i * 20, mat(cols[i % cols.length]));
      box(g, 26, 22, 16, 0, 10, 78, white); box(g, 5, 10, 5, 0, 32, 88, dark);
      box(g, 1.2, 28, 1.2, 0, 10, -92, dark);
    }
    // wake
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(B * 1.3, L * 1.6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false }));
    wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.4, L / 2 + L * 0.8); g.add(wake);
    const lights = { mast: light('#fffbe6'), port: light('#ff3b30'), stbd: light('#34ff6a'), stern: light('#fffbe6') };
    lights.mast.position.set(0, mast, -L * 0.2); lights.port.position.set(-B / 2, mast * 0.4, -L * 0.05);
    lights.stbd.position.set(B / 2, mast * 0.4, -L * 0.05); lights.stern.position.set(0, mast * 0.25, L / 2);
    Object.values(lights).forEach(l => g.add(l));
    return { group: g, L, mast, lights, wake };
  }

  class Bridge {
    constructor(pane) {
      this.pane = pane; this.host = pane.querySelector('.three-host');
      this.tape = pane.querySelector('canvas.tape'); this.tctx = this.tape.getContext('2d');
      this.labelsEl = pane.querySelector('.labels'); this.hud = pane.querySelector('.hud');
      this.yaw = 0; this.pitch = -1.5; this.fov = 55; this.binos = false; this.showLabels = true; this.models = {};
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
      } catch (e) { this.host.innerHTML = '<p class="nogl">3D view needs WebGL, which this device has turned off.</p>'; return; }
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.host.appendChild(this.renderer.domElement);
      const sc = this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.5, 150000); this.camera.rotation.order = 'YXZ';
      this.camera.position.set(0, EYE, 0);
      this.hemi = new THREE.HemisphereLight('#ffffff', '#335566', 1); sc.add(this.hemi);
      this.sun = new THREE.DirectionalLight('#fff4e0', 0.8); this.sun.position.set(-3000, 4000, -2000); sc.add(this.sun);
      sc.fog = new THREE.Fog('#bcd3de', 3000, 60000);
      // sky
      this.skyCv = document.createElement('canvas'); this.skyCv.width = 4; this.skyCv.height = 256;
      this.skyTex = new THREE.CanvasTexture(this.skyCv);
      const sky = new THREE.Mesh(new THREE.SphereGeometry(120000, 32, 16), new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1; sc.add(sky);
      // ocean
      const oc = document.createElement('canvas'); oc.width = oc.height = 256; const ox = oc.getContext('2d');
      ox.fillStyle = '#9aa7ad'; ox.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) { ox.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '20,40,60'},${Math.random() * 0.25})`; ox.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 14, 1 + Math.random() * 2); }
      this.oceanTex = new THREE.CanvasTexture(oc); this.oceanTex.wrapS = this.oceanTex.wrapT = THREE.RepeatWrapping; this.oceanTex.repeat.set(900, 900);
      this.oceanMat = new THREE.MeshPhongMaterial({ color: '#2d5f78', map: this.oceanTex, shininess: 40, specular: '#445566' });
      const ocean = new THREE.Mesh(new THREE.PlaneGeometry(240000, 240000), this.oceanMat); ocean.rotation.x = -Math.PI / 2; sc.add(ocean);
      this.tile = 240000 / 900;
      // own ship forecastle
      const own = this.ownGroup = new THREE.Group();
      const deck = new THREE.Mesh(hullGeo(160, 20, 13), mat('#7c878f')); deck.position.z = -55; own.add(deck);
      box(own, 20.2, 0.3, 150, 0, 9.1, -55, mat('#4c555c'));
      box(own, 5, 3.5, 7, 0, 9.2, -95, mat('#7c878f')); box(own, 0.6, 0.6, 9, 0, 11.4, -103, mat('#2b2f33'));
      box(own, 12, 6, 14, 0, 9.2, -30, mat('#7c878f'));
      box(own, 0.3, 7, 0.3, 0, 9.2, -134, mat('#2b2f33'));
      sc.add(own);
      new ResizeObserver(() => this.resize()).observe(this.host);
      this.resize(); this.setLight(MB.sim.light);
      // Look-around drag
      const el = this.renderer.domElement; let drag = null;
      el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const hf = this.hfov(), px = hf / this.w;
        this.yaw = n360(this.yaw - (e.clientX - drag.x) * px); this.pitch = Math.max(-35, Math.min(20, this.pitch + (e.clientY - drag.y) * px));
        drag = { x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointerup', () => (drag = null));
      el.addEventListener('wheel', e => { e.preventDefault(); this.fov = Math.max(5, Math.min(75, this.fov * (e.deltaY > 0 ? 1.1 : 0.9))); this.binos = this.fov < 20; this.applyFov(); }, { passive: false });
    }
    ok() { return !!this.renderer; }
    hfov() { return 2 * Math.atan(Math.tan(this.camera.fov * D2R / 2) * this.camera.aspect) / D2R; }
    resize() {
      if (!this.renderer) return;
      const r = this.host.getBoundingClientRect(); this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.renderer.setSize(this.w, this.h); this.camera.aspect = this.w / this.h; this.camera.updateProjectionMatrix();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.tape.width = this.w * dpr; this.tape.height = 34 * dpr; this.tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    applyFov() { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    toggleBinos() { this.binos = !this.binos; this.fov = this.binos ? 7 : 55; this.applyFov(); }
    lookAt(trueBrg) { const o = MB.own(); if (o) this.yaw = n360(trueBrg - o.course); this.pitch = -0.3; }
    setLight(name) {
      if (!this.renderer) return;
      const L = LIGHTS[name] || LIGHTS.day; this.lightCfg = L;
      const x = this.skyCv.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, L.zen); gr.addColorStop(0.49, L.hor); gr.addColorStop(0.51, L.fog); gr.addColorStop(1, L.sea);
      x.fillStyle = gr; x.fillRect(0, 0, 4, 256); this.skyTex.needsUpdate = true;
      this.scene.fog.color.set(L.fog); this.scene.fog.far = L.far; this.scene.fog.near = L.far * 0.05;
      this.hemi.intensity = L.hemi; this.sun.intensity = L.sun; this.oceanMat.color.set(L.sea);
      this.renderer.setClearColor(L.fog);
    }
    sync() {
      const ships = MB.sim.ships, own = MB.own(), ids = new Set(ships.map(s => s.id));
      for (const id of Object.keys(this.models)) if (!ids.has(id) || this.models[id].ship.role === 'own' || this.models[id].type !== this.models[id].ship.type) {
        this.scene.remove(this.models[id].group); this.models[id].label.remove(); delete this.models[id];
      }
      for (const s of ships) {
        if (s === own || this.models[s.id]) continue;
        const m = buildShip(s.type); m.ship = s; m.type = s.type;
        m.label = document.createElement('button'); m.label.className = 'blabel'; m.label.type = 'button';
        m.label.addEventListener('click', () => this.lookAt(brg(sub(s, MB.own()))));
        this.labelsEl.appendChild(m.label);
        this.scene.add(m.group); this.models[s.id] = m;
      }
      for (const id in this.models) this.models[id].ship = ships.find(s => s.id === id);
    }
    render() {
      if (!this.renderer) return;
      const own = MB.own(); if (!own) return;
      this.sync();
      const L = this.lightCfg;
      this.ownGroup.rotation.y = -own.course * D2R;
      this.camera.rotation.y = -(own.course + this.yaw) * D2R; this.camera.rotation.x = this.pitch * D2R;
      // ocean scroll to convey own-ship motion
      this.oceanTex.offset.set((own.x * NM / this.tile) % 1, (own.y * NM / this.tile) % 1);
      const now = performance.now() / 1000;
      for (const id in this.models) {
        const m = this.models[id], s = m.ship, rel = sub(s, own), d = len(rel) * NM;
        const drop = d * d / (2 * R_EFF);
        m.group.position.set(rel.x * NM, -drop + Math.sin(now * 0.8 + d) * 0.3, -rel.y * NM);
        m.group.rotation.y = -s.course * D2R;
        m.wake.material.opacity = Math.min(0.45, s.speed / 40); m.wake.visible = s.speed > 0.5;
        // Navigation-light arcs as seen from own ship
        const rb = n360(brg(sub(own, s)) - s.course);
        m.lights.mast.visible = L.nav && (rb <= 112.5 || rb >= 247.5);
        m.lights.stbd.visible = L.nav && rb <= 112.5; m.lights.port.visible = L.nav && rb >= 247.5;
        m.lights.stern.visible = L.nav && rb > 112.5 && rb < 247.5;
        // Label
        const top = new THREE.Vector3(m.group.position.x, m.group.position.y + m.mast * 1.1, m.group.position.z).project(this.camera);
        const visible = drop < m.mast && d < L.far * 0.9;
        if (this.showLabels && visible && top.z < 1 && Math.abs(top.x) < 1.05 && Math.abs(top.y) < 1.1) {
          m.label.hidden = false;
          m.label.style.transform = `translate(${(top.x + 1) / 2 * this.w}px, ${(1 - top.y) / 2 * this.h}px) translate(-50%, -100%)`;
          m.label.textContent = `${s.name} · ${pad3(brg(rel))}° · ${(d / NM).toFixed(1)} nm`;
        } else m.label.hidden = true;
      }
      this.renderer.render(this.scene, this.camera);
      this.drawTape(own);
    }
    drawTape(own) {
      const c = this.tctx, w = this.w, hdg = n360(own.course + this.yaw), hf = this.hfov(), ppd = w / hf;
      c.clearRect(0, 0, w, 34); c.fillStyle = 'rgba(6,14,20,0.62)'; c.fillRect(0, 0, w, 34);
      c.strokeStyle = 'rgba(230,240,245,0.8)'; c.fillStyle = 'rgba(230,240,245,0.92)'; c.textAlign = 'center'; c.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      const step = hf > 40 ? 5 : 1, lab = hf > 40 ? 15 : hf > 12 ? 5 : 1;
      const start = Math.floor((hdg - hf / 2) / step) * step;
      for (let d = start; d <= hdg + hf / 2; d += step) {
        const x = w / 2 + (d - hdg) * ppd, dn = n360(d), major = dn % lab === 0;
        c.beginPath(); c.moveTo(x, 34); c.lineTo(x, major ? 22 : 28); c.stroke();
        if (major) c.fillText(dn % 90 === 0 ? ['N', 'E', 'S', 'W'][dn / 90] : pad3(dn), x, 13);
      }
      // own heading marker
      const hx = w / 2 + (((own.course - hdg + 540) % 360) - 180) * ppd;
      if (hx > 0 && hx < w) { c.fillStyle = '#ffc15e'; c.beginPath(); c.moveTo(hx - 5, 34); c.lineTo(hx + 5, 34); c.lineTo(hx, 27); c.fill(); }
      c.fillStyle = '#ffc15e'; c.fillRect(w / 2 - 1, 18, 2, 16);
      // HUD
      const w2 = MB.sim.wind; let wind = '';
      if (w2.speed > 0) {
        const a = sub(MB.vec(w2.from + 180, w2.speed), MB.velOf(own));
        wind = ` · <span>Wind over deck ${pad3(n360(brg(a) + 180 - own.course))}°R ${len(a).toFixed(0)} kts</span>`;
      }
      this.hud.innerHTML = `<span>Looking ${pad3(hdg)}°T (${pad3(this.yaw)}°R)</span> · <span>${this.binos ? 'Binoculars 7×' : 'Naked eye'}</span>${wind}`;
    }
  }
  MB.Bridge = Bridge;
})(window.MB);
