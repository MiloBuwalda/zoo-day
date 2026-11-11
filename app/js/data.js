// Loading and validating the JSON database. Used by the app and by tools/validate.mjs.
//
//   data/content.json        – what to show (animals, sections, pages, UI text)
//   data/parks/index.json    – which parks exist
//   data/parks/<id>.json     – where things are in one park

import { distanceM, targetsOf, targetKey } from "./geo.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

/** Map of every id a location may point at → { kind: "animal" | "page", item }. */
export function targetIndex(content) {
  const map = new Map();
  for (const s of content.sections || []) if (s.type === "page") map.set(s.id, { kind: "page", item: s });
  for (const a of content.animals || []) map.set(a.id, { kind: "animal", item: a });
  return map;
}

/**
 * Checks content.json. `imageExists(path)` is optional (Node passes one).
 * Returns { errors: string[], warnings: string[] }.
 */
export function validateContent(content, imageExists) {
  const errors = [];
  const warnings = [];
  const langs = content.languages || [];
  if (!langs.length) errors.push("content.languages is empty");

  const seen = new Set();
  const dup = (id, what) => {
    if (seen.has(id)) errors.push(`duplicate id "${id}" (${what})`);
    seen.add(id);
  };

  const animalSections = new Set();
  for (const s of content.sections || []) {
    if (!isStr(s.id)) { errors.push("a section has no id"); continue; }
    dup(s.id, "section");
    if (!["animals", "page"].includes(s.type)) errors.push(`section ${s.id}: type must be "animals" or "page"`);
    if (s.type === "animals") animalSections.add(s.id);
    for (const l of langs) {
      if (!isStr(s.title?.[l])) errors.push(`section ${s.id}: missing title.${l}`);
      if (s.type === "page" && !isStr(s.html?.[l])) errors.push(`page ${s.id}: missing html.${l}`);
      if (s.type === "animals" && !isStr(s.intro?.[l])) errors.push(`section ${s.id}: missing intro.${l}`);
      if (s.ellenWhite && !isStr(s.ellenWhite[l])) errors.push(`section ${s.id}: missing ellenWhite.${l}`);
    }
  }

  for (const a of content.animals || []) {
    if (!isStr(a.id)) { errors.push("an animal has no id"); continue; }
    const at = `animal ${a.id}`;
    dup(a.id, "animal");
    if (!/^[a-z0-9-]+$/.test(a.id)) errors.push(`${at}: id may only contain a-z, 0-9 and -`);
    if (!animalSections.has(a.section)) errors.push(`${at}: unknown section "${a.section}"`);
    for (const key of ["photo", "thumb"]) {
      const p = a.image?.[key];
      if (!isStr(p)) errors.push(`${at}: missing image.${key}`);
      else if (imageExists && !imageExists(p)) errors.push(`${at}: image file not found: ${p}`);
    }
    for (const l of langs) {
      if (!isStr(a.name?.[l])) errors.push(`${at}: missing name.${l}`);
      const c = a.content?.[l];
      if (!c) { errors.push(`${at}: missing content.${l}`); continue; }
      if (!isStr(c.didYouKnow)) errors.push(`${at}: missing content.${l}.didYouKnow`);
      if (!isStr(c.bible)) errors.push(`${at}: missing content.${l}.bible`);
      if (!Array.isArray(c.quiz) || !c.quiz.length) errors.push(`${at}: content.${l}.quiz is empty`);
      else c.quiz.forEach((q, i) => { if (!isStr(q.q) || !isStr(q.a)) errors.push(`${at}: content.${l}.quiz[${i}] needs q and a`); });
    }
    const [first, ...rest] = langs;
    for (const l of rest) {
      if (a.content?.[first]?.quiz?.length !== a.content?.[l]?.quiz?.length) warnings.push(`${at}: quiz has a different number of questions in ${first} and ${l}`);
    }
  }

  const uiKeys = langs.map((l) => new Set(Object.keys(content.ui?.[l] || {})));
  langs.forEach((l, i) => {
    for (const k of uiKeys[0]) if (!uiKeys[i].has(k)) errors.push(`ui.${l} is missing "${k}"`);
  });

  return { errors, warnings };
}

/** Checks a park file against the content. Returns { errors, warnings }. */
export function validatePark(park, content) {
  const errors = [];
  const warnings = [];
  const where = `park ${park?.id || "(no id)"}`;
  if (!isStr(park?.id)) errors.push(`${where}: missing id`);
  if (!isStr(park?.name)) errors.push(`${where}: missing name`);
  if (park?.defaultRadiusM !== undefined && !(isNum(park.defaultRadiusM) && park.defaultRadiusM > 0)) errors.push(`${where}: defaultRadiusM must be a positive number`);
  for (const [k, v] of Object.entries(park?.matching || {})) if (!isNum(v) || v < 0) errors.push(`${where}: matching.${k} must be a number ≥ 0`);
  const center = park?.center;
  if (center && !validLatLng(center)) errors.push(`${where}: center has an invalid lat/lng`);
  if (park?.placeholder) warnings.push(`${where}: uses placeholder coordinates (demo only)`);
  if (!Array.isArray(park?.locations)) { errors.push(`${where}: locations must be an array`); return { errors, warnings }; }

  const targets = targetIndex(content);
  const ids = new Set();
  const good = [];
  for (const [i, l] of park.locations.entries()) {
    const at = `${where}: location ${l.id || "#" + i}`;
    if (!isStr(l.id)) errors.push(`${at}: missing id`);
    else if (ids.has(l.id)) errors.push(`${at}: duplicate location id`);
    ids.add(l.id);
    const ts = targetsOf(l);
    if (!ts.length) errors.push(`${at}: missing target`);
    if (Array.isArray(l.target) && new Set(ts).size !== ts.length) errors.push(`${at}: the same target is listed twice`);
    for (const t of ts) if (!targets.has(t)) errors.push(`${at}: unknown target "${t}"`);
    if (l.label !== undefined && !isStr(l.label) && !(l.label && typeof l.label === "object" && Object.values(l.label).every(isStr))) {
      errors.push(`${at}: label must be text or { "en": "…", "nl": "…" }`);
    }
    if (!validLatLng(l)) { errors.push(`${at}: invalid lat/lng`); continue; }
    if (l.radiusM !== undefined && !(isNum(l.radiusM) && l.radiusM > 0)) errors.push(`${at}: radiusM must be a positive number`);
    if (center && validLatLng(center) && distanceM(center, l) > 2000) warnings.push(`${at}: more than 2 km from the park centre (typo?)`);
    good.push(l);
  }
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      if (targetKey(good[i]) !== targetKey(good[j]) && distanceM(good[i], good[j]) < 5) {
        warnings.push(`${where}: ${good[i].id} and ${good[j].id} point at different targets but are less than 5 m apart`);
      }
    }
  }
  const mapped = new Set(good.flatMap(targetsOf));
  const missing = (content.animals || []).filter((a) => !mapped.has(a.id)).map((a) => a.id);
  if (missing.length) warnings.push(`${where}: ${missing.length} animal(s) have no location here: ${missing.join(", ")}`);
  return { errors, warnings };
}

function validLatLng(p) {
  return isNum(p?.lat) && isNum(p?.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

/**
 * Joins a park to the content: every location gets its target's full record,
 * so one entry holds the id, the GPS point and all content. A location with
 * several targets gets them all in `entries` (`entry` is set for one target).
 */
export function joinPark(park, content) {
  const targets = targetIndex(content);
  const locations = (park.locations || [])
    .filter((l) => targetsOf(l).length && targetsOf(l).every((t) => targets.has(t)) && validLatLng(l))
    .map((l) => {
      const entries = targetsOf(l).map((t) => targets.get(t));
      return entries.length === 1 ? { ...l, entry: entries[0], entries } : { ...l, entries };
    });
  return { ...park, locations, targets: new Set(locations.flatMap(targetsOf)) };
}

// --- browser loading ---------------------------------------------------------

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadContent(base = "data/") {
  const content = await getJSON(base + "content.json");
  const { errors, warnings } = validateContent(content);
  warnings.forEach((w) => console.warn("[content]", w));
  if (errors.length) throw new Error("content.json is invalid:\n" + errors.join("\n"));
  return content;
}

export async function loadParkIndex(base = "data/") {
  try {
    const index = await getJSON(base + "parks/index.json");
    return Array.isArray(index.parks) ? index.parks : [];
  } catch (e) {
    console.warn("[parks] no park index:", e.message);
    return [];
  }
}

export async function loadPark(entry, content, base = "data/") {
  const park = await getJSON(base + "parks/" + entry.file);
  const { errors, warnings } = validatePark(park, content);
  warnings.forEach((w) => console.warn("[park]", w));
  errors.forEach((e) => console.error("[park]", e));
  return joinPark(park, content);
}
