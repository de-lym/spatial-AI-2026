# Inspection feature scope — 2026-11-04

User decision: add a pre-delivery observation orbit, forming a readable Pick up → Orbit / inspect → Drop off story. This extends the teacher's movement exercise with a purposeful circular movement and an embedded scan capability.

## Trigger, capability, completion

After a real order pickup, the drone plans an orbit near that order's customer delivery pad. Flight coverage triggers milestone indicators. Completing the circuit triggers synthetic model checks; successful checks enable the delivery approach. The package remains attached through the circuit and any pending-check hold, then uses the original drop-off behavior.

A completed observation circle is different from a successful check. A test pad reservation intentionally demonstrates 100% coverage with no delivery authorization. Releasing the reservation permits a retry but does not bypass cargo, route or occupancy checks.

## Acceptance requirements

- Circle progress must be computed from actual route motion, never elapsed time alone.
- Paused or yielded motion cannot fill the observation progress bar.
- A changed/blocked observation route cannot bypass the scan or silently deliver.
- Original order identity and carried parcel must survive the inspection.
- Pickup and drop-off semantics, placement tour and proximity checks remain available.
- English controls, indicators, empty states, specific blocked reasons, reset confirmation and successful export feedback.

## Change record

2026-11-04 — Added the observation orbit because the user selected it as the third meaningful movement alongside pickup and drop-off. Affected: delivery task state, orbit planning, coverage, motion prediction speed, final-guard traffic recovery, UI, event export and tests. Existing independent packages and remote repository remain unchanged.
