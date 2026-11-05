# Placement extension — implementation scope

Updated 2026-11-04. This extends the previous proximity implementation in a separate copy.

The user selected an elevated link between buildings and flight through the building gap, and asked us to choose a third interesting placement. The third relation is NEXT TO another drone, represented by two parallel flight lanes rather than an unsafe near-collision.

## Three relations

| Relation | Reference | Geometric rule |
|---|---|---|
| UNDER | Named skybridge span SB-01 | Drone projects into the span's horizontal footprint and is below its underside |
| BETWEEN | Named West and East Towers | Drone is in the lateral gap, within their overlapping depth and below their roof tops |
| NEXT TO | Another named drone | Airborne, aligned headings within 15°, vertical difference ≤5 m, forward offset ≤10 m, 3D separation between cfg.sepM and cfg.sepM+10 m |

These are simultaneous spatial facts, not mutually exclusive flight modes. A drone can be UNDER and BETWEEN and NEXT TO at the same instant. ENTER/EXIT events are generated from live geometry rather than pre-timed captions. THROUGH describes motion; it is not used as a static placement label.

## Demonstration

Start placement tour resets the current delivery session after a confirmation dialog. D-01 and D-02 retain their actual scripted delivery orders but route via a rendezvous at the northern passage entrance. Once both arrive, they fly parallel lanes 35 m apart at 50 m altitude, then continue their original pickup and delivery tasks. The first approach legs may themselves cross the opening before reaching the rendezvous; the paired passage is the synchronized demonstration.

The two architecture parcels replace decorative filler lots; the random sequence for other existing lots is preserved. No river or road bridge is required: this is an elevated building connection.

## Interaction and failure states

- Original order intake, fleet controls, stages, map layers, inspector and proximity controls remain available.
- Header Placements opens the relevant Advanced section. View skybridge centers the original map camera.
- Start requires confirmation; Cancel preserves the session. Reset and tour restart clear placement history.
- The facts list has an empty explanation. Clicking a fact selects its drone.
- Changing the separation above 35 m prevents starting the fixed-lane tour. Increasing clearance or changing airspace can also make it unavailable. Settings are never silently lowered.
- During flight, original separation and proximity guards retain authority. Route changes interrupt the rendezvous rather than forcing an unsafe crossing. Assembly times out after 120 simulated seconds.
- The original application still has no real flight-command API, battery model, persistent server or certified flight constraints.

## Acceptance

The relevant evidence is placement-acceptance.json and the current screenshot / GIF. Verify all three facts at one instant, no 3D obstacle intersection, original first four orders delivered afterward, Cancel and Reset behavior, rejected infeasible parameters, and preserved pigeon responses.

## Change record

2026-11-04 — Added elevated geometry and three live placement relations because the teacher's exercise needs explicit object-to-object spatial descriptions. Affected: obstacle vertical extents, grid validation, nearest surface distance, elevation display, tour routing, inspector, event log and local demonstration controls. No change to the GitHub repository or prior ZIP.
