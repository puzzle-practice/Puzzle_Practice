# Voyage records feed

Every standing voyage record, as JSON, for bots (a Discord bot, say) and other sites. Nothing on the site links to it.

**URL:** https://puzzle-practice.github.io/Puzzle_Practice/voyage-records.json

The build writes it from `src/voyage-records/known-records.json` and `sheet-records.json` (code in `src/voyage-records/feed.ts`), so it changes whenever new records are merged and the site redeploys. `npm run dev` serves it too, at http://localhost:5173/voyage-records.json.

## Shape

```jsonc
{
  "version": 1,                      // goes up only when a field is renamed or removed
  "generated": "2026-11-13T12:00:00.000Z",
  "sheetsFetched": "2026-11-07",     // when the record sheets were last copied
  "voyages": [{ "id": "woodhallow", "name": "Woodhallow", "chests": ["Dire chest", "Lunar locker", "Wolf box"] }, ...],
  "sources": [{ "voyage": "cursedIsles", "name": "CI Forages", "url": "https://tinyurl.com/CIForages" }, ...],
  "crewSizeRecords": [{
    "id": "woodhallow/emerald/3/chests", // voyage/ocean/crewSize/kind: the same id when the record is beaten
    "voyage": "woodhallow", "ocean": "emerald", "crewSize": 3,
    "kind": "chests",                // "score" or "chests" (tier 3 chests)
    "label": "Most dire chests",
    "value": 67,
    "date": "2026-10-29",            // or null
    "pirates": ["Jice", "Rock", "Vackert"],
    "screenshots": ["voyage-records/screenshots/woodhallow/sent/1.png"],
    "screenshotUrl": null,           // the old host, when the picture isn't on the site yet
    "source": "Jice's chatlog (emerald)"
  }],
  "otherRecords": [{
    "id": "cursedIsles/emerald/most-frays-in-one-entry/1", // ties get /2, /3...
    "voyage": "cursedIsles", "ocean": "emerald",
    "category": "Most frays in one entry",
    "crewSize": 1,                   // null where the category isn't split by crew size
    "value": "37 frays",             // text, as the sheets write it
    "date": null, "pirates": ["Jice"],
    "pirateScores": null, "everyone": null,
    "screenshots": [], "screenshotUrl": null, "videoUrl": null,
    "notes": null, "source": "CI Forages, CI Records tab"
  }]
}
```

Fields that can be missing are `null` (or `[]` for lists), never left out. Screenshot paths are relative to the feed's own URL: `new URL(path, feedUrl)` gives the full link.

## Checking for new records

Fetch the file every so often and compare by `id`: a new `id` is a new record, and the same `id` with a different `value` is a record beaten. GitHub Pages caches for about 10 minutes, so polling faster than that gains nothing.
