# Where the donkey base goes on a 3/2/1 board

Notes behind the Donkey lessons "3. Position the base" and "4. Build layer 2". Worked out from the
game's wild-target rules (`WildTargets.runs` in `navigation/logic.ts`) and checked against 300
donkeys made by the tutorial's example generator.

## Names

Ring 1 is the lesson 2 base: three pairs and the two leftover colours, `A A B B C C D E` going round.

- **D** is the leftover colour you break, **E** the one you keep.
- The combo starts at D and travels round ring 1 **away from E**: D, then the C pair, then B, then A.
  A1 is the A star next to E, B1 the B star next to A, and C1 the C star next to B.

The chain, link by link:

1. The trigger (ring 2 turned so its D sits over ring 1's D, with a D in ring 3) clears D's column
   through rings 1–3. A first clear never turns targets wild.
2. A C star drops into D's cell (it comes down from ring 4) and C C C clears (C1, C2 and D).
3. The ring 2 star over C1 drops in. It must be **B**, so B B B clears (B1, B2 and C1).
4. The ring 2 star over B1 drops in. It must be **A**, so A A A clears (A1, A2 and B1).
5. The constellation charts: a donkey.

From link 2 on, a ring 1 clear turns wild the ring 1 targets on its cells and one either side, and
the ring 2 targets directly above its cells. So before link 4:

- every ring 1 target is already wild except one on **A1**;
- the columns over A1 and A2 haven't moved and nothing in them has turned wild;
- E's column never moves before charting.

## Rule for the base position (lesson 3)

The targets don't turn; only the rings do. For a donkey, the constellation must not be complete
before link 4. So at least one target has to wait for link 4: a **waiting target**. That is one of:

- a ring 1 target on A1 whose colour isn't A (one that matches A is filled from the start);
- a ring 2 or ring 3 target over A1 or A2.

Ring 1 is in a good position when it has a waiting target. Ring 2 is in position, one turn before
the trigger, when its D sits over ring 1's E. The trigger turn then moves it one place the way the
combo travels, so D is over D.

Also, a ring 2 target over E's column never goes wild, so its colour has to be there already when
the combo goes off. If the base's E is right next to D in ring 2, it is E that sits over E at
trigger time. So a ring 2 target there must be E's colour.

The check passed on all 300 generated donkeys. Usually more than one ring 1 position works (4–7
of the 8 on most boards), so lesson 3 accepts any of them.

## Rule for layer 2 (lesson 4)

These are judged with ring 2 in its trigger position (its D over ring 1's D), whatever ring 2's
current turn:

- **The two drop-in stars:** the ring 2 star over C1 must be B's colour, and the one over B1 must be A's colour.
- **No early stacks at trigger time:** every other ring 2 star (not the base's D and E, and not the
  drop-ins) must not sit over a ring 1 star of its own colour.
- **No stacks one turn before:** with ring 2 one place back (away from the way the combo travels,
  where it sits before the trigger turn), no ring 2 star may sit over a ring 1 star of its own colour.

Not judged yet: ring 3 and 4, which must hold the trigger's third D, the C that drops into D, and the
colours of targets in the A1/A2 and E columns.
