# Last 10m — So close, yet so far

A spatial-AI simulation of the **last ten metres of drone delivery**. v2 is **one shared miniature city with nine fixed
drones (D-01 … D-09) running a stream of orders**. Nine kinds of trouble (the old nine scenes) happen at the drop spots,
at a rate that depends on the environment you set. They are ranked into three urgency tiers with countdowns, so you —
the operator — are overloaded and have to triage. At the end a scorecard shows how you did, and the last two runs are
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
| **Map** | *Where* is trouble? Each drone's route (thin black line, dashed on the way home), a **red dot where each incident happened** (colour = tier), and the **red circle** of the delivery radius around the hub. | Default view, or **Map** in the top switch |
| **Monitor · 9** | *What* is happening? A 3 × 3 wall of nine **drone cameras**. A cell with an event shows its tier badge; tier ① cells flash. | **Monitor · 9** |
| **Scene** | *What do we do?* One drone: camera, five checks, FOUND / WHY NOT / TRIED / PROPOSES, the answer options with a countdown, commands, timeline and Distance to You. | Click a cell, a map marker or a row in **To resolve** |

## The Simulation board (right column, same place on every page)

| Group | Control |
|---|---|
| City | **Building cluster**: High-rise heavy · Low-rise heavy · Mixed / interleaved (the hub, roads, parade street and crowd zone always stay) |
| Orders | **Orders count** · **Urgent ratio** · **Delivery radius** (the red circle follows the slider) |
| Agents | **Pigeon flocks** · **Pedestrians** · **Dogs** · **Customer reply rate** |
| Weather | **Gust frequency** (no steady wind) |
| Memory | **Fresh / Retained** |
| Run | Seed · Pause / speed / Reset · **Apply & restart** |

Everything else (battery, hover budget, timeouts, backup spots) is a code constant in `last10m/world.js`.

## Event hierarchy

| Tier | Events | Countdown | If nobody acts |
|---|---|---|---|
| **① Critical** (red, flashing) | pedestrian in the descent zone · two-drone conflict · sudden no-fly zone · gust toward a building | 5–8 s | the fixed rule applies; a **missed decision** with a bigger penalty |
| **② Urgent** (orange) | dog on the drop zone · pigeon flock in the path · sensor occluded | 15–20 s | keep waiting; abort and return after the hover limit |
| **③ Can wait** (yellow) | car parked on the pad · customer silent | 45–60 s | on timeout abort; the order goes back to the queue |

An **urgent order raises an event by one tier**. **Safety is never left to the human:** in a tier ① event the drone
first stops, reels up, hovers or yields on its own, *then* asks you what to do next. A slow operator costs time and
score, never a person or a dog. **To resolve** is sorted by tier, then time left. Conflict rule: urgent first, then the
lower drone ID; the other yields and you can override.

## Scorecard and comparison

When every order is delivered or aborted (or at the 900 s cap) a card shows: average reaction time by tier, missed
decisions, delivered / backup / aborted %, redelivered orders, closest approach during tier ① events, events per minute and
peak queue length. The **last two runs** are kept with their settings and shown side by side (the better value is
highlighted). Variants are never generated for you: change the board, **Apply & restart**, and compare.

## Tests

`npm test` — engine tests for determinism, termination, tier bumping, tier ① auto-safety, conflict priority, event rates
vs. board values and city preset, retained-memory speed-up and the scorecard (`tests/last10m-world.test.js`), plus the v1
state-machine tests (`tests/last10m-sim.test.js`) and the earlier AIRSPACE / parade tests.

See [`docs/SEMANTIC_MODEL.md`](docs/SEMANTIC_MODEL.md) for the semantic model (environment, locations, distances, agents,
memory, event hierarchy, parameters). The original AIRSPACE README is in `docs/README-airspace.md`.
