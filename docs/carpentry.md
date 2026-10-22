# Carpentry

Open `#/vampire-carp`. Choose **Vampire Lair** or **Ship** carpentry. A ship takes a difficulty **0–9** (one through ten stars) and tokens **Off**, **Normal shapes** or **Normal shapes + blades**. Then press Start for a two-minute session. Mode, Unlimited, Seeded and Cheats work for both; Speed is the Vampire Lair's practice mode only.

## Ship carpentry

- Holes come from the duty's difficulty, as in the game: at difficulty 2 and up each hole is 4 to 14 pieces in size, from max(4, 6 − difficulty) to min(14, 6 + difficulty). Difficulties 0 and 1 are the game's two tutorial holes with a fixed toolbox (P, Y and I), dealt unturned.
- The star meter fills after 1, 1, 4, 6, 8, 10, 12, 15, 17 or 20 holes at difficulty 0–9. Then "Nice work!" scrolls in and a new board is dealt at the same difficulty.
- Neglect, rattling, flying planks, growing holes, putty, the nudge before you take the next plank and the scrolling board are the same as in the Vampire Lair.
- Each finished hole is rated by the planks it took: A Masterpiece! for exactly its size, Craftsmanship! for one more, A Fair Job. for two more, Sloppy Work. under double and A Pig's Breakfast! beyond.
- A hole's points: 2 × size − 4 for a masterpiece, 1 more if every plank was the same shape ("Nice set."), and size ÷ 2 (rounded down) if every plank's grain runs across ("Grain Bonus."). Masterpieces in a row add 1, 2, 3… more and show their count beside the rating; any other rating, or a neglected hole opening up, ends the streak.

## Maneuver tokens

- With a pool on, every plank (not putty) is dealt with a token on it. A token is a 2 × 2 block of quarters placed where it overlaps the plank, so a plank usually carries one to three quarters. The quarters turn and flip with the plank.
- A whole token forms when four matching quarters sit in their places in a hole, usually from two or more planks. A plank laid over another's quarters replaces them, but a plank that flies off leaves its quarters behind.
- A finished hole hands over one whole token from its cells, chosen at random if there are several. A masterpiece counts it twice ("Double Bonus!"). A hole that took more than two planks over its size hands over nothing ("No Bonus / Too Sloppy").
- The Maneuver practice panel counts the tokens handed over this session, by shape.

## Freeplay mode

Freeplay mode (Mode → Freeplay, for the Vampire Lair or a ship) is a sandbox for showing a setup to someone else. Start it, then hold Q over a hole's 10 × 10 box to cut squares open or W to fill them with wood, or select Cut or Wood in the Board panel and drag. Put down the plank in hand first. A painted hole counts as freshly dealt: its size is its squares ÷ 5, the rest count as growth, and planks already in it become wood. Each toolbox slot can be set to any plank with its grain across or along (I, L, N and Y are always across), or the putty; planks set this way carry no token. Clear holes fills every hole with wood. Planks then place, rate and neglect as usual, and new holes come in as holes are finished. Freeplay has no clock and keeps no PB or history.

A note says when the board could not come from the game: a hole whose squares aren't a multiple of five plus up to three from growing, a hole size the difficulty (or the Vampire Lair) never deals, a hole that isn't the tutorial hole at difficulty 0 or 1, a toolbox other than P, Y and I there, putty below difficulty 3, or two putties. Copy and Paste share boards as text: `C`, each hole's box as 25 hex digits (a bit a square, column by column), then `:` and the toolbox as a letter and grain digit each (`b` for putty). Generate deals a new board and copies it.

## Known assumptions and practice differences

1. **Session length and score.** The game's duty has no clock and its duty score isn't shown. Here a ship session is two minutes (or Unlimited), scored by the holes' points, and reports show Learning.
2. **Difficulty stays fixed.** The next board keeps the chosen difficulty instead of following the game's promotion.
3. **Tokens are forced on for practice**, with no wanted shape. The ship's maneuver and the other stations aren't simulated, and a masterpiece counting twice is read from its "Double Bonus!" message.
4. **Token look.** The game's own token animations are blank images, so a handed-over token is drawn from the plank quarters and flies off to the right over one second. Where the masterpiece streak number sits beside the rating is approximated.

## Validation

`board.test.ts` replays 12 games recorded on the test build's own carpentry classes (`scripts/parity/CarpentryTokenParity.java`) at difficulties 0–9 with each token pool. After every move it checks the toolbox and its tokens, every hole and its token quarters, the rating, points, masterpiece streak and the token handed over. The Vampire Lair keeps its own 6 recorded games. `game.test.ts` plays whole ship boards and checks a masterpiece's double token, grain and nice-set lines.
