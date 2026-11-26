# Voyage records format

Every global voyage record is in one file: `src/voyage-records/records.json`. Every record has the same shape, whatever it's a record for. My records' "Send new records" message, its "Download all my records" file, `npm run add-records` and `npm run gizmo-records` all use this shape too.

## The file

```json
{
  "fetched": "2026-11-07",
  "sources": [
    {"voyage":"cursedIsles","name":"CI Forages","url":"https://tinyurl.com/CIForages"}
  ],
  "records": [
    {"voyage":"woodhallow","ocean":"emerald","category":"Best score","crewSize":9,"value":2123,"date":"2026-10-23","pirates":["Danr","Dien","Jice"],"source":"Jice's chatlog (emerald)"}
  ]
}
```

- `fetched`: when the record sheets were last copied.
- `sources`: the sheets, linked from Global records.
- `records`: one record per line, fields always in the order below. The scripts keep that layout when they save.

## A record

| Field | Needed | What it is |
|---|---|---|
| `voyage` | yes | `woodhallow`, `cursedIsles` or `vampireLairs` |
| `ocean` | yes | lower case: `emerald`, `meridian`... |
| `category` | yes | what the record is for, e.g. `Best score` or `Most carpentry holes`. See the list below. |
| `crewSize` | for categories kept per crew size | the number of pirates in the crew |
| `value` | yes | always a whole number: a score, chests, frays, holes... |
| `date` | no | `YYYY-MM-DD` |
| `time` | no | `YYYY-MM-DDTHH:MM:SS` as the chatlog gives it, or `YYYY-MM-DDTHH:MM` |
| `pirates` | no | the crew, or the one pirate |
| `pirateScores` | no | each pirate's own share, one number per pirate, in the same order as `pirates` |
| `loot` | no | chests brought aboard, tier 3 first: Woodhallow `[dire, lunar, wolf]`, Cursed Isles `[cursed, fetish, bone]`, Vampire Lairs `[immortal, nocturnal, blood]` |
| `everyone` | no | everyone who also reached the record on their own runs |
| `screenshot` | no | a picture under `public/`, e.g. `voyage-records/screenshots/woodhallow/sent/emerald-4p-1a2b3c4d.png` |
| `screenshotUrl` | no | where the picture was hosted before it was copied in |
| `videoUrl` | no | a video link, left on its host |
| `more` | no | further pictures, same form as `screenshot` |
| `notes` | no | a short note. For `Most points in one forage, one pirate` it says which forage: `Forage 3` |
| `source` | no | where the record came from |

Bigger is better for every category. A record replaces what's there for its voyage, ocean, category and crew size (and forage, for `Most points in one forage, one pirate`) when its value is higher. A tie keeps what's there.

## Den records: per crew size, from chatlogs

These are the records My records marks red (beaten) and yellow (tied).

| Voyage | Categories | `value` |
|---|---|---|
| any | `Best score` | 3 × tier 3 + 2 × tier 2 + tier 1 chests. Vampire Lairs counts every chest as 1. |
| Woodhallow | `Most dire chests` | tier 3 chests |
| Cursed Isles | `Most cursed chests` | tier 3 chests |
| Vampire Lairs | `Most immortal chests` | tier 3 chests |

```json
{"voyage":"woodhallow","ocean":"emerald","category":"Most dire chests","crewSize":9,"value":170,"date":"2026-10-23","pirates":["Danr","Dien","Jice","Mrraffo","Multibella","Rock","Rustyspoony","Vackert","Yueyin"],"source":"Jice's chatlog (emerald)"}
```

My records sends them like this, after a `Data for the records:` line:

```json
[{"voyage":"woodhallow","ocean":"emerald","category":"Best score","crewSize":1,"value":108,"date":"2026-11-11","time":"2026-11-11T15:23:09","pirates":["Jice"],"loot":[4,20,56]}]
```

## Crew records: per crew size, with each pirate's share

`crewSize` is set and `pirateScores` gives each pirate's part.

- Woodhallow: `Most dire chests in one DR`, `Best forage score in one DR`. For these, the crew is everyone on the duty report, navigators too, and `pirates`/`pirateScores` are the foragers.
- Cursed Isles: `Most cursed chests in one forage`, `Most cursed chests in one forage, cursed chests only`, `Best score in one duty report`, `Most frays in one entry` (which uses `everyone` instead of shares).

```json
{"voyage":"woodhallow","ocean":"emerald","category":"Best forage score in one DR","crewSize":6,"value":349,"date":"2026-11-12","pirates":["Rock","Jice","Xioch","Mrraffo","Osagras","Cono"],"pirateScores":[74,69,59,55,48,44],"source":"Gizmo export run_20261112-203149_unknown.jsonl, duty report from 21:10:31"}
```

## One-pirate and other records: no crew size

- Woodhallow: `Best dnav score in one DR, one pirate`, `Best forage score in one DR, one pirate`, `Most DCs in one forage`.
- Cursed Isles: `Most cursed chests in one entry, one pirate`, `Most cursed chests in one forage, one pirate`, `Most frays in one entry, one pirate`, `Best score in one duty report, one pirate`, `Best score in one entry, one pirate`, `Most points in one forage, one pirate` (one per forage, named in `notes`).
- Vampire Lairs: `Most 🎁 in one entry, one pirate`, `Most frays in one entry`, `Most Immortal Chests in one DR, one pirate`, `Best carpentry score`, `Most carpentry holes`, `Most vampire proof`.

```json
{"voyage":"woodhallow","ocean":"emerald","category":"Best forage score in one DR, one pirate","value":87,"date":"2026-10-29","pirates":["Rock"],"screenshot":"voyage-records/screenshots/woodhallow/forage-rock.png","source":"Sent to Jared"}
{"voyage":"cursedIsles","ocean":"emerald","category":"Most points in one forage, one pirate","value":35,"pirates":["Qrk"],"screenshot":"voyage-records/screenshots/cursed-isles/forage-1.png","screenshotUrl":"https://imgur.com/a/tnfs6GO","notes":"Forage 1","source":"CI Forages, CI Records tab"}
{"voyage":"vampireLairs","ocean":"emerald","category":"Most carpentry holes","value":25,"pirates":["Gummybears"],"screenshot":"voyage-records/screenshots/vampire-lairs/carp-holes.png","screenshotUrl":"https://imgur.com/a/86kdfXs","source":"YPP Vampires, 🥇 tab"}
```

When a ship holds a tie for a one-pirate record, each holder gets their own record. A record that beats them replaces them all.

A new category can be added the same way: give it a clear name. If every record in it has a `crewSize`, Global records shows it as a column of the crew size table; otherwise it goes in "Other records".

## Adding records

- **Sent in, any category:** save the message or a JSON list of records in this shape as a .txt or .json file, then run `npm run add-records -- <file>`. A folder holding that file plus pictures named `1.png`, `2.jpg`... works too: the pictures go on records 1, 2... in order. See [voyage-records-screenshots.md](voyage-records-screenshots.md). Add `--dry-run` to see what would change first.
- **Woodhallow duty report records from Gizmo:** `npm run gizmo-records` reads Gizmo's `exported_data/<ocean>/runs/run_*.jsonl` and saves through the same merge.
- **By hand:** add a line to `records.json`. `npm test` checks every record.

Older messages and files still work: `Data for the records table:` and `Data for the sheet records:` lines, records with `"kind":"score"` or `"kind":"chests"` instead of `category`, and values written as text (`"value":"260"`).

Runs left out of global records are kept apart, in `src/voyage-records/ignored-pirates.json` (pirates whose runs don't count) and `src/voyage-records/excluded-runs.json` (single reviewed voyages).
