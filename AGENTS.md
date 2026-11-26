# Product copy preferences

- Jared strongly dislikes unsolicited AI-generated text dumps and copy that talks down to the player. Assume the player is capable.
- Keep the default play interface quiet. Do not add instructional paragraphs, repeated explanations of obvious controls, or commentary explaining a successful action.
- Show concise, specific feedback when an interaction calls for it. Let players request hints and explanations instead of showing them by default.
- Longer instructions are intended for a future optional `(i)` card, which Jared will add separately. Do not add that card or replacement help text unless requested.
- Keep tutorial presentation and ordinary play behaviour consistent with the main puzzle unless a difference is needed for a specific drill or explicitly requested.

# Buttons must not flash

- A button's `disabled` check must never depend on a move or replay playing (`busy()`, `scenes`, `replaying`, `waiting`, or a helper that reads them). Those flip on every move, so the button flashes.
- Base `disabled` only on state the player can see change, such as a board to step through or a mistake already found. Have the button's handler ignore a press while a move plays, or stop the playback first.
- `src/puzzles/dennav-tutorial/steady-buttons.test.ts` fails on any `disabled` check that breaks this rule. Keep it passing when adding buttons.
