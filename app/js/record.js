// Record mode (?record=1): walk the park, stand at each viewing spot, save the
// point, then download a park JSON file to put in data/parks/.

import { h } from "./render.js";
import { DEFAULT_MATCHING, DEFAULT_RADIUS_M } from "./geo.js";

const STORE_KEY = "zoo-day-recorded";
const SAMPLES = 5;
const GOOD_ACCURACY_M = 20;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// --- pure helpers (unit-tested) ---------------------------------------------

/** Weighted average of several fixes (better accuracy counts more). */
export function averageFixes(fixes) {
  if (!fixes.length) return null;
  let wSum = 0, lat = 0, lng = 0, acc = 0;
  for (const f of fixes) {
    const w = 1 / Math.max(1, f.accuracy ?? 10) ** 2;
    wSum += w;
    lat += f.lat * w;
    lng += f.lng * w;
    acc += f.accuracy ?? 10;
  }
  return { lat: lat / wSum, lng: lng / wSum, accuracy: acc / fixes.length };
}

/** "lion-1", "lion-2", … — the first id not in `taken`. */
export function nextLocationId(target, taken) {
  let n = 1;
  while (taken.has(`${target}-${n}`)) n++;
  return `${target}-${n}`;
}

/**
 * Builds a park file from the recorded points.
 * keepUnrecorded: also keep the base park's points for targets you didn't record.
 */
export function buildParkExport(base, recorded, { id, name, keepUnrecorded }) {
  const recordedTargets = new Set(recorded.map((p) => p.target));
  const kept = keepUnrecorded && base
    ? base.locations
        .filter((l) => !recordedTargets.has(l.target))
        .map(({ entry, ...l }) => l) // drop the joined content
    : [];
  const taken = new Set(kept.map((l) => l.id));
  const fresh = recorded.map((p) => {
    const loc = { id: taken.has(p.id) ? nextLocationId(p.target, taken) : p.id, target: p.target, lat: r6(p.lat), lng: r6(p.lng) };
    if (p.radiusM) loc.radiusM = p.radiusM;
    if (p.accuracyM != null) loc.accuracyM = p.accuracyM;
    if (p.recordedAt) loc.recordedAt = p.recordedAt;
    taken.add(loc.id);
    return loc;
  });
  const locations = [...kept, ...fresh];
  const center = locations.length
    ? { lat: r6(locations.reduce((s, l) => s + l.lat, 0) / locations.length), lng: r6(locations.reduce((s, l) => s + l.lng, 0) / locations.length) }
    : base?.center ?? null;
  const park = {
    id,
    name,
    center,
    defaultRadiusM: base?.defaultRadiusM ?? DEFAULT_RADIUS_M,
    matching: { ...DEFAULT_MATCHING, ...(base?.matching || {}) },
    locations,
  };
  if (kept.length && base?.placeholder) park.placeholder = true;
  return park;
}

// --- UI ----------------------------------------------------------------------

function loadRecorded() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]") || [];
  } catch {
    return [];
  }
}
function saveRecorded(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: points live until reload */
  }
}

export function createRecorder({ source, getContent, getLang, getT, getPark }) {
  let recorded = loadRecorded();
  let lastFix = null;
  let unsubscribe = null;
  let sampling = null; // { fixes: [], resolve }
  let message = "";
  let slot = null;
  const form = { target: "", id: "", name: "", keep: null };

  function onFix(fix) {
    lastFix = fix;
    if (sampling) {
      sampling.fixes.push(fix);
      message = getT()("recordSampling", { n: sampling.fixes.length, total: SAMPLES });
      if (sampling.fixes.length >= SAMPLES) {
        const s = sampling;
        sampling = null;
        s.resolve(s.fixes);
      }
    }
    render();
  }
  function onError(err) {
    message = err.message || err.code;
    render();
  }

  function ensureGps() {
    if (!unsubscribe) unsubscribe = source.subscribe(onFix, onError);
  }

  async function savePoint() {
    const t = getT();
    const target = form.target;
    if (!target) return;
    ensureGps();
    const fixes = await new Promise((resolve) => {
      sampling = { fixes: [], resolve };
      message = t("recordSampling", { n: 0, total: SAMPLES });
      render();
    });
    const avg = averageFixes(fixes);
    const acc = Math.round(avg.accuracy);
    if (acc > GOOD_ACCURACY_M && !confirm(t("recordPoorAccuracy", { acc }))) {
      message = "";
      return render();
    }
    const id = nextLocationId(target, new Set(recorded.map((p) => p.id)));
    recorded.push({ id, target, lat: r6(avg.lat), lng: r6(avg.lng), accuracyM: acc, recordedAt: new Date().toISOString() });
    saveRecorded(recorded);
    message = t("recordSaved", { id, acc });
    render();
  }

  function exportJSON() {
    const park = getPark();
    const keep = form.keep ?? !(park?.placeholder ?? true);
    const out = buildParkExport(park, recorded, {
      id: form.id || slugify(form.name) || "my-park",
      name: form.name || "My park",
      keepUnrecorded: keep,
    });
    return JSON.stringify(out, null, 2) + "\n";
  }

  function download() {
    const json = exportJSON();
    const id = JSON.parse(json).id;
    const a = h("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: `${id}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  async function copy(btn) {
    const json = exportJSON();
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const ta = h("textarea", {}, json);
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.textContent = getT()("recordCopied");
  }

  function render() {
    if (!slot || !slot.isConnected) return;
    const t = getT();
    const lang = getLang();
    const content = getContent();
    const park = getPark();
    const nameOf = (id) => content.animals.find((a) => a.id === id)?.name[lang] ?? content.sections.find((s) => s.id === id)?.title[lang] ?? id;
    const countFor = (id) => recorded.filter((p) => p.target === id).length;
    const label = (id) => nameOf(id) + (countFor(id) ? `  ✓${countFor(id)}` : "");

    const select = h(
      "select",
      { id: "record-target" },
      h("option", { value: "" }, "—"),
      h("optgroup", { label: "★" }, content.sections.filter((s) => s.type === "page" && s.id !== "sources").map((s) => h("option", { value: s.id, selected: form.target === s.id }, label(s.id)))),
      content.sections
        .filter((s) => s.type === "animals")
        .map((s) => h("optgroup", { label: s.title[lang] }, content.animals.filter((a) => a.section === s.id).map((a) => h("option", { value: a.id, selected: form.target === a.id }, label(a.id))))),
    );
    select.addEventListener("change", () => {
      form.target = select.value;
      render();
    });

    const fixLine = lastFix
      ? `${lastFix.lat.toFixed(6)}, ${lastFix.lng.toFixed(6)} · ±${Math.round(lastFix.accuracy)} m`
      : t("recordNoFix");
    const accClass = !lastFix ? "" : lastFix.accuracy <= GOOD_ACCURACY_M ? "good" : "poor";

    const startBtn = h("button", { type: "button" }, "📍 GPS");
    startBtn.addEventListener("click", ensureGps);
    const saveBtn = h("button", { type: "button", class: "primary", disabled: !form.target || !!sampling }, t("recordSave"));
    saveBtn.addEventListener("click", savePoint);

    const rows = recorded.map((p, i) => {
      const del = h("button", { type: "button", class: "link" }, t("recordDelete"));
      del.addEventListener("click", () => {
        recorded.splice(i, 1);
        saveRecorded(recorded);
        render();
      });
      return h("tr", {}, h("td", {}, p.id), h("td", {}, nameOf(p.target)), h("td", {}, `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`), h("td", {}, `±${p.accuracyM} m`), h("td", {}, del));
    });

    const idIn = h("input", { type: "text", value: form.id, placeholder: "artis", pattern: "[a-z0-9-]+" });
    idIn.addEventListener("input", () => (form.id = idIn.value.trim()));
    const nameIn = h("input", { type: "text", value: form.name, placeholder: "ARTIS Amsterdam" });
    nameIn.addEventListener("input", () => (form.name = nameIn.value.trim()));
    const keepIn = h("input", { type: "checkbox", checked: form.keep ?? !(park?.placeholder ?? true) });
    keepIn.addEventListener("change", () => (form.keep = keepIn.checked));

    const dl = h("button", { type: "button", disabled: !recorded.length }, t("recordDownload"));
    dl.addEventListener("click", download);
    const cp = h("button", { type: "button", disabled: !recorded.length }, t("recordCopy"));
    cp.addEventListener("click", () => copy(cp));
    const clear = h("button", { type: "button", class: "link", disabled: !recorded.length }, t("recordClear"));
    clear.addEventListener("click", () => {
      if (!confirm(t("recordClearConfirm"))) return;
      recorded = [];
      saveRecorded(recorded);
      render();
    });

    slot.replaceChildren(
      h(
        "section",
        { class: "record" },
        h("h2", {}, "📌 " + t("recordTitle")),
        h("p", { class: `record-fix ${accClass}` }, startBtn, " ", h("span", {}, fixLine)),
        h("div", { class: "record-row" }, h("label", {}, t("recordTarget") + " ", select), saveBtn),
        message ? h("p", { class: "record-msg", role: "status" }, message) : null,
        recorded.length
          ? h("div", { class: "tbl" }, h("table", {}, h("caption", {}, `${t("recordPoints")} (${recorded.length})`), h("tbody", {}, rows)))
          : null,
        h(
          "div",
          { class: "record-export" },
          h("label", {}, t("recordParkId") + " ", idIn),
          h("label", {}, t("recordParkName") + " ", nameIn),
          h("label", { class: "record-keep" }, keepIn, " " + t("recordKeep")),
          h("div", { class: "record-row" }, dl, cp, clear),
        ),
      ),
    );
  }

  return {
    mount(newSlot) {
      slot = newSlot;
      render();
    },
  };
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
