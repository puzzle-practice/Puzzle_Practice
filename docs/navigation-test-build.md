# Duty Navigation (Werewolf Isle test build)

## Try it

Open <http://localhost:5212/#/navigation>. **Dennav** is selected initially, with difficulty 4,
wild targets and the extra ring enabled, matching the Werewolf Isle testing options.
**Old Dennav** retains the previous rules. **Dennav** uses the current test-client rules (build `20261024072802`, October 24). Each board starts with 1 inner, 2 middle and 1 outer target, then uses the usual 3/2/1 layout. Charting counts toward wild-target charging, and charging continues through new constellations in the same action. Both Dennav modes share the ring and wild-target options, with separate history and replay settings.

**Normal** uses three rings and ordinary colour-specific targets. Choose difficulty 0–9,
an optional 2- or 5-minute practice timer, and the independent Dennav options in Settings.

Up/Down selects a ring, Left/Right rotates it, and Space speeds up the incoming star.
Keys 1 to 4 select a ring directly, 1 being the innermost.
Click another ring to select it; clicking the selected ring rotates it clockwise
(right-click rotates counterclockwise). Buttons provide the same controls. Escape pauses.
The clock and replay exclude paused time. Settings > Controls lets you remap the keys.
In either Dennav mode, and in any quota run, Dismiss deals a fresh board inside the same run:
the score, statistics, timer and constellation count carry on, and the run is saved (one
history entry and one replay) when it ends. Later boards come from the run's seed, so the
replay deals them too. Otherwise in Normal, Dismiss saves the active run and starts a fresh
one. After Dismiss, play holds for the dismiss delay (1 second by default, 0 to 3 seconds
under Settings > Mode > Game) before the next board or run begins; when the run carries on, its timer keeps
counting. Start begins a new timer after time runs out. Dennav uses the 2-minute timer by default;
the Timer setting under Settings > Mode > Game offers No timer, the quota run (named for the
difficulty's quota, 13 clears at difficulty 4) and 2 or 5 minutes.

A timed run or a quota run ends when its difficulty's constellation quota is reached.
With No timer, constellations keep coming past the quota. Any run also ends when the entry
is blocked, the optional practice timer expires, or Stop is pressed. History separates modes,
difficulties, Dennav options and timers. Replay files include the seed and all settings,
support playback and seeking, and never add another score when watched.

## Freeplay mode

Boards → Freeplay (with any Mode) is a sandbox for showing a setup to someone else. Start it, then hold B, O, R, W or Y over a cell to paint a blue, orange, red, white or yellow star, X to clear one, or select one in the Board panel and click or drag. Stars settle inward as they would fall, without clearing. Paint → Targets paints the constellation instead, in the three innermost rings, and A makes a target wild. Next star and Drops at set the incoming star. Each star waits at the top until Drop, and rings turn as usual. Back to setup puts the board back as it was last painted. Freeplay has no timer or quota and keeps no history.

A note says when the board could not come from the game: three or more stars in a row (they'd have cleared), a constellation already charted or missing, a target count no constellation has (Old Dennav always deals 3 inner, 2 middle and 1 outer; Dennav opens with 1/2/1, then uses 3/2/1, with an extra wild inner target when charged), wild targets without the mode's wild targets enabled, or an incoming star with nowhere to land. Copy and Paste share boards as text: `N` and the ring count, then the cells ring by ring from the outside, the targets, and the incoming star (see `create.ts`). Generate deals a new board.

## Implemented rules

Old Dennav retains test build **20261018210340** (Old Dennav dense constellations arrived with it;
the rest is unchanged since `20261014053332`, and the Old Dennav mechanics first appeared in
`20261012032517`).

- Eight compass points per ring; stars fall inward after a drop or rotation.
- Independently shuffled ten-star bags, two of each of five colours, for incoming stars
  and targets. Both use the game's Java-compatible RNG, including its Gaussian target
  distribution. Difficulty and completed constellations advance that distribution.
- Constellations occupy the innermost three rings, including on the four-ring board.
- Old Dennav constellations are dense: every one has three targets in the innermost ring, two in
  the next ring out and one in the third, whatever the difficulty or progress (plus the
  extra wild target when it applies). No Gaussian draw is made for them. Normal keeps the
  difficulty distribution. Navigation replays of Old Dennav runs recorded before `20261018210340`
  play out with dense constellations and so differ from what was played.
  All their targets must match simultaneously. They clear before ordinary runs.
- Equal-colour runs of at least three clear radially or around a ring, including across
  octants 7/0. Overlaps and scoring match the game, including zero points for
  unsupported or already-cleared run sizes. Cascading run scores receive chain multipliers.
- Constellation points use the game's ring-relative weights and squared per-ring counts,
  multiplied by the chain count when the constellation completes after run clears in the
  same move. A completed constellation produces the next targets before evolution resumes.
- Old Dennav wild targets accept any nonempty star. From the second run-clear pass in an action,
  cleared cells make targets at those cells or their four orthogonal neighbours wild.
  Adjacency wraps around the ring, without diagonal adjacency.
- Dropping a star or completing a rotation resets that clear-pass counter. If a
  constellation completes after a run-clear pass, the next constellation's innermost
  targets start wild. After two or more passes, an extra wild target also joins the inner
  ring at the first free octant, counting round from the first inner target (constellations
  hold up to ten targets). Completion clears old wild flags.
- Chained constellation scores and the extra wild target arrived with `20261014053332`.
  Navigation replays recorded before them are not kept compatible and may play out differently.
- The optional extra ring uses 55/102/149/196px radii on the game's own Werewolf background
  and four-ring highlight sheet (both from `20261017062155`). Normal uses 55/110/165px.
- Original directional star sheets, target outlines, ring highlights, the wild-target sprite
  (ringed in every colour, lit once filled) and sounds are included. Falling, rotation,
  gravity and clear delays follow the game's timing constants; decorative fragments
  and floating text use a simplified browser presentation.

## Dennav: October 24 changes

Checked against the test server's build **20261024072802**, downloaded on October 26, 2026. The installed client was still on October 21; the current deployment descriptor was checked before comparing. Code jar SHA-256: `f3a530e9bf7069ea937190f3b9dbf169113ad130ae1891d03cae81c72742af9d`.

- Every fresh board, including after Dismiss or Freeplay Generate, starts with **1/2/1** targets (innermost first). Subsequent constellations use **3/2/1**. Both skip the Gaussian draw; target bags and random draws match the client.
- Charting a constellation counts as a clear for wild charging. The action's count continues through charts rather than resetting at each completion. One earlier clear makes the next inner targets wild; two or more also add an extra wild target.
- After charting, further run-clear passes can charge the current constellation immediately: first its inner targets become wild, then it gains an extra wild target. Each tier applies once per constellation, so later passes cannot add repeated extras. Ordinary adjacency effects still apply from the second clear, including a chart followed by a run.
- A new drop or rotation resets the action's clear count and charted flag. The scoring chain still resets after each completed constellation, as in the client; charging and scoring use separate counters.
- Normal and Old Dennav keep their existing rules, saved settings, history keys and replay state shape. New tapes use settings schema 3, with mode `ww-test`; schemas 1 and 2 continue to play Normal/Old Dennav by their previous rules. The default is Dennav; saved mode selections are retained.
- Freeplay accepts both opening and later target layouts in Dennav, including the extra wild target on the later layout.

`scripts/parity/NavigationTestParity.java` calls the October 24 client's board, matcher, scorer and wild helper. Its committed fixture covers 4,320 generated entries/constellations, 400 match boards, 480 carryover cases, 200 scoring cases, and 960 longer sequences interleaving charts, runs, empty passes and new actions. The earlier fixture and generator remain available for Old Dennav.

Regenerate the new fixture from this worktree with that code jar:

```powershell
& ../../tools/jdk21/jdk-21.0.12.1+1/bin/javac.exe -cp <code-jar> -d <output> scripts/parity/NavigationTestParity.java
& ../../tools/jdk21/jdk-21.0.12.1+1/bin/java.exe -cp '<code-jar>;<output>' NavigationTestParity > src/puzzles/navigation/navigation-test-parity.json
```

## Not reproduced

Ship speed, the isle's moon gauge, expedition round length and official duty rating are
decided by Werewolf Isle itself and can't be read from the installed game. Practice uses the
local timer and constellation quota instead. Reports keep points and a Learning rating; no
guessed performance cutoffs or simulated moon gauge are applied.

## Verification and regeneration

`scripts/parity/NavigationParity.java` calls the test game's own board, matcher, scorer
and wild-target helper. The fixture checks 4,320 star/constellation generations across
36 seed/difficulty/ring/dense combinations, 400 match boards, 480 wild-target chains/carryovers,
and 200 constellation scoring cases at chain counts 1 to 3. Unit checks also cover gravity,
blocked entry, level completion, action resets and invalid settings. Integration checks cover
Normal and all four Old Dennav option combinations, pause, keyboard/buttons, timing, history, playback,
seeking, Stop and leaving the puzzle.

Run from this worktree:

```powershell
npm test
npm run build
```

Regenerate from `D:\Documents\PP_Clone` with the same build installed:

```powershell
$naviJava = 'tools/jdk21/jdk-21.0.12.1+1/bin'
$naviJar = (Resolve-Path 'C:/Users/jared/AppData/Local/Test Puzzle Pirates/app/code/yo*-dop.jar').Path
& "$naviJava/javac.exe" -cp $naviJar -d run/navi-parity scripts/parity/NavigationParity.java
& "$naviJava/java.exe" -cp "$naviJar;run/navi-parity" NavigationParity > src/puzzles/navigation/navigation-parity.json
```
