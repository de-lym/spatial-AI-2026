# Implementation handoff — skybridge and spatial placements

Use this as the delta to docs/proximity-baseline/CLAUDE_IMPLEMENTATION.md. Work only in a separate copy. Do not commit, push or PR the existing GitHub repository without new user authorization.

## Code map

- placements.js: named architecture extents and pure placementFacts classifier.
- placement-integration.js: visual geometry, constituent AABBs, tour routing, rendezvous, controls, lifecycle and ENTER/EXIT events.
- spatial.js: optional obstacle y0 bottom; h remains the top. Old objects without y0 retain their original ground-based behavior. segCheck, blockedGrid and nearestObstacle use both extents.
- proximity.js: surface distance uses y0; route prediction respects rendezvous waits.
- main.js: new module wiring; original static preflight / proximity / separation / motion pipeline retained. A staging waypoint ends the current movement substep. afterMove computes facts from the resulting actual positions.
- index.html/style.css: English tour controls, confirmation, facts and live placement strip; existing component patterns retained.

Do not combine the two towers and the elevated span into one bounding box. That would fill the passage. The underside is a true obstacle boundary: flight below it can be valid, flight inside the span cannot, flight above it can be valid if the airspace ceiling permits.

## Tour contract

Each drone keeps c.task and the original order reference. decoratePlan concatenates three statically validated legs: current position→rendezvous, passage lane, passage exit→original task destination. The approach's last waypoint is placement_wait. flyStep ends that substep exactly at the waypoint; beforePlan releases both drones only when both are ready. posAfter and trajectory honor c.placementWaiting. The final guard still validates every executed segment.

Do not drop proximity checks to make the tour smoother. Finite static planning and dynamic traffic may interrupt the tour. The UI must preserve this distinction from a successful completion. NEXT_TO requires a safe relative distance and heading alignment; merely being close is insufficient.

## Re-test

Run npm test with Node >=20 (no install needed). Browser verification uses the optional Playwright script tests/placement-acceptance.cjs with Chrome and AIRSPACE_URL set to your static server. Its screenshots and JSON are evidence, not pre-authored state labels. Original proximity test script is also retained.

The fixed lanes are 35 m apart. A requested larger drone separation must reject the demonstration; never change thresholds silently. All distances are illustrative classroom parameters.
