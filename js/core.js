// Core math, formatting and the real-time ship simulation.
// Conventions: positions in nautical miles, x = east, y = north.
// Directions are degrees true, measured clockwise from north. Velocities in knots.
window.MB = window.MB || {};
(function (MB) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const YD_PER_NM = 2000; // tactical convention (3-minute rule)

  const n360 = a => ((a % 360) + 360) % 360;
  const V = (x, y) => ({ x, y });
  const vec = (dir, mag) => ({ x: mag * Math.sin(dir * D2R), y: mag * Math.cos(dir * D2R) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = a => Math.hypot(a.x, a.y);
  const brg = v => n360(Math.atan2(v.x, v.y) * R2D);
  const unit = v => { const l = len(v); return l ? mul(v, 1 / l) : V(0, 0); };
  const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

  const pad3 = b => String(n360(Math.round(b)) % 360).padStart(3, '0');
  const fmtClock = (sec, withSec) => {
    const s = Math.round(((sec % 86400) + 86400) % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const hm = String(h).padStart(2, '0') + String(m).padStart(2, '0');
    return withSec ? hm + ':' + String(ss).padStart(2, '0') : hm;
  };
  const parseClock = str => {
    const d = String(str).replace(/[^0-9]/g, '');
    if (d.length < 3 || d.length > 4) return NaN;
    const v = d.padStart(4, '0'), h = +v.slice(0, 2), m = +v.slice(2);
    if (h > 23 || m > 59) return NaN;
    return h * 3600 + m * 60;
  };
  const clockDiffMin = (a, b) => { let d = ((a - b) % 86400 + 86400) % 86400; if (d > 43200) d -= 86400; return Math.abs(d) / 60; };

  const rI = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const rF = (a, b, dp = 1) => +(a + Math.random() * (b - a)).toFixed(dp);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const round = (v, dp = 0) => +v.toFixed(dp);

  // ---- Relative-motion solvers (shared by problems and the free solver) ----
  // CPA of a point at `rel` moving with relative velocity `vr` (kts). t in hours.
  function cpaOf(rel, vr) {
    const v2 = dot(vr, vr);
    const t = v2 < 1e-9 ? 0 : -dot(rel, vr) / v2;
    const pos = add(rel, mul(vr, t));
    return { t, pos, rng: len(pos), brg: brg(pos) };
  }
  // Maneuvering unit moves from relative position r1 to r2 (relative to reference with velocity vR)
  // at speed S. Returns the maneuvering unit's true velocity, SRM, and time (h).
  function stationSpeed(r1, r2, vR, S) {
    const d = sub(r2, r1), dist = len(d);
    if (dist < 1e-6) return { error: 'The two positions are the same.' };
    const u = unit(d), b = dot(vR, u);
    const disc = b * b - dot(vR, vR) + S * S;
    if (disc < 0) return { error: 'Speed ' + S + ' kts is too slow to reach that position.' };
    const k = -b + Math.sqrt(disc);
    if (k <= 0.05) return { error: 'Speed ' + S + ' kts is too slow to reach that position.' };
    const vM = add(vR, mul(u, k));
    return { vM, course: brg(vM), speed: S, srm: k, drm: brg(u), dist, hours: dist / k };
  }
  function stationTime(r1, r2, vR, hours) {
    const d = sub(r2, r1), dist = len(d);
    if (hours <= 0) return { error: 'Time must be positive.' };
    const k = dist / hours, u = unit(d);
    const vM = add(vR, mul(u, k));
    return { vM, course: brg(vM), speed: len(vM), srm: k, drm: brg(u), dist, hours };
  }
  function minSpeed(r1, r2, vR) {
    const d = sub(r2, r1), dist = len(d), u = unit(d);
    const k = -dot(vR, u);
    if (k <= 0.05) return { error: 'The reference is moving toward the new position; any speed works, so there is no minimum.' };
    const vM = add(vR, mul(u, k));
    return { vM, course: brg(vM), speed: len(vM), srm: k, drm: brg(u), dist, hours: dist / k };
  }
  // Own-ship courses (at speed S) that make a contact at `rel` (velocity vC) pass at exactly D.
  function avoidCourse(rel, vC, S, D) {
    const R = len(rel); if (R <= D) return [];
    const phi = brg(mul(rel, -1)), a = Math.asin(D / R) * R2D, out = [];
    for (const th of [phi + a, phi - a]) {
      const u = vec(th, 1), b = dot(vC, u), disc = b * b - dot(vC, vC) + S * S;
      if (disc < 0) continue;
      for (const k of [b + Math.sqrt(disc), b - Math.sqrt(disc)]) {
        if (k > 0.1) { const vO = sub(vC, mul(u, k)); out.push({ vO, course: brg(vO), drm: n360(th), srm: k }); }
      }
    }
    return out;
  }
  // Own-ship speeds (on fixed course) that make the contact pass at exactly D.
  function avoidSpeed(rel, vC, course, D) {
    const R = len(rel); if (R <= D) return [];
    const phi = brg(mul(rel, -1)), a = Math.asin(D / R) * R2D, c = vec(course, 1), out = [];
    for (const th of [phi + a, phi - a]) {
      const t = vec(th, 1), den = cross(c, t);
      if (Math.abs(den) < 1e-6) continue;
      const s = cross(vC, t) / den, k = cross(c, vC) / den;
      if (k > 0.1 && s >= 0) out.push({ speed: s, drm: n360(th), srm: k, vO: mul(c, s) });
    }
    return out;
  }

  Object.assign(MB, {
    D2R, R2D, YD_PER_NM, n360, V, vec, add, sub, mul, dot, cross, len, brg, unit, angDiff,
    pad3, fmtClock, parseClock, clockDiffMin, rI, rF, pick, round,
    cpaOf, stationSpeed, stationTime, minSpeed, avoidCourse, avoidSpeed,
  });

  // ---- Event bus ----
  const listeners = {};
  MB.on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  MB.emit = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));

  // ---- Simulation ----
  const sim = MB.sim = {
    t: 8 * 3600, running: false, rate: 1, realistic: false,
    wind: { from: 0, speed: 0 }, light: 'day',
    ships: [], history: [], nextId: 1, lastSample: -1e9,
  };
  const TURN_RATE = 1.2;   // deg per second (realistic helm)
  const ACCEL = 0.06;      // knots per second

  MB.makeShip = function (o) {
    const s = Object.assign({
      id: 'S' + (sim.nextId++), name: 'Contact', type: 'merchant', role: 'contact',
      x: 0, y: 0, course: 0, speed: 0, maneuvers: [],
    }, o);
    if (s.ordCourse == null) s.ordCourse = s.course;
    if (s.ordSpeed == null) s.ordSpeed = s.speed;
    s.maneuvers = (s.maneuvers || []).slice().sort((a, b) => a.t - b.t);
    return s;
  };
  MB.own = () => sim.ships.find(s => s.role === 'own');
  MB.guide = () => sim.ships.find(s => s.role === 'guide');
  MB.shipById = id => sim.ships.find(s => s.id === id);

  MB.relOf = (ship, ref) => { ref = ref || MB.own(); return sub(ship, ref); };
  MB.velOf = s => vec(s.course, s.speed);

  MB.setScenario = function (sc) {
    sim.t = sc.t != null ? sc.t : 8 * 3600;
    sim.ships = sc.ships.map(MB.makeShip);
    if (sc.wind) sim.wind = Object.assign({}, sc.wind);
    if (sc.light) sim.light = sc.light;
    sim.realistic = !!sc.realistic;
    // Re-centre so own ship starts at the origin
    const own = MB.own();
    if (own) { const ox = own.x, oy = own.y; sim.ships.forEach(s => { s.x -= ox; s.y -= oy; }); }
    sim.history = []; sim.lastSample = -1e9;
    sample(true);
    MB.emit('scenario');
  };

  MB.orderShip = function (ship, course, speed) {
    if (course != null && !isNaN(course)) { ship.ordCourse = n360(course); if (!sim.realistic) ship.course = ship.ordCourse; }
    if (speed != null && !isNaN(speed)) { ship.ordSpeed = Math.max(0, speed); if (!sim.realistic) ship.speed = ship.ordSpeed; }
    MB.emit('ships');
  };
  MB.addManeuver = function (ship, m) { ship.maneuvers.push(m); ship.maneuvers.sort((a, b) => a.t - b.t); };

  function sample(force) {
    if (!force && sim.t - sim.lastSample < 20) return;
    sim.lastSample = sim.t;
    const p = {};
    sim.ships.forEach(s => (p[s.id] = { x: s.x, y: s.y }));
    sim.history.push({ t: sim.t, p });
    if (sim.history.length > 720) sim.history.shift();
  }

  function integrate(dt) {
    for (const s of sim.ships) {
      if (sim.realistic) {
        const diff = ((s.ordCourse - s.course + 540) % 360) - 180;
        // With a tactical diameter (yds) the turn rate follows from speed: ω = V / R
        const rate = s.td ? Math.max(0.2, (s.speed * 0.5144) / (s.td * 0.9144 / 2) * R2D) : TURN_RATE;
        const maxT = rate * dt;
        s.course = n360(s.course + Math.max(-maxT, Math.min(maxT, diff)));
        const ds = s.ordSpeed - s.speed, maxA = ACCEL * dt;
        s.speed += Math.max(-maxA, Math.min(maxA, ds));
      } else { s.course = s.ordCourse; s.speed = s.ordSpeed; }
      s.x += s.speed * Math.sin(s.course * D2R) * dt / 3600;
      s.y += s.speed * Math.cos(s.course * D2R) * dt / 3600;
    }
    sim.t += dt;
  }
  function applyDue() {
    let changed = false;
    for (const s of sim.ships) {
      while (s.maneuvers.length && s.maneuvers[0].t <= sim.t + 1e-6) {
        const m = s.maneuvers.shift();
        if (m.course != null) s.ordCourse = n360(m.course);
        if (m.speed != null) s.ordSpeed = m.speed;
        if (!sim.realistic) { s.course = s.ordCourse; s.speed = s.ordSpeed; }
        changed = true;
      }
    }
    if (changed) MB.emit('ships');
  }
  // Advance by dt seconds, splitting at scheduled maneuvers so executions are exact.
  MB.advance = function (dt) {
    let remaining = dt;
    applyDue();
    while (remaining > 1e-9) {
      let next = Infinity;
      for (const s of sim.ships) if (s.maneuvers.length) next = Math.min(next, s.maneuvers[0].t);
      let step = Math.min(remaining, next - sim.t, 5);
      if (step <= 1e-9) step = Math.min(remaining, 5);
      integrate(step); remaining -= step;
      applyDue(); sample(false);
    }
    // Keep own ship at the origin to preserve precision on long runs
    const own = MB.own();
    if (own && (Math.abs(own.x) > 50 || Math.abs(own.y) > 50)) {
      const ox = own.x, oy = own.y;
      sim.ships.forEach(s => { s.x -= ox; s.y -= oy; });
      sim.history.forEach(h => Object.values(h.p).forEach(p => { p.x -= ox; p.y -= oy; }));
    }
  };

  // Relative-motion history of `ship` relative to `ref` over the last `minutes`.
  MB.relTrail = function (ship, ref, minutes) {
    const out = [], since = sim.t - minutes * 60;
    for (const h of sim.history) {
      if (h.t < since) continue;
      const a = h.p[ship.id], b = h.p[ref.id];
      if (a && b) out.push({ t: h.t, x: a.x - b.x, y: a.y - b.y });
    }
    return out;
  };

  MB.cpaData = function (ship, ref) {
    ref = ref || MB.own();
    const rel = sub(ship, ref), vr = sub(MB.velOf(ship), MB.velOf(ref));
    const c = cpaOf(rel, vr);
    return { brg: brg(rel), rng: len(rel), cpaRng: c.rng, cpaBrg: c.brg, tcpaMin: c.t * 60, drm: brg(vr), srm: len(vr) };
  };
})(window.MB);
