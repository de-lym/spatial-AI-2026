// Guided tour: an opt-in walkthrough (Accept / Skip) of every function of the operations interface.
// Look: Figma-style popover card with a tail, a preview strip with mini controls and a cursor, a spotlight frame
// with corner handles (selection-frame look) and a floating label pill; a small handwritten margin note per step.
const KEY = 'airspace-tour-dismissed';
const CURSOR = '<svg class="tcursor" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 2.5l15.5 8.3-6.8 1.9-2.6 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const SPARK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" fill="currentColor"/></svg>';

const STEPS = [
  { welcome: true, title: 'Introducing the AIRSPACE tour', text: 'Go from first glance to first flight — a one-minute walk through every function of the drone operations interface.' },
  { sel: '.simcontrols', tag: 'Simulation controls', title: 'Run time, change speed, reset', text: 'Run starts the flight simulation (Stage 4). Pick 0.5×–4× speed, or Reset to restore the four scripted deliveries.', chips: ['Run', '1×', 'Reset'], hit: 0, note: 'start here' },
  { sel: '#statusbar', tag: 'Live status', title: 'Operational status at a glance', text: 'Simulation time, fleet size, first deliveries, active alerts and the current stage, always visible.', chips: ['Time 42 s', 'Fleet 4/4', 'Alerts 0'], hit: 2, note: 'always on' },
  { sel: '.inprogress', tag: 'In Progress', title: 'What the whole fleet is doing', text: 'Flight Ops counts drones in the air, Hub Ops those at the station. It is fleet-wide and ignores selection.', chips: ['Flight Ops 4', 'Hub Ops 0'], hit: 0, note: 'fleet-wide' },
  { sel: '.fixedcontrols', tag: 'Operations', title: 'Intake, allocation, emergency', text: 'Switch order intake on or off, set how many drones are active, and see emergency commands for the selected drone.', chips: ['Order Intake', '− 4/4 +', 'Return'], hit: 1, note: 'try the +/–' },
  { sel: '.incidents', tag: 'Incident Queue', title: 'Alerts and updates', text: 'Critical and low-battery alerts stay open until resolved; Updates keeps the retained event log. Click “View drone” to jump to the source.', chips: ['Critical', 'Low battery', 'Updates'], hit: 0, note: 'check often' },
  { rect: 'map', tag: '3D map', title: 'The city, airspace and routes', text: 'Drag to orbit, scroll to zoom, click a drone to select it. Open the layers button (>) to toggle land use, permitted / restricted airspace and routes.', chips: ['Drag · orbit', 'Scroll · zoom', 'Click · select'], hit: 2, note: 'explore it' },
  { sel: '.fleet', tag: 'Fleet Monitoring', title: 'Every drone, every status', text: 'One row per drone with state, mission, altitude and ETA. Click a drone name to open its inspector. Each drone has its own colour.', chips: ['DR-01', 'DR-02', 'DR-03'], hit: 1, note: 'click a name' },
  { sel: '#inspector', tag: 'Drone inspector', title: 'Live follow-camera and details', text: 'The window at the top follows the selected drone in real time. Tabs show flight details, its location in the city, and its event history.', chips: ['Flight details', 'Location', 'History'], hit: 0, note: 'live view', inspector: true },
  { sel: '#btn-inspection', tag: 'Inspection', title: 'Pre-delivery orbit inspection', text: 'Every delivery first flies a full observation circuit around the drop-off, then runs model checks before landing. Start a dedicated demo here.', chips: ['Approach', 'Orbit', 'Check', 'Drop'], hit: 1, note: 'before drop-off' },
  { sel: '#btn-placements', tag: 'Placements', title: 'Skybridge placement tour', text: 'Two drones meet and pass BETWEEN two towers, UNDER the skybridge and NEXT TO each other, with live relation facts.', chips: ['BETWEEN', 'UNDER', 'NEXT TO'], hit: 1, note: 'three relations' },
  { sel: '#btn-advanced', tag: 'Advanced', title: 'Stages, queries and parameters', text: 'Step through the four stages, run spatial queries, edit land-use rules, route costs, separation and test situations.', chips: ['Stage 1–4', 'Queries', 'Rules'], hit: 0, note: 'power tools' },
  { done: true, title: 'You’re ready to fly', text: 'Press Run to start the simulation. You can reopen this tour any time from the Tour button in the header.' },
];

export function installTutorial({ selectDrone, clearDroneSelection, S }) {
  let i = 0, open = false, selectedByTour = false, root;
  const $ = (q, r = root) => r.querySelector(q);
  const store = { get() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }, set(v) { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } } };

  function build() {
    root = document.createElement('div'); root.className = 'tour'; root.hidden = true;
    root.innerHTML = `<div class="tour-block"></div><div class="tour-frame" hidden>${'<b></b>'.repeat(8)}</div>
      <div class="tour-pill" hidden>${SPARK}<span></span>${CURSOR}</div>
      <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <i class="tour-tail"></i>
        <header><h2 id="tour-title"></h2><button class="tour-x" aria-label="Close tour">×</button></header>
        <div class="tour-prev"><div class="tour-chips"></div><span class="tour-note"></span></div>
        <p class="tour-text"></p>
        <label class="tour-never"><input type="checkbox"> Don’t offer this tour again</label>
        <footer><span class="tour-dots"></span><span class="tour-actions"><button class="tour-skip">Skip tour</button><button class="tour-back">Back</button><button class="tour-next">Next</button></span></footer>
      </section>`;
    document.body.append(root);
    $('.tour-x').onclick = $('.tour-skip').onclick = () => close();
    $('.tour-next').onclick = () => { if (STEPS[i].done) close(true); else go(i + 1); };
    $('.tour-back').onclick = () => go(i - 1);
    $('.tour-never input').onchange = (e) => store.set(e.target.checked);
    addEventListener('keydown', (e) => { if (!open) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); $('.tour-next').click(); } else if (e.key === 'ArrowLeft' && i > 0) go(i - 1); });
    addEventListener('resize', () => open && place());
  }

  function targetRect(st) {
    if (st.rect === 'map') {
      const q = (s) => document.querySelector(s)?.getBoundingClientRect();
      const l = q('.left'), f = q('.fleet'), t = q('.statusbar');
      const x = (l?.right ?? 0) + 16, y = (t?.bottom ?? 0) + 8;
      return { left: x, top: y, width: innerWidth - 16 - x, height: (f?.top ?? innerHeight) - 8 - y };
    }
    const r = document.querySelector(st.sel)?.getBoundingClientRect();
    return r && r.width ? r : null;
  }

  function place() {
    const st = STEPS[i], card = $('.tour-card'), frame = $('.tour-frame'), pill = $('.tour-pill'), tail = $('.tour-tail');
    const r = st.welcome || st.done ? null : targetRect(st);
    card.style.visibility = 'hidden'; const cw = card.offsetWidth, ch = card.offsetHeight; card.style.visibility = '';
    if (!r) {
      frame.hidden = true; pill.hidden = true; tail.hidden = true;
      card.style.left = (innerWidth - cw) / 2 + 'px'; card.style.top = Math.max(16, innerHeight - ch - 64) + 'px'; root.classList.add('dim'); return;
    }
    root.classList.remove('dim');
    const pad = 6;
    Object.assign(frame.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' }); frame.hidden = false;
    $('span', pill).textContent = st.tag; pill.hidden = false;
    const pw = pill.offsetWidth;
    pill.style.left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), innerWidth - pw - 12) + 'px';
    pill.style.top = (r.top > 70 ? r.top - pad - 40 : r.bottom + pad + 8) + 'px';
    const g = 22, room = { right: innerWidth - r.right, left: r.left, bottom: innerHeight - r.bottom, top: r.top };
    const fits = { right: room.right >= cw + g, left: room.left >= cw + g, bottom: room.bottom >= ch + g + 40, top: room.top >= ch + g + 40 };
    const side = ['right', 'left', 'bottom', 'top'].find((s) => fits[s]) ?? null;
    const cl = (v, a, b) => Math.min(Math.max(a, v), Math.max(a, b));
    let x, y;
    if (side === 'right') { x = r.right + g; y = cl(r.top + r.height / 2 - ch / 2, 16, innerHeight - ch - 16); }
    else if (side === 'left') { x = r.left - g - cw; y = cl(r.top + r.height / 2 - ch / 2, 16, innerHeight - ch - 16); }
    else if (side === 'bottom') { y = r.bottom + g; x = cl(r.left + r.width / 2 - cw / 2, 16, innerWidth - cw - 16); }
    else if (side === 'top') { y = r.top - g - ch; x = cl(r.left + r.width / 2 - cw / 2, 16, innerWidth - cw - 16); }
    else { x = (innerWidth - cw) / 2; y = Math.max(16, (r.top - ch - g > 16 ? r.top - ch - g : r.bottom + g)); y = cl(y, 16, innerHeight - ch - 16); }
    card.style.left = x + 'px'; card.style.top = y + 'px';
    tail.hidden = !side; tail.dataset.side = side ?? '';
    tail.style.top = tail.style.left = '';
    if (side === 'right' || side === 'left') tail.style.top = cl(r.top + r.height / 2 - y - 8, 18, ch - 34) + 'px';
    else if (side) tail.style.left = cl(r.left + r.width / 2 - x - 8, 18, cw - 34) + 'px';
  }

  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const st = STEPS[i];
    if (st.inspector && S.couriers[0]) { selectDrone(S.couriers[0].id); selectedByTour = true; }
    else if (selectedByTour) { clearDroneSelection(); selectedByTour = false; }
    $('.tour-card').classList.toggle('welcome', !!st.welcome);
    $('#tour-title').textContent = st.title; $('.tour-text').textContent = st.text;
    const prev = $('.tour-prev');
    prev.hidden = !st.chips;
    $('.tour-chips').innerHTML = st.chips ? st.chips.map((c, k) => `<span class="${k === st.hit ? 'hit' : ''}">${c}${k === st.hit ? CURSOR : ''}</span>`).join('') : '';
    $('.tour-note').textContent = st.note ?? '';
    $('.tour-never').hidden = !st.welcome;
    $('.tour-skip').textContent = st.welcome ? 'Skip' : 'Skip tour'; $('.tour-skip').hidden = !!st.done;
    $('.tour-back').hidden = i === 0 || !!st.welcome;
    $('.tour-next').textContent = st.welcome ? 'Show me' : st.done ? 'Start exploring' : 'Next';
    $('.tour-dots').innerHTML = st.welcome ? '' : STEPS.slice(1).map((_, k) => `<i class="${k === i - 1 ? 'on' : ''}"></i>`).join('');
    requestAnimationFrame(() => { place(); $('.tour-next').focus({ preventScroll: true }); });
  }

  function start(force) { if (!root) build(); open = true; root.hidden = false; $('.tour-never input').checked = store.get(); go(0); }
  function close(finished) {
    open = false; if (root) root.hidden = true;
    if (selectedByTour) { clearDroneSelection(); selectedByTour = false; }
    if (!finished && STEPS[i]?.welcome && !$('.tour-never input').checked) { /* skipped: offered again next visit unless "don't offer again" is ticked */ }
  }
  return { start, close, maybeAutoStart() { if (!store.get()) start(); } };
}
