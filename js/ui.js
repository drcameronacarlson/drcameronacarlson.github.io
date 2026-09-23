// App wiring: views, sim controls, practice / scenario / solver / lessons panels, main loop.
(function (MB) {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { pad3, fmtClock, vec, sub, add, mul, len, brg, n360, sim } = MB;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mbt.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mbt.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TYPES = ['merchant', 'tanker', 'warship', 'carrier', 'fishing', 'sail'];

  const bridge = new MB.Bridge($('#pane-bridge'));
  const radar = new MB.Radar($('#pane-radar'));
  const moboard = new MB.MoBoard($('#pane-moboard'));
  const app = { practice: null, set: null, solver: null };
  const visible = el => el.offsetWidth > 0 && el.offsetHeight > 0;

  // ================= Scenario loading =================
  function loadScenario(sc) {
    MB.setScenario(sc);
    sim.running = false; syncPlay();
    moboard.center = sc.moCenter || (MB.guide() ? 'guide' : 'own'); $('#moCenter').value = moboard.center;
    const own = MB.own(); let maxR = 3;
    sim.ships.forEach(s => { if (s !== own) maxR = Math.max(maxR, len(sub(s, own))); });
    radar.fitTo(Math.min(maxR, 40)); radar.painted = {}; radar.updateReadout();
    bridge.setLight && bridge.setLight(sim.light);
    syncScenarioForm(); renderContacts(); moboard.draw();
  }
  const ownShip = (c, s) => ({ role: 'own', name: 'Own ship', type: 'warship', x: 0, y: 0, course: c, speed: s });
  const at = (name, type, b, r, course, speed, o) => Object.assign({ name, type, course, speed }, vec(b, r), o || {});
  // Contact placed so it passes own ship at `cpa` nm (+ = passes to starboard of the RML) after `min` minutes.
  function cpaPlace(name, type, ownC, ownS, cC, cS, min, cpa) {
    const vr = sub(vec(cC, cS), vec(ownC, ownS)), perp = vec(brg(vr) + 90, cpa);
    const p = sub(perp, mul(vr, min / 60));
    return { name, type, course: cC, speed: cS, x: p.x, y: p.y };
  }
  const PRESETS = {
    open: { title: 'Open ocean — three contacts', make: () => ({ t: 8 * 3600, light: 'day', wind: { from: 40, speed: 12 }, ships: [ownShip(0, 15),
      cpaPlace('Skunk A', 'merchant', 0, 15, 265, 14, 28, 1.2), at('Skunk B', 'fishing', 330, 5, 90, 6), cpaPlace('Skunk C', 'tanker', 0, 15, 200, 12, 40, -2.5)] }) },
    crossing: { title: 'Crossing — you are the give-way vessel', make: () => ({ t: 9 * 3600, light: 'day', ships: [ownShip(0, 12), cpaPlace('Skunk A', 'merchant', 0, 12, 280, 16, 22, 0.1)] }) },
    headon: { title: 'Head-on', make: () => ({ t: 9 * 3600, light: 'day', ships: [ownShip(90, 15), cpaPlace('Skunk A', 'warship', 90, 15, 272, 14, 20, 0.2)] }) },
    overtake: { title: 'Overtaking', make: () => ({ t: 9 * 3600, light: 'day', ships: [ownShip(0, 12), cpaPlace('Skunk A', 'merchant', 0, 12, 5, 21, 30, -0.3)] }) },
    strait: { title: 'Busy strait — six contacts', make: () => ({ t: 7 * 3600, light: 'dusk', ships: [ownShip(45, 14),
      cpaPlace('Skunk A', 'merchant', 45, 14, 225, 16, 25, 0.8), cpaPlace('Skunk B', 'tanker', 45, 14, 300, 12, 35, -1.5), cpaPlace('Skunk C', 'fishing', 45, 14, 120, 5, 18, 0.5),
      cpaPlace('Skunk D', 'merchant', 45, 14, 60, 22, 30, 0.4), at('Skunk E', 'sail', 20, 3, 180, 5), cpaPlace('Skunk F', 'warship', 45, 14, 180, 20, 40, 2)] }) },
    night: { title: 'Night transit — lights only', make: () => ({ t: 23 * 3600, light: 'night', ships: [ownShip(180, 12),
      cpaPlace('Skunk A', 'merchant', 180, 12, 90, 15, 25, 0.5), cpaPlace('Skunk B', 'fishing', 180, 12, 350, 7, 30, -1), cpaPlace('Skunk C', 'tanker', 180, 12, 200, 20, 35, 1.2)] }) },
    division: { title: 'DIVTACS — division in column (you are ship 3)', make: () => ({ t: 10 * 3600, light: 'day', moCenter: 'guide', ships: [
      at('Guide (1)', 'warship', 0, 0.5, 0, 15, { role: 'guide' }), at('Ship 2', 'warship', 0, 0.25, 0, 15), ownShip(0, 15), at('Ship 4', 'warship', 180, 0.25, 0, 15)] }) },
  };

  // ================= Header / sim controls =================
  function syncPlay() {
    const b = $('#playBtn'); b.setAttribute('aria-pressed', sim.running); b.textContent = sim.running ? '❚❚ Pause' : '▶ Run';
  }
  $('#playBtn').addEventListener('click', () => { sim.running = !sim.running; syncPlay(); });
  $$('#rateSeg button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
  function setRate(r) { sim.rate = r; $$('#rateSeg button').forEach(x => x.setAttribute('aria-pressed', +x.dataset.rate === r)); }
  $('#stepBtn').addEventListener('click', () => { MB.advance(180); moboard.draw(); });
  function updateHeader() {
    $('#clock').textContent = fmtClock(sim.t, true);
    const o = MB.own(); $('#ownRead').textContent = o ? `${pad3(o.course)}°T · ${o.speed.toFixed(1)} kts` : '—';
  }

  // ================= View tabs =================
  function setView(v) {
    $('.views').dataset.view = v;
    $$('.views .tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
    store.set('view', v);
  }
  $$('.views .tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  setView(store.get('view', 'split'));
  function setSide(v) {
    $$('.side .tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.side === v));
    $$('.sidepanel').forEach(p => (p.hidden = p.id !== 'sp-' + v));
  }
  $$('.side .tabs button').forEach(b => b.addEventListener('click', () => setSide(b.dataset.side)));

  // ================= Bridge controls =================
  $$('#pane-bridge [data-b]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.b;
    if (k === 'left') bridge.yaw = n360(bridge.yaw - 45);
    if (k === 'right') bridge.yaw = n360(bridge.yaw + 45);
    if (k === 'ahead') { bridge.yaw = 0; bridge.pitch = -1.5; }
    if (k === 'astern') bridge.yaw = 180;
    if (k === 'binos') { bridge.toggleBinos && bridge.toggleBinos(); b.setAttribute('aria-pressed', !!bridge.binos); }
    if (k === 'labels') { bridge.showLabels = !bridge.showLabels; b.setAttribute('aria-pressed', bridge.showLabels); }
  }));

  // ================= Radar controls =================
  $$('#pane-radar [data-r]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.r;
    if (k === 'minus') radar.setRange(-1);
    if (k === 'plus') radar.setRange(1);
    if (k === 'hu') { radar.headUp = !radar.headUp; radar.painted = {}; b.setAttribute('aria-pressed', radar.headUp); }
    if (k === 'trails') { radar.trails = !radar.trails; b.setAttribute('aria-pressed', radar.trails); }
    if (k === 'targets') { radar.showTargets = !radar.showTargets; b.setAttribute('aria-pressed', radar.showTargets); radar.updateTable(); }
    if (k === 'clear') { radar.ebl = radar.vrm = null; }
    radar.updateReadout();
  }));
  $('#radarVec').addEventListener('change', e => (radar.vectors = e.target.value));

  // ================= MoBoard controls =================
  function fillMoScales() {
    const opts = moboard.scaleOptions(), cur = moboard.distUnit === 'yd' ? moboard.ydScale : moboard.nmScale;
    $('#moDist').innerHTML = opts.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${moboard.distUnit === 'yd' ? v.toLocaleString('en-US') + ' yds' : v + ' nm'}/ring</option>`).join('') +
      `<option value="unit">Switch to ${moboard.distUnit === 'yd' ? 'nm' : 'yards'}</option>`;
    $('#moSpd').innerHTML = MB.MoBoard.SPD_SCALES.map(v => `<option value="${v}" ${v === moboard.speedScale ? 'selected' : ''}>${v} kts/ring</option>`).join('');
    moboard.updateReadout();
  }
  MB.on('moboard-scale', fillMoScales); fillMoScales();
  $('#moDist').addEventListener('change', e => {
    if (e.target.value === 'unit') { moboard.distUnit = moboard.distUnit === 'yd' ? 'nm' : 'yd'; fillMoScales(); moboard.draw(); return; }
    moboard.setScale(+e.target.value); moboard.updateReadout();
  });
  $('#moSpd').addEventListener('change', e => { moboard.speedScale = +e.target.value; moboard.updateReadout(); moboard.draw(); });
  $('#moCenter').addEventListener('change', e => { moboard.center = e.target.value; moboard.draw(); });
  function setMoTool(t) {
    moboard.tool = moboard.tool === t ? 'none' : t;
    $$('#pane-moboard [data-m="point"], #pane-moboard [data-m="line"]').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === moboard.tool));
  }
  function setSolutionShown(on) { moboard.showSolution = on; $('#pane-moboard [data-m="sol"]').setAttribute('aria-pressed', on); moboard.draw(); }
  $$('#pane-moboard [data-m]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.m;
    if (k === 'live') { moboard.showLive = !moboard.showLive; b.setAttribute('aria-pressed', moboard.showLive); }
    if (k === 'sol') {
      if (app.locked && app.practice && !app.practice.checked) { moboard.readout.innerHTML = '<span class="acc">The solution opens after you check your answers.</span>'; return; }
      moboard.revealStep = null; setSolutionShown(!moboard.showSolution);
    }
    if (k === 'point' || k === 'line') setMoTool(k);
    if (k === 'undo') moboard.marks.pop();
    if (k === 'clear') moboard.marks = [];
    moboard.draw();
  }));
  function showOverlay(ov, reveal) {
    moboard.overlay = ov; moboard.autoscale(ov); moboard.center = ov.center === 'guide' ? 'guide' : 'own';
    $('#moCenter').value = moboard.center; setSolutionShown(!!reveal);
  }

  // ================= Codes (assignments & completion) =================
  const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  const codeHash = s => fnv('mbt|' + s + '|v1');
  const encodeAssignment = a => 'MBA-' + b64e(JSON.stringify(a));
  function decodeAssignment(code) {
    const m = String(code).trim().match(/^MBA-([A-Za-z0-9_-]+)$/);
    if (!m) throw new Error('An assignment code starts with MBA- and has no spaces.');
    const a = JSON.parse(b64d(m[1]));
    if (!Array.isArray(a.items) || !a.items.every(it => MB.problems[it.t])) throw new Error('This code was made by a newer version of the trainer or is incomplete.');
    return a;
  }
  function encodeResult(r) { const body = b64e(JSON.stringify(r)); return 'MBR-' + body + '-' + codeHash(body); }
  function decodeResult(code) {
    const m = String(code).trim().match(/^MBR-([A-Za-z0-9_-]+)-([a-z0-9]+)$/);
    if (!m) return null;
    try { return { r: JSON.parse(b64d(m[1])), intact: codeHash(m[1]) === m[2] }; } catch (e) { return null; }
  }

  // ================= Practice =================
  const typeOptions = (withSets) => {
    const groups = {};
    MB.problemList.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
    let html = withSets ? `<optgroup label="Problem sets">${MB.problemSets.map(s => `<option value="set:${s.id}">${s.title}</option>`).join('')}</optgroup>
      <optgroup label="From your instructor"><option value="assign">Enter an assignment code…</option></optgroup>` : '';
    for (const g in groups) html += `<optgroup label="${g}">${groups[g].map(p => `<option value="${withSets ? 'type:' : ''}${p.id}">${p.title}</option>`).join('')}</optgroup>`;
    return html;
  };
  $('#probType').innerHTML = typeOptions(true);
  $('#probType').value = 'type:cpa';
  $('#probType').addEventListener('change', () => ($('#newProb').textContent = $('#probType').value === 'assign' ? 'Enter code' : 'New problem'));
  $('#newProb').addEventListener('click', () => startFromSelect());

  function startFromSelect() {
    const v = $('#probType').value;
    if (v === 'assign') return showAssignmentEntry();
    if (v.startsWith('set:')) {
      const s = MB.problemSets.find(x => 'set:' + x.id === v);
      const types = s.types || Array.from({ length: 10 }, () => MB.pick(MB.problemList).id);
      startRun({ kind: 'set', title: s.title, items: types.map(t => ({ t })), allowHints: true, timeLimitMin: 0 });
    } else { endRunSilently(); newProblem(v.slice(5)); }
  }
  function endRunSilently() { app.run = null; setLocked(false); }
  function startRun(run) {
    app.run = Object.assign({ idx: 0, results: [], startedAt: Date.now() }, run);
    setLocked(!app.run.allowHints);
    const it = app.run.items[0]; newProblem(it.t, it.i);
  }
  // During exams and no-hint assignments the solver, lessons and solution overlay stay closed until each answer is checked.
  function setLocked(on) {
    app.locked = on;
    $('#lockNote').hidden = !on;
    ['solver', 'lessons'].forEach(k => { $(`.side .tabs [data-side="${k}"]`).disabled = on; });
    if (on) { const cur = $('.side .tabs [aria-selected="true"]').dataset.side; if (cur === 'solver' || cur === 'lessons') setSide('practice'); }
  }

  function showAssignmentEntry() {
    endRunSilently();
    $('#probArea').innerHTML = `<div class="pcard"><h3>Start an assignment</h3>
      <p class="hint">Paste the code your instructor gave you (it starts with MBA-). Everyone who uses the same code gets the same problems.</p>
      <label class="stack">Your name (goes on your completion code)<input id="asName" autocomplete="name" value="${esc(store.get('name', ''))}"></label>
      <label class="stack">Assignment code<textarea id="asIn" spellcheck="false"></textarea></label>
      <div class="actions"><button class="btn primary" id="asStart">Start assignment</button></div><p class="err" id="asErr"></p></div>`;
    $('#asStart').addEventListener('click', () => {
      const name = $('#asName').value.trim();
      if (!name) { $('#asErr').textContent = 'Enter your name so your instructor can match the completion code to you.'; $('#asName').focus(); return; }
      store.set('name', name);
      try {
        const a = decodeAssignment($('#asIn').value);
        startRun({ kind: 'assign', title: a.title, aid: a.id, items: a.items, allowHints: !!a.hints, timeLimitMin: a.timeLimitMin || 0, name });
      } catch (e) { $('#asErr').textContent = 'That code did not work: ' + e.message; }
    });
  }

  function newProblem(id, inp) {
    const def = MB.problems[id];
    inp = inp || def.generate();
    const sol = def.solve(inp);
    app.practice = { def, inp, sol, checked: false, hintStep: -1, hints: 0, start: performance.now(), sec: null };
    loadScenario(def.scenario(inp, sol));
    moboard.marks = []; moboard.revealStep = null; showOverlay(sol.overlay, false);
    renderProblem();
  }
  let demoStats = null; // sample progress shown only in #demo-progress (store screenshots); never saved
  function stats() { return demoStats || store.get('stats', {}); }
  function recordResult(id, ok, hints, sec) {
    const s = stats(), r = s[id] = s[id] || { tries: 0, correct: 0, streak: 0, mastered: false, best: null };
    r.tries++;
    if (ok) {
      r.correct++;
      if (!hints) { r.streak = (r.streak || 0) + 1; if (r.best == null || sec < r.best) r.best = sec; }
    } else r.streak = 0;
    if (r.streak >= 3) r.mastered = true;
    store.set('stats', s);
  }
  const fmtSec = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

  function renderProblem() {
    const p = app.practice, area = $('#probArea');
    if (!p) { area.innerHTML = ''; return; }
    const { def, inp, sol } = p, st = stats()[def.id], run = app.run, hintsOk = !run || run.allowHints;
    const ph = f => ({ clock: 'hhmm', crs: '000', brg: '000', rel: '000' }[f.kind] || '0.0');
    const rec = st ? (st.mastered ? 'Mastered ✓' : `Streak ${st.streak || 0}/3 · ${st.correct}/${st.tries} correct`) : 'First attempt';
    area.innerHTML = `
      <div class="pcard">
        <div class="pmeta"><span class="chip">${def.group}</span>${run ? `<span class="chip ghost">${esc(run.title)} · ${run.idx + 1} of ${run.items.length}</span>` : ''}
          <span class="rec">${rec}</span></div>
        <div class="titlerow"><h3>${def.title}</h3><span class="timer" id="probTimer" aria-label="Time on this problem">0:00</span></div>
        <p class="stmt">${def.statement(inp, sol)}</p>
        <p class="hint">The scenario is on the scope, paused at the problem time. Work it on paper or with the MoBoard's Point and Line tools; press Run to watch it unfold.</p>
        ${hintsOk ? `<label class="check"><input type="checkbox" id="coach" ${store.get('coach', false) ? 'checked' : ''}> Coach me: check each answer as I enter it</label>` : ''}
        <form class="answers" id="ansForm" novalidate>
          ${def.answers.map(f => `<label class="ans" data-key="${f.key}"><span>${f.label}</span><div class="inwrap"><input id="ans-${f.key}" inputmode="${f.kind === 'clock' ? 'numeric' : 'decimal'}" autocomplete="off" placeholder="${ph(f)}"><em>${MB.KIND[f.kind].unit}</em></div><output></output></label>`).join('')}
          <div class="actions"><button class="btn primary" type="submit">Check answers</button>
            ${hintsOk ? `<button type="button" class="btn" data-act="hint">Hint: next step</button><button type="button" class="btn" data-act="reveal">Show solution</button>` : ''}
            <button type="button" class="btn" data-act="reset">Reset scenario</button></div>
        </form>
        ${def.execute ? `<div class="actions"><button class="btn" data-act="execMine">▶ Run my answer</button>${hintsOk ? '<button class="btn" data-act="execSol">▶ Run the solution</button>' : ''}</div>` : ''}
        <div id="probResult"></div>
        <div id="probSteps" hidden>
          <h4>Worked solution</h4>
          <ol class="steps">${sol.steps.map((s, i) => `<li data-i="${i}">${s}</li>`).join('')}</ol>
          <div class="legend"><span><i style="background:var(--accent)"></i>Relative motion line</span><span><i style="background:var(--v-own)"></i>Own / maneuvering ship</span><span><i style="background:var(--v-other)"></i>Reference / contact / wind</span><span><i style="background:var(--v-rel)"></i>Relative vector</span></div>
        </div>
        <div class="actions"><button class="btn primary" data-act="next">${run && run.idx + 1 >= run.items.length ? 'Finish' : 'Next problem →'}</button></div>
      </div>`;
    $('#ansForm').addEventListener('submit', e => { e.preventDefault(); checkAnswers(); });
    area.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
    const coach = $('#coach');
    if (coach) coach.addEventListener('change', () => store.set('coach', coach.checked));
    def.answers.forEach(f => $('#ans-' + f.key).addEventListener('change', () => { if (coach && coach.checked && !p.checked) markField(f); }));
  }
  function readStudent() {
    const out = {};
    app.practice.def.answers.forEach(f => (out[f.key] = MB.parseField(f.kind, $('#ans-' + f.key).value)));
    return out;
  }
  function paint(f, r, stu, final) {
    const lab = $(`.ans[data-key="${f.key}"]`), out = lab.querySelector('output');
    lab.classList.toggle('ok', r.ok); lab.classList.toggle('bad', !r.ok);
    const exp = MB.formatField(f.kind, r.expected) + ' ' + MB.KIND[f.kind].unit;
    if (r.ok) out.textContent = '✓ Correct' + (r.note ? ' — ' + r.note : '');
    else if (!final) out.textContent = '✗ Not yet — recheck this one' + (r.note ? ' (' + r.note + ')' : '');
    else out.textContent = (isNaN(stu[f.key]) ? '✗ No answer — expected ' : '✗ Expected ') + exp + (r.note ? ' — ' + r.note : '');
  }
  function markField(f) {
    const p = app.practice, stu = readStudent(); if (isNaN(stu[f.key])) return;
    paint(f, MB.gradeAnswers(p.def, p.inp, p.sol, stu)[f.key], stu, false);
  }
  function checkAnswers() {
    const p = app.practice, stu = readStudent(), g = MB.gradeAnswers(p.def, p.inp, p.sol, stu);
    let n = 0;
    p.def.answers.forEach(f => { paint(f, g[f.key], stu, true); if (g[f.key].ok) n++; });
    const all = n === p.def.answers.length;
    if (!p.checked) {
      p.sec = (performance.now() - p.start) / 1000;
      recordResult(p.def.id, all, p.hints, p.sec);
      if (app.run) app.run.results[app.run.idx] = { t: p.def.id, n, of: p.def.answers.length, sec: Math.round(p.sec), hints: p.hints };
    }
    p.checked = true;
    const st = stats()[p.def.id];
    const msg = all ? (p.hints ? 'All correct — now try one without hints to build your streak.' : st.mastered ? 'All correct. This problem type is mastered.' : `All correct. Streak ${st.streak}/3 toward mastery.`)
      : 'Open the worked solution to see where it diverged, then try another.';
    $('#probResult').innerHTML = `<div class="score">${n} of ${p.def.answers.length} correct in ${fmtSec(p.sec)} — ${msg}</div>`;
    reveal();
  }
  function showSteps(k) {
    $('#probSteps').hidden = false;
    $$('#probSteps li').forEach(li => (li.hidden = +li.dataset.i > k));
    moboard.revealStep = k >= app.practice.sol.steps.length - 1 ? null : k;
    setSolutionShown(true);
  }
  function reveal() { app.practice.hintStep = app.practice.sol.steps.length - 1; showSteps(app.practice.hintStep); }
  function executeRun(useSolution) {
    const p = app.practice;
    loadScenario(p.def.scenario(p.inp, p.sol));
    const mans = p.def.execute(p.inp, p.sol, useSolution ? {} : readStudent());
    const own = MB.own(); mans.forEach(m => MB.addManeuver(own, m));
    if (sim.rate < 15) setRate(15);
    sim.running = true; syncPlay();
  }
  function act(a) {
    const p = app.practice;
    if (a === 'hint') {
      if (!p.checked) p.hints++;
      p.hintStep = Math.min(p.sol.steps.length - 1, p.hintStep + 1); showSteps(p.hintStep);
    }
    if (a === 'reveal') { if (!p.checked) p.hints = Math.max(p.hints, 1); reveal(); }
    if (a === 'reset') loadScenario(p.def.scenario(p.inp, p.sol));
    if (a === 'execMine') executeRun(false);
    if (a === 'execSol') { if (!p.checked) p.hints = Math.max(p.hints, 1); executeRun(true); }
    if (a === 'next') {
      if (!app.run) return newProblem(p.def.id);
      const run = app.run;
      if (!run.results[run.idx]) run.results[run.idx] = { t: p.def.id, n: 0, of: p.def.answers.length, sec: Math.round((performance.now() - p.start) / 1000), hints: p.hints, skipped: true };
      run.idx++;
      if (run.idx < run.items.length) { const it = run.items[run.idx]; newProblem(it.t, it.i); }
      else finishRun();
    }
  }
  function finishRun(timedOut) {
    const run = app.run; if (!run) return;
    run.items.forEach((it, i) => { if (!run.results[i]) run.results[i] = { t: it.t, n: 0, of: MB.problems[it.t].answers.length, sec: 0, hints: 0, skipped: true }; });
    const pts = run.results.reduce((a, r) => a + r.n, 0), of = run.results.reduce((a, r) => a + r.of, 0);
    const full = run.results.filter(r => r.n === r.of).length, totalSec = Math.round((Date.now() - run.startedAt) / 1000);
    let codeHtml = '';
    if (run.kind === 'assign' || run.kind === 'exam') {
      const code = encodeResult({ v: 1, kind: run.kind, aid: run.aid || 'exam', title: run.title, name: run.name || store.get('name', ''), at: new Date().toISOString(), totalSec,
        items: run.results.map(r => [r.t, r.n, r.of, r.sec, r.hints]) });
      if (run.kind === 'exam') { const ex = store.get('exams', []); ex.push({ at: Date.now(), pts, of, full, n: run.items.length }); store.set('exams', ex.slice(-10)); }
      codeHtml = `<h4>Your completion code</h4><p class="hint">Send this code to your instructor (email or Teams). It records your score and time for each problem.</p>
        <textarea id="doneCode" readonly>${code}</textarea><div class="actions"><button class="btn" id="doneCopy">Copy code</button></div><p class="hint" id="doneMsg"></p>`;
    }
    $('#probArea').innerHTML = `<div class="pcard"><span class="chip">${timedOut ? 'Time expired' : 'Complete'}</span><h3>${esc(run.title)}</h3>
      <div class="score">${full} of ${run.items.length} problems fully correct · ${pts}/${of} answers · ${fmtSec(totalSec)}</div>
      <ol class="steps sum">${run.results.map(r => `<li>${MB.problems[r.t].title}: ${r.skipped ? 'not answered' : r.n + '/' + r.of + ' in ' + fmtSec(r.sec) + (r.hints ? ' (with hints)' : '')}</li>`).join('')}</ol>
      ${codeHtml}
      <div class="actions"><button class="btn primary" id="again">${run.kind === 'set' ? 'Run the set again' : 'Back to practice'}</button></div></div>`;
    const cp = $('#doneCopy');
    if (cp) cp.addEventListener('click', () => copyText($('#doneCode'), $('#doneMsg')));
    $('#again').addEventListener('click', () => { if (run.kind === 'set') startFromSelect(); else { $('#probType').value = 'type:cpa'; $('#newProb').textContent = 'New problem'; newProblem('cpa'); } });
    endRunSilently();
    renderProgress();
  }
  function copyText(ta, msgEl) {
    const t = ta.value;
    const done = () => (msgEl.textContent = 'Copied to the clipboard.');
    const fallback = () => { ta.focus(); ta.select(); msgEl.textContent = 'Text selected — press Ctrl+C (⌘C) to copy.'; };
    try { navigator.clipboard.writeText(t).then(done, fallback); } catch (e) { fallback(); }
  }
  function tickTimer() {
    const p = app.practice, el = $('#probTimer'); if (!p || !el) return;
    const sec = p.checked ? p.sec : (performance.now() - p.start) / 1000;
    let txt = fmtSec(sec);
    const run = app.run;
    if (run && run.timeLimitMin) {
      const left = run.timeLimitMin * 60 - (Date.now() - run.startedAt) / 1000;
      if (left <= 0) return finishRun(true);
      txt += ' · ' + fmtSec(left) + ' left';
      el.classList.toggle('warn', left < 300);
    }
    el.textContent = txt;
  }

  // ================= Progress =================
  function renderProgress() {
    const s = stats(), path = MB.learningPath.filter(id => MB.problems[id]);
    const mastered = path.filter(id => s[id] && s[id].mastered).length, pct = Math.round(mastered / path.length * 100);
    const exams = store.get('exams', []), lastEx = exams[exams.length - 1];
    const groups = [];
    path.forEach(id => { const g = MB.problems[id].group; let grp = groups.find(x => x.g === g); if (!grp) groups.push(grp = { g, ids: [] }); grp.ids.push(id); });
    $('#sp-progress').innerHTML = `
      <div class="ready"><div class="readyhead"><h3>Fleet readiness</h3><b>${mastered}/${path.length}</b></div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <p class="hint">A problem type is <b>mastered</b> after three fully correct answers in a row without hints. Work down the path in order — each type builds on the ones above it. Progress is saved in this browser on this device.</p></div>
      <div class="exam"><div><h4>Qualification exam</h4><p class="hint">12 mixed problems, 60 minutes, no hints until each answer is checked. You get a completion code to send your instructor.${lastEx ? ` Last attempt: ${lastEx.full}/${lastEx.n} fully correct.` : ''}</p></div>
        <button class="btn primary" id="examGo">Start exam</button></div>
      ${groups.map(grp => `<h4>${grp.g}</h4><div class="path">${grp.ids.map(id => {
        const r = s[id], p = MB.problems[id];
        const status = !r ? '<span class="st st0">Not started</span>' : r.mastered ? '<span class="st st2">Mastered</span>' : `<span class="st st1">Streak ${r.streak || 0}/3</span>`;
        return `<div class="prow"><div><b>${p.title}</b><span>${r ? `${r.correct}/${r.tries} correct${r.best != null ? ' · best ' + fmtSec(r.best) : ''}` : p.blurb}</span></div>${status}<button class="btn sm" data-pp="${id}">Practice</button></div>`;
      }).join('')}</div>`).join('')}
      <div class="actions"><button class="btn sm" id="resetProg">Reset my progress</button><span id="resetConfirm" hidden>Erase all progress on this device? <button class="btn sm danger" id="resetYes">Erase</button> <button class="btn sm" id="resetNo">Keep</button></span></div>`;
    $$('[data-pp]').forEach(b => b.addEventListener('click', () => { endRunSilently(); $('#probType').value = 'type:' + b.dataset.pp; $('#newProb').textContent = 'New problem'; newProblem(b.dataset.pp); setSide('practice'); }));
    $('#examGo').addEventListener('click', startExam);
    $('#resetProg').addEventListener('click', () => ($('#resetConfirm').hidden = false));
    $('#resetNo').addEventListener('click', () => ($('#resetConfirm').hidden = true));
    $('#resetYes').addEventListener('click', () => { store.set('stats', {}); store.set('exams', []); renderProgress(); });
  }
  function startExam() {
    const groups = {};
    MB.problemList.forEach(p => (groups[p.group] = groups[p.group] || []).push(p.id));
    const items = [];
    Object.values(groups).forEach(ids => { const pool = ids.slice(); for (let k = 0; k < 2 && pool.length; k++) items.push({ t: pool.splice(Math.floor(Math.random() * pool.length), 1)[0] }); });
    while (items.length < 12) items.push({ t: MB.pick(MB.problemList).id });
    items.sort(() => Math.random() - 0.5);
    items.forEach(it => (it.i = MB.problems[it.t].generate()));
    const name = store.get('name', '');
    $('#probArea').innerHTML = `<div class="pcard"><h3>Qualification exam</h3><p class="stmt">12 problems across every topic. You have 60 minutes. Hints, the solver and the lessons are closed until you check each answer. Have paper, pencil, dividers and a MoBoard sheet ready — or use the digital board.</p>
      <label class="stack">Your name (goes on your completion code)<input id="exName" autocomplete="name" value="${esc(name)}"></label>
      <div class="actions"><button class="btn primary" id="exStart">Begin — the clock starts now</button></div><p class="err" id="exErr"></p></div>`;
    setSide('practice');
    $('#exStart').addEventListener('click', () => {
      const n = $('#exName').value.trim();
      if (!n) { $('#exErr').textContent = 'Enter your name first.'; return; }
      store.set('name', n);
      startRun({ kind: 'exam', title: 'Qualification exam', items, allowHints: false, timeLimitMin: 60, name: n });
    });
  }

  // ================= Instructor =================
  const draft = { custom: [] };
  function renderInstructor() {
    const groups = {};
    MB.problemList.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
    $('#asTypes').innerHTML = Object.entries(groups).map(([g, ps]) => `<div><h5>${g}</h5>${ps.map(p => `<label class="check"><input type="checkbox" value="${p.id}"> ${p.title}</label>`).join('')}</div>`).join('');
    renderCustom();
  }
  function renderCustom() {
    $('#asCustom').innerHTML = draft.custom.length
      ? `<h5>Your own problems (from the Solver)</h5>` + draft.custom.map((c, i) => `<div class="m"><span>${MB.problems[c.t].title}</span><button class="icon" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('')
      : `<p class="hint">To use exact numbers from a textbook or exercise, enter them in the Solver, then press “Add to assignment”.</p>`;
    $$('[data-rm]').forEach(b => b.addEventListener('click', () => { draft.custom.splice(+b.dataset.rm, 1); renderCustom(); }));
  }
  $('#asMake').addEventListener('click', () => {
    const types = $$('#asTypes input:checked').map(i => i.value), per = Math.max(1, Math.min(10, +$('#asPer').value || 1));
    const items = [];
    types.forEach(t => { for (let k = 0; k < per; k++) items.push({ t, i: MB.problems[t].generate() }); });
    draft.custom.forEach(c => items.push(c));
    if (!items.length) { $('#asMsg').textContent = 'Pick at least one problem type or add a problem from the Solver.'; return; }
    if (items.length > 40) { $('#asMsg').textContent = 'Keep an assignment to 40 problems or fewer.'; return; }
    const a = { v: 1, id: Math.random().toString(36).slice(2, 8), title: $('#asTitle').value.trim() || 'MoBoard assignment', hints: $('#asHints').checked,
      timeLimitMin: Math.max(0, +$('#asTime').value || 0), items };
    $('#asCode').value = encodeAssignment(a);
    $('#asMsg').textContent = `Created “${a.title}”: ${items.length} problems${a.timeLimitMin ? ', ' + a.timeLimitMin + ' min limit' : ''}${a.hints ? ', hints allowed' : ', no hints'}. Every trainee gets the same numbers.`;
  });
  $('#asCopy').addEventListener('click', () => copyText($('#asCode'), $('#asMsg')));
  let roster = [];
  $('#rsGo').addEventListener('click', () => {
    const lines = $('#rsIn').value.split(/\s+/).filter(Boolean);
    roster = []; let bad = 0;
    lines.forEach(l => { const d = decodeResult(l); if (d) roster.push(d); else bad++; });
    if (!roster.length) { $('#rsOut').innerHTML = `<p class="err">No completion codes found. Each starts with MBR-.</p>`; return; }
    roster.sort((a, b) => (a.r.name || '').localeCompare(b.r.name || ''));
    $('#rsOut').innerHTML = `<div class="tablewrap"><table class="outtable roster"><thead><tr><th>Name</th><th>Assignment</th><th>Score</th><th>Time</th><th>Submitted</th></tr></thead><tbody>${roster.map(({ r, intact }) => {
      const pts = r.items.reduce((a, x) => a + x[1], 0), of = r.items.reduce((a, x) => a + x[2], 0), hints = r.items.some(x => x[4]);
      return `<tr><td>${esc(r.name || '—')}${intact ? '' : ' <span class="err">⚠ altered</span>'}</td><td>${esc(r.title)}</td><td>${pts}/${of}${hints ? ' (hints)' : ''}</td><td>${fmtSec(r.totalSec)}</td><td>${esc(new Date(r.at).toLocaleString())}</td></tr>`;
    }).join('')}</tbody></table></div>${bad ? `<p class="hint">${bad} line(s) were not completion codes and were skipped.</p>` : ''}
      <p class="hint">“⚠ altered” means the code was edited after it was issued. Codes deter casual tampering but are not a secure exam system.</p>`;
  });
  $('#rsCsv').addEventListener('click', () => {
    if (!roster.length) { $('#rsOut').innerHTML = '<p class="err">Build the roster first.</p>'; return; }
    const rows = [['Name', 'Assignment', 'Problem', 'Correct', 'Of', 'Seconds', 'Hints', 'Submitted', 'Code intact']];
    roster.forEach(({ r, intact }) => r.items.forEach(x => rows.push([r.name, r.title, MB.problems[x[0]] ? MB.problems[x[0]].title : x[0], x[1], x[2], x[3], x[4], r.at, intact ? 'yes' : 'NO'])));
    const csv = rows.map(row => row.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
    $('#rsCsvOut').hidden = false; $('#rsCsvOut').value = csv; copyText($('#rsCsvOut'), $('#rsMsg'));
  });
  renderInstructor();

  // ================= Scenario panel =================
  $('#presetSel').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.title}</option>`).join('');
  $('#presetLoad').addEventListener('click', () => { const sc = PRESETS[$('#presetSel').value].make(); loadScenario(sc); moboard.overlay = null; setSolutionShown(false); });
  function syncScenarioForm() {
    const o = MB.own(); if (!o) return;
    if (document.activeElement !== $('#osC')) $('#osC').value = pad3(o.ordCourse);
    if (document.activeElement !== $('#osS')) $('#osS').value = +o.ordSpeed.toFixed(1);
    $('#realistic').checked = sim.realistic;
    $('#windFrom').value = pad3(sim.wind.from); $('#windSpd').value = sim.wind.speed; $('#lightSel').value = sim.light;
  }
  $('#osApply').addEventListener('click', () => MB.orderShip(MB.own(), +$('#osC').value, +$('#osS').value));
  ['#osC', '#osS'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') $('#osApply').click(); }));
  $('#realistic').addEventListener('change', e => (sim.realistic = e.target.checked));
  ['#windFrom', '#windSpd'].forEach(s => $(s).addEventListener('change', () => { sim.wind = { from: n360(+$('#windFrom').value || 0), speed: Math.max(0, +$('#windSpd').value || 0) }; }));
  $('#lightSel').addEventListener('change', e => { sim.light = e.target.value; bridge.setLight && bridge.setLight(sim.light); });
  $('#showCpa').addEventListener('change', updateContactReadouts);

  function renderContacts() {
    const own = MB.own(), list = $('#contactList');
    const ships = sim.ships.filter(s => s !== own);
    if (!ships.length) { list.innerHTML = '<p class="hint">No contacts. Add one to build your own scenario.</p>'; return; }
    list.innerHTML = ships.map(s => {
      const rel = sub(s, own);
      return `<div class="ccard" data-id="${s.id}">
        <div class="chead"><input class="cname" value="${esc(s.name)}" aria-label="Contact name">
          <select class="ctype" aria-label="Ship type">${TYPES.map(t => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <button class="icon cdel" aria-label="Remove ${esc(s.name)}" title="Remove">✕</button></div>
        <div class="fgrid">
          <label>Bearing °T<input class="cb" value="${pad3(brg(rel))}" inputmode="numeric"></label>
          <label>Range nm<input class="cr" value="${len(rel).toFixed(1)}" inputmode="decimal"></label>
          <label>Course °T<input class="cc" value="${pad3(s.ordCourse)}" inputmode="numeric"></label>
          <label>Speed kts<input class="cs" value="${+s.ordSpeed.toFixed(1)}" inputmode="decimal"></label>
        </div>
        <label class="check"><input type="checkbox" class="cguide" ${s.role === 'guide' ? 'checked' : ''}> Formation guide</label>
        <div class="clive"></div>
        <div class="mans">${s.maneuvers.map((m, i) => `<div class="m"><span>${fmtClock(m.t)} → ${m.course != null ? pad3(m.course) + '°' : '—'} / ${m.speed != null ? m.speed + ' kts' : '—'}</span><button class="icon mdel" data-i="${i}" aria-label="Remove maneuver">✕</button></div>`).join('')}</div>
        <div class="madd"><input class="mt" placeholder="hhmm" aria-label="Maneuver time" inputmode="numeric"><input class="mc" placeholder="crs" aria-label="New course" inputmode="numeric"><input class="ms" placeholder="kts" aria-label="New speed" inputmode="decimal"><button class="btn sm madd-go">Schedule</button></div>
        <div class="actions"><button class="btn sm primary capply">Apply changes</button><button class="btn sm clook">Look at it</button></div>
      </div>`;
    }).join('');
    $$('.ccard', list).forEach(card => {
      const s = MB.shipById(card.dataset.id), q = c => card.querySelector(c);
      q('.capply').addEventListener('click', () => {
        const own = MB.own(), rel = sub(s, own);
        s.name = q('.cname').value.trim() || s.name; s.type = q('.ctype').value;
        const b = +q('.cb').value, r = +q('.cr').value;
        if (!isNaN(b) && !isNaN(r) && (Math.abs(b - Math.round(brg(rel))) > 0.5 || Math.abs(r - len(rel)) > 0.05)) {
          const p = add(own, vec(b, r)); s.x = p.x; s.y = p.y; radar.painted = {};
        }
        if (q('.cguide').checked) sim.ships.forEach(o => { if (o.role === 'guide') o.role = 'contact'; });
        if (s.role !== 'own') s.role = q('.cguide').checked ? 'guide' : 'contact';
        MB.orderShip(s, +q('.cc').value, +q('.cs').value);
        renderContacts();
      });
      q('.cdel').addEventListener('click', () => { sim.ships = sim.ships.filter(o => o !== s); renderContacts(); });
      q('.clook').addEventListener('click', () => { bridge.lookAt && bridge.lookAt(brg(sub(s, MB.own()))); if ($('.views').dataset.view === 'radar' || $('.views').dataset.view === 'moboard') setView('bridge'); });
      q('.madd-go').addEventListener('click', () => {
        const t = MB.parseClock(q('.mt').value), c = q('.mc').value.trim(), sp = q('.ms').value.trim();
        if (isNaN(t) || (c === '' && sp === '')) { q('.mt').focus(); return; }
        MB.addManeuver(s, { t: t < sim.t - 43200 ? t + 86400 : t, course: c === '' ? null : n360(+c), speed: sp === '' ? null : +sp });
        renderContacts();
      });
      $$('.mdel', card).forEach(b => b.addEventListener('click', () => { s.maneuvers.splice(+b.dataset.i, 1); renderContacts(); }));
    });
    updateContactReadouts();
  }
  function updateContactReadouts() {
    const own = MB.own(); if (!own) return;
    $$('#contactList .ccard').forEach(card => {
      const s = MB.shipById(card.dataset.id); if (!s) return;
      const d = MB.cpaData(s, own);
      let t = `Now ${pad3(d.brg)}° · ${d.rng.toFixed(2)} nm · on ${pad3(s.course)}° at ${s.speed.toFixed(1)} kts`;
      if ($('#showCpa').checked) t += d.tcpaMin > 0 ? ` · CPA ${d.cpaRng.toFixed(2)} nm at ${fmtClock(sim.t + d.tcpaMin * 60)}` : ' · opening';
      card.querySelector('.clive').textContent = t;
      ['.cc', '.cs'].forEach(k => { const el = card.querySelector(k); if (document.activeElement !== el) el.value = k === '.cc' ? pad3(s.ordCourse) : +s.ordSpeed.toFixed(1); });
    });
  }
  MB.on('ships', () => { syncScenarioForm(); });
  $('#addContact').addEventListener('click', () => {
    const own = MB.own(), n = sim.ships.length, p = add(own, vec(45 + n * 40, 6));
    sim.ships.push(MB.makeShip({ name: 'Skunk ' + String.fromCharCode(64 + n), type: 'merchant', x: p.x, y: p.y, course: 270, speed: 10 }));
    renderContacts();
  });
  function scenarioJson() {
    return JSON.stringify({ t: sim.t, wind: sim.wind, light: sim.light, realistic: sim.realistic,
      ships: sim.ships.map(s => ({ name: s.name, type: s.type, role: s.role, x: +s.x.toFixed(4), y: +s.y.toFixed(4), course: s.ordCourse, speed: s.ordSpeed, td: s.td, maneuvers: s.maneuvers })) });
  }
  function loadJson(txt) {
    try {
      const sc = JSON.parse(txt);
      if (!Array.isArray(sc.ships) || !sc.ships.some(s => s.role === 'own')) throw new Error('needs a ships list with one own ship');
      loadScenario(sc); moboard.overlay = null; setSolutionShown(false); $('#scMsg').textContent = 'Scenario loaded.';
    } catch (e) { $('#scMsg').textContent = 'That text is not a valid scenario (' + e.message + ').'; }
  }
  $('#scCopy').addEventListener('click', () => {
    const t = scenarioJson(); $('#scJson').value = t;
    const done = () => ($('#scMsg').textContent = 'Copied to the clipboard.');
    const fallback = () => { $('#scJson').select(); $('#scMsg').textContent = 'Text selected — press Ctrl+C (⌘C) to copy.'; };
    try { navigator.clipboard.writeText(t).then(done, fallback); } catch (e) { fallback(); }
  });
  $('#scLoad').addEventListener('click', () => loadJson($('#scJson').value));
  $('#scSave').addEventListener('click', () => { store.set('saved', scenarioJson()); $('#scMsg').textContent = 'Saved in this browser.'; });
  $('#scRestore').addEventListener('click', () => { const t = store.get('saved', null); if (t) loadJson(t); else $('#scMsg').textContent = 'Nothing saved in this browser yet.'; });

  // ================= Solver =================
  $('#solverType').innerHTML = typeOptions(false);
  function buildSolverForm(inp) {
    const def = MB.problems[$('#solverType').value];
    $('#solverForm').innerHTML = def.inputs.map(f => `<label>${f.label}${MB.KIND[f.kind].unit ? ' (' + MB.KIND[f.kind].unit + ')' : ''}<input id="sv-${f.key}" value="${inp ? MB.formatField(f.kind, inp[f.key]) : ''}" inputmode="${f.kind === 'clock' ? 'numeric' : 'decimal'}" autocomplete="off"></label>`).join('');
    $('#solverOut').innerHTML = '';
  }
  $('#solverType').addEventListener('change', () => buildSolverForm(MB.problems[$('#solverType').value].generate()));
  $('#solverEx').addEventListener('click', () => buildSolverForm(MB.problems[$('#solverType').value].generate()));
  $('#solverCur').addEventListener('click', () => {
    if (!app.practice) return;
    $('#solverType').value = app.practice.def.id; buildSolverForm(app.practice.inp);
  });
  $('#solverForm').addEventListener('submit', e => { e.preventDefault(); runSolver(); });
  $('#solverForm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSolver(); } });
  $('#solverGo').addEventListener('click', runSolver);
  function runSolver() {
    const def = MB.problems[$('#solverType').value], inp = {};
    for (const f of def.inputs) {
      const v = MB.parseField(f.kind, $('#sv-' + f.key).value);
      if (isNaN(v)) { $('#solverOut').innerHTML = `<p class="err">Enter a value for “${f.label}”${f.kind === 'clock' ? ' as hhmm, e.g. 0806' : ''}.</p>`; $('#sv-' + f.key).focus(); return; }
      inp[f.key] = v;
    }
    const sol = def.solve(inp);
    if (sol.error) { $('#solverOut').innerHTML = `<p class="err">${sol.error}</p>`; return; }
    app.solver = { def, inp, sol };
    $('#solverOut').innerHTML = `<div class="pcard"><table class="outtable">${def.answers.map(f => `<tr><td>${f.label}</td><td>${MB.formatField(f.kind, sol.ans[f.key])} ${MB.KIND[f.kind].unit}</td></tr>`).join('')}</table>
      <ol class="steps">${sol.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <div class="actions"><button class="btn primary" id="svPlot">Plot on MoBoard</button><button class="btn" id="svLoad">Load on scope</button><button class="btn" id="svPractice">Practice this problem</button><button class="btn" id="svAssign">Add to assignment</button></div><p class="hint" id="svMsg"></p></div>`;
    $('#svAssign').addEventListener('click', () => { draft.custom.push({ t: def.id, i: inp }); renderCustom(); $('#svMsg').textContent = `Added. The Instructor tab now has ${draft.custom.length} problem(s) of your own.`; });
    $('#svPlot').addEventListener('click', () => { showOverlay(sol.overlay, true); const v = $('.views').dataset.view; if (v === 'bridge' || v === 'radar') setView('moboard'); });
    $('#svLoad').addEventListener('click', () => { loadScenario(def.scenario(inp, sol)); showOverlay(sol.overlay, true); });
    $('#svPractice').addEventListener('click', () => { endRunSilently(); $('#probType').value = 'type:' + def.id; newProblem(def.id, inp); setSide('practice'); });
  }
  buildSolverForm(MB.problems[$('#solverType').value].generate());

  // ================= Lessons =================
  const FUND = [
    ['How to train with this app', `<ul>
      <li><b>Learn:</b> read these fundamentals, then the lesson for a problem type.</li>
      <li><b>Practice with support:</b> turn on “Coach me” and use “Hint: next step” — each hint draws the next part of the solution on the MoBoard.</li>
      <li><b>Practice without support:</b> three fully correct answers in a row with no hints masters a type. Follow the path on the Progress tab.</li>
      <li><b>See the consequences:</b> “Run my answer” plays your course and speed on the radar and bridge, so you watch whether the contact really passes where you said.</li>
      <li><b>Get fast:</b> every problem is timed. On watch you will have a few minutes, not a class period, to solve a CPA.</li>
      <li><b>Prove it:</b> take the qualification exam on the Progress tab and send the completion code to your instructor.</li></ul>`],
    ['The board',`<p>The maneuvering board is a polar plot: ten evenly spaced rings, radials every 10°, and a degree scale around the edge. The center is the <b>reference</b> — usually own ship for contact work, the guide for stationing.</p>
      <p>You pick two scales: one for <b>distance</b> (nm or yards per ring) and one for <b>speed</b> (knots per ring). Relative positions use the distance scale; vectors use the speed scale. Label your scales before you plot anything.</p>`],
    ['Speed, time and distance', `<ul><li>Distance = speed × time.</li><li><b>Three-minute rule:</b> yards covered in 3 minutes = speed × 100.</li><li><b>Six-minute rule:</b> nautical miles in 6 minutes = speed ÷ 10.</li><li>Tactical work uses 2,000 yds ≈ 1 nm.</li></ul>`],
    ['Relative motion and the e-r-m triangle', `<p>The <b>relative plot</b> shows where a ship is relative to the reference over time; its track is the relative motion line (RML).</p>
      <p>The <b>speed triangle</b> links true and relative motion: <b>e→r</b> is the reference ship's true vector, <b>e→m</b> is the maneuvering ship's true vector, and <b>r→m</b> is the relative vector. r→m is always parallel to the RML and points the same way — that one rule solves nearly every problem.</p>`],
    ['Reading a contact', `<ul><li>Steady bearing, decreasing range: risk of collision.</li><li>DRM and SRM describe the RML; CPA is the foot of the perpendicular from the center.</li><li>Use the scope: set the EBL/VRM on a contact (tap the radar) and watch the bearing drift.</li></ul>`],
  ];
  function renderLessons() {
    const groups = {};
    MB.problemList.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
    let html = `<h4>Fundamentals</h4>` + FUND.map(([t, b], i) => `<details ${i === 0 ? 'open' : ''}><summary>${t}</summary><div>${b}</div></details>`).join('');
    for (const g in groups) {
      html += `<h4 style="margin-top:8px">${g}</h4>` + groups[g].map(p => `<details><summary>${p.title}</summary><div><p>${p.lesson.summary}</p><ul>${p.lesson.keys.map(k => `<li>${k}</li>`).join('')}</ul>
        <div class="actions"><button class="btn sm primary" data-lp="${p.id}">Practice</button><button class="btn sm" data-ls="${p.id}">Open in solver</button></div></div></details>`).join('');
    }
    $('#sp-lessons').innerHTML = `<p class="hint">These are summaries for review — keep the Maneuvering Board Manual (Pub. 217) as your reference.</p>` + html;
    $$('[data-lp]').forEach(b => b.addEventListener('click', () => { endRunSilently(); $('#probType').value = 'type:' + b.dataset.lp; newProblem(b.dataset.lp); setSide('practice'); }));
    $$('[data-ls]').forEach(b => b.addEventListener('click', () => { $('#solverType').value = b.dataset.ls; buildSolverForm(MB.problems[b.dataset.ls].generate()); setSide('solver'); }));
  }
  renderLessons();

  // ================= Main loop =================
  let last = performance.now(), acc = 0;
  const panes = { b: $('#pane-bridge'), r: $('#pane-radar'), m: $('#pane-moboard') };
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (sim.running) MB.advance(dt * sim.rate);
    if (visible(panes.b) && bridge.ok()) bridge.render();
    if (visible(panes.r)) radar.draw(dt);
    acc += dt;
    if (acc > 0.25) {
      acc = 0; updateHeader(); radar.updateTable(); updateContactReadouts(); tickTimer();
      if (visible(panes.m) && sim.running) moboard.draw();
    }
    requestAnimationFrame(frame);
  }
  newProblem('cpa');
  renderProgress();
  radar.updateReadout(); moboard.updateReadout();
  // Installable / offline when hosted on its own site (service workers don't run inside the Claude viewer)
  try {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !/claude\.ai|claudeusercontent/.test(location.hostname))
      navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (e) { /* not available here */ }
  // Showcase states for app-store screenshots: open the page with #demo-split, #demo-moboard,
  // #demo-bridge, #demo-radar or #demo-progress. Nothing is saved.
  const demo = (location.hash.match(/^#demo-(\w+)$/) || [])[1];
  const demoBinos = () => { if (bridge.toggleBinos && !bridge.binos) { bridge.toggleBinos(); $('#pane-bridge [data-b="binos"]').setAttribute('aria-pressed', true); } };
  if (demo === 'split' || demo === 'bridge') demoBinos();
  if (demo === 'split') {
    setView('split');
    // Pick a problem whose contact is close enough to see from the bridge
    for (let i = 0; i < 40; i++) { newProblem('cpa'); if (len(sub(sim.ships[1], MB.own())) < 7) break; }
    sim.ships[1].type = 'merchant'; // a small craft would be hull-down at this range
    bridge.lookAt && bridge.lookAt(brg(sub(sim.ships[1], MB.own())));
  }
  if (demo === 'moboard') { setView('moboard'); newProblem('avoid_course'); reveal(); }
  if (demo === 'bridge') {
    setView('bridge'); loadScenario(Object.assign(PRESETS.strait.make(), { light: 'day' }));
    const a = sim.ships.find(s => s.name === 'Skunk D'); bridge.lookAt && bridge.lookAt(brg(sub(a, MB.own())));
  }
  if (demo === 'radar') {
    setView('radar'); loadScenario(PRESETS.strait.make()); MB.advance(600);
    radar.showTargets = true; $('#pane-radar [data-r="targets"]').setAttribute('aria-pressed', true); radar.updateTable();
  }
  if (demo === 'progress') {
    demoStats = {};
    MB.learningPath.forEach((id, i) => { if (i < 9) demoStats[id] = { tries: 5 + i % 3, correct: 4 + i % 3, streak: 3, mastered: true, best: 95 + i * 17 }; else if (i < 12) demoStats[id] = { tries: 3, correct: 2, streak: i - 9 + 1, mastered: false, best: 240 }; });
    setView('split'); renderProgress(); setSide('progress');
    requestAnimationFrame(() => $('.side').scrollIntoView());
  }
  requestAnimationFrame(frame);
  MB.app = { loadScenario, newProblem, bridge, radar, moboard };
})(window.MB);
