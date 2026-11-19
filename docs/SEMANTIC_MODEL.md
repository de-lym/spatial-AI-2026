# Last 10m — Semantic Model (v2)

The model behind the simulation: what exists, how it is located and measured, what each agent knows, wants and does,
how events are ranked, and how environments are designed and compared. Implementation references point to `last10m/`.

**v2 in one paragraph.** v1 had nine independent, scripted scenes. v2 is **one shared city with nine fixed drones
(D-01 … D-09) running a stream of orders.** The nine old scenes became **nine event types**. How often each one happens
depends on the environment the user sets. Events are sorted into **three urgency tiers** with countdowns, so the human
operator is overloaded and has to triage. When a run ends a **scorecard** shows how the operator did, and the last two
runs are compared side by side — running twice in two environments is how the user *designs* an environment.

## 1. Spatial idea

Physical proximity does not guarantee delivery. A drone can be ten metres from the customer and still fail, because the
last ten metres are full of things that move, block, hide or disagree: dogs, pedestrians, parked cars, pigeons, gusts,
other drones, a parade with confetti, a customer who does not answer. v2 puts all of them on one city at once.

## 2. Environment

| Property | Choice | Where |
|---|---|---|
| Physical vs abstract | **Physical** — a miniature city in metres (1 scene unit = 5 m) | `scenes.js` `SCALE_M` |
| City | **Generated** from a preset (High-rise heavy · Low-rise heavy · Mixed / interleaved) and the seed; the hub, roads, parade street and crowd zone never change | `main.js` `rebuildCity`, `tests/fixtures/city-*.json` |
| Observability | **Partial** — a drone senses only within a range that grows with height and shrinks to 3 m in confetti | `world.js` `sensorRadius`, `sense` |
| Agents | **Multi-agent** — nine drones, pedestrians, dogs, pigeon flocks, customers, and the human operator | `world.js` `S.drones`, `S.agents`, `flocks` |
| Dynamics | **Dynamic** — people walk, dogs roam and run, flocks cross, gusts blow, confetti and no-fly zones appear and vanish | `world.js` `updateAgents`, schedules |
| Determinism | **Deterministic** — separate seeded streams for orders, pedestrians, dogs, flocks, gusts, zones, confetti and event windows. Same settings + seed = same run; changing one board value never reshuffles an unrelated stream | `world.js` `seedOf` |

### Building clusters (city presets)

| Preset | Lot mix | Effect on the events |
|---|---|---|
| **High-rise heavy** | many towers, few houses | more occlusion, downwash and **gust trouble**, more **two-drone conflicts** in narrow corridors |
| **Low-rise heavy** | houses, yards, water tanks | more **dogs**, more **cars on pads**, more pedestrians at the door |
| **Mixed / interleaved** | tall and low lots alternate like a chessboard | the most varied mix |

Every lot becomes an obstacle volume; the same lists are exported as one fixture per preset so the simulation is testable
in node (`tests/fixtures/city-high.json`, `city-low.json`, `city-mixed.json`, each with the land-use tiles).

### Occupants

| Class | Instances | Role |
|---|---|---|
| **Obstacle** (blocks traversal) | buildings, parked cars, pigeons, other drones, no-fly zones | hard constraint: never crossed |
| **Hindrance** (penalty) | pedestrians, dogs, gusts, confetti, hover time, a silent customer | slower, more battery, longer waits |
| **Affordance** (bonus) | the delivery pad, a pre-authorized backup spot, known landmarks, retained memory | faster verify, no waiting for approval, shorter locate / scan |

## 3. Location (three notions)

1. **Grid cell** — the drone writes what it senses into a 13 × 13 knowledge grid of 5 m cells around the drop spot
   (unknown / free / static / dynamic + time seen). Visible in Scene mode with *Drone knowledge*.
2. **Address / pad** — every parcel has a front pad `(x, z + 5.1)` and a backup spot 16 m beside it; orders name an address.
3. **Landmark** — a named place the drone has *recognised* (the house, the lawn). A landmark is learned after ~3 s of
   sightings and stored in memory.

The continuous machine location `{x, y, z}` in metres is the carrier of all three. Labels also use a relative frame
("dog 1.2 m from the target").

## 4. Distance (three notions, each with its own metric)

| Distance | Metric | Use |
|---|---|---|
| **Route distance** | metres flown along the route from the hub (drawn as the thin black line on the Map, dashed on the way home) | the radius limit of the board; order duration |
| **Distance to You** | 3D Euclidean distance between the parcel and the requested spot, metres; it grows again on abort | the narrative indicator in Scene mode |
| **Closest approach** | the smallest 3D distance between a drone or parcel and a person, animal or other drone **during tier ① events** | the safety line of the scorecard |

Every leg is planned by the AIRSPACE **flying boundary system** (`spatial.js` `planRoute`): map edge, building volumes with
clearance, restricted volumes and the permitted airspace with its land-use floors, entered and left through landing columns
(every parcel's front pad has one, wide enough to include its backup spot). A drone only follows the planned polyline and
never cuts a corner through a building (tested: no drone position is ever inside an obstacle). Without the planner (node
tests) a conservative fallback is used: straight up, over the tallest building of the leg plus a margin, straight down.

## 5. Agents

| Agent | Goal | Knowledge / sensing | Plans ahead by | Performance measure |
|---|---|---|---|---|
| **Delivery drone ×9** | put the parcel down safely at the requested (or an authorized) spot, then fly home | starts with **no knowledge** of any address; sensor disc 3–6 u, 0.6 u in confetti; own knowledge grid | cruise height over known buildings; 2.5 s look-ahead for other drones, pigeons and no-fly zones; wait → backup → human → abort | outcome, time, hover seconds, highest response level, closest approach |
| **Pedestrian** | walk to an address (often one a drone is serving) | sees only its own path | straight path | times it entered a descent zone |
| **Dog** | roam its yard; run to the drop spot when a parcel comes down | none modelled | approach–stay–leave | times it blocked a drop |
| **Pigeon flock** | cross the city on a fixed line | none modelled | straight flight | times it entered a drone's buffer |
| **Customer** | receive the parcel where they asked | remote; answers by message with the board's reply rate | — | spot confirmed / not |
| **Operator** (user) | keep everyone safe and deliveries flowing | sees all nine feeds | answers events, issues commands | reaction time by tier, missed decisions |

### Spatial memory

* Landmarks are learned per address and stored in `memory.landmarks`.
* **Fresh** forgets everything when a run starts; **Retained** keeps landmarks between runs (browser storage). A known
  address is located in 1 s instead of 4 s and scanned in 1 s instead of 2.5 s. The tests check that a second retained
  run is faster and that a fresh run behaves like a first run.
* Rule: **static knowledge can be reused, dynamic conditions must be revalidated.** Memory never proves a spot is clear —
  an observation older than 2 s fails the safety check.

## 6. The mission and the order stream

`world.js` creates orders from the seed, **for as long as the simulation runs**: the board's *Orders count* is the number of
orders arriving per 10 minutes. Each order has a **shop** (R1–R3, where the goods are collected) and a customer address inside
the **delivery radius**; a share is flagged **urgent**. An idle drone takes the next order (**urgent first**; one departure
every 5 s), flies to the shop, collects the order (waiting until it is ready; a shop pad serves one drone at a time, the others
queue above it on separate levels), flies to the customer, runs the last-ten-metre state machine and flies home.
Drones live on nine slots on the plaza land around the Dispatch Tower, never on a road, and land one at a time (5 s lock).

**Enter → Pick-up at the shop → Enter → Locate → (Confirm with the customer) → Descend → Scan → Verify → Lower → Release → Reel up → Leave → Land**, with
**Wait / Reel / Shift / Climb / Return** as adaptations. Verify = five checks read from what the drone can sense: correct
location · space is safe · descent path clear · facility available · within authorization.

There is no end state: the world runs until the user pauses it. An aborted order goes back to the queue once for
**redelivery**. The scorecard is live; the run that was going before the last restart is kept for comparison.

## 7. Event hierarchy (the core of v2)

The nine event types, the old scene they came from, and what drives them:

| Event | Was | Driven by |
|---|---|---|
| Dog on drop zone | A1 | dogs, low-rise share |
| Car parked on pad | A2 | low-rise share (a car leaves after a while) |
| Pedestrian in descent zone | A3 | pedestrians, near the parade or offices |
| Pigeon flock in path | B1 | pigeon flocks |
| Two-drone conflict | B2 | **real**: detected from path or descent overlap — orders count, radius (density), high-rise corridors |
| Gust toward building | B3 | gust frequency, high-rise share |
| Sensor occluded | C1 | parade proximity (confetti or debris) |
| Customer silent | C2 | 1 − customer reply rate |
| Sudden no-fly zone | C3 | seeded, more likely near the parade |

### Tiers

| Tier | Events | Window | If nobody acts |
|---|---|---|---|
| **① Critical** (red, flashing) — people safety or collision | pedestrian · two-drone conflict · no-fly zone · gust toward building | **5–8 s** | the fixed rule applies (yield / hold / reel up); counted as a **missed decision** with a bigger score penalty |
| **② Urgent** (orange) — short window or the delivery fails | dog · pigeon flock · sensor occluded | **15–20 s** | keep waiting; abort and return after the 75 s hover limit |
| **③ Can wait** (yellow) — not dangerous, just stuck | car on pad · customer silent | **45–60 s** | on timeout abort and return; the order goes back to the queue |

Rules (all tested in `tests/last10m-world.test.js`):

1. **An urgent order raises an event by one tier** (③ → ②, ② → ①).
2. **Safety is never left to the human.** The drone takes the safe action first (stop, reel up, hover, climb, yield) and
   *then* asks what to do next. A slow operator costs time and score, never a person or a dog getting hit.
3. **To resolve** is sorted by tier, then by time left. Events overlap on purpose, so the operator has to triage.
4. **Conflict rule:** an urgent order has priority; with equal priority the lower drone ID goes first; the other yields.
   The operator can override (*swap*).
5. A last-resort **separation guard** (independent of events and the operator) stops the lower-priority drone when two get
   closer than ~7 m.

### Response ladder

`L0 normal → L1 slow / adjust → L2 hold / wait → L3 avoid / redirect → H human decision → L4 abort`, recorded per drone as
the highest level reached. Operator commands (hold, resume, reel in, wait +15 s, return to hub) never override safety:
*Force lower* is not offered, and the battery reserve cannot be crossed.

## 8. Environment design (user as environment designer)

The **Simulation board** (right column, same place on every page):

| Group | Control |
|---|---|
| City | **Building cluster** — High-rise heavy · Low-rise heavy · Mixed / interleaved (a red circle on the Map shows the radius) |
| Orders | **Orders count** (9–60 orders per 10 minutes) · **Urgent ratio** (0–100 %) · **Delivery radius** (80–300 m; shown as a green circle only while adjusting) |
| Agents | **Pigeon flocks** · **Pedestrians** · **Dogs** · **Customer reply rate** |
| Weather | **Gust frequency** (there is no steady wind) |
| Agent memory | **Fresh / Retained** |
| Run | Seed · Pause / 1× / Reset · **Apply & restart** (one global apply) |

Battery, hover budget, timeouts, backup spots and all per-scene parameters are code constants (`world.js`).

**Comparison.** The scorecard (average reaction time by tier, missed decisions, delivered / backup / aborted %,
redeliveries, closest approach in tier ① events, events per minute, peak queue length) is kept for the last two runs with
their settings and shown side by side. Variants are never generated automatically: the user changes the environment and
runs again.

## 9. Parameters grounded in public figures

| Parameter | Value | Reference |
|---|---|---|
| Ceiling | 120 m | FAA Part 107: 400 ft AGL |
| Cruise height | 50 m (more where buildings require) | Wing: typically ~150 ft |
| Cruise speed | 20 m/s | Wing ~60 mph, Zipline P2 ~70 mph (conservative urban value) |
| Delivery hover + tether | 7 m | Wing: ~7 m (23 ft) hover, package lowered on a tether |
| People clearance | detect within 13 m of the drop, 2 m safe | Wing asks customers to stay ~2 m (6 ft) away |
| Hover budget | 75 s | Wing ~30 s, Zipline ~75 s over the home |
| Event windows, drone separation, pigeon buffer, gust limits | simulation assumptions | no public standard found |

## 10. Decisions made while building v2

* **Parade.** The balloon (a moving obstacle at 70 m) is avoided automatically: within 40 m a drone backs off and holds until
  the balloon has passed (logged as `PARADE`, not an operator event). The crowd reservation zones are not drawn.
* **Orders count** was reinterpreted as an arrival rate (per 10 minutes) so that the model can run non-stop *and* the setting
  still changes the load; at the top of the range the nine drones are saturated and a queue builds up.

* **Branch.** The work stayed on `claude/03-semantic-model-delivery-system` (as asked) instead of a new `last-10m-v2` branch.
* **v1 engine kept.** `sim.js` (the nine scripted scenes) and its tests stay as the reference of the state machine and the
  response ladder; `world.js` is the v2 engine. `scenes.js` still supplies the hub and the scale.
* **Addresses.** An order goes to the front pad of any parcel inside the radius except the hub block, the two sensitive
  facilities and ponds; there are no per-customer houses.
* **Pedestrians and dogs** are agents with their own simple behaviour: pedestrians re-target (70 %) toward an address a
  drone is about to serve, dogs have a home address and run out when a drone lowers there (85 % per order). Both are
  seeded, so more of them means more events.
* **Confetti** appears when a drone descends at an address near the parade route (probability ∝ proximity), in addition to
  scheduled clouds along the route.
* **One event per drone at a time.** A drone that already handles an event yields to a higher-priority drone silently.
* **Silent customer.** A customer that does not reply at the first attempt gets a fresh chance on redelivery.
* **Score.** A single number is shown for quick comparison (100 − penalties for missed decisions, weighted by tier, and for
  aborted orders); every component is shown next to it.
