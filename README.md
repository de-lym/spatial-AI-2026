# spatial-AI-2026

## Delivery-Platform Semantic Model — "Neighborhood"

A single-page vanilla-JavaScript web app (three.js) that visualizes a delivery-platform semantic model:
*how does a platform allocate limited courier capacity across orders with different revenue and fulfillment times?*

**Run:** serve the folder with any static server (ES modules need http), e.g. `python3 -m http.server`, then open `http://localhost:8000`.
three.js is vendored in `vendor/`, so no network or build step is needed.

### Model
- **ORDER** (central object): revenue (box size), creation time, status, total delivery time.
  Status flow: `pending → preparing → ready → assigned → picked_up → delivered`.
- **CUSTOMER** (houses), **RESTAURANT** (shops, each with its own preparation time and production capacity),
  **COURIER** (scooters, capacity 2 orders each, max 5 couriers), **PLATFORM** (central tower).
- Coloured lines show the relationships: customer→order *creates*, restaurant→order *prepares*,
  platform→order *evaluates*, platform→courier→order *assigns*, courier→order *picks up / delivers*.

### Controls
Everything except the legend lives in the collapsible panel on the right (each section, and the whole panel, can be collapsed).
The **Simulation** section groups the time controls and one row of actions per entity. The simulation starts by itself with all
four agents on **auto**; untick an agent's *auto* to take over that role manually. Click an entity in the scene to select it —
actions use the selection when it applies, otherwise the first eligible order/courier. Refused actions explain which rule blocked
them, and the Rules section counts how often each rule bounded an outcome. Left-drag orbits, wheel zooms, right-drag pans.

- Customer: Create Order
- Restaurant: Accept Order (limited by production capacity), Mark Ready (only after preparation time)
- Platform: Evaluate Pending, Estimate ETA, Assign Courier, Priority (FIFO ↔ revenue-weighted)
- Courier: Accept, Drive → Restaurant, Pick Up, Deliver, ＋/－ fleet size (couriers are cars that follow the road grid)

Revenue-weighted priority is a **simulation hypothesis**, not a claim about any real platform. The Statistics section compares
average delivery time for high- vs low-revenue orders under each policy.

### Look
Soft "clay" isometric city (orthographic camera, soft shadows, rounded forms, no outlines or grid lines).
The background city is white massing with green parks and blue water on cool-grey streets; saturated architectural-model colours
are reserved for the four roles: **restaurants** (coral/orange/salmon), **customers** (forest/denim/teal roofs),
**platform** (navy) and **couriers** (mustard cars).
