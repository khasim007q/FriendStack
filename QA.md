# FriendStack card-game verification

Local card-game milestone and shared-hosting verification, 6 November 2026. Football's previous verification record is retained in `docs/FOOTBALL-QA.md`.

The interface remains provisional. Browser checks verify function and usability; they do not represent approval of a final visual style.

## Automated verification

The suite contains **29 tests**: 16 new card-game checks and 13 existing football/lifecycle/concurrency checks. The full suite and Vite production build passed during implementation.

Card checks cover:

- File-backed persistence across closing/reopening SQLite; password hashing; login, token expiry, and logout.
- Single-use invitation claims, canonical profile linking, author/subject-only descriptions, unauthorized access and review rejection, and exclusion of self-endorsements.
- Preserving approved powers while a revision waits; rejection keeping earlier powers; revision history and one endorsement per author/type.
- All twelve discovered types remaining represented; consensus tie ordering; approved-only superior eligibility; and the described friend's own playable character.
- Deck counts, friend ownership, copy limits, linked powers, locked reserves, and ownership of saved decks.
- Guaranteed friend in opening hands; private opponent hands and reserves; frozen kickoff definitions and persisted card versions; normal versus superior display flags.
- Summoning, resting, mana carry/income, guarded targeting, simultaneous combat, linked powers, superior upgrades and spending restrictions.
- Rotating triggered-power priority and shared round activation limits.
- Defeat-mana caps, escalating fatigue, simultaneous defeat, deadlines, match results recorded once, and disconnect/reconnect/forfeit handling.
- Late action packets cannot take a move past a turn deadline or change a result after the match clock expires; healing cannot reverse a player defeat.
- A complete bot-driven duel whose every move is chosen from the same legal-action interface used by players.
- Authenticated HTTP and WebSocket flows, invitation/approval requests, human-duel reconnects, final whistle, rematch, and host handoff.
- **Six simultaneous card rooms with twelve distinct identities**, including a reconnect, private-view assertions, complete legal duels, saved results, and cleanup.

The unchanged football tests include the **20-room / 200-player** simultaneous networking regression.

## Player-perspective browser checks

Performed through actual browser controls, using fictional local playtest identities:

- Registered two separate identities and verified separate per-tab sessions.
- Started a practice duel, summoned normal friends, selected attack targets, played through multiple turns, and observed the bot summon and attack through the same rules.
- Summoned a superior reserve at eight mana and observed its four attack/eight health and one-time use.
- Observed turn-timeout progression, fatigue, a natural health-defeat result, and saved match history.
- Created a real-style friend placeholder, chose its colour/avatar, wrote a private description, and built a taking-damage triggered shield.
- Generated an invitation, opened it as the described identity, explicitly claimed the profile, reviewed the private description, and approved the power.
- Verified the author's card updated from zero approved personal traits to the approved custom power and one shared endorsement.
- Reloaded and signed back in after development server restarts; identities, claimed relationships, approved descriptions, decks, and the completed result remained saved.
- Inspected the phone-sized collection and deck editor at 390 px; removed/re-added a friend, saved a renamed deck, and verified deck layout bounds.
- Completed a two-human browser duel using a private room code and ready checks. Played legal attacks through natural health defeat, confirmed both clients received the result, and opened a rematch with both ready states reset.
- Reloaded during that duel and retained the same seat, hand, and board. Activated a friend power through its target picker, spent mana, and drew the resulting card.
- Verified mobile home, deck builder, battle, and result layouts. Corrected a clipped power menu and measured its bounds fully inside a 390 px viewport; the page itself had no horizontal overflow.
- Corrected the development-proxy origin check, the unlocked-normal-card display, hidden mobile navigation names, claim-linked deck references, and stale-room reconnect handling found during implementation and review.

Additional final browser observations and screenshots are recorded in `artifacts/` when available.

## Shared-storage and load verification

The Vercel backend adds a real Postgres test suite covering independent instances, atomic invitation claims, all twelve traits, approval privacy/history, foreign deck protection, shared sign-out, cross-instance takeover, crash/reconnect recovery, optimistic room versions, duplicate delivery, capacity admission, concurrent joins, deadlines, expiry, persisted results, malformed traffic and shared rate limits. A practice-bot check exercises a natural duel and fresh-state rematch. The local rules and football suite remains unchanged at 29 checks.

Load tests use fictional accounts, a loopback Postgres database and a round-robin ingress into three independent runtime instances. They do not contact production or use a mocked database. Completed verification runs:

| Concurrent players | Rooms / completed duels | Confirmed moves | Duplicate packets | Confirmed-move p95 | Ping p95 |
| --- | --- | --- | --- | --- | --- |
| 200 | 100 / 100 | 7,357 | 400 | 45 ms | 35 ms |
| 1,000 | 500 / 500 | 37,123 | 2,018 | 330 ms | 151 ms |

Both runs saved one result per human participant, asserted no private-card/description leaks or unexpected protocol errors, exercised reconnects through the ingress, and cleaned all test rooms. Stale-version packets were rejected and refreshed: 3 in the 200-player run and 29 in the 1,000-player run. The large run took about 69 seconds to prepare and 261 seconds to play; the combined test/runtime process used about 950 MiB RSS. This includes the synthetic clients, ingress and three application instances in one Node process and excludes the separate Postgres processes.

These numbers describe this computer and test workload. They do not establish Vercel or Neon Free-plan capacity, geographic latency, physical-device behavior or a long soak. The schema-qualified pooler-compatible adapter passed its regression suite and a subsequent smaller load run. Vercel deployment and remote smoke checks are recorded separately once complete.

## Remaining release checks

This is the local milestone, not a hosted beta. Network tests run on one machine. Phone layouts are tested using a desktop browser viewport rather than physical phones. Arbitrary user code and AI-invented executable abilities are intentionally unsupported: the builder uses bounded rules. The current bot is a heuristic practice opponent. Balance values need human playtesting.

Live rooms are ephemeral; persistent social and match data survive server restarts. Internet deployment, recovery email, automated backups, physical-device checks, longer soak testing, and geographic-latency testing remain the subsequent private-beta milestone.
