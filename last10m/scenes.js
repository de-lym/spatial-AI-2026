// Last 10m — the nine scene definitions and the environment parameters.
// Units: scene units, 1 u = 5 m (same as the city). x east, z south, y up. Ground top = SLAB (0.4 u).
// Every scene is an independent simulation that happens to sit on one block of the shared city.

export const SCALE_M = 5;
export const HUB = { x: 0, z: 0 };

// Global environment (applies to all nine scenes unless a scene overrides it).
export const GLOBAL_PARAMS = [
  { key: 'windMs', label: 'Wind', unit: 'm/s', min: 0, max: 16, step: 1, def: 6 },
  { key: 'gustMs', label: 'Gust peak', unit: 'm/s', min: 0, max: 22, step: 1, def: 13 },
  { key: 'pigeons', label: 'Pigeon density', unit: 'birds', min: 0, max: 12, step: 1, def: 6 },
  { key: 'pedestrians', label: 'Pedestrians', unit: 'people', min: 0, max: 8, step: 1, def: 3 },
  { key: 'batteryPct', label: 'Battery at launch', unit: '%', min: 30, max: 100, step: 1, def: 80 },
  { key: 'backupSpots', label: 'Backup spots', unit: 'per address', min: 0, max: 1, step: 1, def: 1 },
  { key: 'hoverBudgetS', label: 'Hover budget', unit: 's', min: 20, max: 150, step: 5, def: 75 },
  { key: 'autoS', label: 'Operator timeout', unit: 's', min: 4, max: 30, step: 1, def: 10 },
];

// Scene-only parameters (shown on the board when a scene is open).
export const SCENE_PARAMS = {
  A1: [
    { key: 'dogAtM', label: 'Dog appears at', unit: 'm above lawn', min: 0.5, max: 7, step: 0.5, def: 3 },
    { key: 'dogStayS', label: 'Dog stays for', unit: 's', min: 5, max: 90, step: 5, def: 40 },
    { key: 'backupAuthorized', label: 'Backup pre-authorized', unit: '', min: 0, max: 1, step: 1, def: 0, bool: true },
  ],
  A2: [{ key: 'carOnPad', label: 'Car on drop pad', unit: '', min: 0, max: 1, step: 1, def: 1, bool: true }],
  A3: [{ key: 'crossEveryS', label: 'Someone crosses every', unit: 's', min: 3, max: 30, step: 1, def: 7 }],
  B1: [{ key: 'flockAtU', label: 'Flock meets drone at', unit: 'm out', min: 20, max: 120, step: 5, def: 60 }],
  B2: [{ key: 'balloonDrift', label: 'Balloon drift', unit: 'm/s', min: 0, max: 4, step: 0.5, def: 1.5 }],
  B3: [{ key: 'gustS', label: 'Gust lasts', unit: 's', min: 2, max: 30, step: 1, def: 9 }],
  C1: [{ key: 'confettiS', label: 'Confetti lasts', unit: 's', min: 0, max: 60, step: 5, def: 20 }],
  C2: [{ key: 'replyS', label: 'Customer replies after', unit: 's (0 = never)', min: 0, max: 90, step: 5, def: 0 }],
  C3: [{ key: 'crowdStayS', label: 'Kids stay on pad', unit: 's', min: 0, max: 180, step: 10, def: 120 }],
};

const ds = (x, z) => ({ x, z: z + 5.1 });            // delivery pad in front of a parcel centre
const backupOf = (t) => ({ x: t.x - 3.2, z: t.z });   // a second spot on the same front yard

export const SCENES = [
  { id: 'A1', title: 'Pet on drop zone', place: 'Front yard · C1 house', kind: 'pet', center: { x: -32, z: 0 }, target: ds(-32, 0),
    landmarks: ['C1 house', 'Front lawn', 'Garage'], instruction: 'Please leave it on the lawn in front of my garage.' },
  { id: 'A2', title: 'Drop zone occupied', place: 'Driveway · C3 house', kind: 'car', center: { x: 16, z: 16 }, target: ds(16, 16),
    landmarks: ['C3 house', 'Driveway pad'], instruction: 'Leave it on the pad by the driveway.' },
  { id: 'A3', title: 'Person under descent', place: 'Office plaza · F6', kind: 'crossing', center: { x: 32, z: 32 }, target: ds(32, 32),
    landmarks: ['Office F6', 'Plaza pickup pad'], instruction: "Deliver to the building's pickup pad." },
  { id: 'B1', title: 'Pigeon flock', place: 'Parade route · C6 house', kind: 'pigeons', center: { x: 32, z: -16 }, target: ds(32, -16),
    landmarks: ['C6 house', 'Front pad'], instruction: 'Front pad, please.' },
  { id: 'B2', title: 'Balloon vs two drones', place: 'Parade route · C2 / D6', kind: 'balloon', center: { x: -8, z: 26 }, target: ds(-16, 16),
    second: { id: 'D-03', target: { x: 0, z: 37.1 }, spawn: { x: -4, z: 8 } }, spawn: { x: 8, z: 34 },
    landmarks: ['C2 house', 'Front pad', 'Parade street'], instruction: 'Front pad, please.' },
  { id: 'B3', title: 'Gust on tether', place: 'Residential · C4 house', kind: 'gust', center: { x: 32, z: 16 }, target: ds(32, 16),
    landmarks: ['C4 house', 'Front lawn'], instruction: 'Front lawn.' },
  { id: 'C1', title: 'Sensor occluded', place: 'Parade plaza · C10 house', kind: 'confetti', center: { x: -16, z: -48 }, target: ds(-16, -48),
    landmarks: ['C10 house', 'Front pad'], instruction: 'Front pad, please.' },
  { id: 'C2', title: 'Customer silent', place: 'Two lawns · C7 house', kind: 'ambiguous', center: { x: -48, z: 32 }, target: ds(-48, 32),
    alt: { x: -51.4, z: 37.1 }, landmarks: ['C7 house', 'East lawn', 'West lawn'], instruction: 'Please leave it on the lawn in front of my garage.' },
  { id: 'C3', title: 'Battery limit', place: 'Far edge · C9 house', kind: 'battery', center: { x: 48, z: -32 }, target: ds(48, -32),
    landmarks: ['C9 house', 'Front pad'], instruction: 'Front pad, please.' },
].map((s, i) => ({ ...s, index: i, backup: backupOf(s.target) }));

export function defaultsFor(defs) { return Object.fromEntries(defs.map((d) => [d.key, d.def])); }
export const DEFAULT_GLOBAL = { ...defaultsFor(GLOBAL_PARAMS), memory: 'retained', seed: 2026 };
export function sceneDefaults(id) { return defaultsFor(SCENE_PARAMS[id] ?? []); }
