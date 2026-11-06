# FriendStack · Your people. Your power.

A tactical card game where you and your friends are the characters. Shared endorsements shape a friend's base powers; personal, approved descriptions make each relationship's version different. It has an offline-friendly local server and a shared Postgres backend prepared for Vercel.

**UI status:** The current interface is a temporary functional prototype for testing the game and social flows. The final visual design has not been decided; styling will be established with the user in a later stage.

**Online hosting:** See [the hosting guide](docs/HOSTING.md) for Vercel, required Postgres provisioning, shared authoritative rooms, reconnection, deployment checks and operational limits. This repository does not contain live credentials or local playtest data.

## Start

Requires **Node.js 24+**. SQLite is provided by Node; no separate database installation or external AI service is needed.

```sh
npm install
npm run build
npm start
```

Open **http://localhost:3001**. The built client, authenticated HTTP API, card WebSocket server, and football lab run in the same process. Football is still available at **http://localhost:3001/football**.

For development, run `npm run dev` and open **http://localhost:5173**. This starts the game server plus Vite with HTTP/WebSocket proxying. Stop the server with Ctrl+C. `PORT` changes the production server port; `CARD_DB_PATH` changes the database file location.

## Your first duel

1. Select **Meet your first deck** and create an identity with a name, unique username, and password of at least eight characters.
2. Three **clearly fictional** starter friends—Maya, Rio, and Noor—come with approved sample powers and a valid 12-card deck. Your own character also appears in your collection.
3. Choose **Practice with a bot**, or **Create a table** and share its six-character code. A second player signs in with their own identity, chooses their own saved deck, and joins the code.
4. For a human duel, both players ready up and the host starts. Solo duels start immediately and may include your pending draft abilities.
5. Play a friend from your private hand. Newly summoned friends rest until your next turn. Select **Attack** or **Powers**, then choose a highlighted legal target. Linked power-up cards require their friend on the board.
6. End your turn before its 30-second deadline. Mana carries over and grows by two on subsequent turns, up to ten. Defeating opposing friends gives limited bonus mana.
7. Reduce the other player's 30 health to zero. An eight-minute limit decides by remaining health; equal health or simultaneous defeat is a draw. Results appear in **Match history**.

For two players on one computer, open the URL in a **new tab** and sign into a different identity. Sessions are stored per tab. Duplicating a signed-in tab may copy its session: opening the same identity in another window transfers that identity's connection rather than creating a second seat. Reloading resumes an existing seat during its 30-second reconnect window.

For another device on your LAN, open the server's LAN address on port 3001. Create invitations from that address so they are useful on the other device; localhost links work only on your own computer. Online rooms use eight-character codes; local rooms use six.

## Real friends and private perspectives

- In **Your circle**, add a friend, select one of twelve trait types, write a personal trait name and private description, and design a bounded ability.
- Abilities have a trigger, effect, target, and strength. The builder and server enforce the same rules. All discovered types remain represented; new traits do not rotate older types out.
- Invite the real friend using a random, single-use, seven-day link. They sign into their own identity, inspect the invitation, and explicitly claim the profile. A matching name alone cannot claim it.
- Claiming links the placeholder to the account's canonical character. The creator's relationship, histories, and saved deck references continue to work.
- The described friend sees pending revisions under **Approvals** and can approve or decline them. Only the author and described friend receive private descriptions, including their history.
- A pending edit does not replace an earlier approved version. Opponents see the approved public trait name and gameplay ability only when the relevant card becomes public.
- Approved contributions count once per author and trait type. The two most-endorsed types form the shared base; catalogue order breaks ties. A personal type replaces the shared version of the same type on that relationship's card, avoiding duplicate powers.
- Your own playable character uses approved descriptions received from friends. Self-endorsement is disallowed.
- Three approved personal types unlock a superior reserve for that relationship. The friend's own character can develop through approved incoming types too.

Fictional starters are explicitly marked sample data, so their sample revisions can be approved automatically. Real profiles always use the described person's review flow.

## Decks and battle rules

Decks contain **six friend cards**, at least **three distinct characters** and no more than two copies each, plus **six linked power-ups**. The deck builder validates counts, ownership, links, and superior eligibility before saving and again at kickoff.

| Rule                 | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| Player health        | 30, separate from card health                                  |
| Turn / match limit   | 30 seconds / 8 minutes                                         |
| Board                | Three friends per player                                       |
| Opening hand         | Three cards, including a guaranteed friend                     |
| Starting mana        | Host 3, second player 4                                        |
| Subsequent own turns | Draw one; gain two mana; unused mana carries; cap ten          |
| Defeat reward        | One mana per opposing friend, at most two each turn            |
| Normal friend        | 3 mana; 2 attack / 5 health                                    |
| Activated power      | 2 mana and the friend's action                                 |
| Linked power-up      | 2 mana; heal 2, shield 2, attack +2 this turn, or guard        |
| Superior reserve     | Summon for 8 or upgrade a matching friend for 5; once per duel |

Friends attack or activate once on their own turn. Unit attacks exchange damage simultaneously. Guarding units must be targeted before their player or other units. Guard lasts until the unit owner's next turn; shields absorb damage. Upgrades preserve damage taken, action state, shielding, and round ability usage.

Every friend has **one ability activation per round**, shared by triggered and activated powers. Competing triggered powers use a deterministic rotating cursor visible through the card's powers and battle log. Normal activated abilities have a three-point budget and triggered abilities a two-point budget. Damage, healing, shielding, and mana use one point per strength; draw, attack boosts, and guard use two. Superior damage, healing, and shielding gain one strength. Ability-generated mana is capped at three per player turn. These are initial playtest balancing values, not a claim of competitive balance.

Drawing from an empty deck inflicts increasing fatigue damage. Disconnects hold a seat for 30 seconds, then forfeit. Manual departure from a live duel also forfeits. The bot chooses through the same legal-action interface as humans.

## Persistence and transport

SQLite lives at **`data/friendstack.sqlite`**, with WAL journaling. The ignored `data/` directory contains accounts, hashed passwords, hashed session/invite tokens, friend profiles and canonical links, relationships, trait revision history, approvals, saved decks, immutable kickoff card versions, and match results. Stop the server before copying the data directory for a manual local backup.

Live rooms are in memory. Restarting the server clears rooms but retains social progress, accounts, decks, versions, and results. A reconnect to a restarted server returns to the collection instead of displaying an obsolete table. Automated tests use separate in-memory or temporary databases.

Authentication uses salted scrypt password hashes and opaque, seven-day bearer sessions. Tokens stay in each tab's session storage and are never placed in WebSocket URLs. Card sockets authenticate their first message; actions re-check the session. Account registration/login are rate limited. This is a local alpha: public hosting, TLS deployment, recovery email, automated backups, and remote-device acceptance testing remain beta work.

The card API lives under `/api/cards`: authentication, `/me`, `/friends`, trait revisions, invitation lookup/claim, review, and `/decks`. The card transport uses **`/ws/cards`**; football retains **`/ws`**. A human sends only a server-issued legal action ID. The server owns hidden draws, mana, health, clocks, targeting, triggers, and outcomes. Each socket receives its own hand and reserve plus public boards and opponent card counts. Private descriptions never enter game definitions or snapshots.

## Checks and project map

```sh
npm test
npm run test:cards
npm run build
```

See [QA.md](QA.md) for the verification record and limits. Football's original guide and test history are retained in [docs/FOOTBALL.md](docs/FOOTBALL.md) and [docs/FOOTBALL-QA.md](docs/FOOTBALL-QA.md).

| Location                       | Responsibility                                                             |
| ------------------------------ | -------------------------------------------------------------------------- |
| `shared/cards.mjs`             | Catalogue, ability validation, effects and rule constants                  |
| `server/cards/store.mjs`       | SQLite, identities, permissions, claims, revisions and decks               |
| `server/cards/duels.mjs`       | Authoritative duel rules, legal actions, triggers, bots and private views  |
| `server/cards/service.mjs`     | Authenticated HTTP/WebSocket interface and room lifecycle                  |
| `src/cards/`                   | Collection, approvals, ability builder, decks, battle UI and illustrations |
| `src/App.jsx`, `src/Pitch.jsx` | Original football lab                                                      |
| `tests/cards-*.test.mjs`       | Persistence, permissions, game rules and multi-room network checks         |
