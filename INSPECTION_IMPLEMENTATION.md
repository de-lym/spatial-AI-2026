# Claude handoff — pre-delivery orbit inspection

This is implemented code in a new independent package. Do not modify, commit, push or PR the existing GitHub repository. Preserve the placement and proximity functions. The new files are inspection.js, inspection-integration.js and tests/inspection.test.js.

## State and delivery contract

startTask(toCustomer) redirects to a real `inspection` task unless this same drone/order already has cleared inspection. The original order remains picked_up and remains in c.carry. The inspection task contains a validated approach to the ring and all 48 orbit segments; it has no descent-to-pad segment.

On reaching the end, review checks the completed flight path, carried order, a newly planned static approach, and pad occupancy / session reservation. Only a successful review sets cleared and starts the original toCustomer task. The existing delivery branch also calls canDeliver before setting delivered. onDelivered emits a linked inspection completion event.

Lifecycle: approaching → scanning → waiting (if checks fail) → cleared → delivered. Blocked and interrupted are explicit alternatives. 100% is coverage, not permission. Checks are synthetic model queries, not real vision. A blocked scan is never overwritten by the scanning UI just because the old route still has partial progress.

## Motion and prediction consistency

Each orbit waypoint carries speedU. waypointSpeed is used by actual movement, posAfter, the exact piecewise trajectory predictor and remainingTime. Keep these in sync if changing speeds. Zero speed factors, holds and inspectionLandingBlocked preserve positions and progress.

The original order start, static preflight, proximity preparation, separation planner and final guard remain authoritative. inspection.prepare runs before static preflight, inspection.gate before the final guard, and afterMove derives coverage from the resulting actual route position. Avoidance can invalidate an inspection token; no movement or delivery can use an unverified replacement route. A complete observation circuit is replanned on recovery.

A conservative final guard may expose a mutual wait that the earlier planner did not see. Its recovery callback plans a checked sidestep for a non-inspecting drone or a priority retry. All affected drones remain stopped for that substep; the next substep validates the changed route. Do not turn this into an unchecked teleport or forced movement.

## Geometry and model checks

buildInspectionMission validates every circle segment with existing segCheck and verifies both approach and onward landing route with planRoute. The circle has a fixed configured radius; near the map edge its center is clamped inward to the permitted envelope. It still encloses the intended site in the verified default scenarios; complex worlds may need a more complete search and must report blocked if no solution is found.

A full circle and a statically valid approach do not establish real scene visibility, ground safety, legality or dynamic clearance. The final existing motion guard continues to check drones and pigeons. No object recognition, image collection or live pad service exists.

## UI and logging

English header Inspection opens the new Advanced section. Demo restart has Confirm / Cancel. Reservation buttons are explicitly marked Test. Current phase and coverage appear in the HUD, inspector, fleet and Updates. Persistent problems open INSPECTION_BLOCKED in Critical; resolution requires actual model recovery.

Events include orderId, droneId, simulation time and inspection source. Record types cover planning, start, actual coverage milestones, interruption, pending checks, pass, approach pause/resume, pad reservation/release and inspected delivery completion. Original session JSON now has schemaVersion 2 and context.inspection plus context.placements. This is a local session export, not durable backend audit storage.

## Tests and extension boundaries

npm test covers 16 unit/model tests. Browser acceptance covers a full circuit, stationary progress, 100% with a reserved pad, release and completed delivery, all four scripted orders, a fully closed airspace, reset, export and desktop overflow. A separate browser regression preserved the paired skybridge tour and pigeon responses.

Retain the original packages as references. The code patch applies to a fresh copy of airspace-placement-final; check it before applying. It does not include documentation or large recordings. For another base version, merge deliberately instead of forcing the patch.

Not implemented: certified operations, physical camera/sensor models, yaw/gimbal control, acceleration/jerk dynamics, backend reservations, exhaustive circle search, continuous rotor-body collision or safety proof. This update adds inspection to the existing kinematic simulator; it does not implement every flight-profile idea from the earlier brainstorm.
