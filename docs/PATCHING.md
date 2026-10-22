# Patching practice

Open `#/patching`. Choose difficulty **0–10**, then Start. Difficulty stays fixed until Stop.
The canvas uses the game's 450×600 artwork, a 7×6 field of 56 px pieces, and the original sound recordings.

## Freeplay mode

Freeplay mode is a sandbox for showing a setup to someone else. Choose Mode → Freeplay and Start, then hold 1–8 over a square to paint a straight, elbow, tee, cross, grommet, tie-off, blocker or the spool (or select a piece in the Board panel and click or drag). In Freeplay the number keys paint instead of moving the cursor. The wheel or Q/E turns the spool and tie-offs as well as the movable pieces. Painting the spool moves it, swapping with what was on that square. Freeplay has no wind, maneuver tokens or history. A gust from the spool or Enter plays out as usual, then the board comes back as it was so the setup can be tried again.

A note says when the board could not come from its difficulty: the wrong number of tie-offs, too many blockers, grommets or crosses the difficulty never deals, too few grommets, a spool facing the edge, or pieces walled off from the spool. Copy and Paste share boards as text: `P`, the difficulty (`A` for 10), then a piece letter and orientation digit for each of the 42 squares row by row (`S` straight, `L` elbow, `T` tee, `X` cross, `G` grommet, `O` tie-off, `B` blocker, `U` spool). Pasting a board plays it at its own difficulty. Generate deals a fresh board and copies it.

## Difficulty and wind

These are the board layouts in the current test build. Numbers in the difficulty picker are the game's internal difficulty numbers.

| Difficulty | Active board | Tie-offs | Extra blockers | Wind interval |
| --- | --- | --- | --- | --- |
| 0 | 5×4 | 1 | 0 | 75 s |
| 1 | 5×4 | 1 | 0 | 75 s |
| 2 | 5×4 | 1 | 0 | 75 s |
| 3 | 6×5 | 2 | 0 | 75 s |
| 4 | 6×5 | 2 | 0 | 70 s |
| 5 | 7×6 | 2 | 0 | 65 s |
| 6 | 7×6 | 2 | 3 | 60 s |
| 7 | 7×6 | 3 | 3 | 55 s |
| 8 | 7×6 | 3 | 5 | 50 s |
| 9 | 7×6 | 3 | 5 | 45 s |
| 10 | 7×6 | 4 | 5 | 45 s |

**Wind timing assumption, chosen with Jared:** the installed puzzle does not contain its interval table.
[YPPedia's Patching page](https://yppedia.puzzlepirates.com/Patching), checked 21 October 2026, gives
75, 70, 65, 60, 55, 50, 45 and 45 seconds for its timed levels 2–9.
We align the highest timed level to the highest internal difficulty, then work downwards.
All remaining lower difficulties use its lowest timed interval, **75 seconds**.
This is an explicit practice mapping, not a claim that YPPedia's level numbers or feature descriptions match the internal numbers.
YPPedia lists no wind for its first level; following Jared's final instruction, all lower practice difficulties use 75 seconds.
The earlier proposed 60-second fallback is superseded by that instruction.
Settings also offers a custom 1–300 second interval or no wind.

## Recreated rules

- Pieces swap between any two movable cells, including non-neighbours. Rotation is in 90° steps. Spools, tie-offs and blockers stay fixed.
- The generator first constructs a connected solution, selects tie-offs, fills unused cells, adds blockers and shuffles. It retries boards that fail its reachability, minimum-length or grommet checks. Shuffling does not randomly rotate pieces.
- Difficulties 0–1 have straights and elbows. Difficulty 2 adds three-way tears and grommets. Difficulty 5 adds crosses. There are no timed piece refills: the whole board is generated together, and a spent grommet becomes a straight in its existing orientation.
- Filler grommet probability is 15% plus one percentage point per extra blocker. Minimum count is floor((difficulty+1)/2) when grommets are enabled; the upper check is 8 above that minimum. These checks and the solution construction affect final board frequencies.
- Eligible filler crosses have a 15% draw, suppressed once the existing count exceeds six. That is the actual conditional check, not a hard six-cross cap.
- A gust follows every connected branch. A loose connection tears both affected locations where possible. All tie-offs must be taut for a successful completion. A closed incomplete network survives only by consuming a connected grommet; otherwise the spool tears, even for a closed loop.
- Enter or the spool requests an early gust only when there are no loose ends, at least two connected pieces, and either all tie-offs or a grommet are connected. A safe grommet-only gust can be requested deliberately.
- Taut grommets score 10 points, tie-offs 5, and other taut pieces 1. Coverage bonuses are 5 above 50%, 30 above 80%, or 50 above 99%. Apply the difficulty factor (1+difficulty/10), truncate, then apply the 0.35 torn-board factor and truncate if necessary. Safe intermediate gusts also contribute points.
- Optional maneuver tokens use a 20% draw at valid four-piece intersections. Available types follow the four-type or five-type game mode. All four pieces must be connected; activating multiple types turns them red and awards no maneuver credit. The practice counter counts completed green tokens, not actual ship maneuvers.

## Controls and animation

- Drag with either mouse button to swap. A release on the same piece in under **150 ms** rotates: left counterclockwise, right clockwise. A longer stationary hold does not rotate.
- Wheel up rotates counterclockwise; down rotates clockwise. Wheel events are limited to one accepted event per **150 ms**. While dragging, wheel or the other mouse button rotates the held piece.
- WASD, arrows or keypad directions move the cursor. Q/E rotate. Space or keypad 0/5 selects and swaps. Enter requests a safe gust. Escape pauses.
- Held puzzle keys repeat at **5 actions/second** after a **500 ms** initial delay.
- Board replacement uses the **530 ms** wind-clock adjustment, **400 ms opacity fades**, and column/row delays of **25/15 ms**; incoming thread images start fading in after **265 ms** plus their cell delay. Cloth images refresh immediately. Cleared stitches remain removed during the outgoing fade. These are fades at full size, not scaling animations.
- Newly connected thread images fade in over **500 ms**, while the cloth changes immediately. Swap markers fade out over **750 ms** at their original size. A connection's fade travels with its piece when swapped.
- Loose-end effects run at **10 fps**; grommet stars at **25 fps**; grommet consumption at **20 fps**; rip effects at **10 fps**. Spool sheen and sparkles run at **6/10 fps**.
- On completion, the clear wave travels by shortest connection distance at **200 ms per cell**. Pulse/firework frames run at **10 fps**. Feedback rises 30 px over **1,500 ms**, fading during its second half. Torn boards wait **3,000 ms** before replacement.
- Wind buildup starts in the last **9,250 ms**. Its sound follows the delayed effect starts. Gust strips travel between x = −184 and x = 760 with integer position interpolation, use the game's static random size curve, and fade in over 70% of their 800–1,299 ms travel. Decorative objects retain the 10% per-object draw (up to three); the rare sheep uses a 0.1% draw.
- Loose-end and ready-spool loops restart at frame zero after a board update. Pieces, cloth, markers, drag ghosts and effects keep separate layers. The cursor follows the mouse through board transitions and stays at its previous location; dragging keeps the cursor at the pickup location until release.
- Green maneuver tokens burst into eight fading stars, hold for **700 ms**, then accelerate away with their flare; the flight ends at **1,200 ms**.
- A torn board shows the actual ripped-cloth effects and remains visible for the replacement delay. There is no added failure banner. The wind bar holds its previous fill while a completed board clears.
- Session pause freezes wind and animations. Saved replays reproduce input and board progression without writing new player scores.

## Remaining questions and disclosed approximations

1. **Actual wind intervals:** can the table above be checked against current gameplay, especially the introductory difficulties? Until then it uses the mapping Jared requested.
2. **Performance ratings:** the current population thresholds, rolling performance calculation, and any extra adjustment for deliberately selecting a lower difficulty are not available. Practice shows raw points and board coverage messages; it does not claim an Excellent/Incredible rating.
3. **Board sequence selection:** individual seeded boards match the game generator. How successive seeds are chosen in live play is unavailable. Practice chooses independent deterministic seeds so replays are repeatable; it does not claim to predict a live board sequence.
4. **Ship maneuver progress:** the conversion from green tokens to ship progress, requests and readiness is unavailable. The practice counter counts green tokens on successful boards.
5. **Remaining visual limits:** the animation helpers have now been measured directly and checked using 70 rendered reference frames for opacity, size, delay and travel. Full successful-clear, grommet-gust and torn-board sequences have also been rendered for inspection. Browser font metrics, text-overlap placement, subpixel rasterization and frame scheduling can still differ. Torn-cloth variants use stable seeded per-cell choices in place of per-object identity; decorative wind randomness is seeded separately for repeatable practice. Original sound recordings, their 200 ms per-sound spacing and individual 75% gain adjustments are reproduced.
6. **Early tutorial presentation:** tutorial popups and automatic difficulty advancement are omitted. The requested fixed selectable difficulty and continuous practice session replace that flow.

## Verification

`scripts/parity/PatchingParity.java` produces rule fixtures. Tests compare 55 boards across all eleven difficulties,
1,320 rotations/swaps, gust outcomes, score calculations, safe grommet consumption, torn networks,
and both maneuver modes. Session integration tests cover pause, wind, board replacement, mouse timing,
replay playback/seeking and history isolation. Animation regression tests compare measured opacity/size/position traces and check complete scene layers, effect phases, full-size connection fades, swap-marker fades, immediate cloth refresh and cleared-stitch removal through replacement. A saved-history startup regression is also covered.

Run `npm test`, `npm run typecheck`, and `npm run build`.
