# Puzzle Practice

Practice versions of Puzzle Pirates puzzles that run in the browser:

- **Distilling**: swap pieces so whites go into the jug and blacks into the furnace, rebuilt from the
  Puzzle Pirates rules, with the Distilling Simulator's practice modes and drills on top.
- **Forage Simulator**: rotate 2×2 blocks to drop crates off the bottom, rebuilt from Puzzle Pirates rules, art and
  sounds, with the Forage Simulator's puzzles, CI and Infinite (cursed isle) modes on top.
- **Vampire Carp**: patch coffin holes with pentomino planks (the Vampire Lair's carpentry, rebuilt from the game).
- **Blacksmithing**: strike squares to forge a sword, each piece deciding where you strike next.
- **Swordfight**: drop pairs, shatter them with breakers and fuse blocks into swords, against training
  opponents or on your own.

Play at [puzzle-practice.github.io/Puzzle_Practice](https://puzzle-practice.github.io/Puzzle_Practice/).

Source: [puzzle-practice/Puzzle_Practice](https://github.com/puzzle-practice/Puzzle_Practice).

The main score and relevant timer remain visible above Play, Settings and History. Settings
include a shared 0–100 volume slider, a Warning timer toggle and an option to hide the timer. Finished sessions show
compact HTML results in the board area; secondary statistics stay off the live score display.

Treasure Haul offers Spawn Chests and four Clear Chests packs: middle placement, simultaneous
vertical/horizontal threes, edge emeralds, and difficult edge chests. Clear Chests counts hauls
over the selected round. Gem rates and the one-second spawn delay are configurable in Settings.
The defaults are two chests, 100 cleared coins per additional chest, and Vampirate artwork.
Settings > Display offers Classic, Haunted Seas and Vampirate artwork, with a saved preference.
The optional emerald sight lines appear only while hovering over an emerald. Play, Settings
and History stay pinned at the top while scrolling the panel.

Swordfight Settings lets you choose the number of opponents and teammates, then each NPC’s
type, sword and skill. Sword colours randomise for every fight. New players start with a
blue/blue Falchion; saved equipment choices and older replays keep their original settings.

Forage offers Puzzle, Gauntlet, Chaos and Normal, with optional round timers. Chaos keeps the
normal move spacing but lifts the chest count, mix and per-board limits. Settings expose chest
ratios and special-piece toggles. History includes replay play/pause, stop, a scrubber and time
jumps, plus compressed file sizes and the saved total. Replays for every puzzle are stored as
individual gzip blobs in IndexedDB. The complete replay index stays available; only the ten
most recently opened tapes are kept decoded in memory. Recordings include simulation frame
times so playback speed and seeking preserve the order and timing of moves. Watching a replay
does not save scores or personal bests, and leaving a puzzle finishes its active recording.
Replays also store a hash of the puzzle's state after every recorded input. Playback checks
its own state at the same moments and says in the History tab if a replay drifted from the game
it recorded. Each puzzle's `simulatorVersion` records the rules a game was played by, so older
replays keep playing by their own rules (Forage version 2: paced Normal crates and Chaos chests
retrying a blocked column).

**Take over** in the Replays card turns the replay being watched (or paused after a Jump) into
your own game from that moment: the board, score and clock carry on and your inputs take
control. It saves like any game, labelled "taken over at Ns", and its replay plays from the start
of the original through the take-over. **Resume replay** goes back to the replay, playing on from where
you took it over, and drops the game you played from there without saving it.

Each past game on the History tab has a 🗑 button that deletes the game, its replay and its
place in the stats. Deleted games are listed under `puzzle-practice:deleted`, so merging or
importing an older backup, or syncing a backup folder, doesn't bring them back.

Settings > Global > History can stop finished games being saved to the History tab (and to
replays). Session averages in results count only games from this browser session: the tab since
it was opened, kept through reloads; a new tab or window starts a new session.

Normal Forage crates are paced as in the game: two moves after the last request, a crate is asked
for with the next two-second batch and arrives on the first move after that. A Normal session
where ten per move plus the seconds played is under 95 is Unrated and keeps no replay, best or
history. Distilling sessions that send no columns up are not added to the history.

The home page offers portable JSON backup downloads and optional automatic folder backups.
Folder backups contain a small `puzzle-practice-backup.json` manifest and a `replays/` directory
of individual `.json.gz` files. Keep both together when moving a folder backup. Existing replay
files are copied only when their contents change; settings saves update the manifest. All backup
operations share a queue, with Web Locks coordinating tabs where available. The prelaunch
backup format is version 2; older experimental backup/replay formats are not imported.

Scores are numeric records stored separately from replay payloads. The home page's **Export
scores** downloads a small JSON file for future graphs, merging browser histories and accessible
folder manifests without reading or decompressing replay files. Each row has `puzzle`,
`settingsKey`, `at` (finish time in Unix milliseconds), `score`, extra `stats`, and an optional
`replayFileId` matching the replay index's `id`. Games saved with replay recording off still have
scores. Browser histories retain the latest 1,000 games per settings key; automatic backup
manifests merge older scores without that cap. Keep automatic backups enabled for longer histories.

Distilling Create mode has a numbered piece palette: hold 1–5 or select a piece and left-click
to paint. Click the selected palette piece again to deselect it.

Each started as a separate desktop game in Python ([Distilling_Simulator](https://github.com/jared-morgan/Distilling_Simulator),
[Foreage-Sim](https://github.com/jared-morgan/Foreage-Sim), [Vampire_Carp](https://github.com/jared-morgan/Vampire_Carp))
and is rewritten here in TypeScript on a shared core. Seeds give the same games as the desktop versions.
Blacksmithing has no desktop version: it is built from Puzzle Pirates rules, art and sounds.
Distilling follows the original game's rules.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```

## Layout

```
src/
  main.ts            landing page and #/<puzzle> routing
  core/              shared by every puzzle: canvas, input, sound, saved data, Python-compatible random
  puzzles/<id>/      one folder per puzzle: meta.ts (card) and index.ts (the game)
  puzzles/_template/ starting point for new puzzles
scripts/
  new-puzzle.mjs     npm run new-puzzle -- <id> "<Title>"
  parity/            run the original Python code to make test fixtures
```

## Deploying

Every push to `main` is built, tested and deployed to GitHub Pages by
`.github/workflows/pages.yml`. In the repository settings, **Pages → Source** must be **GitHub Actions**.
The repository is owned by the `puzzle-practice` organization, and the deployed site is
https://puzzle-practice.github.io/Puzzle_Practice/.
