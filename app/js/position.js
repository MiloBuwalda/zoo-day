// Where fixes come from: the real GPS, or a simulator for testing at a desk.
// Both have the same interface:
//
//   const off = source.subscribe(onFix, onError);  // starts watching on first subscriber
//   off();                                         // stops when the last one leaves
//
// onFix receives { lat, lng, accuracy, timestamp }.
// onError receives { code: "denied" | "unavailable" | "timeout", message }.

import { h } from "./render.js";
import { offsetM } from "./geo.js";

const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
const ERROR_CODES = { 1: "denied", 2: "unavailable", 3: "timeout" };

export function createPositionSource({ sim = false, start = null } = {}) {
  return sim ? createSimSource(start) : createGeoSource();
}

function createGeoSource() {
  const subs = new Set();
  let watchId = null;

  const emitFix = (p) => {
    const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp };
    subs.forEach((s) => s.onFix(fix));
  };
  const emitError = (e) => {
    const err = { code: ERROR_CODES[e.code] || "unavailable", message: e.message };
    subs.forEach((s) => s.onError?.(err));
  };

  return {
    isSim: false,
    supported: typeof navigator !== "undefined" && "geolocation" in navigator,
    subscribe(onFix, onError) {
      const sub = { onFix, onError };
      subs.add(sub);
      if (watchId === null && this.supported) watchId = navigator.geolocation.watchPosition(emitFix, emitError, GEO_OPTIONS);
      return () => {
        subs.delete(sub);
        if (!subs.size && watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      };
    },
  };
}

function createSimSource(start) {
  const subs = new Set();
  let pos = start ? { lat: start.lat, lng: start.lng, accuracy: 5 } : null;
  let timer = null;

  const emit = () => {
    if (!pos) return;
    const fix = { ...pos, timestamp: Date.now() };
    subs.forEach((s) => s.onFix(fix));
  };

  return {
    isSim: true,
    supported: true,
    get position() {
      return pos;
    },
    /** Move the simulated phone. Emits right away and then every second. */
    set(point, accuracy = pos?.accuracy ?? 5) {
      pos = { lat: point.lat, lng: point.lng, accuracy };
      emit();
    },
    subscribe(onFix, onError) {
      const sub = { onFix, onError };
      subs.add(sub);
      if (!timer) timer = setInterval(emit, 1000);
      setTimeout(emit, 0);
      return () => {
        subs.delete(sub);
        if (!subs.size) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

/** "51.0001,4.0002" → { lat, lng } or null */
export function parseLatLng(s) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s || "");
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/**
 * Small floating panel (only with ?sim) to move the simulated phone:
 * jump to any location of the park, add an offset, change the accuracy.
 */
export function mountSimPanel(source, { getPark, getContent, getLang, getT }) {
  let panel = document.querySelector(".sim");
  if (!panel) {
    panel = h("details", { class: "sim", open: true });
    document.body.append(panel);
  }
  const t = getT();
  const park = getPark();
  const content = getContent();
  const lang = getLang();
  const nameOf = (target) => {
    const a = content.animals.find((x) => x.id === target);
    if (a) return a.name[lang];
    return content.sections.find((s) => s.id === target)?.title[lang] ?? target;
  };

  const select = h(
    "select",
    { "aria-label": t("simJump") },
    h("option", { value: "" }, "—"),
    (park?.locations || []).map((l) => h("option", { value: l.id }, `${nameOf(l.target)} (${l.id})`)),
    park ? h("option", { value: "__outside" }, t("simOutside")) : null,
  );
  const north = h("input", { type: "number", step: "5", value: "0", "aria-label": "north" });
  const east = h("input", { type: "number", step: "5", value: "0", "aria-label": "east" });
  const acc = h("input", { type: "number", step: "5", min: "1", value: String(Math.round(source.position?.accuracy ?? 5)) });
  const readout = h("output", { class: "sim-readout" });

  const showReadout = () => {
    const p = source.position;
    readout.textContent = p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ±${Math.round(p.accuracy)} m` : "—";
  };
  const apply = () => {
    if (!park) return;
    let base = null;
    if (select.value === "__outside") base = offsetM(park.center || park.locations[0], 5000, 0);
    else base = park.locations.find((l) => l.id === select.value) || source.position;
    if (!base) return;
    source.set(offsetM(base, Number(north.value) || 0, Number(east.value) || 0), Math.max(1, Number(acc.value) || 5));
    showReadout();
  };
  select.addEventListener("change", () => {
    north.value = "0";
    east.value = "0";
    apply();
  });
  [north, east, acc].forEach((i) => i.addEventListener("input", apply));

  panel.replaceChildren(
    h("summary", {}, "🧪 " + t("simTitle")),
    h("label", {}, t("simJump"), select),
    h("div", { class: "sim-row" }, h("label", {}, "N (m)", north), h("label", {}, "E (m)", east), h("label", {}, "± (m)", acc)),
    readout,
  );
  if (!source.position && park) source.set(park.center || park.locations[0]);
  showReadout();
}
