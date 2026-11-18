# Voyage debug exports

Debug mode shows a preview before copying or downloading a single voyage. All three use the same positive list of event types; unrecognised lines are omitted by default.

Included:

- Dates, timestamps and the selected voyage's arrival message.
- Fray starts, pirate and enemy elimination messages (including multiword and numbered NPC names), winners and survivor counts.
- Combat-start team sizes or participant lists, knockouts and team outcomes, for all three voyages.
- Station-period warnings used by the parser, such as rustling in coffins.
- Woodhallow transformation counts, wave/foraging timers, individual abandonment, officer retreat orders and return-to-vessel announcements.
- Cursed Isles forage/wave transitions, boarders disembarking, thrall gain/loss and both recall-order wordings.
- Vampire Lairs recall orders and the return-to-ship announcement.
- Chests taken aboard or reclaimed, including combined reports listing several chest types.
- Victory, defeat, retreat, return and crew-recall events.
- Booty division and vessel departure, which stop the parser reading further loot.

Vessel names and free-text suffixes on recognised retreat/return markers are removed. Date headers are generated from parsed numeric dates. Pirate and NPC names needed to reconstruct the crew and frays remain. The original filename and local file path are not included in copied or downloaded content. Download names contain only the voyage, ocean and timestamp.

Chat, tells, crew/flag chat, broadcasts, login/logout notifications, busy responses, puzzle feedback, unknown messages and untimestamped text are omitted. An unfamiliar event must get an explicit rule and a regression test before it can be exported; never add a general free-text fallback. Reconstruction tests cover all three voyages.

Each export starts with a diagnostic summary written as `#` comments, so it can still be read by the voyage parser. The summary contains the current parsed voyage, ocean, crew size and identified pirates; chest totals and score formula; recorded frays, inferred/observed wins, losses, survivors and deaths; winner-list pirate counts; and elimination counts and names outside the inferred crew. Those outside the inferred crew may be NPCs or unidentified pirates and are evidence for manual review, not automatically added to the crew.

Run length is measured from arrival to the last included voyage event. A departure or booty-division marker confirms the endpoint; otherwise it is labelled a recorded span that may be shorter than the full voyage. Missing dates produce an unknown duration, and later private chat never extends the displayed span. Times are the chatlog clock, whose timezone is not recorded. Checks call out inconsistent crew counts or scores, missing start/end evidence, and wins inferred across log gaps. These are parser diagnostics, not verified records.

The summary also includes combat-start team sizes in the original side order, the run's exclusion status under the current global-record rules, and counts of kept/omitted timestamped events. Combined chest reports and retreat evidence missed by the current result parser are highlighted for review. Exporting extra evidence does not automatically change the existing crew/loot calculations.

The additional event formats were checked against the local English game message bundles (`client/werewolfisle.properties`, `client/vampirelair.properties`, `client/cursed.properties`, `sea/seamonster.properties`, and the general/sword/boxing puzzle bundles). Flavour dialogue, ordinary puzzle feedback and general login/logout messages remain excluded.

Individually ignored runs still count toward the voyage count, chest totals, chest share and expected familiars. They are excluded from the history table, personal records and record submissions. Users can restore them from Ignored runs.
