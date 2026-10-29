# spatial-AI-2026

## AIRSPACE — a land-use-aware drone delivery sandbox

A single-page vanilla-JavaScript web app (three.js) on top of the delivery-platform semantic model:
*navigable airspace is shaped not only by buildings but by the urban activity underneath.* Every ground block has a land use;
land use sets the permitted 3D volumes and the cost of flying over it; four drones plan validated smooth routes across the city and keep their distance;
every drone is described twice — as machine state and as a human-readable update.

![Live Flight](docs/screenshot-v3-live.png)

**Run:** serve the folder with any static server (ES modules need http), e.g. `python3 -m http.server`, then open `http://localhost:8000`.
three.js is vendored in `vendor/`; no network or build step is needed.

### Operations interface (full-page map with floating translucent panels)
The 3D map fills the whole page; the header, status pills, left cards, Fleet Monitoring and the drone inspector float over it as soft glass cards, with one orange accent for emphasis (Run, selection, counts, the drone illustration in the inspector). Map layers are collapsed behind a `>` button. Tall and low buildings, parks, water and utility lots are scattered across the whole city (no single tower district).
Left column Operations are direct controls (no menus): an **Order Intake** switch (off stops new orders; existing ones continue), a **Fleet Allocation** target `− n / N +` (idle drones are only drawn into service up to the target; flights in progress are never interrupted) and **Return / Repair / Land** buttons for the selected drone, which stay disabled because the simulator has no emergency-command API. The manual Accept / Mark Ready / Evaluate / Assign actions live in Advanced.
Header (Run/Pause, speed, Reset with confirmation, Advanced) · one status bar (time, fleet total/active, first deliveries, on-time, active alerts, simulation state) · left column (In Progress: Flight Ops / Hub Ops; Order Intake, Fleet Allocation, Emergency Response; Incident Queue tabs Critical / Low battery / Updates) · full-width map with the existing canvas · Fleet Monitoring table for all drones.
A **drone inspector** (Flight details / Location / History) overlays the map's right side only when a drone is explicitly selected (map click, fleet row, event). It is an absolute overlay: the map rect, renderer buffer and camera are identical with and without it. Close button, Escape or a click on empty map clears the selection. `DR-0x` is a display alias for the internal `D-0x`.
The stages, layers, spatial query, land-use rules, route-cost / separation parameters, test situations, statistics and log live in the **Advanced** drawer; nothing was removed.
Incidents come from a structured event store (`ops-events.js`) fed by real state transitions, not by parsing the log: `NO_VALID_ROUTE` opens one critical incident per drone and closes when the route recovers; Updates keep the newest 200. **Not modelled:** there is no battery model (Low battery stays 0 / "not connected"), no delivery deadline (On-time shows "—") and no emergency flight-command API (return / land / stop are shown disabled).

### Four stages (Advanced drawer stepper) and independent layers
1. **Land Use** — *What kind of place is this?* Each of the 49 blocks is Housing, CBD / Office, Green Space / Park, Logistics / Commercial or a Sensitive Facility, tinted softly on the ground. Click a block (the ground) for its ID, building height, simulated permission policy and risk cost.
2. **Airspace** — *Where can a drone fly?* Mint permitted prisms and blush-red restricted prisms with real height and dashed edges, generated from each block's rule, the building volumes and the altitude envelope. A green park block is not automatically green airspace.
3. **Routes** — *Which feasible route should it take?* Up to three different, fully collision-tested candidates per leg (thin dashed), scored with `w_length·length + w_climb·climb + w_landuse·risk-weighted exposure`; the cheapest becomes a smooth cobalt curve that was re-tested against every volume and building.
4. **Live Flight** — four drones (`D-01…D-04`) fly validated routes to pads at different edges of the city (one short, one medium, two long trips). A predicted conflict makes the lower-priority drone slow, yield or wait for clearance (`WAITING_FOR_CLEARANCE`), sidestep or re-plan; nothing is animated through another drone.

Toggles for **Land use / Permitted / Restricted / Candidate routes / Selected route** work independently of the stage. **All labels are hidden until their entity is selected.**

### Change a rule, change the airspace
Open *Land-use rules*: raising the Housing floor, lowering a risk cost or changing the Care Centre's restricted altitude **regenerates the prisms and re-plans every route**; *Route cost & separation* holds the three weights, separation distance, look-ahead and the test situations (*Conflict test* forces yielding within seconds; *Raise hazard HZ-1* shows `NO_VALID_ROUTE`).

### Location, both ways
* **Agent → location:** click a drone (or a fleet card). Console: `getLocation('D-02')` → XYZ, ground block, land use, risk cost, volumes, separation state, human description.
* **Location → agents:** click a prism or choose a block / volume in *Spatial inspector*. Console: `getAgentsAt('V-01')`, `getAgentsAt({block:'D4'})`, `getAgentsInBox(...)`. Membership uses X, Y **and** Z.

### Delivery model (unchanged semantics)
ORDER (revenue = box size; `pending → preparing → ready → assigned → picked_up → delivered`), CUSTOMER houses, RESTAURANT shops, PLATFORM tower (= launch hub), COURIER drones. The first four orders are scripted and pinned one per drone, so Stage 3's routes are the routes flown in Stage 4. Revenue-weighted priority is a **simulation hypothesis**.

### Look
Soft "clay" isometric city (orthographic camera, soft shadows, rounded forms). White massing, green parks, blue water; saturated colour is reserved for roles (restaurants coral/orange, customers forest/denim, platform navy, drones mustard with a small identifying cap) and for the airspace language: mint = permitted, blush red = restricted, amber = hazard, muted cyan/violet = candidates, cobalt = selected route; land-use tints are low-saturation ground colours.

### Files
`spatial.js` — land-use table, navigable-space model, candidate generation, cost, smoothing, volume queries. `main.js` — scene, delivery model, land use, airspace generation, separation, panels. `ops-events.js` — structured operations events for the Incident Queue. `index.html` / `style.css` — operations layout.
`docs/airspace-simulation-v3.md` — the V3 brief plus the implementation report (what worked, what was simplified); `docs/airspace-simulation.md` — the V2 record.
All geometry, land-use rules and parameters are synthetic classroom assumptions; nothing here claims regulatory compliance, real airspace authorization or validated risk scores.
