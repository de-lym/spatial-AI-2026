# Last 10m — So close, yet so far

A spatial-AI simulation of the **last ten metres of drone delivery**. v2 is **one shared miniature city with nine fixed
drones (D-01 … D-09) running a stream of orders**. Nine kinds of trouble (the old nine scenes) happen at the drop spots,
at a rate that depends on the environment you set. They are ranked into three urgency tiers: critical ones the drones handle
by themselves, the rest wait on hold for you — the operator — so you are overloaded and have to triage. At the end a scorecard shows how you did, and the last two runs are
compared side by side: running twice in two environments is how you *design* an environment.

*Your package is only ten metres away. That doesn't mean you're getting it.*

## Run

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> (ES modules need HTTP; do not open the file directly). No build step; three.js is vendored.
The original AIRSPACE operations app is still available at <http://localhost:8000/airspace.html>.

## Three views

| View | What it answers | How to get there |
|---|---|---|
| **Map** | *Where* is trouble? A thin 3D trail of every flight (solid on the way out, dashed on the way home; the **Trails** button switches it on and off), a **dot where each incident happened** (colour = tier), and a colour-coded **!** bubble above a drone that has an open event. | Default view, or **Map** in the top switch |
| **Monitor · 9** | *What* is happening? A 3 × 3 wall of nine **drone cameras**, each welded to its own drone (the drone is always the centre of the picture). A cell with an event shows its tier badge; tier ① cells flash. The **⟳** button of a cell (and **View ⟳** in Scene) changes the view angle; nothing rotates by itself. | **Monitor · 9** |
| **Scene** | *What do we do?* One drone: camera, and a console that says only what happened, what the drone did and what you can do (the answer buttons); timeline and Distance to You. | Click a cell, a map marker or a row in **To resolve** |

## The Simulation board (right column, same place on every page)

| Group | Control |
|---|---|
| City | **Building cluster**: High-rise heavy · Low-rise heavy · Mixed / interleaved (the hub, roads, parade street and crowd zone always stay) |
| Orders | **Orders count** (orders arriving per 10 minutes) · **Urgent ratio** · **Delivery radius** (a green circle shows around the hub only while you drag the slider) |
| Agents | **Pigeon flocks** · **Pedestrians** · **Dogs** · **Customer reply rate** |
| Weather | **Gust frequency** (no steady wind) |
| Memory | **Fresh / Retained** |
| Run | Seed · Pause / speed / Reset · **Apply & restart** |

Everything else (battery, hover budget, timeouts, backup spots) is a code constant in `last10m/world.js`.

## The delivery model, and a city that never sleeps

Nine drones live on the plaza around the Dispatch Tower (never on a road), leave and land **one at a time**, and run a
**delivery** mission: fly to the **shop** (R1 Burger, R2 Ramen, R3 Slow-Roast), collect the order there (wait until it is
ready; one drone at a time on a shop pad, the others queue above it), then fly to the customer and run the last ten metres.
Every leg is planned by the AIRSPACE flying-boundary planner, so a drone never flies through a building. The parade balloon
is a moving obstacle: a drone that gets near it backs off and holds until it has passed. Orders keep arriving for as long as
the simulation runs — it only stops when you press **Pause**.

## Event hierarchy

| Tier | Events | What the drone does | What it waits for |
|---|---|---|---|
| **① Critical** (red, flashing) | pedestrian in the descent zone · two-drone conflict · sudden no-fly zone · gust toward a building | protects people **by itself** (stops, reels up, holds, yields by the priority rule) and **carries on by itself** when it is safe | nothing — you are told, and you may override (backup spot, send home, swap the conflict rule) |
| **② Urgent** (orange) | dog on the drop zone · pigeon flock in the path · sensor occluded | stops in a safe hover | **you**: it stays on hold until you decide |
| **③ Can wait** (yellow) | car parked on the pad · customer silent | stops in a safe hover | **you**: it stays on hold until you decide |

There are **no countdowns and no decisions taken for you**. A ② / ③ drone waits as long as you leave it; when the spot
clears by itself, the console says so and offers **Continue**. What a slow answer costs is waiting time: the drone is
stuck, the fleet delivers less and the score drops (only the battery reserve can still send a forgotten drone home).
An **urgent order raises an event by one tier**. **To resolve** lists the critical events the drones are handling first,
then everything on hold, longest waiting first. Conflict rule: urgent first, then the lower drone ID; the other yields.

## Shifts and the shift report

A run is a **shift of fixed length** (board: *Shift length*, 5–20 min, default 10). When it ends the world stops and the
**shift report** opens by itself (also available any time from the status bar). It is drawn rather than written:

* **Conditions** — the board settings as a row of pictograms.
* **Headline numbers** — delivered %, two-drone conflicts, events, average wait for you, fleet time on hold, score; each with
  ▲ / ▼ against the previous shift.
* **Orders** — a ring: delivered · at the backup spot · aborted (incl. customers who never answered) · not finished.
* **Map** — top-down plan of the city with every route flown, every incident (tier colour) and the delivery radius.
* **What happened** — the nine event types as bars in tier colours, plus what the drones handled by themselves.
* **The nine drones over the shift** — one bar per drone: at the drop spot · flying · at the shop · going home · on hold for
  you · critical, handled · at the hub.

**Start the next shift** keeps this one for the ▲ / ▼ comparison. Variants are never generated for you: change the board,
start the next shift, and compare.

Other rules worth knowing: a customer who has not answered for **5 minutes** is not coming — the drone flies home by
itself and the order is closed as *customer unreachable*. A parked car stays some time **after the drone arrives**.
Customers take their parcels in after 30–90 s; a drone that finds an earlier parcel still on the pad drops next to it.

## Tests

`npm test` — engine tests for determinism, termination, tier bumping, tier ① auto-safety, conflict priority, event rates
vs. board values and city preset, retained-memory speed-up and the scorecard (`tests/last10m-world.test.js`), plus the v1
state-machine tests (`tests/last10m-sim.test.js`) and the earlier AIRSPACE / parade tests.

See [`docs/SEMANTIC_MODEL.md`](docs/SEMANTIC_MODEL.md) for the semantic model (environment, locations, distances, agents,
memory, event hierarchy, parameters). The original AIRSPACE README is in `docs/README-airspace.md`.
