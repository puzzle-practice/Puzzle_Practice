# Seeded play

All 16 puzzles generate a fresh seed for each normal run. At the bottom of Settings > Mode,
Fixed seed locks the displayed seed for repeatable practice. Entering or pasting a seed, or
choosing New, turns it on automatically. Turning it off returns to fresh seeds each run.
Copy shares the current seed. Use the same puzzle, mode, difficulty, token options, timers
and other gameplay settings.

Chosen-seed runs do not change PBs or counted score histories/session averages. Their replays
can still be saved, and taking over a practice replay retains that restriction. Eligibility is
set when a run starts; changing the switch cannot make an already-started practice run count.
Play contains session actions and live stats. Puzzle options and gameplay controls live in
Settings; repeated summaries and generic headings are omitted.

Distilling keeps its decimal board/sequence formats, using Fixed seed for repeatable play.
Carpentry accepts 48-bit numeric seeds. The other puzzles accept unsigned 32-bit
seeds, including 0. A board layout in a Create mode describes the visible pieces, and does not
necessarily contain the session's future random sequence.

Seeds fix the random choices, not the player's decisions. Different Bilging swaps can produce
different refills and cascades on the current board. At the next level reset, the second board
is generated from the original session seed and its board number, so both players get the same
fresh board even if they used different numbers of swaps and reached it at different times.
Bilging, Rigging, Sailing, Navigation, Forage, Blacksmithing and Treasure Haul use this rule for
their fresh boards. Patching's independent board-seed stream advances only when it deals a board.
Weaving's next shuttle depends on its draw sequence. Gunning has one continuous deck per session.
Swordfight and Rumble use independent participant/dealer/NPC streams within each match.

Carpentry derives individual tools and holes from separate numbered streams. Generating a hole,
neglecting another hole or drawing a maneuver token cannot consume future tool randomness.
Speed mode separates hole generation from the pieces used to fill them; assistance that supplies
a piece needed by a remaining hole still responds to the player's board. Putty availability and
other game rules still apply. Alchemistry gives each bottle column its own sequence, independent
of tube refills. Shipwrightery separates replacement-pattern randomness from material draws;
the game's rules still favor materials/patterns according to the current available patterns.
Blacksmithing and Treasure Haul separate sounds/particles from gameplay draws. Forage has separate
per-board crate, board and animation streams, including animation durations that affect readiness.

The browser host runs a fixed 60 Hz simulation timeline. A slow render runs the missing logical
steps; it does not replace them with a larger game update. Browser input, including pointer
movement, is timestamped and delivered only when the simulation reaches it. Late-frame catch-up
retains its backlog. Panel actions first catch up to their logical time. Replays continue to use
their original recorded step/input timeline. Identical seeds, gameplay settings and actions on the
same simulation ticks therefore follow the same gameplay path irrespective of display refresh
rate. Human timing can still differ, and different game versions can change a seed's result.

Games use a small TypeScript generator with integer operations and JSON snapshots
(`xoshiro128ss-v1`). There is no Python runtime, Python-compatible generator, or Python fixture
script. Replays must record `randomVersion: 1` to play or import; recordings without that marker
are unsupported. Existing score history and saved reports remain available. Explicit board and
piece-sequence formats remain accepted, but numeric seeds from older releases need not deal
the same game.

Regression coverage includes all 16 seed controls, divergent Bilging play followed by a matching
reset, Carpentry tool/hole independence and native Speed play, bottle/pattern stream independence,
snapshot restoration and rejection of removed-generator replays, and Swordfight/Rumble
state/score/end-time comparisons at 30, 60 and 144 render Hz with stalls.
