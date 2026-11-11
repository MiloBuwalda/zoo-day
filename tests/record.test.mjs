import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { averageFixes, nextLocationId, buildParkExport } from "../app/js/record.js";
import { validatePark, joinPark } from "../app/js/data.js";

const content = JSON.parse(readFileSync(new URL("../app/data/content.json", import.meta.url), "utf8"));

test("averageFixes weights accurate fixes more", () => {
  const avg = averageFixes([
    { lat: 51.0, lng: 4.0, accuracy: 5 },
    { lat: 51.001, lng: 4.001, accuracy: 50 },
  ]);
  assert.ok(avg.lat < 51.0001, "the ±50 m fix should barely move the average");
  assert.equal(avg.accuracy, 27.5);
  assert.equal(averageFixes([]), null);
});

test("nextLocationId picks the first free number", () => {
  assert.equal(nextLocationId("lion", new Set()), "lion-1");
  assert.equal(nextLocationId("lion", new Set(["lion-1", "lion-2"])), "lion-3");
});

const base = {
  id: "example-park",
  placeholder: true,
  center: { lat: 51, lng: 4 },
  defaultRadiusM: 80,
  locations: [
    { id: "lion-1", target: "lion", lat: 51, lng: 4, entry: { kind: "animal" } },
    { id: "zebra-1", target: "zebra", lat: 51.001, lng: 4 },
  ],
};
const recorded = [{ id: "lion-1", target: "lion", lat: 51.1234567, lng: 4.7654321, accuracyM: 6, recordedAt: "2026-11-11T10:00:00Z" }];

test("export with only recorded points", () => {
  const park = buildParkExport(base, recorded, { id: "artis", name: "ARTIS", keepUnrecorded: false });
  assert.equal(park.id, "artis");
  assert.equal(park.locations.length, 1);
  assert.deepEqual(park.locations[0], { id: "lion-1", target: "lion", lat: 51.123457, lng: 4.765432, accuracyM: 6, recordedAt: "2026-11-11T10:00:00Z" });
  assert.equal(park.defaultRadiusM, 80);
  assert.equal(park.placeholder, undefined);
  assert.deepEqual(validatePark(park, content).errors, []);
});

test("export keeping unrecorded points replaces recorded targets and drops joined content", () => {
  const park = buildParkExport(base, recorded, { id: "artis", name: "ARTIS", keepUnrecorded: true });
  assert.deepEqual(park.locations.map((l) => l.id), ["zebra-1", "lion-1"]);
  assert.ok(park.locations.every((l) => !("entry" in l)));
  assert.equal(park.locations.find((l) => l.target === "lion").lat, 51.123457, "recorded point wins over the old one");
  assert.equal(park.placeholder, true, "kept points from a demo park are still demo points");
  assert.deepEqual(validatePark(park, content).errors, []);
});

// --- spots with several animals ------------------------------------------------

const groupBase = {
  id: "wildlands",
  name: "Wildlands",
  defaultRadiusM: 40,
  locations: [
    { id: "savanna", target: ["giraffe", "zebra", "rhino"], label: { en: "Savanna", nl: "Savanne" }, lat: 52.7794, lng: 6.8862, radiusM: 60, note: "from OSM", entries: [{}, {}, {}] },
    { id: "lion", target: "lion", lat: 52.7806, lng: 6.886, entry: {}, entries: [{}] },
  ],
};

test("validatePark accepts a spot with several animals and counts them all as mapped", () => {
  const { errors, warnings } = validatePark(groupBase, content);
  assert.deepEqual(errors, []);
  const missing = warnings.find((w) => w.includes("have no location"));
  assert.ok(!/\bgiraffe\b|\bzebra\b|\brhino\b/.test(missing));
});

test("validatePark rejects bad groups", () => {
  const bad = (target, label) => validatePark({ id: "x", name: "x", locations: [{ id: "a", target, label, lat: 52, lng: 6 }] }, content).errors;
  assert.match(bad(["giraffe", "unicorn"]).join(), /unknown target "unicorn"/);
  assert.match(bad(["giraffe", "giraffe"]).join(), /listed twice/);
  assert.match(bad([]).join(), /missing target/);
  assert.match(bad(["giraffe"], 5).join(), /label/);
  assert.deepEqual(bad(["giraffe", "zebra"], "Savanna"), []);
});

test("joinPark gives a group all its entries and marks every animal as here", () => {
  const joined = joinPark(groupBase, content);
  const sav = joined.locations.find((l) => l.id === "savanna");
  assert.deepEqual(sav.entries.map((e) => e.item.id), ["giraffe", "zebra", "rhino"]);
  assert.equal(sav.entry, undefined);
  assert.ok(["giraffe", "zebra", "rhino", "lion"].every((id) => joined.targets.has(id)));
});

test("re-recording a group spot keeps its animals, label, radius and note", () => {
  const rec = [{ id: "savanna", spot: "savanna", target: ["giraffe", "zebra", "rhino"], label: { en: "Savanna", nl: "Savanne" }, radiusM: 60, note: "from OSM", lat: 52.77951, lng: 6.88633, accuracyM: 7, recordedAt: "2026-11-20T10:00:00Z" }];
  const park = buildParkExport(groupBase, rec, { id: "wildlands", name: "Wildlands", keepUnrecorded: true });
  assert.deepEqual(park.locations.map((l) => l.id), ["lion", "savanna"]);
  const sav = park.locations.find((l) => l.id === "savanna");
  assert.deepEqual(sav, { id: "savanna", target: ["giraffe", "zebra", "rhino"], label: { en: "Savanna", nl: "Savanne" }, lat: 52.77951, lng: 6.88633, radiusM: 60, note: "from OSM", accuracyM: 7, recordedAt: "2026-11-20T10:00:00Z" });
  assert.ok(park.locations.every((l) => !("entry" in l) && !("entries" in l)));
  assert.deepEqual(validatePark(park, content).errors, []);
});

test("kept points carry the base park's source credit", () => {
  const park = buildParkExport({ ...groupBase, source: "OpenStreetMap" }, [], { id: "w", name: "W", keepUnrecorded: true });
  assert.equal(park.source, "OpenStreetMap");
  assert.equal(buildParkExport({ ...groupBase, source: "OpenStreetMap" }, [], { id: "w", name: "W", keepUnrecorded: false }).source, undefined);
});
