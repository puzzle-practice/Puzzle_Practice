# Swordfight: what the game tells us, and what it doesn't

Source: the game's own code (build 20260909165753), package `com.threerings.piracy.puzzle.sword`
(decompiled into `run/decompiled/sword-src/`), the drop-puzzle classes it builds on
(`run/decompiled/drop-src/`), `item/data/Sword` (`run/decompiled/sword-misc-src/`), the
`yohoho-puzzle-sword` media bundle for art and sound, `rsrc/en/i18n/puzzle/sword.properties`, and
YPPedia's Swordfighting pages. The practice version is `src/puzzles/swordfight/`.

## Part 1: what I couldn't get from the game (where your help is needed)

The game's code (`SwordManager`) isn't available, so everything it decides is missing. I made a
choice for each of these so the puzzle plays; each one is easy to change.

1. **How fast the pair falls at the start.** The game starts it at `0.01 x (difficulty + 1)`
   pixels per ms (rows are 40px), where the game sends the difficulty. Difficulty 0 is 4
   seconds a row and 9 is 400ms. I don't know which difficulty real fights use, or whether it
   depends on the opponent. Nothing in the game's files sets it for swordfights: the other puzzles
   have difficulty levels 0 to 8 that players pick in their options (capped by experience), but
   Swordfight isn't one of them. **Default here: 1, which is 2 seconds a row, from Jared's memory of
   the game.** The setting offers 0 (4 seconds) to 9 (400ms).
2. **How pairs are dealt.** The game sends the pieces, six pairs at a time. I don't know the
   colour odds, how often a breaker comes, or whether everyone in a fight gets the same pairs.
   **Here: each piece is one of the four colours at random, 12.5% are breakers (a setting), and
   everyone gets the same pairs in the same order.** Does that feel right to you?
3. **Attack sizes.** The game works these out. I followed YPPedia exactly: a block sends a sword
   of its own size (2x2 sends 1x4, 3x3 sends 2x4, extra width on an upright sword or extra height
   on a flat one turns into length), every two loose pieces of a break send a sprinkle, and the
   nth clear of a chain multiplies sprinkles by n and a block's longest side by n. Two things
   YPPedia leaves open:
   - whether the chain multiplier is applied before or after the 2x2 and 3x3 special cases
     (here: before, so a 2x2 in a Double is a 2x4 upright sword), and
   - what happens to a sword longer than the board (here: it's sent whole and the part that
     doesn't fit is cut off, as the game does when it draws it).
4. **When an attack is sent.** I send one attack when your board has finished settling, with
   everything from the whole chain in it. The game might send one per clear instead. Since
   the game only lands one attack per pair you place, this changes how quickly a big chain
   hurts your opponent.
5. **Strike and attack numbers.** Each sword the game sends has an id, and the game uses it
   to pick the column an upright sword starts in and which way it looks for room. I give them
   random ids, so placement looks varied, but real ids may follow a pattern.
6. **How the game's own opponents play.** Their full AI behavior is unavailable. The game's settings object
   tells us a little: there's an AI skill level, a "destruction percentage" for skill 0, 10, 20 ... 100
   (base 7% to 60%, maximum 10% to 70%), a 40% chance that a skill-100 AI chains a
   strike block, and AIs play more slowly once 1 to 4 players are targeting them. So the real AI
   is a dice roll on how much of its board it destroys, not a player.
   **Here both opponent types work that way.** The **Experimental** type: they don't play the puzzle and never fuse blocks.
   Each keeps its pairs stacked on its lowest column (ties in the order 1, 6, 2, 5, 3, 4) as a
   tally of colours. A breaker may be stored on its board; otherwise it clears a share of its
   colour, more the higher the board, taken evenly from the columns centre first, and its
   stored breakers go off with it as the next links of a chain. Each clear is sent as an attack,
   split between swords and sprinkles by the opponent's style. Your attacks land on top of its
   columns as plain pieces, at most once every few of its pairs. An opponent is knocked out like
   you, when the top of its fourth column fills. Opponent screens are hidden by default (red
   boxes where it has pieces).
   AI skill is a preset: its clear share on an empty board is the base destruction for that
   level, rising towards the maximum as the board fills. The Settings tab shows every part (time
   per pair, colour cleared, variation, height multiplier, chance to store breakers, combo size,
   strikes vs sprinkles, how often your attacks land) to set on its own. The time per pair,
   storing chance and combo size for each skill level are my guesses.
   The default opponent type, **Ingame**, uses those values directly: each breaker
   destroys a random share of its own colour (only that colour) between the base and maximum
   destruction for its skill, sends that clear as a chained one (a Double) at the chain chance (40%
   at skill 100, scaled by skill), and plays more slowly while you target it (25% by default, a guess at one
   of the four targeter steps). It plays a pair every 3 seconds when not targeted, at any skill.
7. **Who opponents attack.** Each AI picks a random pirate on the other side, and picks again when
   that one is knocked out. Thralls and skilled swabbies fight on your side.
8. **Scores and ratings.** The game never scores a fight on your screen. Here the main score is damage sent
   (sprinkles plus each sword's squares), with your wins and losses per setting. Which number
   would you like to practise against?
9. **Sounds are Ogg files**, straight from the game. They're being converted to MP3 for every
   puzzle separately.
10. **Faces and names.** Faces are put together from the game's face parts and recoloured with its
    skin, hair and dye colours, picked at random: cultists wear the cultist face paint (women add the
    top knot), homunculi are the homunculus face, thralls are zombies in the enthralled mask, and
    skilled swabbies wear the mercenary head and shako. Knocked-out cultists, homunculi and you show
    the passed-out face. Names come from the game's name lists: "{prefix} Cultist", "{prefix}
    Homunculus", "{prefix} Zombie" for thralls (the game also names a thrall "{owner}'s Thrall"),
    and a first name and surname for skilled swabbies. Which parts the game's own cultists and
    swabbies wear is my reading of the part names. Names are drawn as the game draws them over a
    face: 10pt, outlined in black, yellow, with skilled swabbies in red (role 12).
    The game recolours the sword icons to the sword's colours; I show the plain icons. Hovering a sword shows its name
    and colours. A toggle (Settings, Opponent screens) replaces enemies' names with the attacks
    waiting to land on them, as attacks:pieces; the game doesn't show this. The incoming-strike sparks and the piece
    explosions are close copies, not exact.
11. **Not built yet:** Duelling (the game has it, with a second full-size board), and the
    special seas: Atlantean (aqua pieces), Haunted (purple pieces that turn to metal), sanguine
    pieces, and sea battles' rum and damage rows.

**The easiest help:** your sense of how fast pairs fell at the start and how often breakers came,
and what you want the opponent to be like.

## Part 2: things the game does tell us (maybe new to you)

### Controls
- Left and right repeat 7 times a second after a 300ms hold. **Down turns clockwise, up turns
  anticlockwise**, Space drops faster. **A / S** (or **[ / ]**) change your target.
- Every pair starts at the normal speed, even if you're still holding Space: press it again.
  Fast drop is 50ms a row. The normal speed goes up by 1/300 pixel per ms after 10 pairs, then
  13 more, 16 more and so on, up to 160ms a row.

### The pair
- Pairs appear in the fourth column, upright, with the outlined piece at the bottom. If the
  second row is taken there, the pair starts a row higher, half above the board.
- You're knocked out when the top square of the fourth column is filled as the next pair is due.
- Turning keeps the outlined piece still. If the other piece has no room, it tries one column
  right, then one left, then turns on again. Pointing down, a turn may lift the pair a row
  instead, but only twice per pair.
- Past halfway into a row, moving and turning check the row below too.
- **Landing bounces:** when the pair can't fall it stops for an eighth of a row's time (at the
  normal speed) before it settles, so you can still slide or turn it off a ledge. If it then
  lands on the same rows again, it settles at once with no second bounce.
- A piece still above the board when the pair lands is lost.

### Blocks and clears
- Same-coloured pieces fuse into the biggest rectangle at least 2x2 that contains no part of
  another block sticking out. The search starts bottom-left; a square is preferred, then tall,
  then wide.
- **A block rests on anything under any of its bottom row**, so gaps can stay under a block.
- A breaker shatters when it touches its colour (another breaker of that colour counts), taking
  every connected piece of that colour and whole blocks.
- Chains are named Double, Triple, Bingo, Donkey and Vegas (6 and up).
- The clear's check for "is this square in a block I've already counted" compares the left edge
  the wrong way round. With two separate same-coloured blocks side by side in the same rows, a
  clear that reaches the right one first still shatters the left one, but counts its squares as
  loose pieces rather than as a block. If the game uses the same code (it's in a shared
  package), the left block sends sprinkles instead of a sword. I kept it.

### Incoming attacks
- An attack is placed (with a blinking warning at the edge) when your next pair appears, and
  lands after that pair has landed and your board settles. So you always get one pair's warning.
- The warning sound tells you the size: one for sprinkles only, then danger, big and huge.
- Upright swords start at the top, in a column picked by the sword's id, and **avoid the fourth
  column unless there's nowhere else**. When they land they fall through loose pieces, crushing
  them, until something solid (a block, sword or metal) or until they'd crush more than a third
  of their own size.
- Flat swords come in from a side, at the first row (from three above your highest block) where
  they get more than halfway across. With no such row, they turn upright.
- Sprinkles are dealt one per column in turn (right to left for odd-numbered attacks), and the
  fourth column is never filled above its fourth row, so **sprinkles can't knock you out**.
- Swords and sprinkles move on a stage each time you land a pair: sword, silver, silver showing
  its colour, then the plain piece. Sprinkles start at silver.

### Swords
- Each sword type has its own pattern of colour slots, and its two colours decide which piece
  colour goes in each slot and whether the pattern is mirrored. A strike longer than the pattern
  repeats its last four rows; sprinkles use the bottom two rows. All 26 types, the stick, and
  the 8 x 8 colourings are in `strikes.ts`.

## Checked

`board.test.ts` replays cases recorded from the game's own code by
`scripts/parity/SwordParity.java` and matches every one: 36 random games settled step by step
(falling, fusing, clearing, chains), 150 attacks placed when the pair appears and again as they
land, 60 sprinkle spreads, 351 sword colourings and 300 turns and moves. `match.test.ts` checks
the YPPedia attack sizes, that a fight ends, and that the same seed and inputs always play out
the same way, which replays rely on.
