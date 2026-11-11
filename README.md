# Zoo Day with Jesus: GPS version

The zoo guide (47 animals, EN + NL) as a small web app that knows where you are in the park. When your phone is **within an animal's radius (default 100 m) and closer to that animal than to any other known point**, a card slides up ("You're near: Lion") with a short vibration. Tap it to open the full lesson. The whole guide stays browsable as before.

The two original pages (`Zoo Day with Jesus.html`, `Dierentuindag met Jezus.html`) are unchanged.

## Quick start

```bash
npm install          # once (installs linkedom for the extractor)
npm test             # matching logic + export tests
npm run validate     # checks content.json and every park file
npm run serve        # http://localhost:8765
```

To try it without walking around, open <http://localhost:8765/?sim>. A GPS simulator appears top right. Press **📍 Use my location**, then pick an animal under "Jump to".

## How it's organised

```
app/                          ← deploy this folder
  index.html, css/, js/       the app (plain ES modules, no build step)
  data/content.json           WHAT to show: every animal's content, EN + NL
  data/parks/index.json       which parks exist
  data/parks/<park>.json      WHERE things are in one park
  images/<id>.jpg, <id>-thumb.jpg
  sw.js, manifest.webmanifest offline + "Add to Home Screen"
tools/extract.mjs             one-time: original HTML → content.json + images
tools/validate.mjs            data checks
tests/                        node:test
```

### `content.json`: the content database

Each animal has an `id`, its section, names, images, and all content in both languages:

```json
{ "id": "lion", "section": "savanna",
  "name": { "en": "Lion", "nl": "Leeuw" },
  "image": { "photo": "images/lion.jpg", "thumb": "images/lion-thumb.jpg", "credit": "https://en.wikipedia.org/wiki/Lion" },
  "content": {
    "en": { "didYouKnow": "…", "bible": "…", "ellenWhite": "…", "quiz": [{ "q": "…", "a": "…" }], "tryThis": "…" },
    "nl": { "…": "same keys" } } }
```

`ellenWhite` and `tryThis` are optional. `sections` holds the 8 animal sections plus the pages `gate`, `end` and `sources`. `ui` holds every interface string per language.

Edit `content.json` directly; it is now the source of truth. (`npm run extract` refuses to overwrite it unless you pass `--force`.)

### `parks/<park>.json`: the location database

```json
{
  "id": "artis",
  "name": "ARTIS Amsterdam",
  "center": { "lat": 52.366, "lng": 4.916 },
  "defaultRadiusM": 100,
  "matching": { "maxAccuracyM": 50, "exitBufferM": 15, "switchMarginM": 10, "confirmFixes": 2, "notInParkM": 1500 },
  "locations": [
    { "id": "lion-1",    "target": "lion",    "lat": 52.36612, "lng": 4.91655 },
    { "id": "penguin-1", "target": "penguin", "lat": 52.36580, "lng": 4.91700, "radiusM": 40 },
    { "id": "penguin-2", "target": "penguin", "lat": 52.36570, "lng": 4.91740, "radiusM": 40 },
    { "id": "gate",      "target": "gate",    "lat": 52.36650, "lng": 4.91280, "radiusM": 60 }
  ]
}
```

- `target` is an animal id from `content.json`, or the page `gate` or `end`.
- `target` can also be a **list**, for one spot where you see several animals: a mixed enclosure, a greenhouse, a petting farm. The pop-up then lists them all, each with its own "Seen it!" tick and open button. Give such a spot a `label`:
  ```json
  { "id": "savanna", "target": ["giraffe", "zebra", "rhino"], "label": { "en": "Savanna", "nl": "Savanne" }, "lat": 52.7795, "lng": 6.8858, "radiusM": 70 }
  ```
- One animal can have several points: a large enclosure, or several viewing windows.
- `radiusM` is optional per point. Use smaller radii where enclosures are close together.
- `note` (per point) and `source` (per park) are free text for whoever edits the file; the app ignores them.
- Animals without a point are shown greyed out as "not at this park" and never pop up.
- When the app loads, each location is joined to its content, so every entry has its id, GPS point and full content.

The first park in `parks/index.json` is the default until you pick another one in the park menu (or GPS finds the park you're in).

### The parks

- **`wildlands.json`**: Wildlands Adventure Zoo Emmen, see below.
- **`example-park.json`**: a **demo** with made-up coordinates around 51.00000, 4.00000 (the lions sit exactly on that point). Handy for trying the simulator.

## Wildlands Adventure Zoo Emmen

27 of the 47 animals have a spot, in 20 points:

| Area | Spots |
|---|---|
| Entrance | Entrance and exit (the `gate` and `end` pages together: it's one gate) |
| Serenga | Lion · Savanna (giraffe, zebra, rhino) · Meerkat · Baboon · Camel · Animazia aquariums (fish, clownfish, tortoise) · Hippo · Dogon village petting farm (goat, donkey, chicken, pig, rabbit, pigeon) |
| Nortica | Sea lions · Seals · Snowy owl · Penguins · Polar bears (2 points) · Shark (North Sea aquarium) |
| Jungola | Elephant · Ring-tailed lemur (in Rimbula) · Butterfly Temple (butterfly, python, crocodile) · Koi pond (fish) |

**Where the coordinates come from:** the animal markers in OpenStreetMap (© OpenStreetMap contributors, ODbL), checked against the Wildlands article on Dutch Wikipedia, November 2026. Each OSM marker was within about 25 m of a visitor path; the savanna point was moved closer to the path along its west side. **None of it has been checked on site yet.**

**On the day:** open the site with `?record=1`. The target menu starts with this park's spots (📍 Wildlands…). Pick one, stand where you watch the animals and press **Save point here**. The spot keeps its animals, label and radius and only gets new coordinates. Most worth doing:
- **Shark**: the position of the North Sea aquarium is a guess.
- **Petting farm and sea lions**: they're only about 25 m apart.
- **Savanna**: is the point where you actually look at the giraffes?

Then download the park JSON ("keep points I didn't record" is ticked) and replace `app/data/parks/wildlands.json` with it.

**Not mapped, look out for them:** the parrot (Wikipedia mentions a lovebird aviary in Serenga and about 30 bird species in Rimbula), the frog and chameleon (maybe in the Butterfly Temple), and the peacock and stork (sometimes free-roaming or nesting wild). If you find one, record it the same way: pick the animal and save the point. Gorilla, chimp, orangutan, tiger, red panda, brown bear, wolf, flamingo, eagle, ostrich, rock hyrax, jellyfish, leafcutter ant, honeybee and sheep aren't at Wildlands as far as the sources show.

A few spots stretch the lesson a little: the tortoises are African spurred tortoises (big, but not true giant tortoises), the elephants are Asian, and the "pigeons" at the farm are fancy pigeons.

## How matching works

`app/js/geo.js` is pure and unit-tested:

1. **Nearest point inside its radius wins.** Distances use the haversine formula.
2. **Bad fixes are ignored.** A fix with GPS accuracy worse than `maxAccuracyM` shows "weak GPS" instead of guessing.
3. **No flicker.** Switching to another animal needs `confirmFixes` fixes in a row, and the new animal must be at least `switchMarginM` closer. You stay matched until you're `radiusM + exitBufferM` away.
4. **Leaving the park.** Farther than `notInParkM` from every point means "not in a known park". The app then looks in `parks/index.json` for a park whose `center` is within 3 km and switches to it.

## Adding a park

1. **Get coordinates**, either way works:
   - **In the park:** open `https://<your-site>/?record=1`, press **📍 GPS**, pick an animal, stand at the viewing spot and press **Save point here**. The app averages 5 fixes and warns if accuracy is worse than ±20 m. Repeat for each animal, plus `gate` at the entrance and `end` at the exit. Points are kept on the phone until you clear them. If the park already has a file, its spots are at the top of the menu: re-recording one keeps its animals, label and radius.
   - **At the desk:** right-click a spot in Google Maps or OpenStreetMap, copy the coordinates and type them into the JSON.
2. In record mode, fill in the park id and name, then press **Download park JSON**. Or press **Copy JSON** and mail it to yourself.
3. Save the file as `app/data/parks/<id>.json` and add a line to `app/data/parks/index.json`:
   ```json
   { "id": "artis", "name": "ARTIS Amsterdam", "file": "artis.json", "center": { "lat": 52.366, "lng": 4.916 } }
   ```
4. Run `npm run validate`. It catches unknown animal ids, duplicate ids, impossible coordinates, typos more than 2 km from the centre, and points of different animals less than 5 m apart.
5. Bump `VERSION` in `app/sw.js` and deploy.

**Before zoo day:** make a `home-test.json` with 3 or 4 points around your street and walk it with your phone, to check real GPS behaviour.

## URL options

| URL | What it does |
|---|---|
| `?lang=nl` / `?lang=en` | language (also remembered; the link in the header switches) |
| `?park=<id>` | pick a park |
| `?sim` or `?sim=51.0,4.0` | GPS simulator instead of the real GPS |
| `?record=1` | record mode for capturing park coordinates |
| `?autostart` | start location tracking right away |
| `?nosw` | don't register the offline service worker (handy while editing) |

## Deploying

Phones only give GPS to **https** pages, and the app loads JSON files, so it must be served by a web server. Opening `index.html` as a file won't work.

The live site is **<https://milobuwalda.github.io/zoo-day/>**. Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml): first the tests and `npm run validate`, then it publishes the `app/` folder. If a test or the data check fails, nothing is published.

```bash
git add -A
git commit -m "Add ARTIS park"
git push
```

Other static hosts work too, e.g. drag the `app` folder onto <https://app.netlify.com/drop>.

On first load the service worker caches everything (about 2.6 MB, including all photos), so the guide still works where the zoo has no signal. On the phone, "Add to Home Screen" makes it open like an app.

## Limitations

- A web page only gets GPS while it's open and the screen is on. The app asks the browser to keep the screen awake while tracking (wake lock), where supported.
- iPhones don't support vibration from web pages, so there the pop-up is visual only.
- GPS in a zoo is typically accurate to ±5–15 m and worse under trees or near buildings. Keep at least ~20 m between points of different animals, or use smaller radii.
