# Placement verification — 2026-11-04

Verified in an independent Chrome browser session at 1440×900 and 1280×800.

- 10 unit/model tests pass: existing proximity checks plus placement predicates, elevated underside/interior/roof collision, surface distance, valid passage planning and blocked-clearance rejection.
- Normal delivery regression: first four orders delivered; measured minimum airborne separation 30.181569 m in the tested run.
- Paired tour: all three facts held simultaneously, with D-01 and D-02 exactly 35 m apart at 50 m altitude. See placement-acceptance.json for actual coordinates and timestamp.
- Tour reached complete, then all four original deliveries completed. Measured minimum airborne separation over the tested tour session: 30.585218 m.
- Confirm / Cancel: cancel preserved the previous delivery session.
- Invalid settings: 40 m separation and an obstructing 30 m building-clearance setting both rejected tour start.
- Reset cleared placement mode, facts and history.
- Pigeon smoke check still spawned a bird and produced automatic responses, including escalation where needed.
- Browser page errors: zero. At 1280 px, document scrollWidth equaled the viewport width.
- Screenshot manually reviewed: two visible drones inside the opening, named relation labels and actual event entries.

The GIF is a genuine stepped simulation recording, 28 frames at 0.3 simulated seconds per frame. Playback is accelerated; PAUSED appears because the capture script advances the clock manually. Its final frame pauses for readability.

These tests cover specific synthetic scenarios. They do not establish safety for all initial states or real flight. Screen-reader and exhaustive cross-browser checks were not performed.

The code patch was applied to a fresh copy of the prior proximity implementation and passed the same 10 tests. ZIP CRC and extracted-file hashes were verified during final packaging. See the package verification JSON beside the ZIP.
