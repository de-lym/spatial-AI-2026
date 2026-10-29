/* ====================================================================
   Structured operations events for the Incident Queue (UI adapter, no simulation logic).

   The simulator's own log (S.log) is free text, so the queue does not parse it. Instead the simulator reports
   real state transitions here (route lost / route found again, delivered, assigned, re-routed …).

   category  'critical' | 'battery' | 'updates'
   - critical / battery incidents are OPEN until the model condition clears (resolve()); counts are open items only.
   - updates are informational events retained per session (capped); they never count as alerts.
   - no battery model exists in the simulator, so no 'battery' incident is ever created here.
   ==================================================================== */
export const UPDATE_CAP = 200;

export function createEventStore() {
  const st = { sessionId: 1, sequence: 0, version: 0, events: [] };
  const bump = () => { st.version++; };
  return {
    state: st,
    /** new session: drop every event and forget old ids (a re-created D-03 is a different object) */
    reset() { st.sessionId++; st.sequence = 0; st.events = []; bump(); },
    /** open an incident once per (session, drone, code); returns the event or null when it is already open */
    open(ev) {
      if (st.events.some((e) => e.code === ev.code && e.droneId === ev.droneId && e.resolvedAtSimSeconds == null && e.category !== 'updates')) return null;
      return push(ev);
    },
    /** informational event (kept newest-first in the UI) */
    update(ev) {
      const e = push({ ...ev, category: 'updates' });
      const infos = st.events.filter((x) => x.category === 'updates');
      if (infos.length > UPDATE_CAP) { // evict the oldest information only; open incidents are never dropped
        const drop = new Set(infos.slice(0, infos.length - UPDATE_CAP).map((x) => x.id));
        st.events = st.events.filter((x) => !drop.has(x.id));
      }
      return e;
    },
    /** the model condition cleared */
    resolve(code, droneId, atSimSeconds) {
      let n = 0;
      for (const e of st.events) if (e.code === code && e.droneId === droneId && e.category !== 'updates' && e.resolvedAtSimSeconds == null) { e.resolvedAtSimSeconds = atSimSeconds; n++; }
      if (n) bump();
      return n;
    },
    /** open incidents for critical/battery, retained events for updates; newest first (sim time, then sequence) */
    list(category) {
      const open = category === 'updates' ? () => true : (e) => e.resolvedAtSimSeconds == null;
      return st.events.filter((e) => e.category === category && open(e))
        .sort((a, b) => b.occurredAtSimSeconds - a.occurredAtSimSeconds || b.sequence - a.sequence);
    },
    counts() {
      const c = { critical: 0, battery: 0, updates: 0 };
      for (const e of st.events) if (e.category === 'updates' || e.resolvedAtSimSeconds == null) c[e.category]++;
      return c;
    },
    forDrone(droneId) {
      return st.events.filter((e) => e.droneId === droneId).sort((a, b) => b.occurredAtSimSeconds - a.occurredAtSimSeconds || b.sequence - a.sequence);
    },
  };
  function push(ev) {
    const e = { id: `E${st.sessionId}-${++st.sequence}`, sessionId: st.sessionId, sequence: st.sequence, resolvedAtSimSeconds: null, droneId: null, orderId: null, ...ev };
    st.events.push(e); bump();
    return e;
  }
}
