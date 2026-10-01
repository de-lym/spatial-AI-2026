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
The toolbar has one group per entity, with the actions from the model. Click an entity in the scene to select it;
actions use the selection when it applies, otherwise the first eligible order/courier. Each group also has an
**auto** toggle so that agent acts by itself. Refused actions explain which rule blocked them, and the Rules panel counts
how often each rule bounded an outcome. Left-drag orbits, wheel zooms, right-drag pans.

- Customer: Create Order
- Restaurant: Accept Order (limited by production capacity), Mark Ready (only after preparation time)
- Platform: Evaluate Pending, Estimate ETA, Assign Courier, Priority (FIFO ↔ revenue-weighted)
- Courier: Accept, Travel → Restaurant, Pick Up, Deliver, ＋/－ fleet size
- Simulation: pause/run, speed, reset

Revenue-weighted priority is a **simulation hypothesis**, not a claim about any real platform. The stats panel compares
average delivery time for high- vs low-revenue orders under each policy.

### Look
The visual style follows the line-drawn isometric aesthetic of *Urban Encounter*: orthographic isometric camera, pale sage
ground with white roads, white buildings with thin ink outlines and pastel accents, lollipop trees, and a light UI.
