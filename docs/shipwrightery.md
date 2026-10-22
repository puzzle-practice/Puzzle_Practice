# Shipwrightery

Open `#/shipwrightery`. Choose difficulty 0–8 and press Start. The choice is saved. The puzzle includes click swaps, continuous drag swaps, pattern pickup and cancellation, gold, the tide, combos, overtime, pause, score history and portable replays.

## Rules matched to the game

- The board is 5 × 5. Wood enables vertical swaps, iron horizontal swaps and rope diagonal swaps. Either neighbor can enable the move. Cloth grants no movement; gold cannot move and matches any material. Patterns keep their fixed orientation.
- All 36 patterns are included: sixteen three-piece patterns worth 2 points, ten four-piece patterns worth 4 and ten five-piece patterns worth 6. Each consecutive placement multiplies its points by the combo count. A successful swap resets the combo; an unsuccessful move or pickup does not. Gold adds no separate point bonus.
- Material generation uses a finite draw pile, with the game's material weights, floating-point rounding, random sequence and draw order. Replacements are drawn before materials are returned. A consumed gold returns the material required by the pattern. Refills occur in reverse pattern-square order. Pattern replacement preserves the game's duplicate avoidance and least-required-material selection behavior.
- The tide takes 75 seconds, with warnings at 60 and 67.5 seconds. Expiration removes the last available pattern, which is in the largest remaining size group. Completing the first pattern after a swap restores one lost pattern. Further placements in the same combo do not restore more. Losing every pattern ends the session.
- Normal sessions reach overtime after 20 placements. Swaps stop; pattern placement continues for 15 seconds. Further placements pause the clock during their flash, but do not reset overtime. Tutorial has a fixed board, Cannon/Rigging/Sail, a three-placement goal, no normal tide and two seconds of overtime.

| Difficulty | Three-piece patterns | Four-piece patterns | Five-piece patterns | Gold chance per material draw |
| --- | --- | --- | --- | --- |
| 0 | Fixed tutorial | Fixed tutorial | — | 0% |
| 1 | 4 | 2 | 0 | 0% |
| 2 | 3 | 3 | 0 | 0% |
| 3–4 | 4 | 1 | 1 | 4% |
| 5–6 | 3 | 2 | 1 | 4% |
| 7–8 | 2 | 2 | 2 | 7% |

## Freeplay mode

Freeplay mode is a sandbox for showing a setup to someone else. Start it, then hold 1–5 over a square to paint wood, iron, rope, cloth or gold (or pick a material in the Board panel and click or drag), and scroll to cycle the material under the pointer. Each card slot can be set to any pattern not already on another card. Freeplay has no tide or goal and keeps no history. A note says when the board or cards could not come from the chosen difficulty: gold below difficulty 3, or more cards of a size than the difficulty deals. Copy and Paste share boards as text: `W`, a digit a square row by row from the top, then `:` and the cards' pattern names. Generate deals a fresh board and copies it.

## Presentation

The board uses the game's 450 × 600 artwork, 60-pixel material squares, 24-pixel pattern squares and original sound cues. Orthogonal swaps last 150 ms; diagonal swaps last 211 ms. Interrupted drag swaps continue from the moving square's current position. Placements flash white for 300 ms, followed by 400 ms of growth. Pattern growth scales the whole pattern. The tide retreats over two seconds, waves advance every 100 ms, and the ten-frame flag animates at 10 fps while rising at 20 ms per pixel. Sparks last 600 ms; score messages rise 30 pixels over 1.5 seconds and fade during the second half.

## Seeded refill behavior

Practice uses one seeded random generator throughout a session. Normal boards take their initial 25 material draws one column at a time, from top to bottom. After placing a pattern, only its consumed squares are replaced with the next material draws. The refill follows the reverse pattern-square order found in the game, draws all replacements before returning used materials to the pile, and then chooses the replacement pattern. Pattern selection uses the same generator. Swaps and unsuccessful placements do not consume random draws.

The accepted assumption is to continue that generator throughout the session, without introducing a separate refill seed or an extra delivery wait beyond the placement animations. This is already how practice runs. The same seed, difficulty and sequence of moves reproduce the same initial board, material refills and replacement patterns. The materials are drawn as needed from the changing pile, rather than precomputing a list independent of the player's moves.

## Known limits and questions for comparison

1. **Final performance ratings and difficulty adjustments:** the ocean-wide rating boundaries and final difficulty adjustment were not available. Practice records raw points, raw points per pattern and the other counts. It does not assign an estimated duty rating. If matching reports is important, provide some completed game examples with difficulty, pattern counts, combos and the resulting report.
2. **Live refill verification:** the material and pattern generation rules are available and implemented. What remains unverified is how live play seeds its refill-producing step and whether that step adds anything to those rules. Practice deliberately uses the continuous seeded behavior described above and reveals replacements when the 300 ms flash ends. Matching the exact random outcomes of a particular live session is not required. A recording would still help compare any visible refill hesitation.
3. **Pixel-level animation comparison:** the game art, sizes, durations, colors, label collision-placement rule and main paths are recovered, but there has not yet been a frame-by-frame comparison with a live Shipwrightery session. Font rasterization can differ between browser canvas and the game; label bounds use browser text widths and estimated line heights. Wave phase offsets and warning jitter use deterministic cosmetic choices; they do not consume the material random sequence. Please identify any visibly different effect or gesture behavior, ideally with a short recording.
4. **Difficulty access:** all nine levels are deliberately selectable for practice, without experience or standing restrictions. Adjacent levels 3/4, 5/6 and 7/8 share board styles; no extra board rule has been invented to distinguish them.

There is no separate token mechanic. Gold is part of the normal rules.

## Verification

`logic.test.ts` compares 27 initial states and 432 subsequent transitions against game-generated fixtures across all nine difficulties and three seeds. Controlled placements exercise gold consumption, refill order, draw-pile accounting, replacement patterns, combos, tide losses and restoration. Additional tests cover movement, edge matching, exact timer boundaries, overtime and tutorial rules. The shared integration test completes the tutorial using a held-mouse drag and a three-pattern combo, then verifies that replay playback reproduces its score without writing another history entry.

The public rules are also described in the [official Shipwrightery guide](https://yppedia.puzzlepirates.com/Official:Shipwrightery).
