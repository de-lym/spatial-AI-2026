# AIRSPACE — Skybridge & Spatial Placements

A separate working extension of the drone delivery simulation. All current controls and placement captions are in English.
The existing GitHub repository and previously delivered ZIP remain unchanged.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in a modern desktop browser. Serve over HTTP; do not double-click index.html.
No frontend dependencies or build step are required. Three.js remains vendored.

## See the three placements

1. Click **Placements** in the header.
2. Click **Start placement tour**, then confirm **Reset and start tour**. This starts a fresh delivery session; export the current session first if needed.
3. D-01 and D-02 meet at the northern entrance, fly through two parallel lanes, and continue their original pickup and delivery tasks.
4. Read the live placement strip, Updates, or the selected drone's Flight details / Location / History.

The three relations are **UNDER the skybridge**, **BETWEEN two buildings**, and **NEXT TO another drone**.
They are simultaneous facts, not mutually exclusive flight modes. The paired lanes are 35 m apart, at 50 m altitude.
The skybridge connects two towers and needs no river. Its underside is 75 m above the synthetic ground datum.
The model leaves a genuine opening: two tower obstacles plus one elevated span, not one solid bounding box.

**View skybridge** centers the map camera without resetting the session. **Run/Pause**, reset confirmation, delivery controls, layers, queries and all proximity features remain available.

## Failure behavior

The tour cannot start when the configured drone separation exceeds the 35 m lane spacing or when current clearance / airspace rules block the passage. It does not silently lower thresholds.
Original dynamic avoidance checks retain authority. A new route can interrupt the tour; a rendezvous that cannot assemble times out after 120 simulated seconds.
The first approach legs may also cross the opening before rendezvous. The synchronized paired pass is the intended three-relation demonstration.

The proximity controls still support drone conflicts, building clearance and unpredictable pigeon encounters. Human review records an acknowledgment; it does not clear an active hazard.

## Files

- PLACEMENT_IMPLEMENTATION.md: current implementation and Claude handoff.
- docs/PLACEMENT_SCOPE.md: relation definitions, scope and change record.
- docs/VERIFICATION.md and docs/placement-acceptance.json: current checks and actual browser evidence.
- docs/placement-tour.gif and docs/placement-three-relations.png: actual simulation captures with English text.
- placements.js: pure placement classifier and named geometry.
- placement-integration.js: architecture, rendezvous and tour integration.
- placement-code.patch: delta against the previous airspace-proximity-final implementation, for a fresh copy only.
- SOURCE_MANIFEST.json: source and previous-package provenance.
- docs/proximity-baseline/: historical proximity-only handoff and evidence, not current placement verification.

## Tests

Node >=20:

```sh
npm test
```

No install is needed for the 10 unit/model tests. Optional browser verification requires Playwright plus Chrome:

```sh
npm install --no-save --package-lock=false playwright
AIRSPACE_URL=http://127.0.0.1:8000 node tests/placement-acceptance.cjs
```

The browser script writes temporary recording frames under work/placement-frames and publishes screenshots / results under docs.

## Limits

All dimensions, distances and airspace rules are classroom simulation assumptions, not certified aviation limits.
Geometry uses axis-aligned boxes; drones are represented by reference points plus configurable margins rather than complete rotor collision meshes. The fixed-lane tour is a teaching example, not a general formation-flight planner.
No real sensor, flight-control, battery or backend service is connected. Events and settings are local to the current session; export before reset or refresh.
