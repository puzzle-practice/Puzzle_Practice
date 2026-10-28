# Sailing

Open `#/sailing`. Choose difficulty **0–9** (one through ten stars) and tokens **Off**, **4 Tokens** or **5 Tokens**, then Start. Difficulty remains fixed at the chosen value across boards. This is a practice choice; automatic difficulty changes are not reproduced.

Left/right move the falling pair. Up rotates counterclockwise, down clockwise, and holding Space accelerates the current pair without preventing movement or rotation. Each new pair starts at normal speed; release and press Space again to accelerate it. Escape pauses. Keys are configurable. There are also buttons, optional timed sessions, an optional landing preview, saved results, and portable replays.

## Freeplay mode

Choose **Freeplay**, then **Start** to edit a saved draft without gravity or automatic clears.
The tools place all 36 platform patterns (anchored at the clicked top-left cell), a joined pair,
a single piece, or a fixed blocker. Pieces and blockers offer all three colours; pairs offer
independent colours and all four directions for the second half. Hover previews placement;
clipped pairs/platforms and overlapping platforms are rejected without changing the board.
Pieces may fill platform targets, and replacing a joined half disconnects its partner.

Right-click or choose Eraser to remove a piece first, then the platform underneath on another
click. Undo/Redo includes whole pairs, platforms and Clear board. Drafts save automatically in
browser storage. **Play board** tests a copy with normal falling pieces and clearing rules;
**Back to editor** restores the unchanged draft. Freeplay has no timer or saved scores/replays.
Clearing the final platform leaves the board available for line practice. A blocked spawn keeps
the layout and asks you to return to the editor rather than replacing it with a generated board.

## Recreated rules

- The board is 8 × 16, with 34-pixel cells and all 36 platform patterns. Board and pair generation use the game's seeded random sequence and placement order.
- Targets and fixed square pieces use the ten difficulty tables. The random upper bound on the target count is exclusive, matching the game.
- Landed pairs remain joined. One half may hang over an edge. Removing either half releases the other. Fixed square pieces do not fall.
- Movement and rotation use the game's forgiving grid checks, allowing insertion into a tight gap between settled squares. Sideways moves check the next row at half a cell of fall progress; rotations do so only after halfway. The in-place rotation offsets and sideways kicks follow the game. A pair can slide beneath a shelf once it has passed halfway below its edge.
- Falling uses the game's row timer, including partial-row preservation on speed changes, float rounding, and integer row durations. The base rates are 0.03 logical pixels/ms normally and 0.8 while accelerated. Display scaling changes the cell height and velocity together. Input applies from its current frame rather than retroactively accelerating elapsed time.
- Contact starts a 141 ms landing grace, during which the pair can still move or rotate. If the grace ends over a gap and the pair then touches down again on that same row, it locks at once. Contact cancels accelerated falling. Each newly dealt pair also resets to normal speed, even if Space remains held. Released pieces fall at 1.2 logical pixels/ms, with each piece reaching its destination at its own time.
- Clears fade for 500 ms. After the last platform and its cascades finish, the completed board waits 1,500–2,750 ms according to difficulty before the next board appears. The score is banked before this pause.
- Completed targets fade using their filled-target artwork; ordinary line clears first remove pair connectors. Completed shelves and connectors on surviving halves disappear immediately. Each cleared cell emits coloured glows: three on the first chain step, then one more per subsequent step. Glows stay opaque for 200 ms and fade through 900 ms while following the game's curved trajectories, continuing after the 500 ms piece fade as the next cascade begins. Target artwork follows each falling piece's arrival rather than showing it filled early.
- A platform supports its entire width, including blank spaces. Completing it removes its marked target cells and the shelf; pieces in its blank spaces survive.
- Resolution repeats gravity, completed platforms, and horizontal/vertical lines of at least four matching pieces. All completed platforms in a phase count as one chain step. All lines in a phase also count as one step. Crossings clear and score each piece once.
- Each cascade accumulates base points: up to four ordinary line pieces at 1 each, further ordinary line pieces at 2 each, platform pieces at 4 each, and fixed pieces at 5 each. The final chain multiplier applies to the whole accumulated value. Above twice the raw difficulty, additional chain steps add half a multiplier each. The result rounds down.
- Newly filled targets add 1 point; losing a correctly filled target costs 1. There is no additional board-clear bonus. Occupied top cells in either middle column cause a booch after resolution, costing 20 points and dealing another board.
- Token pools are circle/diamond/plus/cross, with flower added in the 5-token pool. Ring and star artwork exists, but those shapes are not in either Sailing generation pool, so they are not offered as normal practice pieces.
- Token matches require two orthogonally adjacent identical shapes in the same platform or straight-line clear. They need not be on pieces of the same colour in a platform. Each platform/line selects at most one qualifying pair. On a platform, finding the requested shape ends only the scan of that row; if any requested pair was found, the last pair found wins (which may be another shape), otherwise one is chosen at random. Separate crossing lines may each contribute.
- Feedback text: on the first chain step, platforms show Target / Super / Ultra / Mega Target Bonus for 1 / 2 / 3 / 4+ at once, and lines show Great! for five and Excellent! for six or more (nothing for four). Later steps show Double, Triple, Bingo, Donkey, and Vegas (six or more). Token matches show Double Bonus! from step three. A booch shows Ye Booched It!
- Left and right repeat seven times a second after a 300 ms hold; rotations and Space never repeat. Up rotates counterclockwise and Down clockwise by default.
- Up to nine stars stack from the bottom. Progress spans difficulty+1 boards, and the current star fills as targets on the board are cleared. The recent-performance window has eighteen ten-second intervals. An idle interval counts as a move; negative recent performance is clamped to zero.

## Known assumptions and deliberate practice differences

1. **Live performance calibration is unavailable.** The indicator uses the game's fallback curve: `0, 1.02, 2.04, 2.38, 3.06, 3.4, 3.74, 4.08, 4.08, 4.42, 4.76, 4.76, 5.1, 5.1, 5.44, 5.78, 5.78, 6.12, 6.8, 7.48`. This is verified fallback data, not a claim about an ocean's current scale. “Top indicator threshold (approx.)” rescales this curve. Reports show **Learning**, rather than inventing current duty-rating cutoffs. Recent performance starts empty rather than carrying earlier duty performance into a new session.
2. **Token availability is forced for practice.** Once a token pool is selected, every new pair receives exactly one shape, as in the game's enabled bonus mode. The live transitions between off, 4 tokens, and 5 tokens are unknown; no guessed performance gate is imposed.
3. **Token units are a practice tally.** A selected match counts as one unit, or two at chain step three or later, following the game's Double Bonus feedback. Exact conversion to vessel maneuver progress and finished maneuvers is unverified. The tally does not claim that a complete ship maneuver has been earned, and the other duty stations are not simulated.
4. **Selected difficulty stays fixed.** Automatic promotion, reset/wrap rules, and changes following a booch are not inferred. The stars show progress through a practice cycle at the selected level.
5. **Presentation has small differences.** Falling rates, row timing, landing grace, cascade durations, clear fades, glow motion, and the pause between boards follow the game. Glow launch angles use a separate deterministic visual sequence so replays look consistent. The contact sprite stays aligned to the grid rather than drawing the game's one-pixel bounce. Floating text layout, feedback smoothing, and maneuver-token flight effects remain simplified. The current star shows a single part-filled tile rather than a proportional fill, and the indicator jumps to its level instead of stepping every 300 ms.
6. **New-board seeds are local.** The first board/pair stream matches the same seed in the game. Later boards use a reproducible local seed sequence; they do not attempt to predict a live voyage's seeds. Sessions start at the chosen difficulty without importing a pirate's standing, voyage history, damage, or rum effects.

## Questions for Jared

- Which ocean/build should be the visual and performance reference? Do recorded sessions show the live sail thresholds, duty ratings, and any initial carried-over performance?
- At what performance/experience does the normal token pool switch on, and when are flowers allowed? Does this change between blockades, flotillas, and monster hunts?
- For which ship should maneuver progress be shown? What contribution fills that ship's Sailing bar, including third-or-later-chain bonuses and unrequested shapes?
- After completing all side stars, what difficulty follows at each starting level? How do a booch, dismiss, battle, and restation affect that progression?

## Validation

`board.test.ts` checks reference data for 120 seeded boards/piece streams across all difficulties and token pools, 120 gravity arrangements, 960 rotations, and 100 line-clearing/scoring/token selections. These fixtures were recorded from the game. `game.test.ts` adds platform-only removal, chained clears, simultaneous targets, score caps, token adjacency and double bonuses, pair support, booches, board continuation, fast falling, repeatable sessions, performance expiry, and settings validation. `movement.test.ts` checks 3,072 recorded gap moves/rotations across eight obstacle layouts, all four orientations and eight fall fractions. It also covers one-cell gap insertions, narrow columns, shelf edges, full turns without cumulative drift, and safe placement in generated-board sessions. A session integration test reproduces sliding a piece between white and blue squares at the left edge, beside a shelf, with the actual key binding.

`timing.test.ts` compares against six recorded four-second falling traces: normal, accelerated, and Space press/release, each at both display scales. It also checks landing grace, movement during contact, cascade durations, score banking before the completed-board pause, and delayed animation frames. Session integration tests verify that a new Space press cannot accelerate elapsed time and that holding Space through landing does not accelerate the next pair.

`animation.test.ts` compares 35 glow positions/opacities and five piece-fade opacities recorded from the game. Rendering checks cover filled-target fade frames, immediate shelf and connector removal, unfinished target restoration, target filling on arrival, and glows continuing into falling and subsequent clears.

Public rule cross-check: [official Sailing instructions](https://yppedia.puzzlepirates.com/Official:Sailing). Local rule comparisons provide the detailed values above.
