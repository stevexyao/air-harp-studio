/** Pure, browser-independent crossing detector. Coordinates use the same 0..1
 * plane as the rendered harp. A fingertip must leave both sides of a small
 * dead band before it can pluck, so a resting finger never repeats notes. */
export class StringPlucker {
  constructor(options = {}) {
    this.options = {
      hysteresis: 0.0035, cooldown: 110, minSpeed: 0.028,
      maxGap: 220, maxStep: 0.42, maxSpeed: 8, ...options,
    };
    this.points = new Map();
  }

  reset() { this.points.clear(); }

  update(points, strings, now) {
    if (!Number.isFinite(now)) return [];
    const present = new Set();
    const events = [];
    const o = this.options;
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const id = point.id ?? 'pointer';
      present.add(id);
      let track = this.points.get(id);
      const dt = track ? now - track.at : 0;
      const distance = track ? Math.hypot(point.x - track.x, point.y - track.y) : 0;
      const discontinuity = !track || dt <= 0 || dt > o.maxGap ||
        distance > o.maxStep || distance / (dt / 1000) > o.maxSpeed;
      if (discontinuity) {
        track = { x: point.x, y: point.y, at: now, strings: new Map() };
        this.points.set(id, track);
      }
      const pointEvents = [];
      for (const string of strings) {
        const dx = point.x - string.x;
        const side = dx > o.hysteresis ? 1 : dx < -o.hysteresis ? -1 : 0;
        let state = track.strings.get(string.id);
        if (!state) {
          state = { side, x: point.x, y: point.y, at: now, last: -Infinity };
          track.strings.set(string.id, state);
          continue;
        }
        if (!side) continue;
        if (state.side && side !== state.side) {
          const deltaX = point.x - state.x;
          const fraction = (string.x - state.x) / deltaX;
          const y = state.y + fraction * (point.y - state.y);
          const duration = Math.max(1, now - state.at) / 1000;
          const speed = Math.abs(deltaX) / duration;
          if (!discontinuity && speed >= o.minSpeed && now - state.last >= o.cooldown &&
              fraction >= 0 && fraction <= 1 && y >= string.top && y <= string.bottom) {
            pointEvents.push({
              stringId: string.id, handId: id, x: string.x, y,
              velocity: Math.min(0.96, 0.26 + Math.sqrt(speed / 2) * 0.62),
              fraction,
            });
            state.last = now;
          }
        }
        state.side = side;
        state.x = point.x;
        state.y = point.y;
        state.at = now;
      }
      pointEvents.sort((a, b) => a.fraction - b.fraction);
      for (const { fraction, ...event } of pointEvents) events.push(event);
      track.x = point.x;
      track.y = point.y;
      track.at = now;
    }
    // A disappearance is a break in the motion, even if it only lasts one frame.
    for (const id of this.points.keys()) if (!present.has(id)) this.points.delete(id);
    return events;
  }
}

/** Keep hand identities stable when the detector reverses output ordering.
 * Prediction and soft handedness costs let two hands cross without an order swap. */
export class StableHandIds {
  constructor() { this.tracks = []; this.nextId = 1; }
  reset() { this.tracks = []; }

  update(observations, now) {
    this.tracks = this.tracks.filter(t => now - t.at < 450);
    const records = observations.filter(h => h.wrist && Number.isFinite(h.wrist.x) && Number.isFinite(h.wrist.y));
    const costs = records.map(hand => this.tracks.map(track => {
      const dt = Math.min(0.1, Math.max(0, now - track.at) / 1000);
      const predictedX = track.x + track.vx * dt;
      const predictedY = track.y + track.vy * dt;
      const labelPenalty = hand.handedness !== 'Unknown' && track.handedness !== 'Unknown' &&
        hand.handedness !== track.handedness ? 0.16 : 0;
      return Math.hypot(hand.wrist.x - predictedX, hand.wrist.y - predictedY) + labelPenalty;
    }));
    // At most two hands: exhaustive assignment avoids greedy order dependence.
    let bestCost = Infinity;
    let best = [];
    const search = (i, assigned, used, cost) => {
      if (i === records.length) {
        if (cost < bestCost) { bestCost = cost; best = [...assigned]; }
        return;
      }
      search(i + 1, [...assigned, -1], used, cost + 0.5);
      for (let j = 0; j < this.tracks.length; j++) {
        if (!used.has(j) && costs[i][j] < 0.48) {
          const next = new Set(used); next.add(j);
          search(i + 1, [...assigned, j], next, cost + costs[i][j]);
        }
      }
    };
    search(0, [], new Set(), 0);
    const updated = [];
    const result = records.map((hand, i) => {
      const old = best[i] >= 0 ? this.tracks[best[i]] : null;
      const dt = old ? Math.max(0.016, (now - old.at) / 1000) : 1;
      const track = {
        id: old?.id ?? `hand-${this.nextId++}`, x: hand.wrist.x, y: hand.wrist.y,
        vx: old ? (hand.wrist.x - old.x) / dt : 0,
        vy: old ? (hand.wrist.y - old.y) / dt : 0,
        handedness: hand.handedness ?? 'Unknown', at: now,
      };
      updated.push(track);
      return { ...hand, id: track.id };
    });
    const updatedIds = new Set(updated.map(t => t.id));
    this.tracks = [...updated, ...this.tracks.filter(t => !updatedIds.has(t.id))].slice(0, 4);
    return result;
  }
}
