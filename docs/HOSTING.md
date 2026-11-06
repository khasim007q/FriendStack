# Vercel deployment and shared rooms

The visual interface is provisional. This stage changes hosting and session correctness, not the visual design.

## Runtime

- Vite serves the client through Vercel's CDN. `api/server.mjs` exports a Node HTTP/WebSocket server on Fluid Compute.
- Postgres is mandatory online. Accounts, hashed sessions, relationships, approvals, decks, frozen card versions, full room state, connection leases and results live in the shared database.
- Vercel distributes new requests and connections. Connections can reach different instances; the game needs no sticky cookie or room-to-process affinity.
- Each mutation locks its room row. A separate transaction advisory lock serializes changes for the same identity across rooms. State, memberships, frozen definitions and results commit together.
- Human actions carry a room version and request ID. Stale moves refresh the player's view; duplicate deliveries do not repeat spending or damage.
- Each active instance polls versions in a batch every 250 ms and sends each connected player a permitted snapshot. Opponents' hands, reserves and private descriptions are excluded. Confirmed actions return immediately to the acting player; another instance normally sees them on its next poll.
- Database pools allow three connections per instance. Use the provider's pooled URL, and place the Function region close to the database. Capacity is bounded by the database, plan quotas, instance count and workload, not only by Vercel's autoscaling.

## Provision and deploy

1. Push the reviewed source to `https://github.com/khasim007q/FriendStack` on `main`.
2. Import that repository in Vercel, or deploy its commit into the existing FriendStack project. Choose Vite, Node 24, and Fluid Compute. Keep the project's deployment-protection settings during verification.
3. Add Neon Postgres through Vercel Storage/Marketplace. For trials use the provider's Free plan. Connect it to the intended environment so `DATABASE_URL` is provisioned. Keep Preview and Production databases or branches separate before inviting real users.
4. The Vercel build runs `npm run db:migrate` before building the client, using that environment's server-only database credentials. The migration is additive, idempotent, and transaction-locked. For an authorized manual migration, use an ignored `.env.local` and the same command. Never put the URL in Git, screenshots or chat. Production/Preview Secrets may be write-only and do not need to be pulled locally.
5. Build and deploy. `vercel.json` routes the HTTP API and `/api/ws/cards` to the exported server. Function duration is capped at 300 seconds to remain compatible with Hobby; clients reconnect with jitter and reload their shared state.
6. Verify `/api/health` returns `{ "ok": true, "mode": "shared" }`. Test two distinct identities on separate devices through the real deployment URL before treating it as a released beta.

Local data is deliberately **not uploaded**. Online identities start in the new Postgres database. The local SQLite game and football test lab remain available with `npm start`; the football simulation is not distributed by the cloud card backend.

## Deadlines and outages

Turn and match deadlines are persisted absolute times. Actions reconcile the clock before making a move, so a delayed packet cannot extend a turn. Active sockets drive bounded, transaction-safe sweeps. A resumed request also reconciles overdue rooms. If no Function is active, elapsed deadlines still apply; results are materialized on the next sweep or request.

For prompt cleanup while every player is offline, an authorized scheduler may call `/api/maintenance` with `Authorization: Bearer <CRON_SECRET>`. No paid or high-frequency Cron configuration is enabled automatically. A short-duration scheduler depends on the hosting plan; deferred materialization does not grant extra play time.

Connection leases last 15 seconds and are refreshed by clients. Failed processes cannot hold seats forever. A lost lease uses its last-seen time when applying the 30-second reconnect allowance. A new connection takes over the identity globally; an older connection's close event cannot disconnect the newer one. In-flight transactions roll back after a crash, while committed moves survive a change of instance.

## Checks

```sh
npm test
npm run test:cloud
npm run test:load -- --rooms=100
npm run test:load -- --rooms=500
npm run build
```

For an explicitly requested, small live smoke test, run `node scripts/smoke-online.mjs --base=https://YOUR-DEPLOYMENT`. It creates two clearly fictional trial identities with random passwords, plays a duel, checks privacy/reconnect/results, leaves the rooms and revokes its sessions. It is never run automatically against a deployment by CI. Current live trial: https://friendstack.vercel.app .

Cloud/load checks start a real, temporary Postgres database bound to loopback. They never use `DATABASE_URL`, cloud accounts, production rooms or a mocked database. Load traffic passes through a test-only round-robin ingress into three independent runtime instances. JSON reports are written to ignored `artifacts/`. GitHub Actions runs rules/network tests, shared-storage tests, a build, dependency audit and a 50-player load smoke test on pushes and PRs; extended load runs are manual.

Measured loopback results are not a production capacity commitment. Record Vercel-region latency, real device reconnects, database utilization, provider quotas and extended soak results after deployment. Raise `MAX_CARD_ROOMS` only after measuring the actual environment.

## Operations before a broader beta

Enable the database provider's backups or point-in-time recovery, and perform a restore into a separate database before relying on them. Store secrets in Vercel environment variables. Add account recovery before onboarding people who cannot replace their trial identity. Preserve schema compatibility across rolling deployments; a rollback must not use an incompatible room protocol. The current room protocol is version 1. Platform deployment protection is distinct from the app's own sign-in.
