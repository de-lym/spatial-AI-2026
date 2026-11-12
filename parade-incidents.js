// Read-only presentation model. Never changes the simulator or its Decision Trace.
export const ANNOUNCEMENT_LEVELS = {
  1: {name: 'Notice', icon: '○'},
  2: {name: 'Conflict', icon: '!'},
  3: {name: 'Urgent', icon: '!!'}
};
const responseCodes = new Set(['FIXED_PRIORITY', 'COST_NEGOTIATION', 'SLOT_AWARDED', 'GUARD_RECOVERY', 'ABORT']);
const normalizeSubject = subject => /^PIGEON-/.test(subject) ? 'pigeons' : subject;
function subjectFor(row, byId) {
  let ancestor = row;
  while (ancestor) {
    if (ancestor.subjectId) return normalizeSubject(ancestor.subjectId);
    ancestor = byId.get(ancestor.parentId);
  }
  const detail = row.detail ?? '';
  const traffic = detail.match(/D-0[1-4]/);
  if (traffic) return traffic[0];
  if (/balloon/i.test(detail)) return 'balloon';
  if (/pigeon/i.test(detail)) return 'pigeons';
  if (/crowd/i.test(detail)) return 'crowd';
  if (/Static constraint/i.test(detail)) return 'geometry';
  return /Simulator|GUARD/.test(detail + row.code) ? 'safety guard' : 'mission';
}
function heading(subject, row) {
  if (row.code === 'ABORT') return 'Mission aborted';
  if (/UNRESOLVED/.test(row.detail)) return 'No validated escape';
  if (/Simulator|GUARD/.test(row.detail + row.code)) return 'Simulator safety intervention';
  if (subject === 'balloon') return 'Balloon avoidance';
  if (subject === 'pigeons') return 'Flock avoidance';
  if (subject === 'crowd') return 'Crowd-zone stop';
  if (subject === 'geometry') return 'Route blocked';
  if (/^D-/.test(subject)) return row.layer === 'Coordination' || row.code === 'L1' ? 'Traffic coordination' : 'Traffic avoidance';
  return 'Flight response';
}
export function buildIncidents(log, now) {
  const byId = new Map(log.map(r => [r.recordId, r]));
  const incidents = [], lastByKey = new Map();
  const losses = new Map();
  function lostTarget(row, end) {
    if ((end?.time ?? now) - row.time < 2) return;
    incidents.push({id: `encounter:${row.recordId}`, time: row.time, lastTime: end?.time ?? now,
      severity: 1, title: 'Target lost · searching', participants: [row.agentId], agentId: row.agentId,
      subject: 'camera target', position: row.position, representative: row, records: end ? [row, end] : [row],
      eventIds: [row.eventId], outcome: end ?? null, layers: [row.layer], targetLoss: true});
  }
  for (const row of log) {
    if (row.time > now) break;
    if (!row.agentId) continue;
    if (row.code === 'TARGET_LOST') { losses.set(row.agentId, row); continue; }
    if (row.code === 'TARGET_REACQUIRED') {
      const loss = losses.get(row.agentId);
      if (loss) lostTarget(loss, row);
      losses.delete(row.agentId); continue;
    }
    const isResponse = /^L[123]$/.test(row.code) || responseCodes.has(row.code);
    if (!isResponse) continue; // Seeing something, a prediction alone or a world trigger is not an announcement.
    const subject = subjectFor(row, byId);
    const pair = /^D-/.test(subject) ? [row.agentId, subject].sort() : [row.agentId];
    const key = pair.length > 1 ? pair.join('/') : `${row.agentId}/${subject}`;
    const severity = row.code === 'L3' || row.code === 'ABORT' || row.code === 'GUARD_RECOVERY' || /Simulator|UNRESOLVED/.test(row.detail) ? 3 : 2;
    let incident = lastByKey.get(key);
    // Brief state oscillations stay in one encounter; a new encounter requires a quiet interval.
    if (!incident || row.time - incident.lastTime > 3) {
      incident = {id: `encounter:${row.recordId}`, time: row.time, lastTime: row.time,
        severity, title: heading(subject, row), participants: pair, agentId: row.agentId,
        subject, position: row.position, representative: row, records: [], eventIds: [], layers: [], outcome: null};
      incidents.push(incident); lastByKey.set(key, incident);
    }
    incident.lastTime = row.time;
    if (severity > incident.severity || severity === incident.severity && /Simulator|UNRESOLVED/.test(row.detail)) {
      incident.severity = severity; incident.title = heading(subject, row); incident.representative = row;
    }
    incident.records.push(row);
    if (!incident.eventIds.includes(row.eventId)) incident.eventIds.push(row.eventId);
    if (!incident.layers.includes(row.layer)) incident.layers.push(row.layer);
  }
  for (const row of losses.values()) lostTarget(row, null);
  for (const incident of incidents) {
    if (incident.targetLoss) continue;
    const eventIds = new Set(incident.eventIds), ids = new Set(incident.records.map(r => r.recordId));
    for (const row of log) if (row.time <= now && eventIds.has(row.eventId)) ids.add(row.recordId);
    for (const id of [...ids]) {
      let row = byId.get(id);
      while (row?.parentId) { ids.add(row.parentId); row = byId.get(row.parentId); }
    }
    incident.records = log.filter(r => r.time <= now && ids.has(r.recordId));
    incident.outcome = [...incident.records].reverse().find(r => r.kind === 'outcome' && r.time >= incident.lastTime) ?? null;
  }
  return incidents.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
