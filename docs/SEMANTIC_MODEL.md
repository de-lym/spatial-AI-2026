# Last 10m — Semantic Model

The model behind the simulation: what exists, how it is located and measured, what each agent knows, wants and does,
and how the environment is designed and compared. Implementation references point to `last10m/`.

## 1. Spatial idea

Physical proximity does not guarantee delivery. A drone can be ten metres from the customer and still fail, because the
last ten metres are full of things that move, block, hide or disagree. The simulation isolates nine such situations as
nine independent scenes on one city so they can be triggered, watched, varied and compared.

## 2. Environment

| Property | Choice | Where |
|---|---|---|
| Physical vs abstract | **Physical** — a miniature city in metres (1 scene unit = 5 m) | `scenes.js` `SCALE_M` |
| Observability | **Partial** — agents sense only within a range that depends on height and conditions | `sim.js` `sensorRadius`, `sense` |
| Agents | **Multi-agent** — drones, pedestrians, a dog, a customer; B2 has two drones | `sim.js` `S.drones`, `S.agents` |
| Dynamics | **Dynamic** — people, animals, balloon, birds, gusts and confetti change over time | `sim.js` `updateAgents` |
| Determinism | **Deterministic** — seeded randomness; same parameters + seed = same run | `sim.js` `rng(seed)` |

### Occupants

| Class | Instances | Role |
|---|---|---|
| **Obstacle** (blocks traversal) | buildings (city geometry), parked car (A2), balloon (B2), pigeons (B1) | hard constraint: never crossed |
| **Hindrance** (penalty) | crowds and pedestrians, gusts, confetti, pigeon activity, hover time | slower, more battery, longer scans, waits |
| **Affordance** (bonus) | delivery pad, authorized backup spot, known landmarks, retained memory | faster verify, no waiting for approval, shorter locate/scan |

## 3. Location (two notions)

1. **Machine location** — continuous coordinates `{x, y, z}` in metres in the city frame; the knowledge grid indexes the
   ground into 5 m cells around each scene (`sim.js` `idx`, `cellCenter`).
2. **Human / semantic location** — named places and relations: *C1 house*, *Front lawn*, *Backup spot*, *East / West
   lawn*, the customer instruction *"the lawn in front of my garage"*. These are the landmarks the drone recognises
   (`scenes.js` `landmarks`, `instruction`).

A third, relative frame is used by the console and labels: positions relative to the drop target ("dog 1.2 m from the
target").

## 4. Distance (three notions, each with its own metric)

| Distance | Metric | Use |
|---|---|---|
| **Distance to You** | 3D Euclidean distance between the parcel and the requested spot, metres | the narrative indicator; grows again on abort |
| **Clearance** | 2D Euclidean distance between the parcel column and the nearest person/animal, metres; thresholds 2 m (safe) and 3.5 m (detect) | the safety check and the A3 / A1 interruptions |
| **Time / budget distance** | seconds of hover left and battery % above the 20 % reserve | when waiting is no longer allowed |

The route itself is planned at a cruise height that clears every known building on the straight leg
(`cruiseHeightFor`), so flight distance is not the deciding metric in this project.

## 5. Agents

| Agent | Goal | Knowledge / sensing | Plans ahead by | Performance measure |
|---|---|---|---|---|
| **Delivery drone** | put the parcel down safely at the requested (or an authorized) spot within battery and hover budget | starts with **no knowledge of the block**; a sensor disc of 10–30 m that shrinks to 3 m in confetti; writes a 25 × 25 knowledge grid (unknown / free / static / dynamic + time seen) | planning the cruise height over known buildings; 2–2.5 s look-ahead against pigeons and the balloon; escalating from wait → backup → human → abort | outcome (delivered, delivered at alternative, aborted), time, hover seconds, battery left, highest response level, decision time, minimum clearance |
| **Pedestrian** | walk to the other side of the plaza / play on the pad | sees only its own path | straight path | time disturbed by the drone |
| **Dog** | roam the yard, stay near something interesting | none modelled | approach-stay-leave | times disturbed |
| **Customer** | receive the parcel where they asked | remote; answers by message (or not) | — | instruction satisfied / not |
| **Operator** (user) | keep everyone safe and deliveries flowing | sees all nine feeds | answers prompts, issues commands | decision time; overrides |

### Spatial memory

* Objects become **landmarks** after about three seconds of observation (`sense`).
* With **Retained** memory, landmarks and static cells are kept between runs (browser storage). The next run locates in
  1 s instead of 4 s and scans in 1 s instead of 2.5 s; the test suite checks this.
* Rule: **static knowledge can be reused, dynamic conditions must be revalidated.** Memory never proves a spot is clear —
  an observation older than 2 s fails the safety check (C1 demonstrates this).

## 6. Decision logic

Mission: **Enter → Locate → Descend → Scan → Verify → Lower → Release → Leave**, with **Wait / Reel / Shift / Climb /
Ask / Return** as adaptations.

Verify = five checks read from the drone's knowledge only: correct location · space is safe · descent column clear ·
facility available · within authorization.

Response ladder (shared by all nine scenes, recorded as the highest level reached):

`L0 normal → L1 slow/adjust → L2 hold/wait → L3 avoid/redirect → H human decision → L4 abort`

Human decisions have a countdown (`autoS`). With no answer the fixed rule applies (A1: keep waiting · B2: D-03 yields ·
C2: wait for the customer). Operator commands never override safety: *Force lower* is not offered while anyone is within
3.5 m, and the battery reserve cannot be crossed.

## 7. Environment design (user as environment designer)

* **Global parameters** (all nine scenes): wind, gust peak, pigeon density, pedestrians, battery at launch, backup spots,
  hover budget, operator timeout, memory, seed.
* **Scene parameters** (one scene): dog trigger height and stay time, backup pre-authorization, car on pad, crossing
  interval, flock distance, balloon drift, gust length, confetti length, customer reply time, kids on pad.
* **Apply to this scene / Apply to all** commit a parameter set and restart. Runs are deterministic, so two runs differ
  only by what the user changed; the nine status colours, outcomes and metrics are the comparison.

## 8. Parameters grounded in public figures

| Parameter | Value | Reference |
|---|---|---|
| Ceiling | 120 m | FAA Part 107: 400 ft AGL |
| Cruise height | 50 m (more where buildings require) | Wing: typically ~150 ft |
| Cruise speed | 20 m/s | Wing ~60 mph, Zipline P2 ~70 mph (conservative urban value) |
| Delivery hover + tether | 7 m | Wing: ~7 m (23 ft) hover, package lowered on a tether |
| People clearance | 2 m safe, 3.5 m detect | Wing asks customers to stay ~2 m (6 ft) away |
| Hover budget | 75 s | Wing ~30 s, Zipline ~75 s over the home |
| Drone separation, pigeon buffer, gust limits | simulation assumptions | no public standard found |
