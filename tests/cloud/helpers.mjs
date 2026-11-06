import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createCloudServer } from "../../server/cloud/server.mjs";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(
  fn,
  message = "Expected shared network state",
  timeout = 10000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await wait(10);
  }
  assert.fail(message);
}
export async function fixture(t, options = {}) {
  assert.ok(
    process.env.FRIENDSTACK_TEST_DATABASE_URL,
    "Use npm run test:cloud to start an isolated Postgres database.",
  );
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const servers = [],
    clients = [];
  async function add() {
    const s = createCloudServer({
      url: process.env.FRIENDSTACK_TEST_DATABASE_URL,
      schema,
      ...options,
    });
    servers.push(s);
    const a = await s.ready;
    s.base = `http://127.0.0.1:${a.port}`;
    s.url = `ws://127.0.0.1:${a.port}/api/ws/cards`;
    return s;
  }
  const a = await add(),
    b = await add(),
    c = await add();
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    for (const s of servers) await s.close();
  });
  return {
    a,
    b,
    c,
    servers,
    clients,
    add,
    socket: async (server, user) => {
      const s = await socket(server.url, user);
      clients.push(s);
      return s;
    },
  };
}
export async function api(server, path, body, token, headers = {}) {
  const r = await fetch(server.base + "/api/cards" + path, {
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
export async function account(server, name) {
  const r = await api(server, "/auth/register", {
    name,
    username: name,
    password: "Cloud-playtest-123",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const boot = await api(server, "/me", undefined, r.body.token);
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  return { ...r.body, boot: boot.body };
}
export async function socket(url, user) {
  const ws = new WebSocket(url),
    c = {
      ws,
      user,
      room: null,
      errors: [],
      leaks: [],
      states: 0,
      closed: null,
      connected: false,
      refreshes: 0,
      pongs: [],
    };
  let heartbeat;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "connected") c.connected = true;
    if (m.type === "state") {
      c.room = m.room;
      c.states++;
      const other = m.room.seats.find((s) => s.id !== user.user.id);
      if (other && ("hand" in other || "reserve" in other))
        c.leaks.push("Private opponent cards");
      if (raw.toString().includes("Fictional example:"))
        c.leaks.push("Private descriptions");
    }
    if (m.type === "left") c.room = null;
    if (m.type === "error") c.errors.push(m.message);
    if (m.type === "refresh") c.refreshes++;
    if (m.type === "pong")
      c.pongs.push({ at: m.at, ms: performance.now() - m.at });
  });
  ws.on("error", () => {});
  ws.on("close", (code) => {
    clearInterval(heartbeat);
    c.closed = code;
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  c.send = (data) => {
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.send(
      JSON.stringify({
        requestId: randomUUID(),
        ...(data.type === "act" ? { version: c.room?.version } : {}),
        ...data,
      }),
    );
  };
  c.send({ type: "auth", token: user.token });
  await until(() => c.connected || c.closed, "Socket should authenticate");
  assert.ok(c.connected, `Socket closed ${c.closed}`);
  heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN)
      c.send({ type: "ping", at: performance.now() });
  }, 1000);
  return c;
}
export async function duel(f, aUser, bUser) {
  const a = await f.socket(f.a, aUser),
    b = await f.socket(f.b, bUser);
  a.send({ type: "create", deckId: aUser.boot.decks[0].id });
  await until(() => a.room, "Host should create room");
  b.send({ type: "join", code: a.room.code, deckId: bUser.boot.decks[0].id });
  await until(() => a.room?.seats.length === 2 && b.room);
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await until(
    () => a.room.seats.every((s) => s.ready),
    `Both seats must ready: ${a.errors} / ${b.errors}`,
  );
  a.send({ type: "start" });
  await until(() => a.room.phase === "playing" && b.room?.phase === "playing");
  return { a, b };
}
