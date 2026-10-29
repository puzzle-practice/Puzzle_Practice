# Werewolf Forage (Gauntlet test-build options)

## Try it

Open <http://localhost:5212/#/forage>, select **Den** or **Den (Exp)** as the mode, then press
**Start**. If the local server has stopped, run from this worktree:

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5212 --strictPort
```

Both Den modes are Gauntlet with Werewolf Isle's settings filled in: a 5 minute timer, the
Werewolf art (forest background, treasure crates, sounds and the wolf in place of the monkey) and
moons. **Maximum moons** under Specials sets how many moons can be up at once, from 1 (the
default) to 5; it applies to the next game and is saved with recordings. Gauntlet's chest ratios, paced delivery, nine-crate
boards, automatic next board and 1/2/3 crate scoring are unchanged.

**Den (Exp)** adds experimental moon changes on top:

- A moon wanes as soon as a move clears pieces, so its art changes with the clear rather than
  once the move has played out. It still goes at the end of the move after its last phase.
- The moon's firing (and fading) animations run at 4/3 speed, so the board is held 25% less time.
- A new moon is three times as likely to come up on a spot over a column holding a crate.
- A crate that comes in while no moon is up brings a moon up with it.

In every mode, moons no longer keep incoming crates off their cells, and ants eating inside a moon
no longer add to its claw count (the test build does both; replays recorded before each change
keep it). History and best scores are kept apart for Den and Den
(Exp). The old Werewolf art and Moons toggles are gone: saved Gauntlet settings with moons on (keeping
their moon limit), and
the initial local Werewolf mode, open as Den. Replays recorded with the toggles still play back
with them.

## What the test build adds

The Werewolf Isle variant adds a Werewolf board with moon targets. Existing fruit, special
generation, gravity, rotations and crate points keep the same rules. The board reports clears
and ant bites to the moons and keeps incoming crates off moon targets (the site only does this
for older replays; see above). The expanded piece/crate
sheets retain every original tile pixel.

## Implemented rules

- Start with one moon on a random, crate-free 2×2 area, using the board's Java-compatible RNG.
  Moon positions stay fixed when pieces rotate or fall.
- Every nonempty, noncrate clear within a moon adds one charge. Four charges fire it.
  Repeated clears of the same coordinate count. Ant bites charge moons too (the site only does
  this for older replays; see above).
- Moons age once per move that clears pieces anywhere, expire after four such moves,
  and respawn after two or three clearing moves, with at most the selected number present.
  Ant bites and
  the moon beams themselves do not advance that age/spawn clock.
- Check charged moons after gravity, crate collection and matches, before crate placement.
  A firing moon beams along both of its rows to each side of the board and down both of its
  columns to the bottom (from build `20261017062155`; earlier builds fired four diagonal rays
  that bounced once). Beams pass over crates without blocking or clearing them, can charge
  another moon, and clear specials without activating them.
- The wolf replaces piece 7's monkey graphics and animation, keeping the same 5×5 refill
  and crate exclusions. Its throw origin is clamped two cells from the board edges.
- The game's own moon appearance, phase, charge, expiry and beam effects, piece whitening,
  wolf animation, forest background, treasure crates and sounds are used (sounds converted
  to MP3 to match this application's audio format).
- Moons appear at full strength; each new phase shows at full strength for 250ms, then fades
  over 250ms to 60%. A firing moon fades from 60%. From `20261017062155` the claw marks do the
  same whenever their count (or the moon's phase) changes.
- From `20261017062155`: every scoring move howls (`chest_howl`) and the Werewolf intro plays on
  the first game only. Practice omits the continuous night ambience.
- Moon snapshots are kept per animation step, and birth times are tracked during replay seeking.

## Not reproduced

Crate request timing, size ratios, round length, labor budget and duty rating on Werewolf Isle
are decided by the isle itself and can't be read from the installed game. The toggles use the
simulator's existing Gauntlet session rules: they give the board's mechanics and presentation
for practice, without claiming to match the isle's session rules.

## Practice chest timing

Normal and paced Gauntlet delivery require two valid moves and a one-second delay that starts
on the first move. The second move counts while the delay runs. On a clear opening board,
click, click, wait one second, click therefore lands the first chest on click three. If the
second click itself arrives after the delay, that click can deliver it.

The move that lands a chest finishes that delivery. The next valid move starts a fresh delay
and counts as the first move toward the next chest; moves while a delivery is blocked do not
prepay the next chest. Normal board-space, chest-size and nine-chest budget restrictions apply.
Older replays retain their original timing under simulator versions 1–4. Versions 5–6 use a
two-second overlapping delay. Version 6 also saves the selected moon limit. New recordings
use version 7 with the one-second overlapping delay.
Replays from versions 1–5 retain the original two-moon limit. One- and two-moon games keep
separate history and best scores.

The installed client was checked through `PuzzleController`, `DutyPuzzleController`,
`ForageController`, the Forage input delegate, crate spawner and `ForageBoard`:

- Duty progress is sent at a two-second interval (`wu()` and the controller's ticker).
- Forage receives bonus requests separately, queues them and synchronizes them with valid
  moves (`ForageController.p(byte)` / `v(byte)` in the October client).
- The spawner checks the delivered bonus during board settling, clears it when a chest lands,
  and retains it for another attempt when placement is blocked.
- An empty board's placement chance is 100% if a suitable position is clear. Crates, tools,
  ants and moon targets can obstruct a position, and fuller boards can fail the chance check.

The downloaded client does not include the server's eligibility rule. Its progress interval
does not establish a fixed server delay or the number of moves needed for a request. The
overlapping delay above implements the requested practice cadence; it is not a verified
reconstruction of server scheduling.

## Verification

`scripts/parity/WerewolfForageParity.java` drives the test game's own board, dropper, matcher,
scorer and moon helpers. Its fixture covers six seeds/difficulties and 1,200 moves, checking
moon state after every move, points, combo counts, crate state and board checkpoints.

```powershell
npm test
npm run build
```

To regenerate the fixture from `D:\Documents\PP_Clone`:

```powershell
$forageJava = 'tools/jdk21/jdk-21.0.12.1+1/bin'
$forageJar = (Resolve-Path 'C:/Users/jared/AppData/Local/Test Puzzle Pirates/app/code/yo*-dop.jar').Path
& "$forageJava/javac.exe" -cp $forageJar -d run/forage-parity scripts/parity/WerewolfForageParity.java
& "$forageJava/java.exe" -cp "$forageJar;run/forage-parity" WerewolfForageParity > src/puzzles/forage/werewolf-parity.json
```

Unit checks also cover ant charging, moon ageing, beam shape and chaining, crate exclusions and
the wolf throw origin, independent art/mechanics switches and unchanged Gauntlet chest delivery
and scoring with the new art. Integration tests cover all four toggle combinations,
settings migration, completion, pause/resume, saving, playback, seeking, Stop, separate history
and treasure report icons.
