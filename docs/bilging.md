# Bilging

Open `#/bilging`. Choose difficulty **0–9** (one through ten stars) and tokens **Off**, **Normal shapes** or **Normal shapes + blades**, then Start. Settings > Game sets the water level (3–9 flooded rows), an optional timer and the alternate piece art.

The arrow keys move the two-piece cursor and Space swaps the pieces under it. Pointing at the board moves the cursor and a click swaps there. Escape pauses. Keys are configurable. There are also panel buttons, saved results and portable replays.

## Recreated rules

- The board is 6 × 12 with 45-pixel cells. Pieces float upward: cleared spaces fill from below, and new pieces enter at the bottom. Starting boards use the game's seeded random sequence and never begin with three in a line.
- Difficulties 0–2 use five colours, 3–5 six and 6–9 seven. New pieces come from the game's weighting: pufferfish from difficulty 2, crabs from 4 (6, 6, 6, 9, 12, 15 in about 300) and jellyfish from 5.
- A swap trades the two pieces under the cursor and counts as one move. Two identical pieces only trade places, without a move. Crabs cannot be swapped.
- Swapping a pufferfish bursts it, clearing the 3 × 3 square around it. Swapping a jellyfish with a piece clears every piece of that colour. Each scores one point per piece cleared, as the move's first chain step.
- After every change the game repeats, in order: complete one token, float pieces up and refill, release crabs, then clear lines. Lines are three or more in a row or column; crabs, puffers and jellies never match. Token halves do not change a piece's colour.
- The first line clear in a move scores 3, 5 or 8 per line (3, 4 or 5+ long), times 1, 1.6, 3.5 or 9 for one to four lines at five colours, 1.1, 2.1, 5 or 12 at six, and 1.2, 3, 8 or 20 at seven. Later chain steps score one point per piece in their lines.
- Crabs that float to or above the water line leave the board, paying 5 points per flooded row each. Swaps above the water take 250 ms, below it 450 ms.
- Callouts follow the game: Good and Great for one line of 4 or 5, Arrr!, Har! and Yarrr! for two lines, Bingo! for three, Sea Donkey! or Vegas! for four or more, then Super! and Bonus! for later chain steps.
- With tokens on, a fifth of new coloured pieces carry a token half from the selected pool (circle, diamond, plus and cross, adding blade in the second pool). A token completes when a lower half sits directly beneath the matching upper half; both pieces keep their colour.
- The level-up target is 100, 300, … 1900 points at difficulty 0–9. The stars bar fills as moves score; when it fills, "Great work!" shows and a fresh board is dealt.
- Pieces rise at 85.7 ms per row. Clears fade over 250 ms, the pufferfish animation lasts 1,175 ms with its burst at 450 ms, and crabs scuttle off the nearer side.

## Freeplay mode

Freeplay is a sandbox for building a position to show someone. Start, then hold 1–7 (a colour), 8 (puffer), 9 (crab) or 0 (jellyfish) over the board to paint, or select a palette piece and left-click or drag. Scroll cycles the piece under the pointer, and "Token on colours" adds a token's lower or upper half to painted colours. Fill board, Generate (deals and copies a new board) and Paste work while Freeplay is running; Copy works in any mode, so a board from Normal can be pasted into Freeplay. Board codes start with B.

Swaps play out under the game's rules, with pieces refilling from below, but Freeplay never levels up, has no timer and keeps no history. A note under the palette lists anything the game could not deal at the chosen settings: a line of three already on the board, colours or specials the difficulty doesn't use, a crab above the water, tokens with Tokens off, or a token already complete. Painting is not blocked, so unusual positions can still be built on purpose.

## Known assumptions and practice differences

1. **Water level is a setting.** In the game it follows the ship's damage. Here it stays at the chosen number of flooded rows.
2. **Difficulty stays fixed.** After a level-up the next board keeps the selected difficulty, instead of following the game's promotion. Later boards use a local seed sequence so replays repeat.
3. **Live performance calibration is unavailable.** The indicator uses the game's default curve, topping out at 8.4 points per swap; "Top indicator threshold (approx.)" rescales it. Reports show Learning.
4. **Token pools are forced on for practice.** The completed-token tally counts your shapes only; the ship maneuver and the other stations are not simulated.
5. **Presentation is simplified.** Bubbles, splashes and the token flight to the maneuver panel are left out; the jellyfish and level-up animations are approximate. Key repeat uses a 150 ms delay and 75 ms interval.

## Validation

`board.test.ts` checks 90 seeded starting boards and their next 60 pieces across all difficulties and token pools, then replays 80 recorded games of 30 swaps (2,400 swaps) at every water level. Each swap compares the board afterwards, the points, the chain length, crabs released and tokens completed. These cases were recorded from the game's own rules. `game.test.ts` covers crab refusals, equal-piece swaps, swap speed above and below water, pufferfish, jellyfish, crab release, token completion, scoring after the last animation, level-ups and repeatable sessions.
