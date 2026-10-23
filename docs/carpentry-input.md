# Carpentry pickup and adjustment audit

Checked against the installed live client build **20261023101853**, on 23 October
2026. `yoclient-dop.jar` SHA-256:
`a6ea9ae40fdf2fb04a3baa01d5aa773f5fb36d8bd3e5648fbcc47fba38668fe7`.
The older test build 20261021095321 has the same relevant rules.

The previous mouse-event-order correction did not cover every pickup difference.
This audit checks the three input paths separately.

## Rapid repeat-click safeguard

The reported triple click is reproducible: the first click places a plank, the
second picks it back up and the third places the adjustment, locking it. Input
ordering and pickup bounds alone do not prevent this sequence.

New sessions require a **250 ms quiet period** before mouse-picking up a freshly
placed plank. Further clicks on that plank within the period are ignored and
restart the period, so an entire rapid burst is suppressed. Their releases cannot
complete an adjustment. After the burst, a deliberate pickup and adjustment work
normally. Toolbox selection, rotation and placing held pieces remain responsive.

This is an explicit practice safeguard, not a verified native Carpentry timing
constant. Treasure Haul's 250 ms swap animation provides an analogous input gap:
its active animation prevents another swap. No equivalent explicit timer was found
in the inspected Carpentry listener/controller or media-panel dispatch paths.
The earlier listener probe did not test a full in-game triple-click interaction.

## Native pickup and adjustment rules

| Input | Native client behaviour | Correction |
| --- | --- | --- |
| Click and release a placed plank | The mouse listener picks it up if the press lies anywhere in the sprite's bounding rectangle, including blank corners and the extra outline pixel. Releasing without a drag keeps it held. | Use pixel bounds instead of testing only the plank's occupied grid cells. |
| Drag a placed plank | A drag starts after **more than 15 pixels** of movement while pressed. Release places the adjustment. | Accept the same bounding rectangle when starting the drag. Keep the 15-pixel threshold. |
| Place key | The controller's `place` action places the held piece, or commits the tentative placement and takes the selected toolbox piece. It does not run the mouse listener's pickup branch. | Call the controller click action with the mouse-only restriction disabled. |

If a picked-up adjustment is cancelled by taking another toolbox piece, the client
restores both its original orientation and its original cursor position before
selecting the next tool. The port previously restored only the orientation.

No explicit timed adjustment grace period was found in these native methods. A normal placement stays
adjustable until another piece is taken. Putty, a hole-finishing placement, and a
completed adjustment commit immediately. Waiting while a plank is held does not
commit it.

## Evidence and checks

In this live build the relevant native classes and methods are:

- `carpentry/z.mousePressed`: bounding-rectangle pickup through `r.x(int, int)`.
- `carpentry/z.mouseDragged` and `mouseReleased`: distance threshold and release action.
- `CarpentryController.x(ActionEvent)` and `b(boolean)`: the separate place-key path.
- `CarpentryController.t()`: restoration before committing a cancelled adjustment.
- `carpentry/r` and its sprite superclass `media/b/l`: rectangular pixel hit bounds.

A probe in `scripts/parity/CarpentryInputProbe.java` executes the installed client's actual mouse listener and keyboard
dispatcher, with rendering/grid movement stubbed and placement callbacks observed.
It confirmed: click-release-move makes no placement callback; distances 14 and 15
make none; distances 16 and 18 make one on release. The results were identical at
1, 100 and 1,000 milliseconds. A bounding-corner press picks up the sprite, while
the keyboard dispatch calls the controller directly with `mouse=false`.

The probe targets the live build's obfuscated class names. Compile with Java 21 or
newer against the client's `app/code/*` jars, then run the class
`com.threerings.piracy.puzzle.duty.carpentry.CarpentryInputProbe` with the compiled
output and the same jars on the classpath, and `-Djava.awt.headless=true`.

`src/puzzles/vampire-carp/input.test.ts` checks click-release, drag, outline bounds,
keyboard selection and placement, cancellation, and distance versus elapsed time
in both ship and Vampire Lair carpentry. Integration tests check actual key routing
and playback/seeking of older input semantics.

New recordings use simulator version 5. Version 4 retains the corrected pickup
bounds and place-key path without the repeat-click safeguard. Versions 1–3 retain their original pickup
bounds, place-key behaviour and cancellation position. Versions 1–2 additionally
retain the older mouse-event order.

Carpentry recordings retain intermediate cursor samples. Crossing the drag
threshold and returning before release still counts as dragging, and hover can
change the toolbox selection used by the place key. Dropping these samples caused
the full takeover/replay test to drift after the keyboard correction.
