# Gunning

Open `#/gunning`. In **Settings > Mode**, choose **Normal**, **Loop drill** or **Freeplay**, then return to Play and Start. Ordinary gunning offers **2, 4 or 6 cannons** and **Ship broadsides**, **As soon as loaded** or **Viking expedition** firing. Settings also holds the broadside interval, cannonballs aboard, deck holes, ship movement and optional timer. Gameplay controls are in Settings > Controls; Speed is directly below the board in every mode.

Point at a cell and click to lay the selected arrow there. Drag away from the cell before letting go to pick the arrow's direction, or turn it with the mouse wheel; a right click cancels a drag. The arrow keys move the cursor, W A S D select up, left, down and right, and Space lays the arrow. Escape pauses. Keys are configurable. The Speed slider sets the fastest tick you allow.

## Loop drill

The normal 13×13 deck mirrors the example circuit on both sides, with two guns per side in
rows 3 and 9. Pieces travel down the outside edges, across the bottom, up the return lanes
behind the guns and across the top. A central wall separates the circuits. Each has its own
barrel, at (8, 6) on the right and (4, 6) on the left, keeping three of each piece loose on
that side (twelve per side). Consumed pieces wait until 750 ms of active time after the latest
consumption on their side, then that barrel's held batch is shuffled before returning.
A batch with different piece types always changes order. Each side's supply uses its own
stream derived from the run's seed, so actions on one side do not reorder the other's refills.
The initial supply is also shuffled, and replays remain repeatable. Consecutive outputs are allowed
when the return lane is clear; there is no forced gap between pieces in a released batch.

Place **Left** at a right-hand muzzle entrance or **Right** at a left-hand entrance to load
that gun, or **Down** to let pieces keep circulating. Arrows can be placed on any open deck cell, in any direction,
with normal gunning timing, cursor movement, wheel rotation, collision handling and the
three-arrow limit. Arrows elsewhere can change the pieces' route around the deck.

A correct **powder, wad, shot** load immediately fires the gun, showing the normal muzzle blast
and smoke. The gun cannot be loaded during the animation and becomes empty and clean when
the smoke clears, without needing a swab. Swabs still wash out mistaken loads. Cannon count, ammunition
limits, holes, firing settings and ship movement do not affect this drill.

Unavailable guns are darkened. They return to their normal bright appearance at the exact
moment loading becomes possible again.

Score is **guns per minute**: completed loads × 60 divided by active seconds. Pauses add no
time, and timed runs stop the scoring clock at the selected duration. Drill history is separate
from ordinary gunning. Fixed-seed drills follow the shared practice-only PB rules.

## Recreated rules

- The deck is 13 cells wide: 9 rows with 2 cannons, 13 with 4 and 17 with 6. Cannon rows are rows 3, 9 and 13, with a cannon on each side. Each cannon is three cells: the muzzle on the outside, where pieces go in, then the middle and the breech.
- Each deck starts with four crates per cannon at random, never in the barrel's three rows, in a cannon row's open lanes (columns 0, 4, 8 and 12), beside a gunport, or across the lane just below a cannon.
- The barrel sits in the middle of row 6. Facing up, it puts out a piece, turns a quarter over two ticks to face right, puts out the next, and so on round. If that side is blocked it tries the opposite side. With the ship moving it slides along its row a cell every three ticks instead.
- At most one piece comes out a tick, and none while every cannon is loaded or firing, or while the deck already holds two pieces per cannon. The new piece is chosen at random from the types there are fewest of on the deck (swab, shot, powder, wad), never more than one per two cannons of a type, and no shot when every cannonball aboard is already out on the deck.
- Each tick a piece moves one cell. On an arrow it turns that way. When the way ahead is blocked by a crate, a cannon's side, the edge or the barrel, it turns right, then left, then back; if all four are blocked it is removed. Two pieces that would swap cells both turn round, and two heading for the same cell both stop for that tick and turn round.
- Only the three newest arrows stay on the deck. Laying a fourth takes away the oldest; laying one where an arrow already is makes it the newest. Arrows can't go on crates, holes or cannons.
- A piece enters a cannon only through its muzzle, moving sideways into it. It takes the first empty slot from the breech: powder, then wad, then shot is correct. A shot that completes a correct load leaves the cannon **loaded**, which uses a cannonball. A piece that doesn't make a correct load stays in the cannon until a swab clears it.
- A swab goes all the way to the breech and the cannon washes out for one second, emptying it. A fired cannon is fouled and must be swabbed before anything loads correctly into it again. A swab into a clean, empty cannon still washes it but counts as a mistake.
- A piece that runs off the side of a cannon row through the gunport, or onto a hole, goes overboard.
- The deck starts at 250 ms a tick. Every correct piece and loaded cannon takes 2 ms off, down to 100 ms; every wrong piece, wasted swab and lost piece adds 2 ms, up to 500 ms. The Speed slider can make ticks faster than that, never slower.
- With **Viking expedition** firing every cannon starts fouled, and each time the number of cannons loaded reaches a multiple of the cannon count, every loaded cannon fires, 200 ms apart.
- Sounds are the game's: arrows, correct powder, wad and shot, wrong pieces, washing out, pieces overboard and the opening fanfare.

## Freeplay mode

Freeplay mode (Mode → Freeplay) is a sandbox for showing a setup to someone else. It starts frozen so the deck can be set up before anything moves. Hold 1–9 over a cell to paint a crate, a hole, clear, a swab, shot, powder, wad, a fouled cannon or the barrel, or select a paint in the Deck panel and click or drag. Drag the barrel itself to move it to an empty cell; placing a barrel always moves the single existing barrel. Pieces face the arrow selected under Arrow and pick their next cell as a moving piece would. Painting a piece on a cannon loads it into the next slot, as if it had rolled in; Clear empties the cannon and Fouled leaves it needing a swab. Barrel faces turns the barrel in place. Arrows are laid as usual. Run sets the deck going, Freeze holds it still again, and Back to setup puts the deck as it was when it last ran. Freeplay has no timer and keeps no history.

A note says when the deck could not come from the game: a moved barrel, the wrong number of crates, crates or holes where the game never puts them, more pieces than the barrel puts out, more than one of a piece per two cannons, or two pieces on a cell. Copy and Paste share decks as text: `G`, the cannon count and barrel facing, an optional `@xy` for a moved barrel's base-36 column and row, then the cells, the pieces, each cannon's slots and the arrows (see `create.ts`). Older codes keep the barrel in its original position. A pasted deck plays with its own cannon count. Generate deals a new deck.

## Known assumptions and practice differences

1. **When ship cannons fire is a setting.** On a ship, loaded cannons fire when the ship shoots. Here **Ship broadsides** fires every loaded cannon on a fixed timer (5 to 30 seconds), the first at once and the rest 200 ms apart, and **As soon as loaded** fires each cannon a second after it is loaded.
2. **Ship movement is made up.** With Ship moves on, the ship turns left or right at random every three to eight seconds for one and a half to five seconds. The barrel's sliding follows the game.
3. **Holes are only placed at the start.** In the game the deck takes holes from battle damage.
4. **Cannon state at the start.** Ship cannons start empty and clean here; in the game they keep whatever they held when the last gunner left.
5. **Score and rating.** The game doesn't show how gunning points or ratings are worked out, so the score here is cannons loaded a minute and reports show Learning. The duty report lists Cannons Loaded, as the game's does.
6. **Animation timing.** Pieces glide over the tick they move in. The muzzle blast lasts a third of a second and the smoke fades over two seconds; a cannon is fouled when the smoke clears.

## Validation

`game.test.ts` covers ordinary gunning's layout, loading, firing, washing, movement, supply and
seeded sessions. `loop.test.ts` checks both mirrored circuits, firing and clean resets for all four guns, persistent
arrows, mistakes and swabs, sustained picking and replacement supply, seeded layouts and render
step independence and independent supply streams. The replay integration tests complete two-minute drills on each side with mouse and keyboard
controls, pauses it, verifies guns/minute and separate history, then checks playback and seeking
without drift or duplicate scores. Freeplay tests cover moving the single barrel, spawning and
blocking at its new position, copied decks, and recorded drag/paint movements.
