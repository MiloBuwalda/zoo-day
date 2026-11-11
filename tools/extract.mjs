// One-time extractor: turns the two original guide pages (EN + NL) into
//   app/data/content.json   – all animal content, both languages
//   app/images/<id>.jpg     – card photo
//   app/images/<id>-thumb.jpg – table-of-contents thumbnail
//
// After the first run, content.json is the source of truth. Re-running
// refuses to overwrite it unless you pass --force.
//
// Usage: node tools/extract.mjs [--force]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = {
  en: join(ROOT, "Zoo Day with Jesus.html"),
  nl: join(ROOT, "Dierentuindag met Jezus.html"),
};
const OUT_DATA = join(ROOT, "app", "data", "content.json");
const OUT_IMAGES = join(ROOT, "app", "images");
const PAGE_SECTIONS = new Set(["gate", "end", "sources"]);

// UI strings that are not in the original pages (GPS features).
const UI_EXTRA = {
  en: {
    useLocation: "📍 Use my location",
    stopLocation: "Stop location",
    gpsOff: "Location off",
    gpsSearching: "Finding your location…",
    gpsNear: "Near: {name}",
    gpsNothingNear: "No animal nearby",
    gpsWeak: "Weak GPS signal (±{acc} m)",
    gpsNotInPark: "You're not in a known park",
    gpsDenied: "Location permission denied",
    gpsUnsupported: "This browser has no location support",
    gpsUnavailable: "Location unavailable",
    nearYou: "You're near",
    openLesson: "Open lesson",
    close: "Close",
    distance: "about {m} m away",
    notAtPark: "Not at this park",
    park: "Park",
    noPark: "No park selected",
    language: "Nederlands",
    simTitle: "GPS simulator",
    simJump: "Jump to",
    simOffset: "Offset (m)",
    simAccuracy: "Accuracy (m)",
    recordTitle: "Record locations",
    recordTarget: "Animal or page",
    recordSave: "Save point here",
    recordSampling: "Measuring… {n}/{total}",
    recordPoorAccuracy: "Accuracy is ±{acc} m. Wait for a better signal or save anyway?",
    recordSaved: "Saved {id} (±{acc} m)",
    recordDownload: "Download park JSON",
    recordCopy: "Copy JSON",
    recordCopied: "Copied!",
    recordClear: "Clear recorded points",
    recordClearConfirm: "Remove all recorded points?",
    recordPoints: "Recorded points",
    recordNoFix: "Waiting for GPS…",
    recordParkId: "Park id",
    recordParkName: "Park name",
    recordKeep: "Keep the loaded park's points for animals I haven't recorded",
    recordDelete: "Delete",
    gpsInsecure: "Location only works on an https:// page",
    demoPark: "demo coordinates",
    simOutside: "Outside the park",
  },
  nl: {
    useLocation: "📍 Gebruik mijn locatie",
    stopLocation: "Locatie stoppen",
    gpsOff: "Locatie uit",
    gpsSearching: "Locatie zoeken…",
    gpsNear: "In de buurt: {name}",
    gpsNothingNear: "Geen dier in de buurt",
    gpsWeak: "Zwak GPS-signaal (±{acc} m)",
    gpsNotInPark: "Je bent niet in een bekend park",
    gpsDenied: "Geen toestemming voor locatie",
    gpsUnsupported: "Deze browser ondersteunt geen locatie",
    gpsUnavailable: "Locatie niet beschikbaar",
    nearYou: "Je bent bij",
    openLesson: "Open de les",
    close: "Sluiten",
    distance: "ongeveer {m} m hiervandaan",
    notAtPark: "Niet in dit park",
    park: "Park",
    noPark: "Geen park gekozen",
    language: "English",
    simTitle: "GPS-simulator",
    simJump: "Spring naar",
    simOffset: "Afstand (m)",
    simAccuracy: "Nauwkeurigheid (m)",
    recordTitle: "Locaties vastleggen",
    recordTarget: "Dier of pagina",
    recordSave: "Punt hier opslaan",
    recordSampling: "Meten… {n}/{total}",
    recordPoorAccuracy: "Nauwkeurigheid is ±{acc} m. Wachten op beter signaal of toch opslaan?",
    recordSaved: "{id} opgeslagen (±{acc} m)",
    recordDownload: "Park-JSON downloaden",
    recordCopy: "JSON kopiëren",
    recordCopied: "Gekopieerd!",
    recordClear: "Vastgelegde punten wissen",
    recordClearConfirm: "Alle vastgelegde punten verwijderen?",
    recordPoints: "Vastgelegde punten",
    recordNoFix: "Wachten op GPS…",
    recordParkId: "Park-id",
    recordParkName: "Naam van het park",
    recordKeep: "Punten van het geladen park houden voor dieren die ik niet heb vastgelegd",
    recordDelete: "Verwijderen",
    gpsInsecure: "Locatie werkt alleen op een https://-pagina",
    demoPark: "demo-coördinaten",
    simOutside: "Buiten het park",
  },
};

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

// Text of a block with its leading <span class="tag"> label removed.
function bodyText(el) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  clone.querySelectorAll(".tag").forEach((t) => t.remove());
  return text(clone);
}

function tagLabel(doc, selector) {
  const t = doc.querySelector(selector + " > .tag");
  if (!t) fail(`No tag label for ${selector}`);
  return text(t);
}

function decodeDataUri(uri, where) {
  const m = /^data:image\/jpeg;base64,(.+)$/s.exec(uri || "");
  if (!m) fail(`Expected a base64 JPEG for ${where}`);
  const buf = Buffer.from(m[1], "base64");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) fail(`Not a JPEG: ${where}`);
  return buf;
}

function parseLang(lang) {
  const html = readFileSync(SOURCES[lang], "utf8");
  const { document: doc } = parseHTML(html);

  // Section colours live in CSS custom properties: --c-savanna:#d08a2e
  const css = doc.querySelector("style").textContent;
  const colors = {};
  for (const m of css.matchAll(/--c-([a-z]+):(#[0-9a-fA-F]{3,8})/g)) colors[m[1]] = m[2];

  const sections = [];
  for (const sec of doc.querySelectorAll("section.sec")) {
    const id = sec.id;
    const title = text(sec.querySelector("h2"));
    if (PAGE_SECTIONS.has(id)) {
      const clone = sec.cloneNode(true);
      clone.querySelector("h2").remove();
      sections.push({ id, type: "page", color: colors[id], title, html: clone.innerHTML.trim() });
    } else {
      // Fail on anything we don't know how to store, so no content is silently dropped.
      for (const kid of sec.children) {
        if (!["H2", "ARTICLE"].includes(kid.tagName) && !kid.matches("div.intro")) fail(`[${lang}] section ${id}: unexpected <${kid.tagName.toLowerCase()} class="${kid.className}">`);
      }
      const intro = sec.querySelector(".intro");
      const introPs = intro.querySelectorAll(":scope > p");
      const introEgw = intro.querySelectorAll(":scope > blockquote.egw");
      if (introPs.length !== 1) fail(`[${lang}] section ${id}: expected exactly 1 intro paragraph`);
      if (introEgw.length > 1) fail(`[${lang}] section ${id}: more than one Ellen White quote in the intro`);
      if (intro.children.length !== introPs.length + introEgw.length) fail(`[${lang}] section ${id}: unexpected element in the intro`);
      const out = { id, type: "animals", color: colors[id], title, intro: text(introPs[0]) };
      if (introEgw.length) out.ellenWhite = bodyText(introEgw[0]);
      sections.push(out);
    }
  }

  const animals = [];
  for (const art of doc.querySelectorAll("article.animal")) {
    const id = art.id;
    const where = `[${lang}] ${id}`;
    const h3 = art.querySelector("h3");
    const name = text(h3.childNodes[0]);
    const thumbImg = doc.querySelector(`.tiles a[data-key="${id}"] img`);
    if (!thumbImg) fail(`${where}: no thumbnail tile`);

    const one = (sel, required) => {
      const found = art.querySelectorAll(sel);
      if (found.length > 1) fail(`${where}: more than one ${sel}`);
      if (required && found.length === 0) fail(`${where}: missing ${sel}`);
      return found[0] || null;
    };

    const known = ["header", "p.did", "p.bible", "blockquote.egw", "ol.quiz", "p.try"];
    for (const kid of art.querySelector(".animal-body").children) {
      if (!known.some((sel) => kid.matches(sel))) fail(`${where}: unexpected <${kid.tagName.toLowerCase()} class="${kid.className}">`);
    }

    const content = {
      didYouKnow: bodyText(one("p.did", true)),
      bible: bodyText(one("p.bible", true)),
    };
    const egw = one("blockquote.egw", false);
    if (egw) content.ellenWhite = bodyText(egw);
    content.quiz = [...art.querySelectorAll("ol.quiz > li details")].map((d) => ({
      q: text(d.querySelector("summary")),
      a: text(d.querySelector("p")),
    }));
    if (content.quiz.length === 0) fail(`${where}: no quiz questions`);
    const tryEl = one("p.try", false);
    if (tryEl) content.tryThis = bodyText(tryEl);

    animals.push({
      id,
      section: art.closest("section").id,
      name,
      credit: art.querySelector("figcaption a").getAttribute("href"),
      photo: decodeDataUri(art.querySelector("figure img").getAttribute("src"), `${where} photo`),
      thumb: decodeDataUri(thumbImg.getAttribute("src"), `${where} thumb`),
      content,
    });
  }

  // Hero / chrome strings.
  const kicker = doc.querySelector(".kicker").cloneNode(true);
  kicker.querySelector("a")?.remove();
  const progress = doc.querySelector(".progress").cloneNode(true);
  progress.querySelector("button").remove();
  progress.querySelector("#seen-count").textContent = "{seen}";
  const script = doc.querySelector("body script").textContent;
  const cssContent = (re) => (css.match(re) || [])[1];

  const ui = {
    title: text(doc.querySelector("h1")),
    kicker: text(kicker).replace(/[\s·]+$/, ""),
    sub: text(doc.querySelector(".sub")),
    progress: text(progress).replace(/\b47\b/, "{total}"),
    reset: text(doc.querySelector("#reset")),
    resetConfirm: (script.match(/confirm\("([^"]+)"\)/) || [])[1],
    contents: text(doc.querySelector(".toc > h2")),
    tocLabel: doc.querySelector(".toc").getAttribute("aria-label"),
    toTop: text(doc.querySelector(".to-top")),
    toTopLabel: doc.querySelector(".to-top").getAttribute("aria-label"),
    didYouKnow: tagLabel(doc, "p.did"),
    bible: tagLabel(doc, "article p.bible"),
    ellenWhite: tagLabel(doc, "article blockquote.egw"),
    tryThis: tagLabel(doc, "p.try"),
    seenIt: text(doc.querySelector(".seen-box")),
    photoCredit: text(doc.querySelector(".animal figcaption a")),
    quizPrefix: cssContent(/content:"([^"]*)" counter\(q\)/),
    tapForAnswer: cssContent(/summary::after\{content:"([^"]*)"/),
    answerPrefix: cssContent(/details p::before\{content:"([^"]*)"/),
    ...UI_EXTRA[lang],
  };
  for (const [k, v] of Object.entries(ui)) if (!v) fail(`[${lang}] UI string "${k}" not found`);

  return { lang: doc.documentElement.getAttribute("lang"), sections, animals, ui };
}

// ---------------------------------------------------------------------------

if (existsSync(OUT_DATA) && !process.argv.includes("--force")) {
  fail(`${OUT_DATA} already exists. It is now the source of truth; pass --force to overwrite it.`);
}

const en = parseLang("en");
const nl = parseLang("nl");

// EN and NL must describe the same animals in the same structure.
if (en.sections.map((s) => s.id).join() !== nl.sections.map((s) => s.id).join()) fail("Section ids differ between EN and NL");
if (en.animals.map((a) => a.id).join() !== nl.animals.map((a) => a.id).join()) fail("Animal ids differ between EN and NL");

const sections = en.sections.map((s, i) => {
  const n = nl.sections[i];
  if (s.type !== n.type) fail(`Section ${s.id}: type differs`);
  const out = { id: s.id, type: s.type, color: s.color, title: { en: s.title, nl: n.title } };
  if (s.type === "page") out.html = { en: s.html, nl: n.html };
  else {
    out.intro = { en: s.intro, nl: n.intro };
    if (!!s.ellenWhite !== !!n.ellenWhite) fail(`Section ${s.id}: Ellen White quote present in one language only`);
    if (s.ellenWhite) out.ellenWhite = { en: s.ellenWhite, nl: n.ellenWhite };
  }
  return out;
});

mkdirSync(OUT_IMAGES, { recursive: true });
const animals = en.animals.map((a, i) => {
  const b = nl.animals[i];
  for (const key of ["section", "credit"]) if (a[key] !== b[key]) fail(`${a.id}: ${key} differs between EN and NL`);
  if (a.content.quiz.length !== b.content.quiz.length) fail(`${a.id}: quiz length differs between EN and NL`);
  for (const key of ["ellenWhite", "tryThis"]) {
    if (!!a.content[key] !== !!b.content[key]) fail(`${a.id}: ${key} present in one language only`);
  }
  // Prefer the EN images; they are the same photos.
  writeFileSync(join(OUT_IMAGES, `${a.id}.jpg`), a.photo);
  writeFileSync(join(OUT_IMAGES, `${a.id}-thumb.jpg`), a.thumb);
  return {
    id: a.id,
    section: a.section,
    name: { en: a.name, nl: b.name },
    image: { photo: `images/${a.id}.jpg`, thumb: `images/${a.id}-thumb.jpg`, credit: a.credit },
    content: { en: a.content, nl: b.content },
  };
});

const content = {
  version: 1,
  languages: ["en", "nl"],
  ui: { en: en.ui, nl: nl.ui },
  sections,
  animals,
};

mkdirSync(dirname(OUT_DATA), { recursive: true });
writeFileSync(OUT_DATA, JSON.stringify(content, null, 2) + "\n", "utf8");

const pages = sections.filter((s) => s.type === "page").length;
console.log(`✓ ${animals.length} animals, ${sections.length - pages} animal sections, ${pages} pages`);
console.log(`✓ ${animals.length * 2} images → app/images/`);
console.log(`✓ ${OUT_DATA}`);
