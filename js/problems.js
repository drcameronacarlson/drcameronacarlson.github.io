// Problem engine. Each problem type defines its inputs, a random generator, an exact solver
// (worked steps + maneuvering-board overlay), a live scenario, and how to execute an answer.
// Adding a new maneuvering-board problem = adding one def() block.
(function (MB) {
  const { V, vec, add, sub, mul, len, brg, unit, n360, pad3, fmtClock, rI, rF, pick, round,
    cpaOf, angDiff, clockDiffMin, stationSpeed, stationTime, minSpeed, avoidCourse, avoidSpeed } = MB;
  const YD = MB.YD_PER_NM;
  const O = V(0, 0);

  const KIND = {
    crs: { unit: '°T', tol: 3, fmt: v => pad3(v) },
    brg: { unit: '°T', tol: 3, fmt: v => pad3(v) },
    rel: { unit: '°R', tol: 3, fmt: v => pad3(v) },
    spd: { unit: 'kts', tol: 1, fmt: v => String(round(v, 1)) },
    nm: { unit: 'nm', tol: 0.3, fmt: v => (+v).toFixed(1) },
    yd: { unit: 'yds', tol: 200, fmt: v => String(Math.round(v / 10) * 10) },
    clock: { unit: 'hhmm', tol: 3, fmt: v => fmtClock(v) },
    min: { unit: 'min', tol: 3, fmt: v => String(round(v, 1)) },
    int: { unit: '', tol: 0, fmt: v => String(v) },
  };
  MB.KIND = KIND;
  const F = (key, label, kind, o) => Object.assign({ key, label, kind }, o || {});

  // Text helpers for statements and steps
  const B = v => pad3(v) + '°';
  const R = v => pad3(v) + '° relative';
  const K = v => round(v, 1) + ' kts';
  const N = v => (+v).toFixed(1) + ' nm';
  const Y = v => Math.round(v).toLocaleString('en-US') + ' yds';
  const C = v => fmtClock(v);
  const M = h => round(h * 60, 1) + ' min';
  const b = s => '<b>' + s + '</b>';

  MB.parseField = function (kind, raw) {
    if (raw == null || String(raw).trim() === '') return NaN;
    if (kind === 'clock') return MB.parseClock(raw);
    return Number(String(raw).replace(/[^0-9.\-]/g, ''));
  };
  MB.formatField = (kind, v) => (v == null || isNaN(v) ? '' : KIND[kind].fmt(v));

  function compare(field, expected, got) {
    if (isNaN(got)) return false;
    const tol = field.tol != null ? field.tol : KIND[field.kind].tol;
    if (field.kind === 'crs' || field.kind === 'brg' || field.kind === 'rel') return angDiff(expected, got) <= tol;
    if (field.kind === 'clock') return clockDiffMin(expected, got) <= tol;
    return Math.abs(expected - got) <= tol;
  }
  MB.gradeAnswers = function (def, inp, sol, student) {
    const custom = def.grade ? def.grade(inp, sol, student) : {};
    const out = {};
    def.answers.forEach(f => {
      if (custom[f.key]) { out[f.key] = custom[f.key]; return; }
      const exp = custom.__expected && custom.__expected[f.key] != null ? custom.__expected[f.key] : sol.ans[f.key];
      const skip = sol.skip && sol.skip[f.key];
      out[f.key] = { ok: skip ? true : compare(f, exp, student[f.key]), expected: sol.ans[f.key], note: skip || '' };
    });
    return out;
  };

  const list = [], reg = {};
  function def(p) { list.push(p); reg[p.id] = p; }
  MB.problemList = list; MB.problems = reg;
  const contactType = () => pick(['merchant', 'tanker', 'fishing', 'warship', 'merchant']);
  const tryGen = (fn) => { for (let i = 0; i < 800; i++) { const r = fn(); if (r) return r; } throw new Error('generation failed'); };

  // ============ RELATIVE MOTION ============
  const fixInputs = [
    F('osC', 'Own course', 'crs'), F('osS', 'Own speed', 'spd'),
    F('t1', 'Time of M1', 'clock'), F('b1', 'M1 bearing', 'brg'), F('r1', 'M1 range', 'nm'),
    F('t2', 'Time of M2', 'clock'), F('b2', 'M2 bearing', 'brg'), F('r2', 'M2 range', 'nm'),
  ];
  function genFixes(accept, extra) {
    return tryGen(() => {
      const osC = rI(0, 71) * 5, osS = rI(10, 20), cC = rI(0, 359), cS = rI(6, 24);
      const t1 = 8 * 3600 + rI(0, 10) * 360, dm = pick([6, 6, 9, 12]), t2 = t1 + dm * 60;
      const b2 = rI(0, 359), r2 = rF(6, 11, 1);
      const vr = sub(vec(cC, cS), vec(osC, osS)), rel2 = vec(b2, r2), rel1 = sub(rel2, mul(vr, dm / 60));
      const inp = Object.assign({ osC, osS, t1, b1: Math.round(brg(rel1)), r1: round(len(rel1), 1), t2, b2, r2 }, extra ? extra() : {});
      const s = solveFixes(inp);
      return !s.error && accept(inp, s) ? inp : null;
    });
  }
  function solveFixes(inp) {
    const rel1 = vec(inp.b1, inp.r1), rel2 = vec(inp.b2, inp.r2), dh = (inp.t2 - inp.t1) / 3600;
    if (!(dh > 0)) return { error: 'The time of M2 must be after M1.' };
    const vr = mul(sub(rel2, rel1), 1 / dh), srm = len(vr);
    if (srm < 0.2) return { error: 'Bearing and range are steady: the contact is on your course and speed, so there is no relative motion.' };
    const c = cpaOf(rel2, vr), vO = vec(inp.osC, inp.osS), vC = add(vO, vr);
    return { rel1, rel2, vr, srm, drm: brg(vr), c, vO, vC, dh, cpaTime: inp.t2 + c.t * 3600 };
  }
  function rmlEnd(from, vr, cpaPos) { return add(cpaPos, mul(unit(vr), Math.max(1.5, len(sub(cpaPos, from)) * 0.35))); }
  function fixSteps(inp, s) {
    const d = len(sub(s.rel2, s.rel1));
    const out = [
      `Plot M1 (${B(inp.b1)}, ${N(inp.r1)}) at ${C(inp.t1)} and M2 (${B(inp.b2)}, ${N(inp.r2)}) at ${C(inp.t2)}. The line M1→M2 is the relative motion line (RML).`,
      `DRM is the direction from M1 to M2: ${b(B(s.drm))}. M1→M2 measures ${N(d)} in ${M(s.dh)}, so SRM = ${round(d, 2)} ÷ ${round(s.dh, 3)} h = ${b(K(s.srm))}.`,
      `Extend the RML past the center. The perpendicular from own ship to the RML marks the CPA: ${b(B(s.c.brg) + ' at ' + N(s.c.rng))}.`,
      s.c.t >= 0
        ? `M2→CPA is ${N(s.srm * s.c.t)}; at ${K(s.srm)} that takes ${M(s.c.t)}, so CPA occurs at ${b(C(s.cpaTime))}.`
        : `CPA was ${M(-s.c.t)} before M2 (at ${b(C(s.cpaTime))}); the contact is already opening.`,
      `Speed triangle: draw e→r as own ship (${B(inp.osC)}, ${K(inp.osS)}). From r lay off r→m parallel to the DRM, ${K(s.srm)} long. e→m is the contact's true course and speed: ${b(B(brg(s.vC)) + ' at ' + K(len(s.vC)))}.`,
    ];
    return out;
  }
  // `st` maps overlay parts to the worked-solution step that draws them (for step-by-step hints).
  function fixOverlay(inp, s, extra, st) {
    st = Object.assign({ pts: 0, cpa: 2, vec: 4 }, st || {});
    const o = {
      center: 'own', centerLabel: 'OS', distUnit: 'nm',
      points: [{ p: s.rel1, label: 'M1 ' + C(inp.t1), s: st.pts }, { p: s.rel2, label: 'M2 ' + C(inp.t2), s: st.pts }, { p: s.c.pos, label: 'CPA', s: st.cpa }],
      lines: [{ a: s.rel1, b: rmlEnd(s.rel1, s.vr, s.c.pos), kind: 'rml', s: st.pts }, { a: O, b: s.c.pos, kind: 'aux', s: st.cpa }],
      vectors: [{ a: O, b: s.vO, kind: 'own', label: 'r', s: st.vec }, { a: s.vO, b: s.vC, kind: 'rel', label: 'm', s: st.vec }, { a: O, b: s.vC, kind: 'other', s: st.vec }],
    };
    if (extra) { o.points.push(...(extra.points || [])); o.lines.push(...(extra.lines || [])); o.vectors.push(...(extra.vectors || [])); }
    return o;
  }
  function fixScenario(inp, s) {
    return {
      t: inp.t2, moCenter: 'own',
      ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.osC, speed: inp.osS },
        { name: 'Skunk A', type: contactType(), x: s.rel2.x, y: s.rel2.y, course: brg(s.vC), speed: len(s.vC) },
      ],
    };
  }
  const fixStatement = inp =>
    `Own ship is on course ${B(inp.osC)} at ${K(inp.osS)}. Radar reports Skunk A:<br>` +
    `<span class="fix">${C(inp.t1)} — ${B(inp.b1)}, ${N(inp.r1)}</span><span class="fix">${C(inp.t2)} — ${B(inp.b2)}, ${N(inp.r2)}</span>`;

  def({
    id: 'cpa', group: 'Relative motion', title: 'Contact analysis & CPA',
    blurb: 'Two radar fixes → DRM, SRM, CPA and the contact\'s true course and speed.',
    inputs: fixInputs,
    answers: [F('drm', 'DRM', 'brg'), F('srm', 'SRM', 'spd'), F('cpaBrg', 'CPA bearing', 'brg'), F('cpaRng', 'CPA range', 'nm'),
      F('cpaTime', 'Time of CPA', 'clock'), F('cCrs', 'Contact course', 'crs', { tol: 4 }), F('cSpd', 'Contact speed', 'spd', { tol: 1.5 })],
    generate: () => genFixes((i, s) => s.c.rng < 5 && s.c.t * 60 > 10 && s.c.t * 60 < 60 && s.srm > 5),
    solve(inp) {
      const s = solveFixes(inp); if (s.error) return s;
      return {
        ans: { drm: s.drm, srm: s.srm, cpaBrg: s.c.brg, cpaRng: s.c.rng, cpaTime: s.cpaTime, cCrs: brg(s.vC), cSpd: len(s.vC) },
        skip: s.c.rng < 0.25 ? { cpaBrg: 'Collision course — CPA bearing is undefined.' } : null,
        steps: fixSteps(inp, s), overlay: fixOverlay(inp, s), raw: s,
      };
    },
    statement: inp => fixStatement(inp) + `Find the DRM, SRM, CPA (bearing, range, time) and Skunk A's course and speed.`,
    scenario: (inp, sol) => fixScenario(inp, sol.raw),
    lesson: {
      summary: 'The basic radar plot. Two timed positions of a contact define its relative motion; add your own vector and the speed triangle gives its true motion.',
      keys: ['RML: the line through successive plotted positions.', 'DRM/SRM: direction and speed along the RML.', 'CPA: foot of the perpendicular from the center to the RML.', 'e→r is own ship, r→m parallels the RML, e→m is the contact.'],
    },
  });

  def({
    id: 'avoid_course', group: 'Relative motion', title: 'Course to pass at a set distance',
    blurb: 'Keep speed and choose a new course so the contact passes at the CPA the CO orders.',
    inputs: [...fixInputs, F('D', 'Desired CPA', 'nm')],
    answers: [F('course', 'New course', 'crs'), F('drm', 'New DRM', 'brg'), F('srm', 'New SRM', 'spd'), F('cpaTime', 'New CPA time', 'clock')],
    generate: () => genFixes((inp, s) => {
      if (!(s.c.rng < inp.D - 0.6 && s.c.t * 60 > 15 && s.c.t * 60 < 50 && inp.r2 > inp.D + 2)) return false;
      const r = reg.avoid_course.solve(inp); return !r.error && r.ans.srm >= 4;
    }, () => ({ D: pick([2, 2.5, 3, 3.5]) })),
    solve(inp) {
      const s = solveFixes(inp); if (s.error) return s;
      const sols = avoidCourse(s.rel2, s.vC, inp.osS, inp.D);
      if (!sols.length) return { error: `No course at ${K(inp.osS)} opens the CPA to ${N(inp.D)}.` };
      const turn = c => n360(c - inp.osC);
      const stb = sols.filter(x => turn(x.course) > 0.5 && turn(x.course) < 180).sort((a, b2) => turn(a.course) - turn(b2.course));
      const port = sols.filter(x => turn(x.course) >= 180).sort((a, b2) => turn(b2.course) - turn(a.course));
      const best = stb[0] || port[0], dir = stb[0] ? 'starboard' : 'port';
      const vrN = sub(s.vC, best.vO), cN = cpaOf(s.rel2, vrN);
      const tangentEnd = add(s.rel2, mul(unit(vrN), len(s.rel2) * 1.3));
      return {
        dir, best, raw: s,
        ans: { course: best.course, drm: best.drm, srm: best.srm, cpaTime: inp.t2 + cN.t * 3600 },
        steps: [...fixSteps(inp, s).slice(0, 2), fixSteps(inp, s)[4],
          `Draw a circle of ${N(inp.D)} around own ship. From M2, draw the new RML tangent to that circle so the contact passes on the correct side: new DRM ${b(B(best.drm))}.`,
          `In the speed triangle, keep m fixed (contact is not maneuvering). Draw a line through m parallel to the new DRM, back toward the ${K(inp.osS)} circle; where it cuts the circle is the new r.`,
          `e→r is the new own-ship course: ${b(B(best.course))} (a turn to ${dir}). The new r→m measures SRM ${b(K(best.srm))}, and the contact reaches CPA at ${b(C(inp.t2 + cN.t * 3600))}.`],
        overlay: fixOverlay(inp, s, {
          points: [{ p: cN.pos, label: 'New CPA', s: 5 }],
          lines: [{ a: s.rel2, b: tangentEnd, kind: 'rml2', s: 3 }, { a: O, b: cN.pos, kind: 'aux', s: 5 }],
          vectors: [{ a: O, b: best.vO, kind: 'own2', label: "r'", s: 4 }, { a: best.vO, b: s.vC, kind: 'rel2', s: 4 }],
          circles: [{ r: inp.D, s: 3 }],
        }, { cpa: 0, vec: 2 }),
      };
    },
    grade(inp, sol, st) {
      const s = sol.raw, out = { __expected: {} };
      if (!isNaN(st.course)) {
        const vO = vec(st.course, inp.osS), vr = sub(s.vC, vO), c = cpaOf(s.rel2, vr);
        const ok = angDiff(st.course, sol.ans.course) <= 3 || (c.t > 0 && c.rng >= inp.D - 0.2 && c.rng <= inp.D + 0.4);
        out.course = { ok, expected: sol.ans.course, note: `Your course gives a CPA of ${N(c.rng)}.` };
        if (ok) out.__expected = { drm: brg(vr), srm: len(vr), cpaTime: inp.t2 + c.t * 3600 };
      }
      return out;
    },
    statement: (inp, sol) => fixStatement(inp) + `The CO wants Skunk A to pass no closer than ${b(N(inp.D))}. Maneuvering at ${C(inp.t2)} and keeping ${K(inp.osS)}, find the new course (turn to ${sol && sol.dir || 'starboard'}), the new DRM and SRM, and the new time of CPA.`,
    scenario: (inp, sol) => fixScenario(inp, sol.raw),
    execute: (inp, sol, st) => [{ t: inp.t2, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.osS }],
    lesson: {
      summary: 'When the CPA is too close, change the relative motion line so it is tangent to a circle of the desired distance, then find the own-ship course that produces that relative motion.',
      keys: ['Solve the contact first (its e→m stays fixed).', 'New RML from the maneuver point, tangent to the CPA circle.', 'New r lies where a line through m, parallel to the new RML, crosses your speed circle.'],
    },
  });

  def({
    id: 'avoid_speed', group: 'Relative motion', title: 'Speed to pass at a set distance',
    blurb: 'Hold course and slow down so the contact passes at the ordered CPA.',
    inputs: [...fixInputs, F('D', 'Desired CPA', 'nm')],
    answers: [F('speed', 'New speed', 'spd'), F('drm', 'New DRM', 'brg'), F('srm', 'New SRM', 'spd')],
    generate: () => genFixes((inp, s) => {
      if (!(s.c.rng < inp.D - 0.6 && s.c.t * 60 > 15 && inp.r2 > inp.D + 2)) return false;
      const r = reg.avoid_speed.solve(inp); return !r.error && r.ans.speed >= 3 && r.ans.speed < inp.osS - 2 && r.ans.srm >= 4;
    }, () => ({ D: pick([2, 2.5, 3]) })),
    solve(inp) {
      const s = solveFixes(inp); if (s.error) return s;
      const sols = avoidSpeed(s.rel2, s.vC, inp.osC, inp.D).filter(x => x.speed < inp.osS).sort((a, c) => c.speed - a.speed);
      if (!sols.length) return { error: `No reduced speed on course ${B(inp.osC)} opens the CPA to ${N(inp.D)}.` };
      const best = sols[0], vrN = sub(s.vC, best.vO), cN = cpaOf(s.rel2, vrN);
      return {
        best, raw: s,
        ans: { speed: best.speed, drm: best.drm, srm: best.srm },
        steps: [...fixSteps(inp, s).slice(0, 2), fixSteps(inp, s)[4],
          `Draw the ${N(inp.D)} circle and, from M2, the new RML tangent to it: DRM ${b(B(best.drm))}.`,
          `Through m draw a line parallel to the new DRM. Where it crosses your own-course line (e→r extended along ${B(inp.osC)}) is the new r.`,
          `e→r now measures ${b(K(best.speed))}; r→m gives the new SRM ${b(K(best.srm))}.`],
        overlay: fixOverlay(inp, s, {
          points: [{ p: cN.pos, label: 'New CPA', s: 3 }],
          lines: [{ a: s.rel2, b: add(s.rel2, mul(unit(vrN), len(s.rel2) * 1.3)), kind: 'rml2', s: 3 }, { a: O, b: cN.pos, kind: 'aux', s: 3 }],
          vectors: [{ a: O, b: best.vO, kind: 'own2', label: "r'", s: 4 }, { a: best.vO, b: s.vC, kind: 'rel2', s: 4 }],
          circles: [{ r: inp.D, s: 3 }],
        }, { cpa: 0, vec: 2 }),
      };
    },
    grade(inp, sol, st) {
      const s = sol.raw, out = { __expected: {} };
      if (!isNaN(st.speed)) {
        const vO = vec(inp.osC, st.speed), vr = sub(s.vC, vO), c = cpaOf(s.rel2, vr);
        const ok = Math.abs(st.speed - sol.ans.speed) <= 1 || (c.t > 0 && c.rng >= inp.D - 0.2 && c.rng <= inp.D + 0.4);
        out.speed = { ok, expected: sol.ans.speed, note: `Your speed gives a CPA of ${N(c.rng)}.` };
        if (ok) out.__expected = { drm: brg(vr), srm: len(vr) };
      }
      return out;
    },
    statement: inp => fixStatement(inp) + `Maintaining course ${B(inp.osC)}, what reduced speed at ${C(inp.t2)} makes Skunk A pass at ${b(N(inp.D))}? Give the new DRM and SRM.`,
    scenario: (inp, sol) => fixScenario(inp, sol.raw),
    execute: (inp, sol, st) => [{ t: inp.t2, course: inp.osC, speed: isNaN(st.speed) ? sol.ans.speed : st.speed }],
    lesson: {
      summary: 'Same geometry as a course change, but r slides along your own course line instead of around the speed circle.',
      keys: ['New RML tangent to the CPA circle.', 'New r = intersection of your course line with the line through m parallel to the new RML.'],
    },
  });

  def({
    id: 'intercept', group: 'Relative motion', title: 'Intercept',
    blurb: 'Find the course to close a moving contact at a given speed, and when you arrive.',
    inputs: [F('osS', 'Own speed', 'spd'), F('cb', 'Contact bearing', 'brg'), F('cr', 'Contact range', 'nm'),
      F('cC', 'Contact course', 'crs'), F('cS', 'Contact speed', 'spd'), F('t0', 'Time now', 'clock')],
    answers: [F('course', 'Intercept course', 'crs'), F('srm', 'SRM', 'spd'), F('eta', 'Time of intercept', 'clock')],
    generate: () => tryGen(() => {
      const inp = { osS: rI(20, 30), cb: rI(0, 359), cr: rF(8, 20, 1), cC: rI(0, 71) * 5, cS: rI(8, 18), t0: 8 * 3600 + rI(0, 20) * 300 };
      const s = reg.intercept.solve(inp); return !s.error && s.ans.srm > 6 && (s.ans.eta - inp.t0) / 60 < 150 ? inp : null;
    }),
    solve(inp) {
      const rel = vec(inp.cb, inp.cr), vC = vec(inp.cC, inp.cS);
      const r = stationSpeed(mul(rel, -1), O, vC, inp.osS);
      if (r.error) return { error: `At ${K(inp.osS)} you cannot close this contact.` };
      const vO = r.vM, eta = inp.t0 + r.hours * 3600;
      return {
        ans: { course: r.course, srm: r.srm, eta },
        steps: [
          `Plot the contact at M1 (${B(inp.cb)}, ${N(inp.cr)}). To intercept, it must move relative to you straight down the bearing toward the center: DRM ${b(B(n360(inp.cb + 180)))}.`,
          `Draw e→m, the contact's vector (${B(inp.cC)}, ${K(inp.cS)}).`,
          `Through m draw a line parallel to the DRM, extended back toward the ${K(inp.osS)} circle. Where it cuts the circle is r: e→r = ${b(B(r.course))}.`,
          `r→m = SRM ${b(K(r.srm))}. Time = ${N(inp.cr)} ÷ ${K(r.srm)} = ${M(r.hours)}, intercept at ${b(C(eta))}.`],
        overlay: {
          center: 'own', centerLabel: 'OS', distUnit: 'nm',
          points: [{ p: rel, label: 'M1 ' + C(inp.t0), s: 0 }], lines: [{ a: rel, b: O, kind: 'rml', s: 0 }],
          vectors: [{ a: O, b: vC, kind: 'other', label: 'm', s: 1 }, { a: O, b: vO, kind: 'own', label: 'r', s: 2 }, { a: vO, b: vC, kind: 'rel', s: 2 }],
        },
      };
    },
    statement: inp => `At ${C(inp.t0)} a contact bears ${B(inp.cb)} at ${N(inp.cr)}, on course ${B(inp.cC)} at ${K(inp.cS)}. Using ${K(inp.osS)}, find the course to intercept, the SRM, and the time of intercept.`,
    scenario: (inp) => {
      const rel = vec(inp.cb, inp.cr);
      return { t: inp.t0, moCenter: 'own', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.cb, speed: 10 },
        { name: 'Contact', type: contactType(), x: rel.x, y: rel.y, course: inp.cC, speed: inp.cS }] };
    },
    execute: (inp, sol, st) => [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.osS }],
    lesson: {
      summary: 'Intercept is a station change where the new station is the contact itself: the RML runs from the contact straight to the center.',
      keys: ['RML = reciprocal of the contact bearing.', 'Line through m parallel to the RML; its intersection with your speed circle is r.', 'Time = range ÷ SRM.'],
    },
  });

  // ============ STATIONING ============
  const stInputs = [F('gC', 'Guide course', 'crs'), F('gS', 'Guide speed', 'spd'),
    F('b1', 'Present station bearing', 'brg'), F('r1', 'Present station range', 'nm'),
    F('b2', 'New station bearing', 'brg'), F('r2', 'New station range', 'nm')];
  function genStation(extra, accept) {
    return tryGen(() => {
      const inp = Object.assign({ gC: rI(0, 71) * 5, gS: rI(10, 18), b1: rI(0, 35) * 10, r1: rI(4, 16) / 2, b2: rI(0, 35) * 10, r2: rI(4, 16) / 2,
        t0: 8 * 3600 + rI(0, 16) * 300 }, extra());
      if (len(sub(vec(inp.b2, inp.r2), vec(inp.b1, inp.r1))) < 3) return null;
      return accept(inp) ? inp : null;
    });
  }
  function stationFrame(inp, r, how) {
    const r1 = vec(inp.b1, inp.r1), r2 = vec(inp.b2, inp.r2), vG = vec(inp.gC, inp.gS);
    const eta = inp.t0 + r.hours * 3600;
    const steps = [
      `Put the guide at the center. Plot M1, your present station (${B(inp.b1)}, ${N(inp.r1)}), and M2, the new station (${B(inp.b2)}, ${N(inp.r2)}). M1→M2 is the RML: DRM ${b(B(r.drm))}, relative distance ${N(r.dist)}.`,
      `Draw e→r, the guide's vector (${B(inp.gC)}, ${K(inp.gS)}).`,
      how,
      `e→m is your course and speed: ${b(B(r.course) + ' at ' + K(r.speed))}. SRM (r→m) = ${K(r.srm)}; time = ${N(r.dist)} ÷ ${K(r.srm)} = ${M(r.hours)}, on station at ${b(C(eta))}.`];
    const overlay = {
      center: 'guide', centerLabel: 'G', distUnit: 'nm',
      points: [{ p: r1, label: 'M1', s: 0 }, { p: r2, label: 'M2', s: 0 }], lines: [{ a: r1, b: r2, kind: 'rml', s: 0 }],
      vectors: [{ a: O, b: vG, kind: 'other', label: 'r', s: 1 }, { a: vG, b: r.vM, kind: 'rel', s: 2 }, { a: O, b: r.vM, kind: 'own', label: 'm', s: 2 }],
    };
    return { steps, overlay, eta };
  }
  function stationScenario(inp) {
    const r1 = vec(inp.b1, inp.r1);
    return { t: inp.t0, moCenter: 'guide', ships: [
      { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.gC, speed: inp.gS },
      { role: 'guide', name: 'Guide', type: 'carrier', x: -r1.x, y: -r1.y, course: inp.gC, speed: inp.gS }] };
  }
  const stStatement = inp => `The guide is on course ${B(inp.gC)} at ${K(inp.gS)}. You are on station ${B(inp.b1)}, ${N(inp.r1)} from the guide. At ${C(inp.t0)} you are ordered to a new station ${B(inp.b2)}, ${N(inp.r2)} from the guide. `;

  def({
    id: 'station_speed', group: 'Stationing', title: 'Change station at a set speed',
    blurb: 'Given the speed to use, find course and time to the new station.',
    inputs: [...stInputs, F('S', 'Speed to use', 'spd'), F('t0', 'Time of signal', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('srm', 'SRM', 'spd'), F('eta', 'Time on station', 'clock')],
    generate: () => genStation(() => ({}), inp => { inp.S = Math.min(32, inp.gS + rI(5, 12)); const s = reg.station_speed.solve(inp); return !s.error && s.ans.srm > 4; }),
    solve(inp) {
      const r = stationSpeed(vec(inp.b1, inp.r1), vec(inp.b2, inp.r2), vec(inp.gC, inp.gS), inp.S);
      if (r.error) return r;
      const f = stationFrame(inp, r, `From r draw a line parallel to the DRM. Where it cuts the ${K(inp.S)} speed circle is m.`);
      return { ans: { course: r.course, srm: r.srm, eta: f.eta }, steps: f.steps, overlay: f.overlay, raw: r };
    },
    statement: inp => stStatement(inp) + `Using ${K(inp.S)}, find the course, SRM and time you will be on station.`,
    scenario: stationScenario,
    execute: (inp, sol, st) => {
      const eta = isNaN(st.eta) ? sol.ans.eta : st.eta;
      return [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.S }, { t: eta, course: inp.gC, speed: inp.gS }];
    },
    lesson: {
      summary: 'Station changes are always solved relative to the guide: the relative plot runs from your present station to the new one, and the speed triangle converts that relative motion into a true course.',
      keys: ['Guide at the center; plot M1 → M2.', 'e→r = guide vector.', 'Line from r parallel to the DRM meets your speed circle at m.', 'Time = relative distance ÷ SRM.'],
    },
  });

  def({
    id: 'station_time', group: 'Stationing', title: 'Change station in a set time',
    blurb: 'Given the time allowed, find the course and speed.',
    inputs: [...stInputs, F('T', 'Time allowed', 'min'), F('t0', 'Time of signal', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('speed', 'Speed', 'spd'), F('srm', 'SRM', 'spd')],
    generate: () => genStation(() => ({ T: pick([12, 15, 18, 20, 24, 30]) }), inp => { const s = reg.station_time.solve(inp); return !s.error && s.ans.speed > 5 && s.ans.speed < 32; }),
    solve(inp) {
      const r = stationTime(vec(inp.b1, inp.r1), vec(inp.b2, inp.r2), vec(inp.gC, inp.gS), inp.T / 60);
      if (r.error) return r;
      const f = stationFrame(inp, r, `SRM needed = ${N(r.dist)} ÷ ${M(r.hours)} = ${K(r.srm)}. From r lay off r→m parallel to the DRM, ${K(r.srm)} long.`);
      return { ans: { course: r.course, speed: r.speed, srm: r.srm }, steps: f.steps, overlay: f.overlay, raw: r };
    },
    statement: inp => stStatement(inp) + `You must be on station in ${b(inp.T + ' minutes')}. Find the course, speed and SRM.`,
    scenario: stationScenario,
    execute: (inp, sol, st) => [
      { t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: isNaN(st.speed) ? sol.ans.speed : st.speed },
      { t: inp.t0 + inp.T * 60, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'When the time is fixed, the SRM is fixed too (distance ÷ time), so the r→m vector is fully known and e→m follows.',
      keys: ['SRM = relative distance ÷ time.', 'Lay off r→m along the DRM with that length.', 'e→m is course and speed.'],
    },
  });

  def({
    id: 'minspeed', group: 'Stationing', title: 'Station at minimum speed',
    blurb: 'Find the slowest speed that still reaches the new station (fuel economy).',
    inputs: [...stInputs, F('t0', 'Time of signal', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('speed', 'Minimum speed', 'spd'), F('eta', 'Time on station', 'clock')],
    generate: () => genStation(() => ({}), inp => { const s = reg.minspeed.solve(inp); return !s.error && s.ans.speed > 3 && (s.ans.eta - inp.t0) / 60 < 150 && s.raw.srm > 3; }),
    solve(inp) {
      const r = minSpeed(vec(inp.b1, inp.r1), vec(inp.b2, inp.r2), vec(inp.gC, inp.gS));
      if (r.error) return r;
      const f = stationFrame(inp, r, `From r draw a line parallel to the DRM. The shortest e→m reaching that line is perpendicular to it — drop a perpendicular from e; its foot is m.`);
      f.overlay.lines.push({ a: O, b: r.vM, kind: 'aux', speed: true, s: 2 });
      return { ans: { course: r.course, speed: r.speed, eta: f.eta }, steps: f.steps, overlay: f.overlay, raw: r };
    },
    statement: inp => stStatement(inp) + `Proceed at the minimum speed. Find the course, speed and time on station.`,
    scenario: stationScenario,
    execute: (inp, sol, st) => [
      { t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: isNaN(st.speed) ? sol.ans.speed : st.speed },
      { t: isNaN(st.eta) ? sol.ans.eta : st.eta, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Every point on the line from r parallel to the DRM is a workable solution; the shortest e→m to that line (perpendicular to it) is the minimum speed.',
      keys: ['Draw the DRM line through r.', 'Drop a perpendicular from e to that line: that is e→m.', 'Only possible when the guide is moving away from the direction you need to go.'],
    },
  });

  def({
    id: 'scout', group: 'Stationing', title: 'Scouting and return',
    blurb: 'Leave the formation on a scouting course and time the turn to rejoin on schedule.',
    inputs: [F('gC', 'Guide course', 'crs'), F('gS', 'Guide speed', 'spd'), F('S', 'Scouting speed', 'spd'),
      F('outC', 'Scouting course', 'crs'), F('t0', 'Time of departure', 'clock'), F('tR', 'Rejoin time', 'clock')],
    answers: [F('turn', 'Time to turn back', 'clock'), F('retC', 'Return course', 'crs'), F('maxD', 'Max distance from guide', 'nm')],
    generate: () => tryGen(() => {
      const gC = rI(0, 71) * 5, gS = rI(10, 16), t0 = 8 * 3600 + rI(0, 12) * 300;
      const inp = { gC, gS, S: Math.min(30, gS + rI(8, 14)), outC: n360(gC + pick([-1, 1]) * rI(3, 12) * 10), t0, tR: t0 + rI(6, 12) * 15 * 60 };
      const s = reg.scout.solve(inp); return !s.error && s.ans.maxD > 4 ? inp : null;
    }),
    solve(inp) {
      const vG = vec(inp.gC, inp.gS), vO1 = vec(inp.outC, inp.S), r1 = sub(vO1, vG);
      if (len(r1) < 0.5) return { error: 'On that course and speed you do not move relative to the guide.' };
      const u = unit(mul(r1, -1)), bb = MB.dot(vG, u), disc = bb * bb - MB.dot(vG, vG) + inp.S * inp.S;
      if (disc < 0) return { error: 'You cannot get back to station at that speed.' };
      const k2 = -bb + Math.sqrt(disc), vO2 = add(vG, mul(u, k2));
      let tot = (inp.tR - inp.t0) / 3600; if (tot <= 0) tot += 24;
      const t1 = k2 * tot / (len(r1) + k2), P = mul(r1, t1);
      return {
        ans: { turn: inp.t0 + t1 * 3600, retC: brg(vO2), maxD: len(P) },
        steps: [
          `Guide at the center. Draw e→r (guide ${B(inp.gC)}, ${K(inp.gS)}) and e→m₁ (scouting ${B(inp.outC)}, ${K(inp.S)}). r→m₁ = outbound relative motion: DRM ${B(brg(r1))}, SRM ${b(K(len(r1)))}.`,
          `The return RML runs back along the reciprocal (${B(brg(u))}). From r draw a line in that direction; where it cuts the ${K(inp.S)} circle is m₂: return course ${b(B(brg(vO2)))}, return SRM ${K(k2)}.`,
          `Out and back cover the same relative distance: t_out = SRM_back × total ÷ (SRM_out + SRM_back) = ${round(k2, 1)} × ${M(tot)} ÷ ${round(len(r1) + k2, 1)} = ${M(t1)}. Turn back at ${b(C(inp.t0 + t1 * 3600))}.`,
          `Greatest distance from station = ${K(len(r1))} × ${M(t1)} = ${b(N(len(P)))}.`],
        overlay: {
          center: 'guide', centerLabel: 'Stn', distUnit: 'nm',
          points: [{ p: P, label: 'Turn ' + C(inp.t0 + t1 * 3600), s: 3 }], lines: [{ a: O, b: P, kind: 'rml', s: 2 }],
          vectors: [{ a: O, b: vG, kind: 'other', label: 'r', s: 0 }, { a: O, b: vO1, kind: 'own', label: 'm₁', s: 0 }, { a: vG, b: vO1, kind: 'rel', s: 0 },
            { a: O, b: vO2, kind: 'own2', label: 'm₂', s: 1 }, { a: vG, b: vO2, kind: 'rel2', s: 1 }],
        },
      };
    },
    statement: inp => `The formation guide is on course ${B(inp.gC)} at ${K(inp.gS)}. At ${C(inp.t0)} you leave station to scout on course ${B(inp.outC)} at ${K(inp.S)}, and must be back on station at ${b(C(inp.tR))} using the same speed. When do you turn back, what is the return course, and how far from station do you get?`,
    scenario: inp => {
      const r0 = vec(inp.gC + 90, 1.5);
      return { t: inp.t0, moCenter: 'guide', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.gC, speed: inp.gS },
        { role: 'guide', name: 'Guide', type: 'carrier', x: -r0.x, y: -r0.y, course: inp.gC, speed: inp.gS }] };
    },
    execute: (inp, sol, st) => [
      { t: inp.t0, course: inp.outC, speed: inp.S },
      { t: isNaN(st.turn) ? sol.ans.turn : st.turn, course: isNaN(st.retC) ? sol.ans.retC : st.retC, speed: inp.S },
      { t: inp.tR, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Two station changes back to back: out along one RML and back along its reciprocal, with the total time split in inverse proportion to the two SRMs.',
      keys: ['Outbound triangle gives SRM out.', 'Return RML is the reciprocal; solve it at your speed.', 'Split the total time so relative distances match.'],
    },
  });

  // ============ WIND ============
  // st = steps at which [own, apparent, true] vectors appear
  const windOverlay = (vO, a, w, st) => ({
    center: 'own', centerLabel: 'OS', distUnit: 'nm', points: [], lines: [],
    vectors: [{ a: O, b: vO, kind: 'own', label: 'r', s: st[0] }, { a: vO, b: w, kind: 'rel', s: st[1] }, { a: O, b: w, kind: 'other', label: 'w', s: st[2] }],
  });
  const windScenario = (course, speed, from, spd) => ({ moCenter: 'own', wind: { from, speed: spd }, t: 10 * 3600,
    ships: [{ role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course, speed }] });

  def({
    id: 'wind_true', group: 'Wind', title: 'True wind from apparent wind',
    blurb: 'Convert the wind you feel on deck into the true wind.',
    inputs: [F('osC', 'Own course', 'crs'), F('osS', 'Own speed', 'spd'), F('awRel', 'Apparent wind from', 'rel'), F('awSpd', 'Apparent wind speed', 'spd')],
    answers: [F('twFrom', 'True wind from', 'brg', { tol: 4 }), F('twSpd', 'True wind speed', 'spd')],
    generate: () => tryGen(() => {
      const inp = { osC: rI(0, 71) * 5, osS: rI(8, 25), awRel: rI(0, 71) * 5, awSpd: rI(10, 35) };
      const s = reg.wind_true.solve(inp); return s.ans.twSpd > 4 ? inp : null;
    }),
    solve(inp) {
      const from = n360(inp.osC + inp.awRel), a = vec(from + 180, inp.awSpd), vO = vec(inp.osC, inp.osS), w = add(a, vO);
      return {
        ans: { twFrom: n360(brg(w) + 180), twSpd: len(w) },
        steps: [
          `Make the apparent wind true-referenced: ${R(inp.awRel)} + course ${B(inp.osC)} = from ${B(from)}.`,
          `Draw e→r, own ship (${B(inp.osC)}, ${K(inp.osS)}).`,
          `From r draw the apparent wind the way it blows — toward ${B(from + 180)} — ${K(inp.awSpd)} long. Its end is w.`,
          `e→w is the true wind blowing toward ${B(brg(w))}, so the true wind is from ${b(B(brg(w) + 180) + ' at ' + K(len(w)))}.`],
        overlay: windOverlay(vO, a, w, [1, 2, 3]),
      };
    },
    statement: inp => `Own ship is on course ${B(inp.osC)} at ${K(inp.osS)}. The anemometer shows apparent wind from ${b(R(inp.awRel))} at ${K(inp.awSpd)}. Find the true wind.`,
    scenario: (inp, sol) => windScenario(inp.osC, inp.osS, sol.ans.twFrom, sol.ans.twSpd),
    lesson: {
      summary: 'Apparent wind = true wind − own-ship motion. Plot vectors in the direction the wind blows (toward), and report wind as the direction it blows from.',
      keys: ['Relative bearing + course = true direction.', 'e→r own ship; r→w apparent wind (toward); e→w true wind.', 'Reverse the final vector to state "from".'],
    },
  });

  def({
    id: 'wind_apparent', group: 'Wind', title: 'Apparent wind from true wind',
    blurb: 'Predict the wind across the deck on a planned course and speed.',
    inputs: [F('osC', 'Own course', 'crs'), F('osS', 'Own speed', 'spd'), F('twFrom', 'True wind from', 'brg'), F('twSpd', 'True wind speed', 'spd')],
    answers: [F('awRel', 'Apparent wind from', 'rel', { tol: 4 }), F('awSpd', 'Apparent wind speed', 'spd')],
    generate: () => tryGen(() => {
      const inp = { osC: rI(0, 71) * 5, osS: rI(8, 25), twFrom: rI(0, 71) * 5, twSpd: rI(8, 30) };
      return reg.wind_apparent.solve(inp).ans.awSpd > 4 ? inp : null;
    }),
    solve(inp) {
      const w = vec(inp.twFrom + 180, inp.twSpd), vO = vec(inp.osC, inp.osS), a = sub(w, vO);
      const fromT = n360(brg(a) + 180);
      return {
        ans: { awRel: n360(fromT - inp.osC), awSpd: len(a) },
        steps: [
          `Draw e→w, the true wind blowing toward ${B(inp.twFrom + 180)}, ${K(inp.twSpd)} long.`,
          `Draw e→r, own ship (${B(inp.osC)}, ${K(inp.osS)}).`,
          `r→w is the apparent wind: blowing toward ${B(brg(a))} at ${K(len(a))}, i.e. from ${B(fromT)} true.`,
          `Relative to the bow: ${B(fromT)} − ${B(inp.osC)} = ${b(R(fromT - inp.osC) + ' at ' + K(len(a)))}.`],
        overlay: windOverlay(vO, a, w, [1, 2, 0]),
      };
    },
    statement: inp => `The true wind is from ${B(inp.twFrom)} at ${K(inp.twSpd)}. If own ship steers ${B(inp.osC)} at ${K(inp.osS)}, what apparent wind (relative direction and speed) will you have?`,
    scenario: inp => windScenario(inp.osC, inp.osS, inp.twFrom, inp.twSpd),
    lesson: {
      summary: 'The reverse of the true-wind problem: the apparent wind is the vector from the head of your own-ship vector to the head of the true-wind vector.',
      keys: ['e→w true wind (toward).', 'e→r own ship.', 'r→w apparent wind; convert to relative bearing.'],
    },
  });

  def({
    id: 'wind_desired', group: 'Wind', title: 'Course and speed for a desired wind',
    blurb: 'Flight-ops wind: find the course and speed that give the relative wind the air boss wants.',
    inputs: [F('twFrom', 'True wind from', 'brg'), F('twSpd', 'True wind speed', 'spd'), F('desRel', 'Desired wind from', 'rel'), F('desSpd', 'Desired wind speed', 'spd')],
    answers: [F('course', 'Course', 'crs'), F('speed', 'Speed', 'spd')],
    generate: () => tryGen(() => {
      const inp = { twFrom: rI(0, 71) * 5, twSpd: rI(8, 22), desRel: pick([0, 345, 350, 355, 5, 10, 15, 330, 30]), desSpd: rI(25, 35) };
      const s = reg.wind_desired.solve(inp); return !s.error && s.ans.speed >= 5 && s.ans.speed <= 30 ? inp : null;
    }),
    solve(inp) {
      const A = inp.desSpd, W = inp.twSpd, rb = inp.desRel * MB.D2R;
      const disc = W * W - A * A * Math.sin(rb) ** 2;
      if (disc < 0) return { error: 'That relative wind is not achievable with this true wind.' };
      const cands = [A * Math.cos(rb) - Math.sqrt(disc), A * Math.cos(rb) + Math.sqrt(disc)].filter(s => s > 0.5).sort((a, c) => a - c);
      if (!cands.length) return { error: 'That relative wind is not achievable with this true wind.' };
      const S = cands[0], w = vec(inp.twFrom + 180, W), wl = V(-A * Math.sin(rb), S - A * Math.cos(rb));
      const course = n360(brg(w) - brg(wl)), vO = vec(course, S), a = sub(w, vO);
      return {
        ans: { course, speed: S },
        steps: [
          `Draw e→w, the true wind (toward ${B(inp.twFrom + 180)}, ${K(W)}).`,
          `The apparent wind r→w must be ${K(A)} from ${R(inp.desRel)}, so the angle at r between your heading and the wind is fixed. Law of cosines: S = A·cos(RB) − √(W² − A²·sin²RB) = ${b(K(S))}.`,
          `Rotate the triangle until r→w arrives from ${R(inp.desRel)}: course ${b(B(course))}.`,
          `Check: on ${B(course)} at ${K(S)} the apparent wind is ${K(len(a))} from ${R(n360(brg(a) + 180 - course))}.`],
        overlay: windOverlay(vO, a, w, [2, 2, 0]),
      };
    },
    statement: inp => `True wind is from ${B(inp.twFrom)} at ${K(inp.twSpd)}. Air operations need ${b(K(inp.desSpd))} of wind from ${b(R(inp.desRel))}. Find the course and the lowest speed that give it.`,
    scenario: (inp, sol) => windScenario(sol.ans.course, sol.ans.speed, inp.twFrom, inp.twSpd),
    lesson: {
      summary: 'Here the apparent wind is the known and own ship is the unknown. Fix the true-wind vector, then find the own-ship vector whose apparent wind has the required speed and relative direction.',
      keys: ['e→w fixed.', 'r must sit so r→w has the desired speed and makes the desired angle with e→r.', 'Two speeds may work; take the lower (steaming into the wind).'],
    },
  });

  // ============ DIVTACS ============
  const yd = v => v / YD;
  def({
    id: 'div_formation', group: 'DIVTACS', title: 'Formation change',
    blurb: 'Division in column shifts to a line of bearing; compute your course and time to the new station.',
    inputs: [F('gC', 'Guide course (axis)', 'crs'), F('gS', 'Guide speed', 'spd'), F('D1', 'Column distance', 'yd'), F('k', 'Your position in column', 'int'),
      F('relB', 'New line bearing (rel. axis)', 'rel'), F('I', 'New interval', 'yd'), F('S', 'Maneuvering speed', 'spd'), F('t0', 'Time of execute', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('srm', 'SRM', 'spd'), F('eta', 'Time on station', 'clock')],
    generate: () => tryGen(() => {
      const inp = { gC: rI(0, 71) * 5, gS: rI(12, 18), D1: pick([500, 500, 1000]), k: rI(2, 4), relB: pick([45, 90, 135, 225, 270, 315]),
        I: pick([500, 1000, 1500, 2000]), S: 0, t0: 8 * 3600 + rI(0, 12) * 300 };
      inp.S = Math.min(30, inp.gS + rI(6, 12));
      const s = reg.div_formation.solve(inp); return !s.error && s.ans.srm > 3 ? inp : null;
    }),
    solve(inp) {
      const r1 = vec(inp.gC + 180, yd((inp.k - 1) * inp.D1)), r2 = vec(inp.gC + inp.relB, yd((inp.k - 1) * inp.I));
      const r = stationSpeed(r1, r2, vec(inp.gC, inp.gS), inp.S);
      if (r.error) return r;
      const eta = inp.t0 + r.hours * 3600;
      return {
        ans: { course: r.course, srm: r.srm, eta },
        steps: [
          `Guide (ship 1) at the center. In column you are ${Y((inp.k - 1) * inp.D1)} astern: M1 = ${B(inp.gC + 180)}, ${Y((inp.k - 1) * inp.D1)}.`,
          `New station: line of bearing ${R(inp.relB)} = ${B(inp.gC + inp.relB)} true, ${inp.k - 1} × ${Y(inp.I)} = ${Y((inp.k - 1) * inp.I)} from the guide: M2.`,
          `RML M1→M2: DRM ${B(r.drm)}, relative distance ${Y(r.dist * YD)}.`,
          `e→r = guide (${B(inp.gC)}, ${K(inp.gS)}). From r, parallel to the DRM, to the ${K(inp.S)} circle gives m: course ${b(B(r.course))}, SRM ${b(K(r.srm))}.`,
          `Time = ${Y(r.dist * YD)} ÷ (${round(r.srm, 1)} × 100 yds per 3 min) = ${M(r.hours)} → on station at ${b(C(eta))}.`],
        overlay: {
          center: 'guide', centerLabel: 'G', distUnit: 'yd',
          points: [{ p: r1, label: 'M1', s: 0 }, { p: r2, label: 'M2', s: 1 }], lines: [{ a: r1, b: r2, kind: 'rml', s: 2 }],
          vectors: [{ a: O, b: vec(inp.gC, inp.gS), kind: 'other', label: 'r', s: 3 }, { a: vec(inp.gC, inp.gS), b: r.vM, kind: 'rel', s: 3 }, { a: O, b: r.vM, kind: 'own', label: 'm', s: 3 }],
        },
      };
    },
    statement: inp => `A four-ship division is in column, ${Y(inp.D1)} between ships, guide (ship 1) leading on ${B(inp.gC)} at ${K(inp.gS)}. You are ship ${inp.k}. At ${C(inp.t0)} the signal is executed to form a line of bearing ${b(R(inp.relB))} from the axis, interval ${b(Y(inp.I))}, guide unchanged, in order of ship number. Using ${K(inp.S)}, find your course, SRM and time on station.`,
    scenario(inp) {
      const G = mul(vec(inp.gC + 180, yd((inp.k - 1) * inp.D1)), -1), vG = vec(inp.gC, inp.gS), ships = [];
      for (let i = 1; i <= 4; i++) {
        const pos = add(G, vec(inp.gC + 180, yd((i - 1) * inp.D1)));
        const s = { name: i === 1 ? 'Guide (1)' : 'Ship ' + i, type: 'warship', x: pos.x, y: pos.y, course: inp.gC, speed: inp.gS, role: i === 1 ? 'guide' : 'contact' };
        if (i === inp.k) Object.assign(s, { role: 'own', name: 'Own ship (' + i + ')', x: 0, y: 0 });
        else if (i > 1) {
          const r = stationSpeed(vec(inp.gC + 180, yd((i - 1) * inp.D1)), vec(inp.gC + inp.relB, yd((i - 1) * inp.I)), vG, inp.S);
          if (!r.error) s.maneuvers = [{ t: inp.t0, course: r.course, speed: inp.S }, { t: inp.t0 + r.hours * 3600, course: inp.gC, speed: inp.gS }];
        }
        ships.push(s);
      }
      return { t: inp.t0, moCenter: 'guide', ships };
    },
    execute: (inp, sol, st) => [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.S },
      { t: isNaN(st.eta) ? sol.ans.eta : st.eta, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Formation changes are station changes in yards. Work out your old and new stations from the formation geometry, then solve relative to the guide. Every other ship in the division is solving its own problem at the same time.',
      keys: ['Station = bearing from the axis + range in yards from the guide.', 'Three-minute rule: yards in 3 min = speed × 100.', 'Other ships move simultaneously; watch for crossing tracks.'],
    },
  });

  def({
    id: 'div_axis', group: 'DIVTACS', title: 'Axis rotation',
    blurb: 'The formation axis shifts; your station rotates with it. Reach it in the time given.',
    inputs: [F('gC', 'Guide course', 'crs'), F('gS', 'Guide speed', 'spd'), F('A1', 'Old axis', 'crs'), F('A2', 'New axis', 'crs'),
      F('Rb', 'Station bearing (rel. axis)', 'rel'), F('rng', 'Station range', 'yd'), F('T', 'Time allowed', 'min'), F('t0', 'Time of execute', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('speed', 'Speed', 'spd'), F('srm', 'SRM', 'spd')],
    generate: () => tryGen(() => {
      const gC = rI(0, 71) * 5;
      const inp = { gC, gS: rI(12, 18), A1: gC, A2: n360(gC + pick([-90, -60, -45, -30, 30, 45, 60, 90])), Rb: rI(0, 35) * 10, rng: rI(4, 12) * 500, T: pick([10, 12, 15, 20]), t0: 8 * 3600 + rI(0, 12) * 300 };
      const s = reg.div_axis.solve(inp); return !s.error && s.ans.speed > 5 && s.ans.speed < 31 && s.ans.srm > 3 ? inp : null;
    }),
    solve(inp) {
      const r1 = vec(inp.A1 + inp.Rb, yd(inp.rng)), r2 = vec(inp.A2 + inp.Rb, yd(inp.rng)), vG = vec(inp.gC, inp.gS);
      const r = stationTime(r1, r2, vG, inp.T / 60);
      if (r.error) return r;
      return {
        ans: { course: r.course, speed: r.speed, srm: r.srm },
        steps: [
          `Station ${R(inp.Rb)} from the axis. Old axis ${B(inp.A1)} → M1 at ${B(inp.A1 + inp.Rb)} true; new axis ${B(inp.A2)} → M2 at ${B(inp.A2 + inp.Rb)} true, both ${Y(inp.rng)} from the guide.`,
          `RML M1→M2: DRM ${B(r.drm)}, relative distance ${Y(r.dist * YD)}. SRM needed = distance ÷ ${inp.T} min = ${b(K(r.srm))}.`,
          `e→r = guide (${B(inp.gC)}, ${K(inp.gS)}). Lay off r→m along the DRM, ${K(r.srm)} long.`,
          `e→m: ${b(B(r.course) + ' at ' + K(r.speed))}.`],
        overlay: {
          center: 'guide', centerLabel: 'G', distUnit: 'yd',
          points: [{ p: r1, label: 'M1', s: 0 }, { p: r2, label: 'M2', s: 0 }], lines: [{ a: r1, b: r2, kind: 'rml', s: 1 }, { a: O, b: vec(inp.A1, yd(inp.rng) * 1.2), kind: 'aux', s: 0 }, { a: O, b: vec(inp.A2, yd(inp.rng) * 1.2), kind: 'aux', s: 0 }],
          vectors: [{ a: O, b: vG, kind: 'other', label: 'r', s: 2 }, { a: vG, b: r.vM, kind: 'rel', s: 2 }, { a: O, b: r.vM, kind: 'own', label: 'm', s: 3 }],
        },
      };
    },
    statement: inp => `The guide is on ${B(inp.gC)} at ${K(inp.gS)}. Your station is ${R(inp.Rb)} from the formation axis, ${Y(inp.rng)} from the guide. At ${C(inp.t0)} the axis rotates from ${B(inp.A1)} to ${b(B(inp.A2))}; stations rotate with it. Be on your new station in ${b(inp.T + ' minutes')}. Find course, speed and SRM.`,
    scenario(inp) {
      const r1 = vec(inp.A1 + inp.Rb, yd(inp.rng));
      return { t: inp.t0, moCenter: 'guide', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.gC, speed: inp.gS },
        { role: 'guide', name: 'Guide', type: 'carrier', x: -r1.x, y: -r1.y, course: inp.gC, speed: inp.gS }] };
    },
    execute: (inp, sol, st) => [
      { t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: isNaN(st.speed) ? sol.ans.speed : st.speed },
      { t: inp.t0 + inp.T * 60, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Screen and formation stations are assigned relative to the formation axis, not true north. When the axis rotates, every station rotates about the guide by the same angle.',
      keys: ['True station bearing = axis + assigned relative bearing.', 'Old and new stations lie on the same range circle.', 'With a fixed time, SRM = chord length ÷ time.'],
    },
  });

  def({
    id: 'div_corpen', group: 'DIVTACS', title: 'Column turn (CORPEN)',
    blurb: 'Follow-the-leader turn: when do you put your rudder over, and where is the guide then?',
    inputs: [F('gC', 'Present course', 'crs'), F('newC', 'New course', 'crs'), F('S', 'Division speed', 'spd'), F('k', 'Your position in column', 'int'),
      F('D', 'Column distance', 'yd'), F('t0', 'Time guide turns', 'clock')],
    answers: [F('turn', 'Time you turn', 'clock', { tol: 1 }), F('gBrg', 'Guide bearing when you turn', 'brg'), F('gRng', 'Guide range when you turn', 'yd')],
    generate: () => tryGen(() => {
      const gC = rI(0, 71) * 5;
      return { gC, newC: n360(gC + pick([-1, 1]) * rI(3, 12) * 10), S: rI(12, 20), k: rI(2, 4), D: pick([500, 500, 1000]), t0: 8 * 3600 + rI(0, 12) * 300 };
    }),
    solve(inp) {
      const d = (inp.k - 1) * inp.D, h = yd(d) / inp.S, K1 = vec(inp.gC, yd(d)), G2 = add(K1, vec(inp.newC, yd(d)));
      return {
        ans: { turn: inp.t0 + h * 3600, gBrg: inp.newC, gRng: d },
        steps: [
          `In a column movement each ship turns in the guide's wake, at the point where the guide turned (the "knuckle"). You are ${Y(d)} astern of it.`,
          `Time to reach it: ${Y(d)} at ${K(inp.S)} (${inp.S * 100} yds per 3 min) = ${M(h)} → rudder over at ${b(C(inp.t0 + h * 3600))}.`,
          `In that time the guide has steamed ${Y(d)} on the new course, so when you turn it bears ${b(B(inp.newC))} at ${b(Y(d))} — dead ahead on your new heading.`],
        overlay: {
          center: 'own', centerLabel: 'OS@exec', distUnit: 'yd',
          points: [{ p: K1, label: 'Knuckle' }, { p: G2, label: 'Guide ' + C(inp.t0 + h * 3600) }],
          lines: [{ a: O, b: K1, kind: 'rml' }, { a: K1, b: G2, kind: 'rml2' }], vectors: [],
        },
      };
    },
    statement: inp => `Your division is in column, ${Y(inp.D)} apart, on ${B(inp.gC)} at ${K(inp.S)}. You are ship ${inp.k}. At ${C(inp.t0)} the guide executes a column turn (CORPEN) to ${b(B(inp.newC))}. When do you put your rudder over, and what are the guide's bearing and range at that moment?`,
    scenario(inp) {
      const ships = [];
      for (let i = 1; i <= 4; i++) {
        const pos = vec(inp.gC + 180, yd((i - inp.k) * inp.D));
        const tTurn = inp.t0 + (yd((i - 1) * inp.D) / inp.S) * 3600;
        const s = { name: i === 1 ? 'Guide (1)' : 'Ship ' + i, role: i === 1 ? 'guide' : 'contact', type: 'warship', x: pos.x, y: pos.y, course: inp.gC, speed: inp.S };
        if (i === inp.k) Object.assign(s, { role: 'own', name: 'Own ship (' + i + ')', x: 0, y: 0 });
        else s.maneuvers = [{ t: tTurn, course: inp.newC }];
        ships.push(s);
      }
      return { t: inp.t0, moCenter: 'own', ships };
    },
    execute: (inp, sol, st) => [{ t: isNaN(st.turn) ? sol.ans.turn : st.turn, course: inp.newC, speed: inp.S }],
    lesson: {
      summary: 'A CORPEN (column movement) is follow-the-leader: each ship turns in succession at the guide\'s knuckle. A TURN, by contrast, puts every ship on the new course at once, and the formation shape changes relative to the new course.',
      keys: ['Time to knuckle = distance astern ÷ speed.', 'Three-minute rule: at 20 kts you make 2,000 yds in 3 min, so 1,000 yds takes 1.5 min.', 'Turn late and you end up outside the wake; turn early and you cut inside it.'],
    },
  });

  // ============ MORE RELATIVE MOTION ============
  def({
    id: 'range_time', group: 'Relative motion', title: 'Time to reach a set range',
    blurb: 'When will the contact close to a given range, and when will it open past it again?',
    inputs: [...fixInputs, F('R', 'Range of interest', 'nm')],
    answers: [F('tIn', 'Time it closes to the range', 'clock'), F('bIn', 'Bearing at that time', 'brg'), F('tOut', 'Time it opens past the range', 'clock')],
    generate: () => genFixes((inp, s) => s.c.rng < inp.R - 0.8 && inp.r2 > inp.R + 1.5 && s.srm > 5 && s.c.t * 60 > 8 && s.c.t * 60 < 70, () => ({ R: pick([3, 4, 5, 6]) })),
    solve(inp) {
      const s = solveFixes(inp); if (s.error) return s;
      const a = MB.dot(s.vr, s.vr), bq = 2 * MB.dot(s.rel2, s.vr), c = MB.dot(s.rel2, s.rel2) - inp.R * inp.R;
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) return { error: `The contact never comes within ${N(inp.R)} (its CPA is ${N(s.c.rng)}).` };
      const t1 = (-bq - Math.sqrt(disc)) / (2 * a), t2 = (-bq + Math.sqrt(disc)) / (2 * a);
      if (t2 < 0) return { error: 'The contact has already passed through that range and is opening.' };
      const pIn = add(s.rel2, mul(s.vr, t1)), pOut = add(s.rel2, mul(s.vr, t2)), fs = fixSteps(inp, s);
      return {
        raw: s,
        ans: { tIn: inp.t2 + t1 * 3600, bIn: brg(pIn), tOut: inp.t2 + t2 * 3600 },
        steps: [fs[0], fs[1],
          `Draw a circle of ${N(inp.R)} about the center. The RML cuts it where the contact closes to that range (${B(brg(pIn))}) and where it opens again (${B(brg(pOut))}).`,
          `M2 → first crossing: ${N(s.srm * t1)} ÷ ${K(s.srm)} = ${M(t1)} → ${b(C(inp.t2 + t1 * 3600))}, bearing ${b(B(brg(pIn)))}.`,
          `M2 → second crossing: ${N(s.srm * t2)} ÷ ${K(s.srm)} = ${M(t2)} → opens past ${N(inp.R)} at ${b(C(inp.t2 + t2 * 3600))}.`],
        overlay: fixOverlay(inp, s, { points: [{ p: pIn, label: 'Closes to ' + N(inp.R), s: 2 }, { p: pOut, label: 'Opens', s: 2 }], circles: [{ r: inp.R, s: 2 }] }, { cpa: 2, vec: 5 }),
      };
    },
    statement: inp => fixStatement(inp) + `When will Skunk A first close to ${b(N(inp.R))}, what will its bearing be then, and when will it open past ${N(inp.R)} again?`,
    scenario: (inp, sol) => fixScenario(inp, sol.raw),
    lesson: {
      summary: 'Useful for "report when the contact closes to 5 nm" and for weapon or sensor ranges. The RML crosses a range circle twice: once closing, once opening.',
      keys: ['Plot the RML as usual.', 'Draw the range circle; mark both crossings.', 'Time = relative distance from M2 to each crossing ÷ SRM.'],
    },
  });

  def({
    id: 'closest_slow', group: 'Relative motion', title: 'Closest approach when you can\'t intercept',
    blurb: 'The contact is faster than you: find the course that gets you as close as possible.',
    inputs: [F('osS', 'Own max speed', 'spd'), F('cb', 'Contact bearing', 'brg'), F('cr', 'Contact range', 'nm'),
      F('cC', 'Contact course', 'crs'), F('cS', 'Contact speed', 'spd'), F('t0', 'Time now', 'clock')],
    answers: [F('course', 'Course', 'crs'), F('cpaRng', 'Closest range', 'nm'), F('cpaTime', 'Time of closest approach', 'clock')],
    generate: () => tryGen(() => {
      const inp = { osS: rI(8, 15), cb: rI(0, 359), cr: rF(8, 16, 1), cC: rI(0, 71) * 5, cS: 0, t0: 8 * 3600 + rI(0, 20) * 300 };
      inp.cS = inp.osS + rI(5, 12);
      const s = reg.closest_slow.solve(inp);
      return !s.error && s.ans.cpaRng > 1 && (s.ans.cpaTime - inp.t0) / 60 < 120 && (s.ans.cpaTime - inp.t0) / 60 > 10 ? inp : null;
    }),
    solve(inp) {
      const rel = vec(inp.cb, inp.cr), vC = vec(inp.cC, inp.cS), S = inp.osS, m = len(vC);
      if (!stationSpeed(mul(rel, -1), O, vC, S).error) return { error: 'An intercept is possible at this speed — solve it as an intercept.' };
      const want = brg(mul(rel, -1)), beta = Math.acos(Math.min(1, S / m)) * MB.R2D;
      let best = null;
      for (const sg of [1, -1]) {
        const r = vec(brg(vC) + sg * beta, S), vr = sub(vC, r), ang = angDiff(brg(vr), want);
        if (!best || ang < best.ang) best = { r, vr, ang };
      }
      if (best.ang >= 89) return { error: 'The contact opens whatever course you steer; you are as close now as you will get.' };
      const c = cpaOf(rel, best.vr), cpaTime = inp.t0 + c.t * 3600;
      return {
        ans: { course: brg(best.r), cpaRng: c.rng, cpaTime },
        steps: [
          `Plot the contact at M1 (${B(inp.cb)}, ${N(inp.cr)}). The ideal DRM would be straight at you (${B(want)}), but the contact is too fast for an intercept.`,
          `Draw e→m, the contact's vector (${B(inp.cC)}, ${K(inp.cS)}), and your ${K(S)} speed circle about e.`,
          `From m draw the tangent to your speed circle that points closest to ${B(want)}. The tangent point is r: e→r = ${b(B(brg(best.r)))} (e→r is perpendicular to r→m).`,
          `That gives DRM ${B(brg(best.vr))}, SRM ${K(len(best.vr))}. Drawn from M1, the RML passes closest at ${b(N(c.rng))} in ${M(c.t)}, at ${b(C(cpaTime))}.`],
        overlay: {
          center: 'own', centerLabel: 'OS', distUnit: 'nm',
          points: [{ p: rel, label: 'M1 ' + C(inp.t0), s: 0 }, { p: c.pos, label: 'Closest', s: 3 }],
          lines: [{ a: rel, b: add(c.pos, mul(unit(best.vr), 1.5)), kind: 'rml', s: 3 }, { a: O, b: c.pos, kind: 'aux', s: 3 }, { a: O, b: rel, kind: 'aux', s: 0 }],
          circles: [{ r: S, speed: true, s: 1 }],
          vectors: [{ a: O, b: vC, kind: 'other', label: 'm', s: 1 }, { a: O, b: best.r, kind: 'own', label: 'r', s: 2 }, { a: best.r, b: vC, kind: 'rel', s: 2 }],
        },
      };
    },
    statement: inp => `At ${C(inp.t0)} a contact bears ${B(inp.cb)} at ${N(inp.cr)}, on course ${B(inp.cC)} at ${K(inp.cS)}. Your best speed is ${K(inp.osS)} — not enough to intercept. Find the course that brings you closest, the closest range, and when it occurs.`,
    scenario: inp => {
      const rel = vec(inp.cb, inp.cr);
      return { t: inp.t0, moCenter: 'own', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.cb, speed: 8 },
        { name: 'Contact', type: contactType(), x: rel.x, y: rel.y, course: inp.cC, speed: inp.cS }] };
    },
    execute: (inp, sol, st) => [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.osS }],
    lesson: {
      summary: 'When the contact is faster than you, no RML reaches the center. The best you can do is the relative direction closest to the bearing line — a tangent from m to your own speed circle.',
      keys: ['Try the intercept first; if the line from m misses your speed circle, switch to this method.', 'The tangent point r makes e→r perpendicular to r→m.', 'CPA = perpendicular from the center to the resulting RML.'],
    },
  });

  function cpaRange(rel, vC, vO) { const c = cpaOf(rel, sub(vC, vO)); return c.t > 0 ? c.rng : len(rel); }
  function twoCpas(inp, course) {
    const vO = vec(course, inp.osS);
    return [cpaRange(vec(inp.aB, inp.aR), vec(inp.aC, inp.aS), vO), cpaRange(vec(inp.bB, inp.bR), vec(inp.bC, inp.bS), vO)];
  }
  function minTurn(inp, dir, ok) {
    for (let d = 1; d <= 180; d++) { const c = n360(inp.osC + dir * d); if (ok(twoCpas(inp, c))) return { course: c, d }; }
    return null;
  }
  def({
    id: 'avoid_two', group: 'Relative motion', title: 'Clearing two contacts',
    blurb: 'Find the smallest turn that keeps two contacts outside the ordered CPA at the same time.',
    inputs: [F('osC', 'Own course', 'crs'), F('osS', 'Own speed', 'spd'),
      F('aB', 'A bearing', 'brg'), F('aR', 'A range', 'nm'), F('aC', 'A course', 'crs'), F('aS', 'A speed', 'spd'),
      F('bB', 'B bearing', 'brg'), F('bR', 'B range', 'nm'), F('bC', 'B course', 'crs'), F('bS', 'B speed', 'spd'),
      F('D', 'Minimum CPA', 'nm'), F('t0', 'Time now', 'clock')],
    answers: [F('course', 'New course', 'crs', { tol: 5 }), F('cpaA', 'New CPA with A', 'nm', { tol: 0.4 }), F('cpaB', 'New CPA with B', 'nm', { tol: 0.4 })],
    generate: () => tryGen(() => {
      const osC = rI(0, 71) * 5, osS = rI(10, 18), vO = vec(osC, osS), inp = { osC, osS, D: pick([2, 2.5, 3]), t0: 8 * 3600 + rI(0, 20) * 300 };
      const place = (cpa, min) => {
        const cc = rI(0, 71) * 5, cs = rI(8, 22), vr = sub(vec(cc, cs), vO);
        const p = sub(vec(brg(vr) + 90, cpa), mul(vr, min / 60));
        return { B: Math.round(brg(p)), R: round(len(p), 1), C: cc, S: cs };
      };
      const a = place(rF(-0.8, 0.8, 1), rI(18, 30)), bb = place(rF(-3, 3, 1), rI(15, 40));
      Object.assign(inp, { aB: a.B, aR: a.R, aC: a.C, aS: a.S, bB: bb.B, bR: bb.R, bC: bb.C, bS: bb.S });
      if (inp.aR < 5 || inp.bR < 5 || inp.aR > 13 || inp.bR > 13) return null;
      const now = twoCpas(inp, osC);
      if (!(now[1] < inp.D + 1.5 && now[0] < inp.D)) return null;
      const s = reg.avoid_two.solve(inp);
      return !s.error && s.turn <= 90 ? inp : null;
    }),
    solve(inp) {
      const ok = cp => cp[0] >= inp.D - 0.01 && cp[1] >= inp.D - 0.01;
      if (ok(twoCpas(inp, inp.osC))) return { error: `Both contacts already pass at ${N(inp.D)} or more — no turn needed.` };
      const stb = minTurn(inp, 1, ok), port = minTurn(inp, -1, ok);
      const pickS = stb && (!port || stb.d <= 120 || stb.d <= port.d);
      const best = pickS ? stb : port, dir = pickS ? 'starboard' : 'port';
      if (!best) return { error: `No course at ${K(inp.osS)} clears both contacts by ${N(inp.D)}.` };
      const sgn = pickS ? 1 : -1;
      const onlyA = minTurn(inp, sgn, cp => cp[0] >= inp.D - 0.01), onlyB = minTurn(inp, sgn, cp => cp[1] >= inp.D - 0.01);
      const now = twoCpas(inp, inp.osC), cp = twoCpas(inp, best.course), vO = vec(inp.osC, inp.osS), vN = vec(best.course, inp.osS);
      const rA = vec(inp.aB, inp.aR), rB = vec(inp.bB, inp.bR), vA = vec(inp.aC, inp.aS), vB = vec(inp.bC, inp.bS);
      const rml = (r, v) => ({ a: r, b: add(r, mul(unit(v), len(r) * 1.4)) });
      return {
        dir, turn: best.d,
        ans: { course: best.course, cpaA: cp[0], cpaB: cp[1] },
        steps: [
          `Relative motion now (r→m for each contact, from its true vector): A passes at ${N(now[0])}, B at ${N(now[1])}. The ordered minimum is ${N(inp.D)}.`,
          `Draw the ${N(inp.D)} circle. From each contact's position draw the RML tangent to it. Through each m, a line parallel to that tangent cuts your ${K(inp.osS)} speed circle at the course limit for that contact.`,
          `Turning to ${dir}: A alone needs ${onlyA ? B(onlyA.course) : 'no turn'}; B alone needs ${onlyB ? B(onlyB.course) : 'no turn'}.`,
          `The smallest turn that satisfies both is ${b(B(best.course))} (${best.d}° to ${dir}). Check: A passes at ${b(N(cp[0]))}, B at ${b(N(cp[1]))}.`],
        overlay: {
          center: 'own', centerLabel: 'OS', distUnit: 'nm',
          points: [{ p: rA, label: 'A', s: 0 }, { p: rB, label: 'B', s: 0 }],
          lines: [Object.assign(rml(rA, sub(vA, vO)), { kind: 'rml', s: 0 }), Object.assign(rml(rB, sub(vB, vO)), { kind: 'rml', s: 0 }),
            Object.assign(rml(rA, sub(vA, vN)), { kind: 'rml2', s: 3 }), Object.assign(rml(rB, sub(vB, vN)), { kind: 'rml2', s: 3 })],
          circles: [{ r: inp.D, s: 1 }],
          vectors: [{ a: O, b: vA, kind: 'other', label: 'mA', s: 0 }, { a: O, b: vB, kind: 'other', label: 'mB', s: 0 }, { a: O, b: vO, kind: 'own', label: 'r', s: 0 },
            { a: O, b: vN, kind: 'own2', label: "r'", s: 3 }, { a: vN, b: vA, kind: 'rel2', s: 3 }, { a: vN, b: vB, kind: 'rel2', s: 3 }],
        },
      };
    },
    grade(inp, sol, st) {
      const out = { __expected: {} };
      if (!isNaN(st.course)) {
        const cp = twoCpas(inp, st.course);
        const ok = cp[0] >= inp.D - 0.2 && cp[1] >= inp.D - 0.2 && angDiff(st.course, sol.ans.course) <= 10;
        out.course = { ok, expected: sol.ans.course, note: `Your course gives CPAs of ${N(cp[0])} (A) and ${N(cp[1])} (B).` };
        if (ok) out.__expected = { cpaA: cp[0], cpaB: cp[1] };
      }
      return out;
    },
    statement: (inp, sol) => `At ${C(inp.t0)} own ship is on ${B(inp.osC)} at ${K(inp.osS)}. CIC has solved two contacts:<br>` +
      `<span class="fix">A — ${B(inp.aB)}, ${N(inp.aR)}, course ${B(inp.aC)}, ${K(inp.aS)}</span><span class="fix">B — ${B(inp.bB)}, ${N(inp.bR)}, course ${B(inp.bC)}, ${K(inp.bS)}</span>` +
      `The CO wants both to pass no closer than ${b(N(inp.D))}. Keeping your speed, find the smallest course change (to ${sol && sol.dir || 'starboard'}) that does it, and the resulting CPA with each.`,
    scenario: inp => {
      const rA = vec(inp.aB, inp.aR), rB = vec(inp.bB, inp.bR);
      return { t: inp.t0, moCenter: 'own', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.osC, speed: inp.osS },
        { name: 'Skunk A', type: contactType(), x: rA.x, y: rA.y, course: inp.aC, speed: inp.aS },
        { name: 'Skunk B', type: contactType(), x: rB.x, y: rB.y, course: inp.bC, speed: inp.bS }] };
    },
    execute: (inp, sol, st) => [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.osS }],
    lesson: {
      summary: 'In a crowded seaway, a maneuver that clears one contact can close another. Work each contact\'s limiting course, then choose the smallest turn that satisfies all of them.',
      keys: ['Solve each contact first (keep each m fixed).', 'Each tangent RML gives a limiting own-ship course.', 'The answer is the most demanding limit in the chosen direction — then re-check every contact.'],
    },
  });

  // ============ STATIONING (more) ============
  def({
    id: 'sector', group: 'Stationing', title: 'Screen sector station',
    blurb: 'Move to the center of an assigned screen sector (bearings relative to the axis, ranges in yards).',
    inputs: [F('gC', 'Guide course', 'crs'), F('gS', 'Guide speed', 'spd'), F('A', 'Formation axis', 'crs'), F('s1', 'Sector from (rel. axis)', 'rel'), F('s2', 'Sector to (rel. axis)', 'rel'),
      F('rIn', 'Inner range', 'yd'), F('rOut', 'Outer range', 'yd'), F('b0', 'Present bearing from guide', 'brg'), F('r0', 'Present range from guide', 'yd'),
      F('S', 'Speed to use', 'spd'), F('t0', 'Time of signal', 'clock')],
    answers: [F('cB', 'Sector center bearing (true)', 'brg'), F('cR', 'Sector center range', 'yd', { tol: 100 }), F('course', 'Course', 'crs'), F('eta', 'Time on station', 'clock')],
    generate: () => tryGen(() => {
      const gC = rI(0, 71) * 5, gS = rI(12, 18), s1 = rI(0, 35) * 10, rIn = rI(4, 8) * 1000;
      const inp = { gC, gS, A: pick([gC, gC, n360(gC + pick([-30, 30, 45, -45]))]), s1, s2: n360(s1 + pick([40, 60, 80])), rIn, rOut: rIn + pick([2000, 3000, 4000]),
        b0: rI(0, 35) * 10, r0: rI(3, 12) * 1000, S: Math.min(30, gS + rI(6, 12)), t0: 8 * 3600 + rI(0, 16) * 300 };
      const s = reg.sector.solve(inp);
      return !s.error && s.raw.dist * YD > 2500 && s.raw.srm > 4 ? inp : null;
    }),
    solve(inp) {
      const width = n360(inp.s2 - inp.s1), mid = n360(inp.A + inp.s1 + width / 2), mr = (inp.rIn + inp.rOut) / 2;
      const p1 = vec(inp.b0, yd(inp.r0)), p2 = vec(mid, yd(mr)), vG = vec(inp.gC, inp.gS);
      const r = stationSpeed(p1, p2, vG, inp.S); if (r.error) return r;
      const eta = inp.t0 + r.hours * 3600, edge = (bb, s) => ({ a: vec(inp.A + bb, yd(inp.rIn)), b: vec(inp.A + bb, yd(inp.rOut)), kind: 'aux', s });
      return {
        raw: r,
        ans: { cB: mid, cR: mr, course: r.course, eta },
        steps: [
          `The sector runs ${pad3(inp.s1)}°–${pad3(inp.s2)}° relative to the axis (${B(inp.A)}), i.e. ${B(inp.A + inp.s1)}–${B(inp.A + inp.s2)} true. Its center bearing is halfway: ${b(B(mid))}.`,
          `Center range is halfway between ${Y(inp.rIn)} and ${Y(inp.rOut)}: ${b(Y(mr))}. That point is M2.`,
          `Plot M1, your present position (${B(inp.b0)}, ${Y(inp.r0)}). RML M1→M2: DRM ${B(r.drm)}, ${Y(r.dist * YD)}.`,
          `e→r = guide (${B(inp.gC)}, ${K(inp.gS)}). From r parallel to the DRM to the ${K(inp.S)} circle: course ${b(B(r.course))}, SRM ${K(r.srm)}.`,
          `Time = ${Y(r.dist * YD)} ÷ ${K(r.srm)} = ${M(r.hours)} → on station at ${b(C(eta))}.`],
        overlay: {
          center: 'guide', centerLabel: 'G', distUnit: 'yd',
          points: [{ p: p2, label: 'Sector center', s: 1 }, { p: p1, label: 'M1', s: 2 }],
          lines: [edge(inp.s1, 0), edge(inp.s2, 0), { a: p1, b: p2, kind: 'rml', s: 2 }],
          circles: [{ r: yd(inp.rIn), s: 0 }, { r: yd(inp.rOut), s: 0 }],
          vectors: [{ a: O, b: vG, kind: 'other', label: 'r', s: 3 }, { a: vG, b: r.vM, kind: 'rel', s: 3 }, { a: O, b: r.vM, kind: 'own', label: 'm', s: 3 }],
        },
      };
    },
    statement: inp => `The guide is on ${B(inp.gC)} at ${K(inp.gS)}; the formation axis is ${B(inp.A)}. You are ${B(inp.b0)}, ${Y(inp.r0)} from the guide. At ${C(inp.t0)} you are assigned screen sector ${b(pad3(inp.s1) + '–' + pad3(inp.s2) + ' relative, ' + (inp.rIn / 1000) + '–' + (inp.rOut / 1000) + ' kyd')}. Using ${K(inp.S)}, proceed to the center of the sector. Find the sector center (true bearing and range), your course, and time on station.`,
    scenario: inp => {
      const p1 = vec(inp.b0, yd(inp.r0));
      return { t: inp.t0, moCenter: 'guide', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.gC, speed: inp.gS },
        { role: 'guide', name: 'Guide', type: 'carrier', x: -p1.x, y: -p1.y, course: inp.gC, speed: inp.gS }] };
    },
    execute: (inp, sol, st) => [{ t: inp.t0, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.S },
      { t: isNaN(st.eta) ? sol.ans.eta : st.eta, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Screen stations are sectors, not points: two bearings relative to the formation axis and two ranges from the guide. Unless told otherwise, head for the center of the sector, then patrol within it.',
      keys: ['Convert relative sector bearings to true with the axis.', 'Center = mid bearing, mid range.', 'Then it is an ordinary station change at the given speed.'],
    },
  });

  def({
    id: 'two_leg', group: 'Stationing', title: 'Two-leg station change',
    blurb: 'Your first leg is ordered; work out where it leaves you, then the second leg to station.',
    inputs: [...stInputs, F('S', 'Speed (both legs)', 'spd'), F('c1', 'First-leg course', 'crs'), F('T1', 'First-leg time', 'min'), F('t0', 'Time of signal', 'clock')],
    answers: [F('pB', 'Bearing from guide after leg 1', 'brg'), F('pR', 'Range from guide after leg 1', 'nm'), F('course', 'Second-leg course', 'crs'), F('eta', 'Time on station', 'clock')],
    generate: () => genStation(() => ({ T1: pick([10, 12, 15, 20]), c1: rI(0, 35) * 10 }), inp => {
      inp.S = Math.min(30, inp.gS + rI(6, 12));
      const s = reg.two_leg.solve(inp); return !s.error && s.raw.srm > 4 && s.ans.pR > 1.5 && s.raw.dist > 2;
    }),
    solve(inp) {
      const vG = vec(inp.gC, inp.gS), m1 = vec(inp.b1, inp.r1), m2 = vec(inp.b2, inp.r2), v1 = vec(inp.c1, inp.S), rel1 = sub(v1, vG);
      const P = add(m1, mul(rel1, inp.T1 / 60));
      const r = stationSpeed(P, m2, vG, inp.S); if (r.error) return r;
      const eta = inp.t0 + (inp.T1 / 60 + r.hours) * 3600;
      return {
        raw: r,
        ans: { pB: brg(P), pR: len(P), course: r.course, eta },
        steps: [
          `Guide at the center. Plot M1 (${B(inp.b1)}, ${N(inp.r1)}) and the final station M2 (${B(inp.b2)}, ${N(inp.r2)}).`,
          `Leg 1: e→r = guide (${B(inp.gC)}, ${K(inp.gS)}); e→m₁ = ${B(inp.c1)} at ${K(inp.S)}. r→m₁ gives DRM ${B(brg(rel1))}, SRM ${K(len(rel1))}.`,
          `In ${inp.T1} min you move ${N(len(rel1) * inp.T1 / 60)} from M1 along that DRM, to P: ${b(B(brg(P)) + ', ' + N(len(P)))} from the guide.`,
          `Leg 2: RML P→M2, DRM ${B(r.drm)}, ${N(r.dist)}. From r parallel to it to the ${K(inp.S)} circle: course ${b(B(r.course))}, SRM ${K(r.srm)}.`,
          `Leg 2 takes ${M(r.hours)}; on station at ${b(C(eta))}.`],
        overlay: {
          center: 'guide', centerLabel: 'G', distUnit: 'nm',
          points: [{ p: m1, label: 'M1', s: 0 }, { p: m2, label: 'M2', s: 0 }, { p: P, label: 'P', s: 2 }],
          lines: [{ a: m1, b: P, kind: 'rml', s: 2 }, { a: P, b: m2, kind: 'rml2', s: 3 }],
          vectors: [{ a: O, b: vG, kind: 'other', label: 'r', s: 1 }, { a: O, b: v1, kind: 'own', label: 'm₁', s: 1 }, { a: vG, b: v1, kind: 'rel', s: 1 },
            { a: O, b: r.vM, kind: 'own2', label: 'm₂', s: 3 }, { a: vG, b: r.vM, kind: 'rel2', s: 3 }],
        },
      };
    },
    statement: inp => stStatement(inp) + `You are directed to steer ${b(B(inp.c1))} at ${K(inp.S)} for ${b(inp.T1 + ' minutes')}, then proceed to station at the same speed. Where are you relative to the guide at the end of the first leg? What is the second-leg course, and when will you be on station?`,
    scenario: stationScenario,
    execute: (inp, sol, st) => [{ t: inp.t0, course: inp.c1, speed: inp.S },
      { t: inp.t0 + inp.T1 * 60, course: isNaN(st.course) ? sol.ans.course : st.course, speed: inp.S },
      { t: isNaN(st.eta) ? sol.ans.eta : st.eta, course: inp.gC, speed: inp.gS }],
    lesson: {
      summary: 'Real station changes often have constraints — clear the formation center, stay out of a sector, open first. Solve each leg in turn: the end of one relative leg is the start of the next.',
      keys: ['Leg 1: speed triangle → DRM/SRM; distance = SRM × time.', 'Plot where that leaves you (P).', 'Leg 2: an ordinary station change from P.'],
    },
  });

  // ============ SHIPHANDLING ============
  def({
    id: 'tac_turn', group: 'Shiphandling', title: 'Advance and transfer',
    blurb: 'Use tactical diameter to predict where a turn puts you and how long it takes.',
    inputs: [F('C1', 'Present course', 'crs'), F('C2', 'New course', 'crs'), F('TD', 'Tactical diameter', 'yd'), F('reach', 'Reach before the turn bites', 'yd'), F('S', 'Speed', 'spd')],
    answers: [F('adv', 'Advance', 'yd', { tol: 60 }), F('trans', 'Transfer', 'yd', { tol: 60 }), F('tmin', 'Time to complete the turn', 'min', { tol: 0.3 })],
    generate: () => {
      const C1 = rI(0, 71) * 5;
      return { C1, C2: n360(C1 + pick([30, 45, 60, 90, 120, 135, 150]) * pick([1, -1])), TD: pick([800, 1000, 1200, 1500]), reach: pick([100, 150, 200]), S: rI(12, 25) };
    },
    solve(inp) {
      const th = angDiff(inp.C1, inp.C2), dir = n360(inp.C2 - inp.C1) <= 180 ? 1 : -1, Rr = inp.TD / 2, tr = th * MB.D2R;
      const adv = inp.reach + Rr * Math.sin(tr), trans = Rr * (1 - Math.cos(tr)), run = inp.reach + Rr * tr, tmin = run / (inp.S * 100 / 3);
      const Pr = vec(inp.C1, yd(inp.reach)), ctr = add(Pr, vec(inp.C1 + dir * 90, yd(Rr))), arc = [];
      for (let i = 0; i <= 16; i++) arc.push(add(ctr, vec(inp.C1 - dir * 90 + dir * th * i / 16, yd(Rr))));
      const end = arc[16], lines = [{ a: O, b: Pr, kind: 'rml', s: 0 }];
      for (let i = 0; i < 16; i++) lines.push({ a: arc[i], b: arc[i + 1], kind: 'arc', s: 0 });
      lines.push({ a: O, b: vec(inp.C1, yd(adv)), kind: 'aux', s: 1 }, { a: vec(inp.C1, yd(adv)), b: end, kind: 'aux', s: 2 });
      return {
        ans: { adv, trans, tmin },
        steps: [
          `The turn is ${Math.round(th)}° to ${dir > 0 ? 'starboard' : 'port'}. Turning radius ≈ tactical diameter ÷ 2 = ${Y(Rr)}.`,
          `Advance (distance gained along the original course) = reach + R·sin θ = ${Y(inp.reach)} + ${Y(Rr)} × ${round(Math.sin(tr), 3)} = ${b(Y(adv))}.`,
          `Transfer (distance gained perpendicular to the original course) = R·(1 − cos θ) = ${Y(Rr)} × ${round(1 - Math.cos(tr), 3)} = ${b(Y(trans))}.`,
          `Distance run = reach + R·θ (radians) = ${Y(run)}. At ${K(inp.S)} (${inp.S * 100} yds per 3 min) that takes ${b(round(tmin, 1) + ' min')}.`],
        overlay: {
          center: 'own', centerLabel: 'Rudder over', distUnit: 'yd',
          points: [{ p: Pr, label: 'Turn bites', s: 0 }, { p: end, label: 'Steady ' + B(inp.C2), s: 0 }], lines, vectors: [],
        },
      };
    },
    statement: inp => `Own ship is on ${B(inp.C1)} at ${K(inp.S)}. Tactical diameter at this speed and rudder is ${b(Y(inp.TD))}, with about ${Y(inp.reach)} of reach before the ship starts to swing. You put the rudder over to come to ${b(B(inp.C2))}. Find the advance, the transfer, and how long the turn takes.`,
    scenario: inp => ({ t: 10 * 3600, realistic: true, moCenter: 'own', ships: [
      { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.C1, speed: inp.S, td: inp.TD },
      { name: 'Anchored boat', type: 'fishing', x: vec(inp.C1, 2).x, y: vec(inp.C1, 2).y, course: 0, speed: 0 }] }),
    execute: inp => [{ t: 10 * 3600 + 5, course: inp.C2 }],
    lesson: {
      summary: 'Maneuvering-board answers assume instant turns; real ships swing through an arc. Advance and transfer tell you where you actually end up, which matters for close-quarters stationing and man-overboard recovery.',
      keys: ['R ≈ TD ÷ 2; reach is the run before the ship starts to swing.', 'Advance = reach + R sin θ; transfer = R(1 − cos θ).', 'At 90°: advance ≈ reach + R, transfer ≈ R. At 180°: transfer = TD.'],
    },
  });

  def({
    id: 'div_turn', group: 'DIVTACS', title: 'TURN signal (simultaneous turn)',
    blurb: 'Every ship turns together. Where does that leave the guide relative to you?',
    inputs: [F('gC', 'Present course', 'crs'), F('newC', 'New course', 'crs'), F('relB', 'Your bearing from guide (rel. axis)', 'rel'),
      F('rng', 'Distance from guide', 'yd'), F('S', 'Speed', 'spd'), F('t0', 'Time of execute', 'clock')],
    answers: [F('gB', 'Guide bearing from you (true)', 'brg'), F('gRel', 'Guide relative bearing from your bow', 'rel'), F('rng2', 'Guide range', 'yd', { tol: 50 })],
    generate: () => {
      const gC = rI(0, 71) * 5;
      return { gC, newC: n360(gC + pick([-90, -60, -45, -30, 30, 45, 60, 90])), relB: pick([45, 90, 135, 180, 225, 270, 315]), rng: pick([500, 1000, 1500, 2000]), S: rI(12, 20), t0: 8 * 3600 + rI(0, 12) * 300 };
    },
    solve(inp) {
      const gB = n360(inp.gC + inp.relB + 180), gRel = n360(gB - inp.newC), G = vec(gB, yd(inp.rng));
      return {
        ans: { gB, gRel, rng2: inp.rng },
        steps: [
          `Before the turn, the axis is ${B(inp.gC)} and you are ${R(inp.relB)} from the guide (${B(inp.gC + inp.relB)} true), so the guide bears ${B(gB)} from you.`,
          `On TURN every ship puts its rudder over at the same moment and steadies on ${B(inp.newC)}. Positions barely change, so the guide still bears ${b(B(gB))} at ${b(Y(inp.rng))}.`,
          `Your bow moved, though: relative to your new heading the guide now bears ${B(gB)} − ${B(inp.newC)} = ${b(R(gRel))}. The formation's shape relative to the course has changed.`,
          `Contrast CORPEN: ships turn in succession at the guide's knuckle and the formation keeps its shape relative to the course.`],
        overlay: {
          center: 'own', centerLabel: 'OS', distUnit: 'yd',
          points: [{ p: G, label: 'Guide', s: 0 }],
          lines: [{ a: O, b: vec(inp.gC, yd(inp.rng) * 0.8), kind: 'aux', s: 0 }, { a: O, b: vec(inp.newC, yd(inp.rng) * 0.8), kind: 'rml', s: 1 }, { a: O, b: G, kind: 'rml2', s: 2 }],
          vectors: [],
        },
      };
    },
    statement: inp => `Two ships steam in formation on ${B(inp.gC)} at ${K(inp.S)}; your station is ${R(inp.relB)} from the axis, ${Y(inp.rng)} from the guide. At ${C(inp.t0)} the signal ${b('TURN ' + pad3(inp.newC))} is executed. After the turn, what is the guide's true bearing from you, its relative bearing from your bow, and its range?`,
    scenario: inp => {
      const G = vec(n360(inp.gC + inp.relB + 180), yd(inp.rng));
      return { t: inp.t0, moCenter: 'own', ships: [
        { role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: inp.gC, speed: inp.S },
        { role: 'guide', name: 'Guide', type: 'warship', x: G.x, y: G.y, course: inp.gC, speed: inp.S, maneuvers: [{ t: inp.t0, course: inp.newC }] }] };
    },
    execute: inp => [{ t: inp.t0, course: inp.newC }],
    lesson: {
      summary: 'TURN changes every ship\'s course at once, so true bearings between ships stay the same while relative bearings from the bow all shift by the angle of the turn.',
      keys: ['TURN: simultaneous; formation shape relative to true north is kept.', 'Relative bearing from the bow = true bearing − new course.', 'CORPEN: in succession; formation shape relative to the course is kept.'],
    },
  });

  // Problem sets
  MB.problemSets = [
    { id: 'set_rm', title: 'Relative motion — 6 problems', types: ['cpa', 'range_time', 'avoid_course', 'avoid_speed', 'intercept', 'closest_slow'] },
    { id: 'set_col', title: 'Collision avoidance — 5 problems', types: ['cpa', 'avoid_course', 'avoid_two', 'avoid_speed', 'avoid_two'] },
    { id: 'set_st', title: 'Stationing — 6 problems', types: ['station_speed', 'station_time', 'minspeed', 'two_leg', 'sector', 'scout'] },
    { id: 'set_wind', title: 'Wind — 4 problems', types: ['wind_true', 'wind_apparent', 'wind_desired', 'wind_true'] },
    { id: 'set_div', title: 'DIVTACS & shiphandling — 5 problems', types: ['div_formation', 'div_axis', 'div_turn', 'div_corpen', 'tac_turn'] },
    { id: 'set_qual', title: 'Qualification — 10 mixed', types: null },
  ];
  // Recommended order for self-study (Progress tab)
  MB.learningPath = ['cpa', 'range_time', 'avoid_course', 'avoid_speed', 'avoid_two', 'intercept', 'closest_slow',
    'station_speed', 'station_time', 'minspeed', 'two_leg', 'sector', 'scout',
    'wind_true', 'wind_apparent', 'wind_desired', 'div_formation', 'div_axis', 'div_turn', 'div_corpen', 'tac_turn'];
})(window.MB);
