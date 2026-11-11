// Ties GPS fixes to the UI: the location button and status pill in the header,
// the "You're near: Lion" pop-up at the bottom, vibration and screen wake lock.

import { h } from "./render.js";
import { createTracker, distanceM, keyTargets, targetKey } from "./geo.js";

const AUTO_PARK_M = 3000; // pick a park automatically if its centre is this close

export function createNearby({ source, parkIndex, getContent, getLang, getT, getPark, onSelectPark, onOpen }) {
  let tracking = false;
  let unsubscribe = null;
  let tracker = null;
  let status = { state: "off" };
  let current = null; // { target, distanceM }; target is a key: "lion" or "giraffe+zebra+rhino"
  const dismissed = new Set();
  let wakeLock = null;
  let switchingPark = false;
  let slot = null;

  const popup = h("aside", { class: "nearby", hidden: true, "aria-live": "polite" });
  document.body.append(popup);

  // --- helpers -------------------------------------------------------------

  function entryFor(target) {
    const content = getContent();
    const animal = content.animals.find((a) => a.id === target);
    if (animal) return { kind: "animal", item: animal };
    const page = content.sections.find((s) => s.id === target);
    return page ? { kind: "page", item: page } : null;
  }

  function nameOf(target, lang = getLang()) {
    const e = entryFor(target);
    if (!e) return target;
    return e.kind === "animal" ? e.item.name[lang] : e.item.title[lang];
  }

  /** Name for a target key: the animal, or the group's label, or its animals' names. */
  function labelOf(key, lang = getLang()) {
    const ids = keyTargets(key);
    if (ids.length === 1) return nameOf(ids[0], lang);
    const label = getPark()?.locations.find((l) => targetKey(l) === key)?.label;
    return (typeof label === "string" ? label : label?.[lang]) || ids.map((id) => nameOf(id, lang)).join(", ");
  }

  function nearestPark(fix) {
    let best = null;
    for (const p of parkIndex) {
      if (!p.center) continue;
      const d = distanceM(fix, p.center);
      if (d <= AUTO_PARK_M && (!best || d < best.d)) best = { entry: p, d };
    }
    return best?.entry || null;
  }

  async function lockScreen() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      /* not allowed or not supported: fine */
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (tracking && document.visibilityState === "visible") lockScreen();
  });

  // --- tracking ------------------------------------------------------------

  function start() {
    if (tracking) return;
    if (!source.supported) return setStatus({ state: "unsupported" });
    if (!source.isSim && !window.isSecureContext) return setStatus({ state: "insecure" });
    tracking = true;
    setStatus({ state: "searching" });
    unsubscribe = source.subscribe(onFix, onError);
    lockScreen();
  }

  function stop() {
    tracking = false;
    unsubscribe?.();
    unsubscribe = null;
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    tracker?.reset();
    current = null;
    hidePopup();
    setStatus({ state: "off" });
  }

  async function onFix(fix) {
    if (switchingPark) return;
    const park = getPark();

    // No park yet, or we're outside this one: try to find the park we're in.
    if (!park || (tracker && status.state === "outside")) {
      const candidate = nearestPark(fix);
      if (candidate && candidate.id !== park?.id) {
        switchingPark = true;
        try {
          await onSelectPark(candidate.id);
        } finally {
          switchingPark = false;
        }
        return;
      }
      if (!park) return setStatus({ state: "outside", accuracy: fix.accuracy });
    }
    if (!tracker) return;

    const { events, status: s } = tracker.update(fix);
    for (const e of events) {
      if (e.type === "leave") {
        dismissed.delete(e.target);
        if (popup.dataset.target === e.target) hidePopup();
        current = null;
      } else if (e.type === "enter") {
        current = { target: e.target, distanceM: e.distanceM };
        if (!dismissed.has(e.target)) {
          showPopup(e.target);
          try {
            navigator.vibrate?.(200);
          } catch {
            /* iOS Safari has no vibrate */
          }
        }
      }
    }
    if (s.state === "near") current = { target: s.target, distanceM: s.distanceM };
    setStatus(s);
  }

  function onError(err) {
    if (err.code === "timeout") return setStatus({ state: "searching" });
    if (err.code === "denied") {
      tracking = false;
      unsubscribe?.();
      unsubscribe = null;
    }
    setStatus({ state: err.code });
  }

  // --- UI ------------------------------------------------------------------

  function setStatus(s) {
    status = s;
    renderBar();
    if (!popup.hidden && current && popup.dataset.target === current.target) updatePopupDistance();
    markNearCard();
  }

  function statusText() {
    const t = getT();
    const acc = Math.round(status.accuracy ?? 0);
    switch (status.state) {
      case "off": return t("gpsOff");
      case "searching": return t("gpsSearching");
      case "near": return `${t("gpsNear", { name: labelOf(status.target) })} · ±${acc} m`;
      case "none": return `${t("gpsNothingNear")} · ±${acc} m`;
      case "weak": return t("gpsWeak", { acc });
      case "outside": return t("gpsNotInPark");
      case "denied": return t("gpsDenied");
      case "unsupported": return t("gpsUnsupported");
      case "insecure": return t("gpsInsecure");
      default: return t("gpsUnavailable");
    }
  }

  function renderBar() {
    if (!slot || !slot.isConnected) return;
    const t = getT();
    const park = getPark();
    const toggle = h("button", { type: "button", class: "gps-btn", "aria-pressed": String(tracking) }, tracking ? t("stopLocation") : t("useLocation"));
    toggle.addEventListener("click", () => (tracking ? stop() : start()));

    const pill =
      status.state === "near"
        ? h("button", { type: "button", class: "gps-status", "data-state": status.state }, statusText())
        : h("span", { class: "gps-status", "data-state": status.state, role: "status" }, statusText());
    if (status.state === "near") {
      pill.addEventListener("click", () => {
        dismissed.delete(status.target);
        showPopup(status.target);
      });
    }

    let parkPicker = null;
    if (parkIndex.length) {
      const select = h(
        "select",
        { id: "park-select" },
        h("option", { value: "" }, "— " + t("noPark") + " —"),
        parkIndex.map((p) => h("option", { value: p.id, selected: p.id === park?.id }, p.name)),
      );
      select.addEventListener("change", () => onSelectPark(select.value || null));
      parkPicker = h("label", { class: "gps-park" }, t("park") + " ", select);
    }

    // replaceChildren would print a null as the text "null", so drop the empty ones.
    slot.replaceChildren(
      ...[toggle, pill, parkPicker, park?.placeholder ? h("span", { class: "gps-demo" }, t("demoPark")) : null].filter(Boolean),
    );
  }

  function colorOf(e) {
    return e.kind === "animal" ? getContent().sections.find((s) => s.id === e.item.section)?.color : e.item.color;
  }

  function showPopup(target) {
    if (keyTargets(target).length > 1) return showGroupPopup(target);
    const t = getT();
    const lang = getLang();
    const content = getContent();
    const e = entryFor(target);
    if (!e) return;
    const alt = content.languages.find((l) => l !== lang) || lang;
    const color = colorOf(e);

    const close = h("button", { type: "button", class: "nearby-close", "aria-label": t("close") }, "×");
    close.addEventListener("click", () => {
      dismissed.add(target);
      hidePopup();
    });
    const open = h("button", { type: "button", class: "nearby-open" }, t("openLesson"));
    open.addEventListener("click", () => {
      dismissed.add(target);
      hidePopup();
      onOpen(target);
    });

    popup.dataset.target = target;
    popup.classList.remove("is-group");
    popup.style.setProperty("--sec", color || "var(--accent)");
    popup.replaceChildren(
      e.kind === "animal" ? h("img", { class: "nearby-thumb", src: e.item.image.thumb, alt: "" }) : h("span", { class: "nearby-dot", "aria-hidden": "true" }),
      h(
        "div",
        { class: "nearby-text" },
        h("span", { class: "nearby-kicker" }, t("nearYou")),
        h("strong", { class: "nearby-name" }, nameOf(target, lang)),
        e.kind === "animal" ? h("span", { class: "nearby-alt" }, nameOf(target, alt)) : null,
        h("span", { class: "nearby-dist" }),
      ),
      close,
      h(
        "div",
        { class: "nearby-actions" },
        e.kind === "animal" ? h("label", { class: "seen-box" }, h("input", { type: "checkbox", "data-key": target }), " " + t("seenIt")) : null,
        open,
      ),
    );
    revealPopup();
  }

  /** One spot with several animals: a list, each with its own tick and open button. */
  function showGroupPopup(key) {
    const t = getT();
    const lang = getLang();
    const content = getContent();
    const alt = content.languages.find((l) => l !== lang) || lang;
    const items = keyTargets(key).map((id) => ({ id, e: entryFor(id) })).filter((x) => x.e);
    if (!items.length) return;

    const close = h("button", { type: "button", class: "nearby-close", "aria-label": t("close") }, "×");
    close.addEventListener("click", () => {
      dismissed.add(key);
      hidePopup();
    });
    const rows = items.map(({ id, e }) => {
      const open = h("button", { type: "button", class: "nearby-go", "aria-label": `${t("openLesson")}: ${nameOf(id, lang)}`, title: t("openLesson") }, "›");
      open.addEventListener("click", () => {
        dismissed.add(key);
        hidePopup();
        onOpen(id);
      });
      return h(
        "li",
        { style: `--sec:${colorOf(e) || "var(--accent)"}` },
        e.kind === "animal" ? h("img", { class: "nearby-mini", src: e.item.image.thumb, alt: "" }) : h("span", { class: "nearby-mini nearby-dot", "aria-hidden": "true" }),
        h("span", { class: "nearby-li-text" }, h("strong", {}, nameOf(id, lang)), e.kind === "animal" ? h("small", {}, nameOf(id, alt)) : null),
        e.kind === "animal" ? h("label", { class: "nearby-seen", title: t("seenIt") }, h("input", { type: "checkbox", "data-key": id, "aria-label": `${t("seenIt")} ${nameOf(id, lang)}` })) : h("span"),
        open,
      );
    });

    popup.dataset.target = key;
    popup.classList.add("is-group");
    popup.style.setProperty("--sec", colorOf(items[0].e) || "var(--accent)");
    popup.replaceChildren(
      h(
        "div",
        { class: "nearby-text" },
        h("span", { class: "nearby-kicker" }, t("nearYou")),
        h("strong", { class: "nearby-name" }, labelOf(key, lang)),
        h("span", { class: "nearby-dist" }),
      ),
      close,
      h("ul", { class: "nearby-list" }, rows),
    );
    revealPopup();
  }

  function revealPopup() {
    updatePopupDistance();
    popup.hidden = false;
    popup.classList.remove("show");
    void popup.offsetWidth;
    popup.classList.add("show");
    document.body.classList.add("has-nearby");
    document.dispatchEvent(new CustomEvent("nearby:rendered")); // lets app.js sync the seen tick
  }

  function updatePopupDistance() {
    const el = popup.querySelector(".nearby-dist");
    // Rounded to 5 m: GPS isn't more precise than that anyway.
    if (el && current) el.textContent = getT()("distance", { m: Math.max(5, Math.round(current.distanceM / 5) * 5) });
  }

  function hidePopup() {
    popup.hidden = true;
    delete popup.dataset.target;
    document.body.classList.remove("has-nearby");
  }

  function markNearCard() {
    document.querySelectorAll(".is-near").forEach((el) => el.classList.remove("is-near"));
    if (status.state === "near" || (status.state === "weak" && current)) {
      for (const id of keyTargets(current?.target || status.target)) document.getElementById(id)?.classList.add("is-near");
    }
  }

  // --- public --------------------------------------------------------------

  return {
    /** Called after every full re-render (language or park change). */
    mount(newSlot) {
      slot = newSlot;
      renderBar();
      markNearCard();
      if (!popup.hidden && popup.dataset.target) showPopup(popup.dataset.target);
    },
    /** Called when the park changes. */
    setPark(park) {
      tracker = park ? createTracker(park) : null;
      current = null;
      dismissed.clear();
      hidePopup();
      if (tracking) setStatus({ state: "searching" });
    },
    start,
    stop,
    get status() {
      return status;
    },
  };
}
