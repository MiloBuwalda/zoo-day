import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceM, offsetM, findMatch, createTracker, targetsOf, targetKey, keyTargets } from "../app/js/geo.js";

const LION = { lat: 51.0, lng: 4.0 };
const near = (point, northM, eastM = 0) => offsetM(point, northM, eastM);
const fix = (point, accuracy = 5) => ({ ...point, accuracy });

test("distanceM: 0.001° of latitude is about 111 m", () => {
  const d = distanceM({ lat: 51, lng: 4 }, { lat: 51.001, lng: 4 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `got ${d}`);
});

test("offsetM round-trips through distanceM", () => {
  assert.ok(Math.abs(distanceM(LION, near(LION, 50)) - 50) < 0.01);
  assert.ok(Math.abs(distanceM(LION, near(LION, 0, 80)) - 80) < 0.01);
  assert.ok(Math.abs(distanceM(LION, near(LION, 30, 40)) - 50) < 0.01);
});

// --- findMatch: the core rule -------------------------------------------------

const lion = { id: "lion-1", target: "lion", ...LION };
const giraffe = { id: "giraffe-1", target: "giraffe", ...near(LION, 0, 80) }; // 80 m east

test("user example: phone 50 m from the lions matches the lions", () => {
  const m = findMatch(near(LION, 50), [lion]);
  assert.equal(m.location.target, "lion");
  assert.ok(Math.abs(m.distanceM - 50) < 0.1);
});

test("user example: phone 150 m from the lions matches nothing", () => {
  assert.equal(findMatch(near(LION, 150), [lion]), null);
});

test("exactly on the radius still matches", () => {
  assert.equal(findMatch(near(LION, 99.99), [lion])?.location.target, "lion");
});

test("within 100 m of two points: the nearer one wins", () => {
  // 30 m east of the lion = 50 m west of the giraffe
  assert.equal(findMatch(near(LION, 0, 30), [lion, giraffe]).location.target, "lion");
  // 60 m east of the lion = 20 m west of the giraffe
  assert.equal(findMatch(near(LION, 0, 60), [lion, giraffe]).location.target, "giraffe");
  // Order of the list doesn't matter
  assert.equal(findMatch(near(LION, 0, 60), [giraffe, lion]).location.target, "giraffe");
});

test("a nearer point outside its own small radius loses to a farther point inside its radius", () => {
  const small = { id: "frog-1", target: "frog", ...near(LION, 0, 40), radiusM: 10 };
  // 25 m from the frog point (outside its 10 m), 65 m from the lion (inside 100 m)
  assert.equal(findMatch(near(LION, 0, 65), [lion, small]).location.target, "lion");
});

test("custom default radius", () => {
  assert.equal(findMatch(near(LION, 80), [lion], 50), null);
  assert.equal(findMatch(near(LION, 40), [lion], 50).location.target, "lion");
});

test("an animal with two points matches at its nearest point", () => {
  const p1 = { id: "penguin-1", target: "penguin", ...LION };
  const p2 = { id: "penguin-2", target: "penguin", ...near(LION, 150) };
  const m = findMatch(near(LION, 140), [p1, p2]);
  assert.equal(m.location.id, "penguin-2");
  assert.ok(Math.abs(m.distanceM - 10) < 0.1);
});

// --- createTracker: stability --------------------------------------------------

const park = { defaultRadiusM: 100, locations: [lion, giraffe] };
const run = (tracker, points) => points.map((p) => tracker.update(fix(p)));
const types = (r) => r.events.map((e) => `${e.type}:${e.target}`);

test("tracker: entering needs confirmFixes fixes in a row", () => {
  const t = createTracker(park);
  const [r1, r2] = run(t, [near(LION, 20), near(LION, 21)]);
  assert.deepEqual(types(r1), []);
  assert.equal(r1.status.state, "none");
  assert.deepEqual(types(r2), ["enter:lion"]);
  assert.equal(r2.status.state, "near");
  assert.equal(r2.status.target, "lion");
});

test("tracker: confirmFixes 1 enters immediately", () => {
  const t = createTracker({ ...park, matching: { confirmFixes: 1 } });
  assert.deepEqual(types(t.update(fix(near(LION, 20)))), ["enter:lion"]);
});

test("tracker: inaccurate fixes are ignored and reported as weak", () => {
  const t = createTracker(park);
  run(t, [near(LION, 5), near(LION, 5)]);
  assert.equal(t.current.target, "lion");
  const weak = t.update({ ...near(LION, 0, 300), accuracy: 80 });
  assert.deepEqual(weak.events, []);
  assert.equal(weak.status.state, "weak");
  assert.equal(t.current.target, "lion", "a bad fix must not drop the match");
});

test("tracker: standing halfway between two enclosures doesn't flicker", () => {
  const t = createTracker(park);
  run(t, [near(LION, 0, 10), near(LION, 0, 10)]);
  assert.equal(t.current.target, "lion");
  // Midpoint is 40 m east. Jitter a few metres either side, many times.
  const jitter = [38, 43, 37, 44, 39, 42, 36, 45].map((e) => near(LION, 0, e));
  const results = run(t, jitter);
  assert.ok(results.every((r) => r.events.length === 0), "no enter/leave while jittering at the midpoint");
  assert.equal(t.current.target, "lion");
});

test("tracker: switches when clearly closer to another target", () => {
  const t = createTracker(park);
  run(t, [near(LION, 0, 10), near(LION, 0, 10)]);
  const [a, b] = run(t, [near(LION, 0, 70), near(LION, 0, 72)]);
  assert.deepEqual(types(a), [], "one fix is not enough");
  assert.deepEqual(types(b), ["leave:lion", "enter:giraffe"]);
});

test("tracker: exit buffer keeps the match just outside the radius", () => {
  const solo = { defaultRadiusM: 100, locations: [lion] };
  const t = createTracker(solo);
  run(t, [near(LION, 50), near(LION, 50)]);
  const edge = run(t, [near(LION, 105), near(LION, 110), near(LION, 112)]);
  assert.ok(edge.every((r) => r.events.length === 0), "105-112 m is inside radius + 15 m buffer");
  assert.equal(t.current.target, "lion");
  const out = run(t, [near(LION, 130), near(LION, 131)]);
  assert.deepEqual(types(out[0]), []);
  assert.deepEqual(types(out[1]), ["leave:lion"]);
  assert.equal(t.current, null);
  assert.equal(out[1].status.state, "none");
});

test("tracker: walking between two points of the same animal emits no events", () => {
  const p1 = { id: "penguin-1", target: "penguin", ...LION };
  const p2 = { id: "penguin-2", target: "penguin", ...near(LION, 150) };
  const t = createTracker({ defaultRadiusM: 100, locations: [p1, p2] });
  run(t, [near(LION, 10), near(LION, 10)]);
  const walk = run(t, [40, 70, 80, 110, 140].map((n) => near(LION, n)));
  assert.ok(walk.every((r) => r.events.length === 0));
  assert.equal(t.current.target, "penguin");
  assert.equal(t.current.location.id, "penguin-2");
});

test("tracker: far away from every point reports outside", () => {
  const t = createTracker(park);
  const r = t.update(fix({ lat: 52.37, lng: 4.9 })); // Amsterdam, ~150 km away
  assert.equal(r.status.state, "outside");
});

test("tracker: reset forgets the current match", () => {
  const t = createTracker(park);
  run(t, [near(LION, 5), near(LION, 5)]);
  t.reset();
  assert.equal(t.current, null);
});

// --- spots with several animals ------------------------------------------------

test("targetsOf / targetKey / keyTargets", () => {
  assert.deepEqual(targetsOf({ target: "lion" }), ["lion"]);
  assert.deepEqual(targetsOf({ target: ["giraffe", "zebra"] }), ["giraffe", "zebra"]);
  assert.equal(targetKey({ target: ["giraffe", "zebra"] }), "giraffe+zebra");
  assert.deepEqual(keyTargets("giraffe+zebra"), ["giraffe", "zebra"]);
  assert.deepEqual(keyTargets("lion"), ["lion"]);
});

test("tracker: a spot with several animals enters and leaves as one target", () => {
  const savanna = { id: "savanna", target: ["giraffe", "zebra", "rhino"], ...near(LION, 0, 120), radiusM: 50 };
  const t = createTracker({ defaultRadiusM: 50, locations: [lion, savanna] });
  const out = run(t, [near(LION, 0, 110), near(LION, 0, 110), near(LION, 0, 5), near(LION, 0, 5)]);
  assert.deepEqual(types(out[1]), ["enter:giraffe+zebra+rhino"]);
  assert.equal(out[1].status.target, "giraffe+zebra+rhino");
  assert.deepEqual(types(out[3]), ["leave:giraffe+zebra+rhino", "enter:lion"]);
});

test("tracker: two points of the same group count as the same target", () => {
  const a = { id: "farm-1", target: ["goat", "pig"], ...LION };
  const b = { id: "farm-2", target: ["goat", "pig"], ...near(LION, 60) };
  const t = createTracker({ defaultRadiusM: 40, locations: [a, b] });
  run(t, [near(LION, 5), near(LION, 5)]);
  const walk = run(t, [20, 30, 40, 55].map((n) => near(LION, n)));
  assert.ok(walk.every((r) => r.events.length === 0));
  assert.equal(t.current.location.id, "farm-2");
});
