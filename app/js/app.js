// Bootstrap: load the database, pick language and park, render, wire up GPS.

import { loadContent, loadParkIndex, loadPark } from "./data.js";
import { renderGuide, makeT, focusTarget, h } from "./render.js";
import { createPositionSource, parseLatLng, mountSimPanel } from "./position.js";
import { createNearby } from "./nearby.js";
import { createRecorder } from "./record.js";

const SEEN_KEY = "zoo-day-seen";
const LANG_KEY = "zoo-day-lang";
const PARK_KEY = "zoo-day-park";

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};

const root = document.getElementById("app");
const params = new URLSearchParams(location.search);

async function main() {
  const content = await loadContent();
  const parkIndex = await loadParkIndex();

  // --- language ---
  const pickLang = () => {
    const fromUrl = params.get("lang");
    if (content.languages.includes(fromUrl)) return fromUrl;
    const saved = store.get(LANG_KEY, null);
    if (content.languages.includes(saved)) return saved;
    const browser = (navigator.language || "").slice(0, 2);
    return content.languages.includes(browser) ? browser : content.languages[0];
  };
  let lang = pickLang();
  let t = makeT(content.ui[lang]);

  // --- park ---
  let park = null;
  const savedPark = store.get(PARK_KEY, undefined);
  const initialPark = params.get("park") || (savedPark !== undefined ? savedPark : parkIndex.length === 1 ? parkIndex[0].id : null);

  async function selectPark(id) {
    const entry = parkIndex.find((p) => p.id === id) || null;
    park = entry ? await loadPark(entry, content).catch((e) => (console.error(e), null)) : null;
    store.set(PARK_KEY, park ? park.id : null);
    nearby.setPark(park);
    renderAll();
  }

  // --- GPS ---
  const sim = params.has("sim");
  const source = createPositionSource({ sim, start: parseLatLng(params.get("sim")) });
  const ctx = { getContent: () => content, getLang: () => lang, getT: () => t, getPark: () => park };
  const nearby = createNearby({
    ...ctx,
    source,
    parkIndex,
    onSelectPark: selectPark,
    onOpen: (target) => focusTarget(target),
  });
  const recorder = params.has("record") ? createRecorder({ ...ctx, source }) : null;

  // --- seen ticks (same behaviour and storage key as the original page) ---
  let seen = store.get(SEEN_KEY, {}) || {};
  function syncSeen() {
    document.querySelectorAll("input[type=checkbox][data-key]").forEach((b) => (b.checked = !!seen[b.getAttribute("data-key")]));
    const count = content.animals.filter((a) => seen[a.id]).length;
    const counter = document.getElementById("seen-count");
    if (counter) counter.textContent = count;
    document.querySelectorAll(".tiles a[data-key]").forEach((a) => a.classList.toggle("is-seen", !!seen[a.getAttribute("data-key")]));
  }
  document.addEventListener("change", (e) => {
    const box = e.target;
    if (!box.matches?.("input[type=checkbox][data-key]")) return;
    const k = box.getAttribute("data-key");
    if (box.checked) seen[k] = 1;
    else delete seen[k];
    store.set(SEEN_KEY, seen);
    syncSeen();
  });
  document.addEventListener("click", (e) => {
    if (e.target.id !== "reset") return;
    if (!confirm(t("resetConfirm"))) return;
    seen = {};
    store.set(SEEN_KEY, seen);
    syncSeen();
  });
  document.addEventListener("nearby:rendered", syncSeen);
  window.addEventListener("beforeprint", () => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")));

  // --- render ---
  function setLang(next) {
    lang = next;
    t = makeT(content.ui[lang]);
    store.set(LANG_KEY, lang);
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    history.replaceState(null, "", url);
    const y = scrollY;
    renderAll();
    scrollTo(0, y);
  }

  function renderAll() {
    renderGuide(root, { content, lang, park, t, onLang: setLang });
    nearby.mount(document.getElementById("gps-slot"));
    if (recorder) recorder.mount(document.getElementById("record-slot"));
    if (sim) mountSimPanel(source, ctx);
    syncSeen();
  }

  await selectPark(initialPark);

  // Content is rendered after load, so jump to #anchor ourselves.
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();

  if (params.has("autostart")) nearby.start();
}

main().catch((err) => {
  console.error(err);
  const fileHint = location.protocol === "file:" ? " Open it through a web server (npm run serve), not as a file." : "";
  root.replaceChildren(h("div", { class: "wrap load-error" }, h("h1", {}, "Zoo Day"), h("p", {}, "Could not load the guide data." + fileHint), h("pre", {}, String(err.message || err))));
});

if ("serviceWorker" in navigator && location.protocol !== "file:" && !params.has("nosw")) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e));
}
