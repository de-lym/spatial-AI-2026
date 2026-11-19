# Last 10m — So close, yet so far

A spatial-AI simulation of the **last ten metres of drone delivery**. Nine extreme cases run as nine independent
scenes on one miniature city, each watched by its own camera. The drone starts every run knowing nothing about the
block, scans it, builds landmarks it reuses next time, and decides — or asks a human — what to do when the drop spot is
blocked, contested or unsafe.

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
| **Map** | *Where* is something happening? A static view of the city; the nine scenes are framed and coloured by status. | Default view, or **Map** in the top switch |
| **Monitor · 9** | *What* is happening? Nine live camera feeds, plus the list of things to resolve. | **Monitor · 9**, or **Open monitor →** |
| **Scene** | *What do we do?* One zoomed feed, the drone's knowledge, the event timeline and the operator console. | Click a frame, a camera or a list item |

Status colours: **green** = normal (L0–L1), **yellow** = hazard being handled (L2 hold/wait, L3 avoid/redirect),
**red** = emergency (H human decision, L4 abort), **grey** = ended (delivered or aborted).

## The Simulation board (right column, same place on every page)

* **Pause / 1× / Reset** — run control for all nine scenes.
* **Environment parameters** — wind, gust peak, pigeon density, pedestrians, battery at launch, backup spots, hover budget,
  operator timeout, memory (Fresh / Retained).
* On the **Map** and **Monitor** pages the board edits the global set: **Apply to all** restarts all nine scenes.
* In a **Scene** the board also shows that scene's own parameters (e.g. *Dog appears at*, *Dog stays for*). Tags show
  `edited` (this scene differs) or `global`. **Apply to this scene** restarts only that scene; **Apply to all** pushes the
  global values to every scene.

To compare environments, change parameters and run again: every run with the same parameters and seed is identical,
so any difference comes from the environment, not from chance.

## The nine scenes

| # | Case | Trigger (by the drone's own state) | Automatic response | Human decision |
|---|---|---|---|---|
| A1 | Pet on drop zone | dog runs onto the lawn when the parcel is 3 m above it | reel in, wait, rescan | approve the backup spot (not pre-authorized) |
| A2 | Drop zone occupied | car parked on the pad | static obstacle → go straight to the backup spot | — |
| A3 | Person under descent | people cross the plaza while the parcel is lowered | reel in at 3.5 m, retry; after 2 interruptions use the backup | — |
| B1 | Pigeon flock | flock crosses the drone's path 60 m out | slow down, hold, continue | — |
| B2 | Balloon vs two drones | parade balloon drifts across both drones' paths | both hold | who yields (fixed rule: D-03) |
| B3 | Gust on tether | gust while the parcel is half lowered | pause, shorten tether, wait for the gust; abort above 12 m/s sustained | — |
| C1 | Sensor occluded | parade confetti over the yard | memory locates the pad but cannot prove it clear → climb, wait, rescan | — |
| C2 | Customer silent | two lawns match "in front of my garage" | wait for the customer within the hover budget | choose east / west lawn |
| C3 | Battery limit | kids playing on the pad, long trip | wait until the 20 % reserve, then abort | — |

Every human decision has a countdown. With no answer the **fixed rule** runs and the log says so.
Operator commands (hold, resume, reel in, wait +15 s, return to hub) are available in the console; *Force lower* is never
offered while anyone is within 3.5 m.

## Files

* `last10m/scenes.js` — scene definitions and parameters (global + per scene).
* `last10m/sim.js` — the deterministic scene simulation: mission phases, knowledge grid, landmarks and memory, the five
  verification checks, the response ladder, prompts and commands, metrics, Distance to You. No three.js; runs in node.
* `last10m/stage.js` — puts each scene's actors (drone, parcel and tether, dog, people, car, pigeons, balloon, confetti)
  into the city and renders the camera views with the existing ink pass.
* `last10m/app.js`, `last10m/style.css` — the three views, the Simulation board and the console.
* `main.js` — unchanged city; in Last 10m mode (`<body data-app="last10m">`) it only builds and draws the city.
* `docs/SEMANTIC_MODEL.md` — the semantic model (course deliverable).
* `docs/README-airspace.md` — the previous AIRSPACE README.

## Tests

```sh
npm test            # node >= 20, no install needed
```

`tests/last10m-sim.test.js` checks determinism, every scene's outcome, the memory speed-up, operator commands and prompt
time-outs, using the real city obstacles (`tests/fixtures/city-obstacles.json`).

All numbers are illustrative classroom parameters. Heights and speeds follow public figures (FAA Part 107 ceiling,
Wing-style 7 m hover with tether); separation and clearance margins are simulation assumptions.
