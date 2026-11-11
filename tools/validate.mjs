// Checks app/data/content.json and every park listed in app/data/parks/index.json.
// Exits with code 1 if there are errors. Warnings are printed but don't fail.
//
// Usage: node tools/validate.mjs [path/to/extra-park.json ...]

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent, validatePark } from "../app/js/data.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const DATA = join(APP, "data");
let errorCount = 0;

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`✗ ${path}: ${e.message}`);
    process.exit(1);
  }
}

function report(label, { errors, warnings }) {
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  warnings.forEach((w) => console.warn(`  ! ${w}`));
  console.log(`${errors.length ? "✗" : "✓"} ${label}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  errorCount += errors.length;
}

const content = readJSON(join(DATA, "content.json"));
report(
  `content.json (${content.animals?.length ?? 0} animals, ${content.sections?.length ?? 0} sections)`,
  validateContent(content, (p) => existsSync(join(APP, p))),
);

const indexPath = join(DATA, "parks", "index.json");
const parkFiles = [];
if (existsSync(indexPath)) {
  const index = readJSON(indexPath);
  const ids = new Set();
  for (const entry of index.parks || []) {
    if (ids.has(entry.id)) { console.error(`  ✗ parks/index.json: duplicate park id ${entry.id}`); errorCount++; }
    ids.add(entry.id);
    const file = join(DATA, "parks", entry.file || "");
    if (!entry.file || !existsSync(file)) { console.error(`  ✗ parks/index.json: ${entry.id}: file not found: ${entry.file}`); errorCount++; continue; }
    parkFiles.push({ file, entry });
  }
} else {
  console.warn("! no data/parks/index.json");
}
for (const extra of process.argv.slice(2)) parkFiles.push({ file: resolve(extra), entry: null });

for (const { file, entry } of parkFiles) {
  const park = readJSON(file);
  const result = validatePark(park, content);
  if (entry && entry.id !== park.id) result.errors.push(`index.json says id "${entry.id}" but the file says "${park.id}"`);
  report(`park ${park.id} (${park.locations?.length ?? 0} locations)`, result);
}

process.exit(errorCount ? 1 : 0);
