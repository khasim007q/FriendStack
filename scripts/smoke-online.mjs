import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { api, account, socket, until } from "../tests/cloud/helpers.mjs";
import { Duels } from "../server/cards/duels.mjs";

// Explicit opt-in smoke test. Never run in CI or infer a deployment from env vars.
const baseArg = process.argv.find((x) => x.startsWith("--base="))?.slice(7);
if (!baseArg || new URL(baseArg).protocol !== "https:")
  throw new Error(
    "Supply --base=https://YOUR-DEPLOYMENT to create two fictional trial identities and play a duel.",
  );
const base = new URL(baseArg).origin,
  server = { base },
  url = base.replace("https:", "wss:") + "/api/ws/cards";
const prefix = `trial_${Date.now().toString(36)}`,
  clients = [],
  latencies = [];
try {
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "shared");
  const alice = await account(server, prefix + "_a", randomUUID()),
    bob = await account(server, prefix + "_b", randomUUID());
  const p = (
    await api(
      server,
      "/friends",
      { name: "Fictional online trial friend" },
      alice.token,
    )
  ).body;
  const description = "Fictional private online smoke-test note.";
  const trait = {
    type: "loyal",
    name: "Online team player",
    description,
    ability: { trigger: "hurt", target: "self", effect: "shield", amount: 2 },
  };
  assert.equal(
    (await api(server, `/friends/${p.id}/traits`, trait, alice.token)).status,
    200,
  );
  const invite = (await api(server, `/friends/${p.id}/invite`, {}, alice.token))
    .body;
  assert.equal(
    (await api(server, "/claim", { token: invite.token }, bob.token)).status,
    200,
  );
  const incoming = (
    await api(server, "/me", undefined, bob.token)
  ).body.incoming.find((r) => r.description === description);
  assert.ok(incoming);
  assert.equal(
    (await api(server, `/review/${incoming.id}`, { approve: true }, bob.token))
      .status,
    200,
  );
  const approved = (
    await api(server, "/me", undefined, alice.token)
  ).body.people.find((p) => p.id === bob.user.personId);
  assert.ok(approved.card.abilities.some((a) => a.name === trait.name));
  const a = await socket(url, alice);
  clients.push(a);
  let b = await socket(url, bob);
  clients.push(b);
  a.send({ type: "create", deckId: alice.boot.decks[0].id });
  await until(() => a.room, "Remote room should open", 30000);
  const code = a.room.code;
  b.send({ type: "join", code, deckId: bob.boot.decks[0].id });
  await until(() => a.room?.seats.length === 2 && b.room, "Remote join", 30000);
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await until(() => a.room.seats.every((s) => s.ready), "Ready seats", 30000);
  a.send({ type: "start" });
  await until(
    () => a.room.phase === "playing" && b.room.phase === "playing",
    "Start remote duel",
    30000,
  );
  const hand = structuredClone(
    b.room.seats.find((s) => s.id === bob.user.id).hand,
  );
  b.ws.terminate();
  b = await socket(url, bob);
  clients.push(b);
  await until(() => b.room?.code === code, "Remote reconnect", 30000);
  assert.deepEqual(b.room.seats.find((s) => s.id === bob.user.id).hand, hand);
  console.log(
    "Online registration, private approval, room start and reconnect passed. Playing to a natural result…",
  );
  const engine = new Duels({});
  let moves = 0;
  while (moves < 250) {
    const latest = [a.room, b.room].sort((x, y) => y.version - x.version)[0];
    if (latest.phase === "finished") break;
    const c = latest.currentPlayerId === alice.user.id ? a : b;
    await until(
      () => c.room.version >= latest.version,
      "Remote current view",
      30000,
    );
    const visible = {
      ...c.room,
      current: c.room.seats.findIndex((s) => s.id === c.room.currentPlayerId),
      seats: c.room.seats.map((s) => ({
        ...s,
        user: { id: s.id, name: s.name },
      })),
    };
    const action = engine.botAction(visible);
    assert.ok(c.room.legalActions.some((a) => a.id === action.id));
    const version = c.room.version,
      requestId = randomUUID(),
      time = performance.now();
    c.send({ type: "act", actionId: action.id, version, requestId });
    if (moves === 0)
      c.send({ type: "act", actionId: action.id, version, requestId });
    await until(() => c.room.version > version, "Confirmed remote move", 30000);
    latencies.push(performance.now() - time);
    moves++;
    if (moves % 20 === 0) console.log(`${moves} confirmed remote moves.`);
  }
  await until(
    () => a.room.phase === "finished" && b.room.phase === "finished",
    "Both remote results",
    30000,
  );
  assert.deepEqual(a.leaks, []);
  assert.deepEqual(b.leaks, []);
  assert.deepEqual(
    [...a.errors, ...b.errors].filter((e) => !/table changed/.test(e)),
    [],
  );
  const result = a.room.reason,
    matchId = a.room.id;
  for (const user of [alice, bob])
    assert.ok(
      (await api(server, "/me", undefined, user.token)).body.matches.some(
        (m) => m.id === matchId,
      ),
    );
  a.send({ type: "rematch" });
  await until(
    () => a.room.phase === "lobby" && b.room.phase === "lobby",
    "Remote rematch",
    30000,
  );
  assert.ok(a.room.seats.every((s) => !s.ready));
  a.send({ type: "leave" });
  await until(() => a.room === null, "Host leave", 30000);
  b.send({ type: "leave" });
  await until(() => b.room === null, "Guest leave", 30000);
  for (const user of [alice, bob])
    assert.equal((await api(server, "/logout", {}, user.token)).status, 200);
  latencies.sort((a, b) => a - b);
  const report = {
    base,
    passed: true,
    moves,
    result,
    privateDataLeaks: 0,
    duplicateDelivery: true,
    reconnect: true,
    approvals: true,
    results: true,
    rematch: true,
    actionMs: {
      p50: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
      p95: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    },
  };
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../artifacts/online-smoke.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const c of clients) c.ws.terminate();
}
