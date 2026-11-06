import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../server/index.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await wait(15);
  }
  assert.fail(message);
}
async function client(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on("message", (bytes) => messages.push(JSON.parse(bytes)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    ws,
    messages,
    send: (data) => ws.send(JSON.stringify(data)),
    get state() {
      return messages.findLast((m) => m.type === "state")?.room;
    },
    get auth() {
      return messages.findLast((m) => m.type === "joined");
    },
    get error() {
      return messages.findLast((m) => m.type === "error")?.message;
    },
  };
}

test(
  "10 independent WebSocket players share a 5v5 match, reconnect, and complete a rematch",
  { timeout: 15000 },
  async (t) => {
    const server = createGameServer({ port: 0, host: "127.0.0.1" });
    const address = await server.ready;
    t.after(() => server.close());
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const clients = [];
    for (let i = 0; i < 10; i++) clients.push(await client(url));
    const host = clients[0];
    host.send({ type: "create", name: "Host", teamSize: 5, duration: 1 });
    await until(() => host.auth, "Host did not receive room credentials");
    const code = host.auth.code;
    for (let i = 1; i < 10; i++)
      clients[i].send({ type: "join", name: `Friend ${i}`, code });
    await until(
      () => clients.every((c) => c.state?.players.length === 10),
      "All ten players should see the same full roster",
    );
    assert.ok(clients.every((c) => c.state.code === code));
    assert.ok(
      clients.every((c) => !JSON.stringify(c.state).includes(host.auth.token)),
    );
    const extra = await client(url);
    extra.send({ type: "join", name: "Too many", code });
    await until(() => extra.error, "Capacity rejection not received");
    assert.match(extra.error, /full/);
    clients[1].send({ type: "start" });
    await until(() => clients[1].error, "Non-host rejection not received");
    assert.match(clients[1].error, /host/);
    host.send({ type: "start" });
    await until(() => host.error, "Ready-check rejection not received");
    assert.match(host.error, /ready/);
    for (const c of clients) c.send({ type: "ready", ready: true });
    await until(
      () => host.state.players.every((p) => p.ready),
      "Ready state did not sync",
    );
    host.send({ type: "start" });
    await until(
      () => clients.every((c) => c.state?.phase === "playing"),
      "Countdown did not transition all players to live",
    );
    const before = host.state.players.find(
      (p) => p.id === host.auth.playerId,
    ).x;
    for (let i = 0; i < 8; i++) {
      host.send({ type: "input", x: 1, y: 0, sprint: false, kick: false });
      await wait(30);
    }
    await until(
      () =>
        clients.every(
          (c) =>
            c.state.players.find((p) => p.id === host.auth.playerId).x >
            before + 20,
        ),
      "Host movement did not sync to all peers",
    );
    const count = host.messages.filter((m) => m.type === "state").length;
    await wait(600);
    assert.ok(
      host.messages.filter((m) => m.type === "state").length - count >= 8,
      "Expected steady snapshot delivery",
    );
    host.send({ type: "ping", at: 123 });
    await until(
      () => host.messages.some((m) => m.type === "pong" && m.at === 123),
      "Latency heartbeat failed",
    );
    const original = clients[3];
    const credentials = original.auth;
    original.ws.terminate();
    await until(
      () =>
        host.state.players.find((p) => p.id === credentials.playerId)
          ?.connected === false,
      "Disconnect did not propagate",
    );
    const reconnected = await client(url);
    reconnected.send({
      type: "resume",
      code,
      playerId: credentials.playerId,
      token: credentials.token,
    });
    await until(
      () => reconnected.state?.phase === "playing",
      "Player could not resume live match",
    );
    assert.equal(reconnected.auth.playerId, credentials.playerId);
    const imposter = await client(url);
    imposter.send({
      type: "resume",
      code,
      playerId: host.auth.playerId,
      token: "invalid",
    });
    await until(() => imposter.error, "Invalid session was not rejected");
    assert.match(imposter.error, /expired/);
    const room = server.rooms.rooms.get(code);
    room.endsAt = Date.now() - 1;
    await until(
      () =>
        host.state.phase === "finished" &&
        reconnected.state.phase === "finished",
      "Final whistle was not synchronized",
    );
    host.send({ type: "rematch" });
    await until(
      () => host.state.phase === "lobby",
      "Rematch did not open lobby",
    );
    assert.ok(host.state.players.every((p) => !p.ready));
    const successorId = clients[1].auth.playerId;
    host.send({ type: "leave" });
    await until(
      () => clients[1].state.hostId === successorId,
      "Host did not transfer after leaving",
    );
    assert.equal(clients[1].state.players.length, 9);
    for (const c of [...clients, extra, reconnected, imposter]) c.ws.close();
  },
);

test("rooms stay isolated; malformed or forged messages do not affect another game", async (t) => {
  const server = createGameServer({ port: 0, host: "127.0.0.1" });
  const address = await server.ready;
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const a = await client(url),
    b = await client(url);
  a.send({ type: "create", name: "Alex", teamSize: 1, duration: 1 });
  b.send({ type: "create", name: "Jamie", teamSize: 1, duration: 1 });
  await until(() => a.state && b.state, "Rooms not created");
  assert.notEqual(a.state.code, b.state.code);
  a.ws.send("not json");
  await until(() => a.error, "Malformed message not handled");
  assert.match(a.error, /Invalid message/);
  a.send({ type: "score", home: 999, code: b.state.code });
  await wait(80);
  assert.deepEqual(b.state.score, { home: 0, away: 0 });
  assert.equal(b.state.players.length, 1);
  a.ws.close();
  b.ws.close();
});
