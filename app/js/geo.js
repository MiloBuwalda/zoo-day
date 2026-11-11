// Location matching. Pure functions, no DOM: runs in the browser and in Node tests.
//
// A "fix" is { lat, lng, accuracy } (accuracy in metres, as reported by the GPS).
// A "location" is { id, target, lat, lng, radiusM?, label? } from a park file.
// A "target" is the animal or page id a location points to. One target can
// have several locations (e.g. two viewing spots at the penguins).
// One location can also point to several ids at once, as a list:
//   { "id": "savanna", "target": ["giraffe", "zebra", "rhino"], ... }
// for a spot where you see several animals (a mixed enclosure, a greenhouse).
// The matching treats such a group like any other target, keyed "giraffe+zebra+rhino".

export const EARTH_RADIUS_M = 6371008.8;
export const DEFAULT_RADIUS_M = 100;

export const DEFAULT_MATCHING = {
  maxAccuracyM: 50, // ignore fixes less accurate than this
  exitBufferM: 15, // stay matched until radius + this, so the edge doesn't flicker
  switchMarginM: 10, // a new target must be at least this much closer than the current one
  confirmFixes: 2, // a change must win this many fixes in a row
  notInParkM: 1500, // farther than this from every point = not in this park
};

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A point moved northM metres north and eastM metres east (fine for short distances). */
export function offsetM(point, northM, eastM) {
  const lat = point.lat + (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lng = point.lng + (eastM / (EARTH_RADIUS_M * Math.cos(toRad(point.lat)))) * (180 / Math.PI);
  return { lat, lng };
}

/** The ids a location points to, always as a list. */
export function targetsOf(location) {
  const t = location?.target;
  return Array.isArray(t) ? t : t == null ? [] : [t];
}

/** One string per target or group of targets: "lion", "giraffe+zebra+rhino". */
export function targetKey(location) {
  return targetsOf(location).join("+");
}

/** The ids in a key made by targetKey. */
export function keyTargets(key) {
  return key ? String(key).split("+") : [];
}

export function radiusOf(location, defaultRadiusM = DEFAULT_RADIUS_M) {
  return location.radiusM ?? defaultRadiusM;
}

/**
 * The nearest location whose radius contains the fix, or null.
 * This is the core rule: "within 100 m of the lions AND closer to them than to
 * any other known point".
 */
export function findMatch(fix, locations, defaultRadiusM = DEFAULT_RADIUS_M) {
  let best = null;
  for (const location of locations) {
    const d = distanceM(fix, location);
    if (d <= radiusOf(location, defaultRadiusM) && (!best || d < best.distanceM)) {
      best = { location, distanceM: d };
    }
  }
  return best;
}

/** Nearest location of one target key (any radius), or null if it has none. */
function nearestOfTarget(fix, locations, key) {
  let best = null;
  for (const location of locations) {
    if (targetKey(location) !== key) continue;
    const d = distanceM(fix, location);
    if (!best || d < best.distanceM) best = { location, distanceM: d };
  }
  return best;
}

/**
 * Keeps the match stable while the phone moves and the GPS jitters.
 *
 *   const tracker = createTracker(park);
 *   const { events, status } = tracker.update(fix);
 *
 * events: [{ type: "leave", target }, { type: "enter", target, location, distanceM }]
 * status: { state: "weak" | "outside" | "none" | "near", accuracy, target?, distanceM? }
 * target is a target key (see targetKey): "lion", or "giraffe+zebra+rhino" for a group.
 */
export function createTracker(park) {
  const opts = { ...DEFAULT_MATCHING, ...(park.matching || {}) };
  const defaultRadiusM = park.defaultRadiusM ?? DEFAULT_RADIUS_M;
  const locations = park.locations || [];

  let current = null; // { target, location, distanceM }
  let pending = null; // { target, count }

  function update(fix) {
    const events = [];
    const accuracy = fix.accuracy ?? 0;

    if (accuracy > opts.maxAccuracyM) {
      return { events, status: { state: "weak", accuracy, target: current?.target ?? null } };
    }

    const candidate = findMatch(fix, locations, defaultRadiusM);

    // Where is the current target now? (nearest of its points)
    let cur = null;
    if (current) {
      cur = nearestOfTarget(fix, locations, current.target);
      const stillIn = cur && cur.distanceM <= radiusOf(cur.location, defaultRadiusM) + opts.exitBufferM;
      if (!stillIn) cur = null;
    }

    // What we would like to show after this fix.
    let desired;
    if (cur) {
      const better =
        candidate &&
        targetKey(candidate.location) !== current.target &&
        candidate.distanceM + opts.switchMarginM <= cur.distanceM;
      desired = better ? candidate : { location: cur.location, distanceM: cur.distanceM };
    } else {
      desired = candidate; // may be null = nothing nearby
    }
    const desiredTarget = desired ? targetKey(desired.location) : null;

    if (desiredTarget === (current?.target ?? null)) {
      pending = null;
      if (current && desired) current = { target: current.target, location: desired.location, distanceM: desired.distanceM };
    } else {
      pending = pending && pending.target === desiredTarget ? { target: desiredTarget, count: pending.count + 1 } : { target: desiredTarget, count: 1 };
      if (pending.count >= opts.confirmFixes) {
        if (current) events.push({ type: "leave", target: current.target });
        current = desired ? { target: desiredTarget, location: desired.location, distanceM: desired.distanceM } : null;
        if (current) events.push({ type: "enter", ...current });
        pending = null;
      } else if (current && cur) {
        // Still showing the current target; keep its distance fresh.
        current = { target: current.target, location: cur.location, distanceM: cur.distanceM };
      }
    }

    let nearestAny = Infinity;
    for (const l of locations) nearestAny = Math.min(nearestAny, distanceM(fix, l));

    let status;
    if (current) status = { state: "near", accuracy, target: current.target, distanceM: current.distanceM };
    else if (nearestAny > opts.notInParkM) status = { state: "outside", accuracy, distanceM: nearestAny };
    else status = { state: "none", accuracy };

    return { events, status };
  }

  return {
    update,
    get current() {
      return current;
    },
    reset() {
      current = null;
      pending = null;
    },
    options: opts,
  };
}
