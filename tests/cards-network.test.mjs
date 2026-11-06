import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../server/index.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message = "Expected network state", timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await wait(10);
  }
  assert.fail(message);
}
async function setup(t) {
  const server = createGameServer({ port: 0, host: "127.0.0.1" }),
    address = await server.ready;
  t.after(() => server.close());
  const base = `http://127.0.0.1:${address.port}`;
  return { server, base, url: `ws://127.0.0.1:${address.port}/ws/cards` };
}
async function api(base, path, body, token, headers = {}) {
  const r = await fetch(base + "/api/cards" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
async function register(base, name) {
  const r = await api(base, "/auth/register", {
    name,
    username: name,
    password: "Testing-friend-123",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const boot = await api(base, "/me", undefined, r.body.token);
  return { ...r.body, boot: boot.body };
}
async function socket(url, account) {
  const ws = new WebSocket(url),
    c = { ws, room: null, errors: [], leaks: [], states: 0, connected: false };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "connected") c.connected = true;
    if (m.type === "state") {
      c.room = m.room;
      c.states++;
      const other = m.room.seats.find((s) => s.id !== account.user.id);
      if (other && ("hand" in other || "reserve" in other))
        c.leaks.push("Opponent private cards");
      if (raw.toString().includes("Fictional example:"))
        c.leaks.push("Private descriptions");
    }
    if (m.type === "left") c.room = null;
    if (m.type === "error") c.errors.push(m.message);
  });
  ws.on("error", () => {});
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  c.send = (data) => ws.send(JSON.stringify(data));
  c.send({ type: "auth", token: account.token });
  await until(() => c.connected);
  return c;
}

test("HTTP authentication protects profiles; invitation claims and approvals work without leaking descriptions", async (t) => {
  const { base } = await setup(t);
  assert.equal((await api(base, "/me")).status, 401);
  const alice = await register(base, "alice"),
    bob = await register(base, "bob"),
    eve = await register(base, "eve");
  assert.ok(!JSON.stringify(alice.boot).includes("password"));
  assert.ok(!JSON.stringify(alice.boot).includes(alice.token));
  const p = (await api(base, "/friends", { name: "Bob" }, alice.token)).body;
  const definition = {
    type: "bold",
    name: "Secret perspective",
    description: "TOP SECRET relationship text",
    ability: {
      trigger: "active",
      target: "enemy",
      effect: "damage",
      amount: 3,
    },
  };
  assert.equal(
    (await api(base, `/friends/${p.id}/traits`, definition, eve.token)).status,
    400,
  );
  assert.equal(
    (await api(base, `/friends/${p.id}/traits`, definition, alice.token))
      .status,
    200,
  );
  assert.ok(
    !JSON.stringify(
      (await api(base, "/me", undefined, eve.token)).body,
    ).includes("TOP SECRET"),
  );
  const invitation = (
    await api(base, `/friends/${p.id}/invite`, {}, alice.token)
  ).body;
  assert.equal(
    (await api(base, "/claim", { token: invitation.token }, bob.token)).status,
    200,
  );
  const incoming = (await api(base, "/me", undefined, bob.token)).body
    .incoming[0];
  assert.equal(incoming.description, definition.description);
  assert.equal(
    (await api(base, `/review/${incoming.id}`, { approve: true }, eve.token))
      .status,
    400,
  );
  assert.equal(
    (await api(base, `/review/${incoming.id}`, { approve: true }, bob.token))
      .status,
    200,
  );
  assert.equal(
    (await api(base, "/claim", { token: invitation.token }, eve.token)).status,
    400,
  );
  assert.equal(
    (
      await api(base, "/friends", { name: "Attacker" }, alice.token, {
        Origin: "http://unrelated.example",
      })
    ).status,
    403,
  );
  await api(base, "/logout", {}, alice.token);
  assert.equal((await api(base, "/me", undefined, alice.token)).status, 401);
});

test("two authenticated players duel, receive only their own hand, reconnect, finish, and rematch", async (t) => {
  const { server, base, url } = await setup(t),
    alice = await register(base, "alice"),
    bob = await register(base, "bob");
  let a = await socket(url, alice),
    b = await socket(url, bob);
  a.send({ type: "create", deckId: alice.boot.decks[0].id });
  await until(() => a.room);
  const code = a.room.code;
  b.send({ type: "join", code, deckId: bob.boot.decks[0].id });
  await until(() => a.room.seats.length === 2 && b.room);
  b.send({ type: "start" });
  await until(() => b.errors.length);
  assert.match(b.errors[0], /host/);
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await until(() => a.room.seats.every((s) => s.ready));
  a.send({ type: "start" });
  await until(() => a.room.phase === "playing" && b.room.phase === "playing");
  assert.equal(a.room.seats.find((s) => s.id === alice.user.id).hand.length, 3);
  assert.deepEqual(a.leaks, []);
  assert.deepEqual(b.leaks, []);
  const playable = a.room.legalActions.find((x) => x.type === "play");
  a.send({ type: "act", actionId: playable.id });
  await until(
    () => b.room.seats.find((s) => s.id === alice.user.id).board.length === 1,
  );
  b.ws.terminate();
  await until(
    () => a.room.seats.find((s) => s.id === bob.user.id).connected === false,
  );
  b = await socket(url, bob);
  await until(() => b.room?.phase === "playing");
  assert.equal(b.room.seats.length, 2);
  const room = server.cards.duels.rooms.get(code);
  room.endsAt = Date.now() - 1;
  await until(() => a.room.phase === "finished" && b.room.phase === "finished");
  assert.equal(
    (await api(base, "/me", undefined, alice.token)).body.matches.length,
    1,
  );
  a.send({ type: "rematch" });
  await until(() => a.room.phase === "lobby");
  assert.ok(a.room.seats.every((s) => !s.ready));
  a.send({ type: "leave" });
  await until(() => b.room.hostId === bob.user.id);
  assert.equal(b.room.seats.length, 1);
  a.ws.close();
  b.ws.close();
});

test(
  "six simultaneous card rooms keep independent frozen versions and complete legal duels",
  { timeout: 20000 },
  async (t) => {
    const { server, base, url } = await setup(t),
      groups = [],
      all = [];
    for (let i = 0; i < 6; i++) {
      const aUser = await register(base, `host${i}`),
        bUser = await register(base, `guest${i}`),
        a = await socket(url, aUser),
        b = await socket(url, bUser);
      all.push(a, b);
      a.send({ type: "create", deckId: aUser.boot.decks[0].id });
      await until(() => a.room);
      b.send({
        type: "join",
        code: a.room.code,
        deckId: bUser.boot.decks[0].id,
      });
      await until(() => b.room && a.room.seats.length === 2);
      a.send({ type: "ready", ready: true });
      b.send({ type: "ready", ready: true });
      await until(() => a.room.seats.every((s) => s.ready));
      a.send({ type: "start" });
      await until(() => b.room.phase === "playing");
      groups.push({ a, b, code: a.room.code, aUser, bUser });
    }
    assert.equal(server.cards.duels.rooms.size, 6);
    const original = groups[2].b;
    original.ws.terminate();
    await until(() => groups[2].a.room.seats.some((s) => !s.connected));
    groups[2].b = await socket(url, groups[2].bUser);
    all.push(groups[2].b);
    await until(() => groups[2].b.room?.phase === "playing");
    for (
      let moves = 0;
      moves < 180 && groups.some((g) => g.a.room.phase === "playing");
      moves++
    ) {
      for (const g of groups) {
        if (g.a.room.phase !== "playing") continue;
        const r = server.cards.duels.rooms.get(g.code),
          action = server.cards.duels.botAction(r),
          active = r.seats[r.current].user.id === g.aUser.user.id ? g.a : g.b;
        active.send({ type: "act", actionId: action.id });
      }
      await wait(55);
    }
    await until(
      () =>
        groups.every(
          (g) => g.a.room.phase === "finished" && g.b.room.phase === "finished",
        ),
      "All concurrent card duels should finish",
    );
    for (const g of groups) {
      assert.equal(g.a.room.code, g.code);
      assert.equal(g.b.room.code, g.code);
      assert.deepEqual(g.a.leaks, []);
      assert.deepEqual(g.b.leaks, []);
      assert.deepEqual(g.a.errors, []);
      assert.deepEqual(g.b.errors, []);
      assert.equal(
        (await api(base, "/me", undefined, g.aUser.token)).body.matches.length,
        1,
      );
      g.a.send({ type: "leave" });
      g.b.send({ type: "leave" });
    }
    await until(() => server.cards.duels.rooms.size === 0);
    for (const c of all) c.ws.close();
  },
);
