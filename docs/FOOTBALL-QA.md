# Football sandbox verification

Verified locally on 5 November 2026.

## Automated checks

- `npm test`: 13 passing tests, including ten independent live WebSocket clients in a 5v5 room and a 20-room, 200-player concurrency test.
- `npm run build`: Vite production build succeeds.
- `npm audit`: no known vulnerabilities reported at installation.
- The frontend and backend health endpoint respond locally. The Node server also serves the production bundle.

The integration test verifies shared ten-player rosters, ready state, host-only kickoff, full-room rejection, movement reaching every peer, ongoing snapshots, heartbeat, token-based reconnection during play, final whistle, rematch reset, and host transfer. Separate tests exercise room isolation and malformed and forged messages. Physics and room lifecycle checks cover scoring, shooting, stamina, bounds, stale inputs, expiry, and capacity from 1v1 to 5v5.

## Browser checks from the player's perspective

Performed through the visible app and actual controls:

- Empty nickname validation focuses the input and explains the error.
- Created rooms with 1v1, 2v2, and 5v5 capacities.
- Joined using a separate browser tab and a different nickname. Both tabs showed the same room and roster.
- Changed sides as a guest. Capacity and the chosen side updated in both tabs.
- Marked players ready, added practice bots to empty seats, and started a match as host.
- Verified the countdown, live timer, keyboard movement, ball interaction, final whistle, and rematch.
- Reloaded the guest tab and rejoined the existing room as the same player, without taking an extra seat.
- Enabled +150 ms simulated RTT and observed a measured RTT of approximately 155 ms, with 19 snapshots per second in that sample.
- Tested a 390 px phone layout, with no horizontal overflow. Inspected both the pitch and room controls at that width.
- Enabled on-screen touch controls, exercised the joystick and shoot button, and ran a full 5v5 practice room.
- Opened help during a match, dismissed it with Escape, and entered and exited fullscreen.
- Checked room codes, copy/invite controls, leave confirmation, session activity, and diagnostics.
- Corrected a development-only React root remount warning by separating the app component from its entry point.

## Concurrent room verification

Added a repeatable concurrency regression test and ran it together with the complete test suite. Also ran a separate trial against the already-running local app. The measurements below cover a 10-second active input window after room setup and kickoff.

| Trial                                                 | Simultaneous rooms | Players | Median RTT | 95th percentile RTT | Snapshots per client per second |
| ----------------------------------------------------- | -----------------: | ------: | ---------: | ------------------: | ------------------------------: |
| Separate test server; all rooms 5v5                   |                 20 |     200 |    20.4 ms |             35.0 ms |                            16.5 |
| Running app; one room each of 1v1, 2v2, 3v3, 4v4, 5v5 |                  5 |      30 |     0.8 ms |              2.1 ms |                            16.5 |

- No unexpected disconnects or cross-room state leaks occurred in either active input window.
- Twenty players reconnected concurrently in the 20-room test; five reconnected concurrently in the running-app trial. Each returned to their original room and player ID without consuming another seat.
- The 20-room regression verifies that scoring, final whistle, rematch, and host transfer in one room leave the others independent. It also rejects using one room's credentials to resume in another room.
- All test-created rooms were removed. The running app reported one existing room before and after its trial. No actions were sent to that existing room, and the server was not restarted.
- The snapshot target is 20/s; the observed rate was approximately 16.5/s on this Windows host. These results do not establish a 20 Hz delivery guarantee. The isolated 200-player trial runs its load generator in the same Node process as its server, so its RTT includes that shared event-loop load.

The live-trial machine-readable summary is in `artifacts/concurrent-live.json`. To repeat the isolated regression, run `node --test tests/concurrent-rooms.test.mjs`. To repeat the mixed-size trial against a running local server, run `node scripts/concurrent-trial.mjs ws://localhost:3001/ws`. The latter command creates and cleans up only its own rooms.

## Scope of these results

These checks demonstrate a local sandbox, not Internet performance or a long-running soak test. Concurrent networking was tested with independent socket clients on one machine; the visible human-player browser flow used two tabs. The phone layout and on-screen controls were tested in the desktop browser, not on physical phones. Packet loss, sustained bandwidth limits, hostile public traffic, external NAT/firewall behavior, and real geographically distributed players have not been tested. No production deployment or persistent room database is configured.
