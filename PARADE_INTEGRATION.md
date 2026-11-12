# Parade experiment in the AIRSPACE shell

The delivery simulation is replaced by a deterministic parade experiment (default). The original delivery simulator is still
available at `index.html?mode=legacy`. Engine files come from the supplied `nyc-parade` package; the UI is the existing shell.

**Engine (unchanged logic):** `parade.js`, `parade-methods.js` (Fixed Priority / Cost Negotiation / Slot Bidding), `parade-events.js`
(Balloon Drift 20–42 s, Pigeon Flock 26–54 s, Confetti 38–62 s, Wind Gust 68–86 s), `parade-environment.js` (balloon, marchers, handlers,
spectators, 22.5 m crowd reservations), `parade-incidents.js` (encounter grouping). 0.05 s fixed steps, 150 s window, departures 0 / 4 / 8 / 12 s.

**Where it lives in the existing UI**

| Existing slot | Now shows |
|---|---|
| Top bar: Run / speed / Reset | Start-Pause-Resume, speed, restart with the active conditions |
| Top bar: Inspection / Placements | *Locate parade* / *Whole city* camera shortcuts (Tour hidden) |
| Status bar | Time, fleet, delivered, method, encounters, run state, current event |
| Operations card | Event conditions switch and Method stepper (staged after the first tick) |
| Incident Queue | Encounter log, tabs Urgent / Conflict / Notice; click opens the replay |
| Fleet Monitoring | Per-drone state, mission, altitude, ETA, battery and a shared 0–150 s event axis |
| Drone inspector | Status, machine view, sensor knowledge, surface landmarks (approve / reject), history |
| Event inspector (same card) | Independent historical replay with its own play, scrub, speed, camera and knowledge view |
| Advanced drawer | Experiment setup (+ Apply & Restart / Discard), Results, Decision Trace, Model Info, Export JSON |

Visuals use the monochrome ink style: the balloon, crowd, pigeons, confetti and gusts are drawn in white/black/grey tones.
`npm test` runs the engine checks together with the existing tests.
