// Builds the guide from content.json, using the same markup and CSS classes as
// the original static pages so it looks the same.

/** Tiny DOM builder. Strings become text nodes (safe); only `html` sets innerHTML. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** t("gpsNear", { name: "Lion" }) → "Near: Lion" */
export function makeT(ui) {
  return (key, vars = {}) => String(ui?.[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export const otherLang = (content, lang) => content.languages.find((l) => l !== lang) || lang;

const tagged = (tag, cls, label, body) => h(tag, { class: cls }, h("span", { class: "tag" }, label), " " + body);

function tile(animal, lang, alt, park, t) {
  const here = !park || park.targets.has(animal.id);
  return h(
    "li",
    {},
    h(
      "a",
      { href: `#${animal.id}`, "data-key": animal.id, class: here ? null : "not-here", title: here ? null : t("notAtPark") },
      h("img", { src: animal.image.thumb, alt: "", loading: "lazy" }),
      h("span", { class: "en" }, animal.name[lang]),
      h("span", { class: "nl" }, animal.name[alt]),
      h("span", { class: "seen", "aria-hidden": "true" }, "✓"),
    ),
  );
}

function animalCard(animal, lang, alt, park, t) {
  const c = animal.content[lang];
  const here = !park || park.targets.has(animal.id);
  return h(
    "article",
    { class: "animal", id: animal.id },
    h(
      "figure",
      {},
      h("img", { src: animal.image.photo, alt: animal.name[lang], loading: "lazy" }),
      h("figcaption", {}, h("a", { href: animal.image.credit, target: "_blank", rel: "noopener" }, t("photoCredit"))),
    ),
    h(
      "div",
      { class: "animal-body" },
      h(
        "header",
        {},
        h("h3", {}, animal.name[lang], h("span", { class: "nl" }, animal.name[alt])),
        h(
          "div",
          { class: "card-badges" },
          here ? null : h("span", { class: "not-here-badge" }, t("notAtPark")),
          h("label", { class: "seen-box" }, h("input", { type: "checkbox", "data-key": animal.id }), " " + t("seenIt")),
        ),
      ),
      tagged("p", "did", t("didYouKnow"), c.didYouKnow),
      tagged("p", "bible", t("bible"), c.bible),
      c.ellenWhite ? tagged("blockquote", "egw", t("ellenWhite"), c.ellenWhite) : null,
      h(
        "ol",
        { class: "quiz" },
        c.quiz.map((q) => h("li", {}, h("details", {}, h("summary", {}, q.q), h("p", {}, q.a)))),
      ),
      c.tryThis ? tagged("p", "try", t("tryThis"), c.tryThis) : null,
    ),
  );
}

/**
 * Renders hero + contents + all sections into `root`.
 * Leaves empty slots for the GPS bar (#gps-slot) and record panel (#record-slot).
 */
export function renderGuide(root, { content, lang, park, t, onLang }) {
  const alt = otherLang(content, lang);
  const animalsBy = (sectionId) => content.animals.filter((a) => a.section === sectionId);
  const total = content.animals.length;
  const [before, after = ""] = t("progress", { total }).split("{seen}");

  document.documentElement.lang = lang;
  document.title = t("title");
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--t-quiz-prefix", JSON.stringify(t("quizPrefix")));
  rootStyle.setProperty("--t-tap-for-answer", JSON.stringify(t("tapForAnswer")));
  rootStyle.setProperty("--t-answer-prefix", JSON.stringify(t("answerPrefix")));

  // ui.<lang>.language is the name of the *other* language ("Nederlands" in the EN UI).
  const langLink = h("a", { class: "lang", href: `?lang=${alt}`, hreflang: alt }, t("language"));
  langLink.addEventListener("click", (e) => {
    e.preventDefault();
    onLang(alt);
  });

  const hero = h(
    "header",
    { class: "hero" },
    h(
      "div",
      { class: "wrap" },
      h("p", { class: "kicker" }, t("kicker") + " · ", langLink),
      h("h1", {}, t("title")),
      h("p", { class: "sub" }, t("sub")),
      h("p", { class: "progress" }, before, h("span", { id: "seen-count" }, "0"), after, " ", h("button", { type: "button", id: "reset" }, t("reset"))),
      h("div", { class: "gps", id: "gps-slot" }),
    ),
  );

  const toc = h(
    "nav",
    { class: "toc", id: "contents", "aria-label": t("tocLabel") },
    h("h2", {}, t("contents")),
    h(
      "ol",
      {},
      content.sections.map((s) => {
        const animals = s.type === "animals" ? animalsBy(s.id) : [];
        return h(
          "li",
          { class: `toc-sec sec-${s.id}`, style: `--sec:${s.color}` },
          h("a", { class: "toc-h", href: `#${s.id}` }, s.title[lang], animals.length ? [" ", h("span", { class: "count" }, animals.length)] : null),
          animals.length ? h("ul", { class: "tiles" }, animals.map((a) => tile(a, lang, alt, park, t))) : null,
        );
      }),
    ),
  );

  const sections = content.sections.map((s) => {
    const attrs = { class: `sec sec-${s.id}`, id: s.id, style: `--sec:${s.color}` };
    if (s.type === "page") {
      return h("section", attrs, h("h2", {}, s.title[lang]), h("div", { class: "page-body", html: s.html[lang] }));
    }
    return h(
      "section",
      attrs,
      h("h2", {}, s.title[lang]),
      h("div", { class: "intro" }, h("p", {}, s.intro[lang]), s.ellenWhite ? tagged("blockquote", "egw", t("ellenWhite"), s.ellenWhite[lang]) : null),
      animalsBy(s.id).map((a) => animalCard(a, lang, alt, park, t)),
    );
  });

  const main = h("main", { class: "wrap" }, h("div", { id: "record-slot" }), toc, sections);
  const toTop = h("a", { class: "to-top", href: "#contents", "aria-label": t("toTopLabel") }, t("toTop"));

  root.replaceChildren(hero, main, toTop);
}

/** Scrolls to an animal/page and briefly highlights it. */
export function focusTarget(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 2200);
}
