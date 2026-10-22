# Rigging

Open `#/rigging`. Choose difficulty **0–9** (one through ten stars) and tokens **Off**, **Normal shapes** or **Normal shapes + blades**, then Start. Settings > Game has an optional timer.

Drag a piece along any of its three ropes and let go to slide the whole rope; a right click puts it back. With the keyboard, **W E A D Z X** move the cursor in the six directions, **S** selects the piece under it, the same keys slide its rope one place at a time, and **S** again lets go. **Space** cancels a selected slide. Escape pauses. Keys are configurable. There are also saved results and portable replays.

## Recreated rules

- The board is a hexagon of nine rows (5 to 9 pieces). Each straight line of pieces is a rope; sliding it moves every piece along and wraps the end piece round to the other end. A slide that comes back to where it started is not a move.
- After every slide the active pulley pulls. The six pulleys take turns clockwise from the top, whatever happened. The pull takes the piece at the pulley and every connected piece of its colour. Wild, tar and gaff pieces match any colour, and a pull needs at least three pieces.
- A pull that fails, or starts on a special piece, is a skip. After three skips in a row, five loops are lost from the rope coils.
- Each piece pulled adds a loop to the coils. Every 20 loops earn a wild and 25 points.
- Pieces the pull cuts off from the edge of the board are pulled too ("looped") and earn a gaff. A chain that takes every piece of its colour, with at least five pieces, earns tar. A chain that reaches a pulley two to four places round from the active one earns a splice.
- Earned pieces come in at difficulty 3 or above for gaff, 5 or above for tar and 6 or above for splices; below that they come as wilds. A splice also comes as a wild while another splice is on the board.
- A gaff in the chain also pulls every neighbouring coloured piece. A splice next to a cleared space is pulled and starts a second chain from its far end, in that end's colour.
- When tar is pulled, the pieces that reappear on or next to it all share one new colour.
- Cleared spaces refill in a shuffled order from the game's seeded random sequence. Earned specials take the first non-pulley spaces. Difficulties 0–1 use six colours, 2–3 seven and 4–9 eight.
- A pull scores the pieces pulled raised to the power 0.8 + 0.1 × colours (at least 1), rounded down. Linking adds 10, tar 25 and each looped piece 10.
- With tokens on, a fifth of new coloured pieces carry a maneuver shape from the selected pool. A pull activates the shapes it took for the next pull, shown round the next pulley. Pulling an activated shape again completes it.
- The level meter fills with pieces pulled: 20 at difficulty 0 and 27 × (difficulty + 1) above it. When it fills, "Board cleared!" shows and a fresh board is dealt.

## Freeplay mode

Freeplay mirrors Distilling's Freeplay mode. It is a sandbox: it never deals a new board or ends by itself, ignores the timer and keeps no history.

- Hold 1–8 for a colour, 9 for wild or 0 for tar and move over the board to paint. Or select a palette piece (any colour, wild, tar, gaff or splice) and left-click or drag to place it; select it again to slide ropes. The mouse wheel cycles the piece under the pointer.
- "Shape on colours" adds a maneuver shape to painted colours. "Fill board" makes every space the selected piece (orange if none).
- Copy gives the board as text: `R`, the active pulley (0–5), then 61 two-digit hex pieces row by row. Paste plays a copied board, Generate deals the next board and copies it, and Next pulley moves the active pulley on.

## Known assumptions and practice differences

1. **Difficulty stays fixed.** After a level-up the next board keeps the selected difficulty instead of following the game's promotion. Later boards use a local seed sequence so replays repeat.
2. **Live performance calibration is unavailable.** The indicator uses the game's default curve, topping out at 7.48 points per slide; "Top indicator threshold (approx.)" rescales it. Like bilging, it averages points over slides in 10-second intervals, and an idle interval counts as one slide. Reports show Learning.
3. **Token pools are forced on for practice.** The completed-shape tally counts your shapes only; the ship maneuver and the other stations are not simulated.
4. **Splice colours are approximated.** The game recolours a splice's bands with its own colour tables; here each band takes the average colour of the piece at that end.
5. **Animations are simplified.** Pieces travel back along their chain to the pulley at 50 ms a step, splices and gaffs go off for 300 ms first and tar splatters for 900 ms. The coil-to-wild flight, sparkles and tar slurp are left out or shortened. Key repeat uses a 150 ms delay and 75 ms interval.

## Validation

`board.test.ts` checks 60 seeded starting boards and the random sequence after them at every difficulty and token pool, and every rope through every piece in all six directions. It then replays 80 recorded games of 80 slides (6,400 slides) at difficulties 0–9. Each slide compares the pull (pieces, points, colours of each chain, looped pieces, tar, linking, wilds and shapes), the coils, the skips left and the board afterwards. These cases were recorded from the game's own rules and include gaffs, tar, splices with second chains, looped pieces and completed maneuvers. `game.test.ts` covers the layout, drag and keyboard slides, skipped pulls, the coil bonus, level-ups and repeatable sessions.
