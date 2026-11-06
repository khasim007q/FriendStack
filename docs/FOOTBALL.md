# FriendStack · Football lab

A local multiplayer football sandbox for trying out the room and session foundation of FriendStack. The future card game can reuse the room lifecycle and WebSocket transport while replacing the football simulation.

## Run locally

Requires Node.js 24+.

```sh
npm install
npm run dev
```

Open **http://localhost:5173/football**. The frontend runs on port 5173 and proxies `/ws` and `/api` to the game server on port 3001. Both servers run with one command. The card game is at `/`.

To try multiplayer on one computer, open a second tab, enter a different player name, and join using the first tab’s room code. Every tab has its own player session. Do not duplicate an existing room tab if you want a separate player: duplicated tabs can inherit session storage, in which case the app will ask you to join with another name.

For friends on the same LAN, use the **Network URL printed by Vite** on each device instead of localhost. Invite links use the address you opened, so create the room at that Network URL when inviting another device. Your computer and network must allow access to port 5173. A localhost invite works only on your computer. Internet hosting is deliberately outside this local sandbox.

## Play

1. Enter a nickname, select a capacity from **1v1 to 5v5**, and choose a **1, 3, or 5 minute** match.
2. Create a room and share its six-character code or invite link.
3. Choose **Mint** or **Coral**. Each side has its own capacity. Uneven teams can play; both sides need at least one player.
4. Every person marks themselves ready. The host can fill empty seats with removable practice bots, then **Kick off**.
5. Move with **WASD / arrow keys**, face your shot, and press **Space** to kick. Hold **Shift** to sprint; the small bar below your player shows stamina. Run into the ball to dribble. Mobile touch devices get a joystick and shoot/sprint buttons.
6. Mint attacks right; Coral attacks left. Most goals at the final whistle wins. The host opens a rematch, and everyone readies up again.

Sound is opt-in. The help dialog explains the flow. Fullscreen keeps the pitch and controls together. Touch controls appear automatically on touch devices; you can also enable them manually in Session diagnostics.

## Session diagnostics

Open **Session diagnostics** below the pitch to see measured round-trip time, jitter, received snapshots per second, and server simulation rate. Select **+80, +150, or +300 ms** extra round-trip latency to delay outgoing inputs and pings by half that value and incoming snapshots and pong responses by the other half. This setting affects only your browser. It is a controlled latency test, not a packet loss or bandwidth simulation. Jitter is the mean absolute difference between the last twelve RTT samples.

The server simulates play at a target **60 Hz**, distributes snapshots at **20 Hz**, and validates room membership and host actions. The renderer interpolates positions between received snapshots. Scores, the timer, collisions, team capacity, and ready checks are decided by the server. Input stops after 300 ms without an update, and the client clears controls when it loses focus.

## Reconnect and room lifecycle

- A random, secret resume token belongs to each player and is kept in that tab’s session storage. Tokens are never included in public room snapshots.
- Reconnect retries use bounded exponential backoff. A player’s seat is held for **30 seconds** after disconnection. Reloading resumes the same player if the server and room still exist.
- A connected friend takes over when the host leaves or disconnects. A returning host keeps their seat but does not take hosting back automatically.
- Late arrivals wait for the final whistle; existing players may reconnect during a match.
- If the last human leaves or all human sessions expire, the room is removed. Bots do not keep a room alive.
- Rooms are **in memory**. Restarting the server clears them; expired sessions return to the join screen. This is an intentional trial environment, without accounts, persistent storage, matchmaking, voice chat, or Internet deployment.

## Checks

```sh
npm test
npm run build
```

Tests use Node’s native test runner and real WebSocket clients. They cover all room sizes, capacity, ready checks, side selection, host authorization, bots, normalized movement, sprinting, kicking, goals, match expiry, rematches, room isolation, malformed messages, secret-token handling, disconnection, expiry, and host handoff. The multiplayer integration test connects **ten clients** to an actual ephemeral game server and verifies shared state, movement propagation, ongoing snapshots, heartbeat replies, reconnection, final whistle, and a rematch.

The concurrency regression additionally runs **20 simultaneous 5v5 rooms with 200 clients**, including concurrent reconnects and independent scores, match endings, rematches, and host transfers. See `QA.md` for measured results and limits. To test five mixed-size rooms against your running local app, run `node scripts/concurrent-trial.mjs ws://localhost:3001/ws`; it creates and cleans up only its own rooms.

For a single-process local production build:

```sh
npm run build
npm start
```

Then open **http://localhost:3001**. The same Node process serves the built client and the WebSocket endpoint. Set `PORT` to choose another production port. Stop the preview with **Ctrl+C** in the terminal that runs it.

## Project map

| Location            | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `src/App.jsx`       | Player flow, lobby, match UI, help and diagnostics                             |
| `src/main.jsx`      | Application entry point                                                        |
| `src/Pitch.jsx`     | Canvas pitch, interpolation, keyboard and touch controls                       |
| `src/useSession.js` | WebSocket connection, tab session, reconnect, telemetry and latency simulation |
| `src/styles.css`    | Responsive UI, theme, dialogs and touch controls                               |
| `server/rooms.mjs`  | Transport-independent room lifecycle and permissions                           |
| `server/engine.mjs` | Football physics, bots, scoring and match clock                                |
| `server/index.mjs`  | HTTP/WebSocket transport and simulation scheduling                             |
| `tests/`            | Physics, lifecycle and network integration checks                              |

To add cards later, keep the transport and membership model, then provide a different game state and server action handler. Hidden cards must be sent in per-player views instead of football’s public snapshots.
