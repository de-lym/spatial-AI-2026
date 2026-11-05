# AIRSPACE — Pre-delivery Orbit Inspection

A separate working extension of the placement + proximity delivery simulator. All new interface text and recording captions are in English. The existing GitHub repository and earlier ZIP packages remain unchanged.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in a desktop browser. No frontend install or build is required; Three.js is vendored. Do not double-click index.html because ES modules need HTTP.

## Delivery sequence

**Pick up → Approach observation circuit → Orbit and observe → Evaluate model checks → Approach / descend → Drop off.**

Every customer-delivery leg now starts with an inspection task. The parcel stays on the drone throughout observation and any wait. Completing 100% of the circuit does not mark the order delivered.

Click **Inspection** in the header, then **Start inspection demo** and confirm the session reset. Orders run normally; no new orders are created during the demo. **View inspection** centers an active drone and its site. You can also run the existing delivery session without starting a dedicated demo: the new behavior is built into ordinary deliveries.

The full ring is a faint blue line; the completed arc fills as the drone actually travels, with a dashed observation cue to the destination. The HUD, drone inspector, fleet attention and event queue show the current phase and progress. No timer can complete the circuit while the drone is stopped.

## Separate completion and approval

The model checks all of the following before continuing to the delivery pad:

1. A complete observation circuit has been flown.
2. The assigned parcel is aboard the same drone.
3. A statically valid approach route exists.
4. The delivery pad is neither occupied nor reserved for the teaching test.

**Test: reserve delivery pad** makes the current target unavailable in this local simulation. The drone can finish the circuit but then stays at 100% with checks pending. **Test: release delivery pad** lets checks retry and, if they pass, the drone proceeds to land and deliver. This is an explicit synthetic reservation, not a real external landing authorization.

Persistent failed checks or a blocked orbit raise a critical human-review incident. Acknowledging other proximity incidents never bypasses inspection checks. A new obstacle or avoidance reroute can interrupt and restart the observation route. New pad unavailability after approval pauses the final approach.

## Configuration

- Orbit radius: 25 m by default; editable 15–40 m.
- Preferred altitude: 80 m by default. The planner tries that level, a higher level, and a level below the configured ceiling, using only complete validated circles.
- Orbit speed: 5 m/s by default; editable 2–8 m/s. Predictions, actual motion and ETA share the same waypoint speed calculation.
- Circle: 48 straight segments approximating a full orbit.
- Failed-check retry: 1 simulated second. Human escalation: 8 simulated seconds.

Inputs apply when the next circuit is planned. Near the city edge, the orbit center may shift slightly inward so the circle remains inside the permitted map envelope. The actual circle must still pass the existing building, restriction and permitted-volume checks; an onward landing route must also exist.

All numbers are illustrative classroom parameters. There is no real camera, obstacle recognition, terrain sensing or certified flight authorization. The observation cue illustrates a conceptual sensor, while the pass/fail checks inspect the known simulation model. Completing a ring is not proof that a real landing site is safe.

## Existing features

The skybridge, BETWEEN / UNDER / NEXT TO placement tour, original order flow, map layers, queries and drone–drone / building / pigeon proximity controls remain available. See PLACEMENT_IMPLEMENTATION.md and docs/PLACEMENT_SCOPE.md for the preserved placement feature. Historical verification files from the previous package are identified as such under docs/placement-baseline and docs/proximity-baseline.

The previous route previews do not include the new observation circuit: the actual customer leg is planned after pickup. The inspected delivery adds flight time and may change subsequent traffic interactions.

## Files and verification

- INSPECTION_IMPLEMENTATION.md: Claude integration handoff and constraints.
- docs/INSPECTION_SCOPE.md: feature scope and movement/trigger definitions.
- docs/VERIFICATION.md: current acceptance results.
- docs/inspection-acceptance.json: actual browser evidence.
- docs/inspection-session.json: real downloaded session export, including inspection context.
- docs/inspection-demo.gif and inspection-*.png: actual simulation captures.
- inspection.js: pure orbit planning, progress, model checks and shared waypoint speed.
- inspection-integration.js: lifecycle, visuals, reservation test, UI and event integration.
- inspection-code.patch: code delta against the separate airspace-placement-final copy.

Node >=20, without installing dependencies:

```sh
npm test
```

Optional browser checks require Playwright and Chrome. Start the HTTP server, then run:

```sh
npm install --no-save --package-lock=false playwright
AIRSPACE_URL=http://127.0.0.1:8000 node tests/inspection-acceptance.cjs
```

The browser script creates temporary frames under work/inspection-frames and writes its evidence into docs. It injects a test-only closed airspace in its disposable page; close that page afterward. Application source does not contain that active closure.

Session records and reservations reset with Reset / demo restart or a page refresh. Export before resetting. The inspection audit keeps the newest 400 events; the most recent 12 records are shown in the list. Session export retains inspection records and the original operations events. No backend, user identity or real flight command API is connected.
