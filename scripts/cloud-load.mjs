import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture, socket, until, wait } from "../tests/cloud/helpers.mjs";
import { balancer } from "../tests/cloud/balancer.mjs";
import { Duels } from "../server/cards/duels.mjs";
const option = (name, fallback) =>
  Number(
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ||
      fallback,
  );
const rooms = option("rooms", 100),
  rounds = option("rounds", 180);
if (!Number.isInteger(rooms) || rooms < 1 || rooms > 1000)
  throw new Error("Choose 1–1000 test rooms.");
const cleanups = [],
  f = await fixture(
    { after: (fn) => cleanups.push(fn) },
    { maxRooms: rooms + 1 },
  ),
  lb = await balancer(f.servers);
const users = [],
  clients = [],
  groups = [],
  actionMs = [],
  start = performance.now();
let moves = 0,
  duplicates = 0;
const summary = {
  rooms,
  players: rooms * 2,
  instances: f.servers.length,
  source:
    "isolated loopback Postgres; synthetic clients; not a Vercel capacity guarantee",
};
async function parallel(items, limit, fn) {
  let index = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (index < items.length) {
        const i = index++;
        await fn(items[i], i);
      }
    }),
  );
}
try {
  console.log(
    `Preparing ${rooms * 2} fictional test identities for ${rooms} rooms across ${f.servers.length} instances…`,
  );
  await parallel(Array.from({ length: rooms * 2 }), 6, async (_, i) => {
    const s = f.servers[i % 3],
      u = await s.store.register({
        name: `Load player ${i}`,
        username: `load_${i}`,
        password: "Disposable-loadtest-123",
      });
    const deck = await s.db.get(
      "SELECT id FROM __SCHEMA__.decks WHERE owner=$1",
      u.user.id,
    );
    users[i] = { ...u, deckId: deck.id };
  });
  await parallel(users, 20, async (u, i) => {
    const c = await socket(lb.url, u);
    clients[i] = c;
    f.clients.push(c);
  });
  for (let i = 0; i < 9; i++)
    assert.equal((await fetch(lb.base + "/api/health")).status, 200);
  await parallel(Array.from({ length: rooms }), 8, async (_, i) => {
    const a = clients[i * 2],
      b = clients[i * 2 + 1];
    a.send({ type: "create", deckId: users[i * 2].deckId });
    await until(() => a.room, `Create room ${i}: ${a.errors}`, 30000);
    b.send({
      type: "join",
      code: a.room.code,
      deckId: users[i * 2 + 1].deckId,
    });
    await until(
      () => a.room?.seats.length === 2 && b.room,
      `Join room ${i}: ${b.errors}`,
      30000,
    );
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await until(
      () => a.room.seats.every((s) => s.ready),
      `Ready room ${i}`,
      30000,
    );
    a.send({ type: "start" });
    await until(
      () => a.room.phase === "playing" && b.room.phase === "playing",
      `Start room ${i}: ${a.errors} / ${b.errors}`,
      30000,
    );
    groups[i] = { a, b, code: a.room.code };
  });
  summary.setupMs = Math.round(performance.now() - start);
  assert.equal(new Set(groups.map((g) => g.code)).size, rooms);
  assert.ok(
    lb.counts.every((c) => c.websocket > 0),
    "Connections must reach every instance",
  );
  // Reconnect 5% of players through ingress, potentially to a different instance.
  await parallel(
    groups.filter((_, i) => i % 20 === 0),
    5,
    async (g) => {
      const before = g.b.room,
        identity = g.b.user;
      g.b.ws.terminate();
      g.b = await socket(lb.url, identity);
      clients.push(g.b);
      f.clients.push(g.b);
      await until(
        () => g.b.room?.code === g.code,
        "Reconnect under load",
        30000,
      );
      assert.equal(g.b.room.id, before.id);
      assert.deepEqual(g.b.leaks, []);
    },
  );
  console.log(
    `All ${rooms} rooms are live. Exercising legal actions, duplicate delivery and private snapshots…`,
  );
  const playStart = performance.now(),
    engine = new Duels({});
  for (
    let round = 0;
    round < rounds && groups.some((g) => g.a.room?.phase === "playing");
    round++
  ) {
    await parallel(groups, 20, async (g) => {
      const latest = [g.a.room, g.b.room]
        .filter(Boolean)
        .sort((a, b) => b.version - a.version)[0];
      if (latest.phase !== "playing") return;
      const c = latest.currentPlayerId === g.a.user.user.id ? g.a : g.b;
      if (c.room.version < latest.version)
        await until(
          () => c.room.version >= latest.version,
          "Active view catches up",
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
      // Choose through the same server-published legal-action interface.
      assert.ok(c.room.legalActions.some((a) => a.id === action.id));
      const version = c.room.version,
        requestId = randomUUID(),
        sent = performance.now();
      c.send({ type: "act", actionId: action.id, version, requestId });
      moves++;
      if (round % 20 === 0) {
        c.send({ type: "act", actionId: action.id, version, requestId });
        duplicates++;
      }
      await until(
        () => c.room.version > version,
        `Action under load: ${c.errors}`,
        30000,
      );
      actionMs.push(performance.now() - sent);
      assert.equal(c.room.code, g.code);
      assert.deepEqual(c.leaks, []);
    });
    if (round % 20 === 0)
      console.log(
        `Round ${round}: ${moves} confirmed moves; ${groups.filter((g) => g.a.room?.phase === "finished").length}/${rooms} duels finished.`,
      );
  }
  await until(
    () =>
      groups.every(
        (g) => g.a.room?.phase === "finished" && g.b.room?.phase === "finished",
      ),
    "All loaded duels must finish naturally",
    30000,
  );
  const elapsed = performance.now() - playStart;
  const staleRetries = clients
    .flatMap((c) => c.errors)
    .filter((e) => /table changed/.test(e)).length;
  for (const c of clients) {
    assert.deepEqual(c.leaks, []);
    assert.deepEqual(
      c.errors.filter((e) => !/table changed/.test(e)),
      [],
    );
  }
  const outcomes = (
    await f.a.db.get("SELECT COUNT(*)::int AS n FROM __SCHEMA__.matches")
  ).n;
  assert.equal(outcomes, rooms * 2);
  const pct = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor((sorted.length - 1) * p)] || 0);
  };
  const rtts = clients.flatMap((c) => c.pongs.map((p) => p.ms));
  Object.assign(summary, {
    completedDuels: rooms,
    persistedResults: outcomes,
    confirmedMoves: moves,
    duplicatePackets: duplicates,
    playMs: Math.round(elapsed),
    movesPerSecond: Math.round((moves / elapsed) * 10000) / 10,
    actionMs: {
      p50: pct(actionMs, 0.5),
      p95: pct(actionMs, 0.95),
      p99: pct(actionMs, 0.99),
    },
    rttMs: { p50: pct(rtts, 0.5), p95: pct(rtts, 0.95), p99: pct(rtts, 0.99) },
    routing: lb.counts,
    staleRetries,
    privateDataLeaks: 0,
    protocolErrors: 0,
    rssMiB: Math.round(process.memoryUsage().rss / 1048576),
  });
  await parallel(groups, 20, async (g) => {
    g.a.send({ type: "leave" });
    g.b.send({ type: "leave" });
  });
  await until(
    async () =>
      !(await f.a.db.get("SELECT COUNT(*)::int AS n FROM __SCHEMA__.rooms")).n,
    "Load rooms should be cleaned up",
    30000,
  );
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(
    new URL(
      `../artifacts/cloud-load-${rooms * 2}-players.json`,
      import.meta.url,
    ),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (e) {
  console.error("Load test failed:", e.message);
  process.exitCode = 1;
} finally {
  for (const c of clients) c.ws.terminate();
  await lb.close();
  for (const fn of cleanups) await fn();
}
