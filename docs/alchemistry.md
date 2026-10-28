# Alchemistry

Recreated from the game’s test build **20261018210340**, checked on 19 October 2026.
Open `#/alchemistry`. Choose difficulty before starting; the choice is remembered.

## Difficulty

| Level | Primary colors | Bottle layers | Completed bottles required | Overlapping tubes | Secondary colors |
| --- | --- | --- | --- | --- | --- |
| 0 | 2 | 1 | 10 | 11% | None |
| 1 | 2 | 1 | 10 | 15% | Available mix of the two primaries |
| 2 | 3 | 1 | 10 | 19% | Two adjacent mixes |
| 3 | 3 | 1–2 | 8 | 23% | Two adjacent mixes |
| 4 | 3 | 1–3 | 8 | 25% | Two adjacent mixes |
| 5 | 3 | 1–3 | 8 | 27% | All three |
| 6 | 3 | 1–4 | 8 | 29% | All three |
| 7 | 3 | 2–4 | 6 | 31% | All three |
| 8 | 3 | 2–4 | 6 | 33% | All three |

The board has eleven staggered columns and 104 pieces. Left release rotates anticlockwise;
right release rotates clockwise. Wheel down rotates clockwise; wheel up anticlockwise.
Arrow keys move the selection. Space fills; Z/X rotate. These keys can be changed in Settings.
Fill is available whenever a colored path reaches an unbroken bottle, even if the color is wrong.

## Freeplay mode

Freeplay mode is a sandbox for showing a setup to someone else. Choose Mode → Freeplay and Start, then hold 1–9, 0 or - over a square to paint one of the eleven single tubes, or select any tube in the Board panel (the overlapping pairs too) and click or drag. A painted tube keeps the turn of the piece it replaced, so rotate it as usual afterwards, and it gets the special chosen under Special. Over a bottle, hold R, Y, B, O, P or G, or select a label and click, to add a label on top. Right-clicking a bottle takes its top label off, and a left click steps it through how many labels are filled, then broken, then empty again. Bulbs sets which primaries feed the columns.

Fills play out as usual and the game carries on with new pieces falling in. Before last fill puts the board back as it was, so a fill can be tried again. Freeplay never finishes and keeps no history.

A note says when the board could not come from its difficulty: specials below the difficulty that unlocks them, label colors the difficulty and bulbs never deal, bottles with more or fewer labels than the difficulty deals, or every bottle broken. Copy and Paste share boards as text: `A`, the difficulty, the bulb order, two base-36 characters a square column by column, then `:` and the eleven bottles (label colors from the bottom, then `*n` for filled labels or `!` for broken). A pasted board plays at its own difficulty. Generate deals a fresh board and copies it.

## Generation and specials

Single-tube shapes have weights `5,2,37,8,5,7,11,19,3,2,1` out of 100 for
inlet masks `9,3,17,21,27,29,11,13,15,31,63`.
Overlapping pieces have weights `10,20,20,30,10,10` for masks
`393,2185,1161,2181,2565,1541`. Each piece receives zero through five clockwise rotations uniformly.

Specials start with zero chance. Each generated piece checks quicksilver, bonus, then multifill,
with chance measured out of **1,000**, and resets an awarded special’s chance to zero.

- Quicksilver unlocks at 6. A fill with at least two scoring colors adds 3 to its chance.
- Bonus unlocks at 3. A fill worth more than 45 points adds 3 to its chance.
- Multifill unlocks at 5. Each scoring color with more than three effective labels adds 2 to its chance.

Crossing tubes are independent, but a special belongs to the whole piece. Multifill applies
to the connected path group. Quicksilver fills any bottom label and counts as one scoring color.
All three primaries make brown sludge. A wrong fill breaks the bottle permanently.
Part-filled bottles retain their score. Finished bottles are sorted by their existing value
before the current fill’s score is added; the most valuable take the remaining completion slots.

## Presentation

The game’s normal-size artwork, color palette, font and sounds are used. Sounds are packaged as
MP3 for browser compatibility. The measured animation values include:

| Effect | Timing |
| --- | --- |
| Rotate 60 degrees | Three 20 ms steps |
| Liquid retreat | Four keyframes, three 20 ms crossfades, sequenced by path depth |
| Bottle squirt | Nine frames at 50 ms |
| Completed bottle flight | 500 ms |
| Conveyor movement | 1,000 ms |
| Connected piece fade | 250 ms |
| Falling pieces | 0.525 pixels/ms |
| Fill star particles | 50% of path pieces; 1–3 stars; 400 ms |
| Broken bottle | 3×3 fragments; 700 ms; maximum initial velocity 0.16 pixels/ms per axis |
| Floating labels | 1,500 ms; fade during second half |
| Finished label | 3,000 ms |

The mouse and gears animate with the conveyor. Clicking bottles shows their value gleams.
Three seconds after the last turn the game shows the bottle gleams, or one time in five pulses the
quicksilver tubes instead, each fading up over 250 ms, 15 ms after the one before. Fills animate one connected group at a time.
Pause freezes the simulation clock. Sessions keep difficulty-specific history and saved replays.

## Assumptions and remaining differences

These are visible in Settings and are not claims of complete visual identity:

1. **Default difficulty is 4.** This is a practice-site choice. The game’s automatic assignment
   from standing is unavailable; users choose any of the nine verified levels.
2. **Bottle label shuffles use a separate seeded random stream.** The game shuffles its eligible
   color pool independently of the board seed. The eligible pools, size distribution and uniform
   label draws are preserved; a shared numeric seed does not identify the same bottle labels.
3. **Refill randomness is continuous within a practice session.** The game can provide independent
   refill draws. Their seed schedule and live sequences are unavailable. The verified generation
   probabilities and earned-special counters are used without guessing new rates.
4. **No network waiting is simulated.** Fills advance once their animations finish. The game can
   wait for additional draws after an animation, so a real connection can make the delay longer.
5. **Cosmetic randomness is seeded separately.** Particle velocities follow the measured ranges;
   their individual scatter does not match a particular game recording. Bottle gleams use the
   original sprite sheet with simplified placement/repetition. Text has the original font,
   words and sequence timings, with simplified collision handling/positioning. Pixel blending,
   subpixel rotation and frame scheduling can differ between Java-style rendering and Canvas.
6. **Raw score only.** Ocean-wide rating thresholds, labor credit, rank changes and automatic
   difficulty adjustments are unavailable. No estimated duty rating is presented as authentic.
7. **No time/rotation penalty.** None is active in the inspected rules. Jared also confirmed
   on 19 October that he has not seen one. Move counting alone is not treated as a penalty.

## Questions for Jared

No answer is needed to play or select a difficulty. These would help close the remaining gaps:

- Should the default stay at 4, or would another starting level suit your practice?
- If displayed labor/performance ratings are required, can you provide examples of completed
  sessions with both the displayed result and the filled bottles? Raw score is already recreated;
  rating thresholds are a separate unknown.
- When comparing against your game, which animation differences are noticeable first: gleams,
  floating labels, quicksilver pulsing, or refill pacing? A short recording would let us validate
  those last presentation details frame by frame.

## Validation

The checked-in fixture captures 27 generation cases across every difficulty and three seeds,
plus 360 path/fill cases. Tests compare tube layouts and draws, color propagation, scores,
completed-bottle selection, earned-special counters, quicksilver bulbs and whole-board refills.
Additional tests cover rotation invariants, staggered bounds, label order, tube independence,
difficulty-specific history and an animated session completing with its final score.
