# spatial-AI-2026

## AIRSPACE — a location-aware drone delivery sandbox

A single-page vanilla-JavaScript web app (three.js) on top of the delivery-platform semantic model:
*airspace is a volume, not an empty background.* Four drones deliver orders across a fictional block city through
translucent **3D permitted prisms**, around **restricted prisms** and solid buildings — and every drone is described twice,
as machine state (XYZ, volume ids) and as a human-readable relational update.

![Airspace in Live Flight](docs/screenshot-airspace.png)

**Run:** serve the folder with any static server (ES modules need http), e.g. `python3 -m http.server`, then open `http://localhost:8000`.
three.js is vendored in `vendor/`; no network or build step is needed.

### Four stages (right-panel stepper)
1. **Airspace** — *Where can I fly?* Mint permitted prisms (decks V-01/V-02, corridor V-03 above V-02, landing columns at every pad) and blush-red restricted prisms (RZ-A, RZ-B, switchable amber hazard HZ-1), each with a floor, a ceiling and dashed edges.
2. **Candidate Routes** — *Where could I go?* Up to three genuinely different, fully collision-tested routes per leg (direct / left detour / right detour / climb over), shown as fine dashed curves. Never more than actually exist.
3. **Optimal Route** — *Which is best?* The cheapest candidate (3D distance + 1.5 × climb) is smoothed with Bézier arcs that are re-tested against every volume and building; alternatives fade, one cobalt curve remains.
4. **Live Flight** — *Where am I now?* Four drones (`D-01…D-04`) fly the validated curves on one clock; a newly blocked route pauses and re-plans, or reports `NO_VALID_ROUTE`.

Stages 1–3 keep the clock frozen; **Start flight** (or stage 4) runs it. **Reset** is deterministic.

### Location, both ways
* **Agent → location:** click a drone (or a fleet card) → *Robot view* and *Human view* from the same state. Console: `getLocation('D-02')`.
* **Location → agents:** click a prism or pick it in *Spatial query* → id, X/Y/Z extents, permission, drones inside. Console: `getAgentsAt('V-03')`, `getAgentsInBox(xMin, xMax, yMin, yMax, zMin, zMax)`. Membership uses X, Y **and** Z.

### Delivery model (unchanged semantics)
ORDER (revenue = box size; `pending → preparing → ready → assigned → picked_up → delivered`), CUSTOMER houses, RESTAURANT shops with
preparation time and capacity, PLATFORM tower (= launch hub), COURIER drones (capacity 2 orders). The first four orders are scripted and
pinned one per drone so the routes previewed in Stages 2–3 are the ones flown. Revenue-weighted priority is a **simulation hypothesis**.
The *Delivery platform* section keeps the manual controls; every agent can be switched between auto and manual.

### Look
Soft "clay" isometric city (orthographic camera, soft shadows, rounded forms). White massing, green parks, blue water; saturated colour is
reserved for roles (restaurants coral/orange, customers forest/denim, platform navy, drones mustard with a small identifying cap) and for the
airspace language: mint = permitted, blush red = restricted, amber = hazard, muted cyan/violet = candidates, cobalt = selected route.

### Files
`spatial.js` — navigable-space model, candidate generation, smoothing, volume queries. `main.js` — scene, delivery model, panels.
`docs/airspace-simulation.md` — the specification plus the implementation report. All geometry and parameters are synthetic classroom
assumptions; nothing here claims regulatory compliance or real airspace authorization.
