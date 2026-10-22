# Weaving practice

Weaving is available at `#/weaving`. Choose a difficulty before Start. Each session plays one
bolt at that fixed difficulty, following the current test build (18 October 2026).
Move the shuttle with the mouse or Left/Right; click or press Space to batten. Escape pauses.
Controls can be rebound in Settings. Completed, booched and stopped bolts have separate results,
history and replay recordings. Replay playback preserves hover paths, key holds and animation time.

## Recreated rules

The loom has ten columns and ten board rows, with a separate shuttle row. The reed pushes occupied
columns together until a row cannot advance. Threads do not fall independently into every gap.
Orthogonally connected groups of at least four matching threads clear simultaneously, and the
reed advances again until the entire cascade resolves. Finishing the bolt retains all surplus
groups in that last cascade. A bolt booches only when the newly drawn shuttle has no legal placement.

| Difficulty | Colors | Shuttle | Sparkly threads | Groups per bolt |
| --- | --- | --- | --- | --- |
| 0 | 2 | Always two adjacent threads | None | 5 |
| 1 | 2 | 2–4 adjacent threads | None | 10 |
| 2 | 3 | 2–4 adjacent threads | None | 15 |
| 3 | 3 | 2–4 threads in four slots, with possible gaps | None | 15 |
| 4 | 3 | Same possible gaps | 1 in 16 per thread | 25 |
| 5–8 | 4 | Same possible gaps | 1 in 16 per thread | 25 |

Shuttle sizes above level zero have probabilities 40% / 40% / 20% for two / three / four
threads. Colors are uniformly drawn. Slot zero is always occupied; from difficulty three the
other occupied slots are drawn without replacement from slots one through three. Initial threads
appear in the bottom four rows with independent probability 1/6 per cell, then settle and clear;
the initial clears do not count toward the bolt. Initial threads have no sparkles.

The starting board and refill sequence use the game's seeded random generator and draw order,
including the opening discarded shuttle. Sparkles appear in four corners and lose one corner
after each completed batten. The visible rules for levels five through eight are identical.

## Presentation and timing

The loom, reed sheets, shuttle, threads, sparkles, bolt and sounds use the game's artwork and audio.
Sound files use the site's standard MP3 format. The logical board is 450 × 600, with 34-pixel cells.

- Opening threads and warp fade in over 250 ms.
- Incoming wooden shuttles alternate sides at 0.7181818 pixels/ms. Input waits for the entry to finish.
- A key slide takes 75 ms. Held keys repeat after 500 ms, then every 200 ms.
- Mouse positioning uses the game's weighted snapping around the nearest column.
- Reed closing and opening each use three 30 ms frames.
- Reed compression takes 55 ms per row, including delayed pushes of lower pieces.
- Matching groups converge over 100 ms. A rotating, shrinking spark flies to the bolt over 400 ms;
  group particles last 200 ms, followed by the 200 ms inter-clear pause.
- The reed returns over 500 ms; the next entry begins alongside the reed opening.
- Blocked placements briefly lower and shake the shuttle, then return without consuming the move.
- Remaining threads and warp fade out over 250 ms at the end of a bolt.

## Freeplay mode

Freeplay mode is a sandbox for showing a setup to someone else. Choose Freeplay in the session panel and press Start, then hold 1–4 over the loom to paint red, yellow, blue or green threads, or 0 to clear one (or pick a colour in the Loom panel and click or drag). The Sparkles select makes painted threads sparkly. Each of the shuttle's four slots can be set from the Loom panel, counting from the left. Battening works as usual, but the bolt has no goal, carries on after a booch, and keeps no history; Before last batten puts the loom back as it was. A note says when the loom could not come from its difficulty: too many colours, sparkles below difficulty 4, threads the reed would still push, groups of four that would already have cleared, a shuttle the game would not deal, or a shuttle that fits nowhere. Copy and Paste share looms as text: `L` and the difficulty, `:`, two characters a cell for the ten rows from the top (`..` for empty, otherwise the colour 0–3 and sparkles 0 or 4), then `:` and the shuttle's four slots. Generate lays new threads and a new shuttle and copies them.

## Unverified details and questions

1. **Supplied shuttle distribution:** the current test build accepts supplied shuttles and also
   contains the local generation rules above. Whether supplied draws always follow exactly that
   distribution is unverified. Offline practice uses the visible local rules without simulated
   delivery delays. A sample of actual shuttle draws at several difficulties would help validate this.
2. **Scoring:** the complete points formula, chain and large-group bonuses, sparkly-thread value,
   booch penalty, labor quality and performance-rating thresholds are unavailable in the visible
   board rules. Practice reports actual groups, threads and chains; it does not invent game points
   or claim an authentic performance rating. Known scoring examples would help resolve this.
3. **Difficulty mapping:** the exact skill/rank thresholds that select levels 0–8, and any hidden
   differences between levels 5–8, are unverified. The selector uses numeric levels and the known
   mechanical differences. Difficulty stays fixed by the user's practice choice.
4. **Final visual comparison:** timings and paths are recovered, but a side-by-side recording of a
   real bolt is still needed to confirm browser rendering, text metrics and end-of-bolt presentation.
   Cosmetic randomness is independent from board generation: particle velocities use the recovered
   ranges, while blocked-placement jitter uses an approximation of the original random shake.
   The initial phase of looping sparkles and the exact random cosmetic sequence can differ.

The one-bolt session, pause control, results table, history and replays are practice features.
No board probabilities or speeds are silently tuned to make the puzzle easier.

## Validation

`scripts/parity/WeavingParity.java` exports reference games for six seeds at each of the nine
difficulties. The checked-in fixture covers 54 games, 2,268 moves and 2,989 resolution stages,
including 37 completed and 17 booched bolts. Tests compare starting boards, every refill, matching
group coordinates, reed stops, progress and termination. Animation lifecycle tests check that the
displayed threads remain synchronized through full bolts and that animation locks release.
