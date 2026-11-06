import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

// A single ordinary two-player match, not a capacity/load test. Explicit URL
// required. Do not add concurrency ramps on Hobby: see docs/HOSTING.md.
const baseArg = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
if (!baseArg || new URL(baseArg).protocol !== "https:")
  throw new Error(
    "Supply --base=https://YOUR-DEPLOYMENT for a normal two-player endurance check.",
  );
const base = new URL(baseArg).origin,
  url = base.replace("https:", "wss:") + "/api/ws/cards";
const started = Date.now(),
  runId = `soak_${started.toString(36)}`;
const report = {
  base,
  runId,
  kind: "one ordinary two-player eight-minute match; no capacity test",
  startedAt: new Date(started).toISOString(),
  players: 2,
  http: [],
  health: [],
  sockets: [],
  recovery: [],
  privacyFailures: [],
  errors: [],
};
const users = [],
  seats = [];
let stopping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error(label);
}
async function request(path, body, token) {
  const at = performance.now(),
    response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  const result = await response.json();
  report.http.push({
    path,
    status: response.status,
    ms: Math.round(performance.now() - at),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return result;
}
async function health() {
  const time = Date.now(),
    value = await request("/api/health");
  assert.equal(value.mode, "shared");
  assert.equal(value.ok, true);
  report.health.push({ at: new Date(time).toISOString(), ok: true });
}
function own(room, user) {
  return room?.seats.find((s) => s.id === user.id);
}
class Seat {
  room = null;
  connected = false;
  versionCount = 0;
  closed = false;
  attempt = 0;
  reconnects = 0;
  rtt = [];
  transitions = [];
  planned = false;
  pendingRecovery = null;
  first = true;
  constructor(account) {
    this.account = account;
    this.user = account.user;
  }
  send(data) {
    assert.equal(
      this.ws.readyState,
      WebSocket.OPEN,
      "Test client must be connected",
    );
    this.ws.send(
      JSON.stringify({
        requestId: randomUUID(),
        ...(data.type === "act" ? { version: this.room?.version } : {}),
        ...data,
      }),
    );
  }
  connect() {
    if (stopping || this.closed) return;
    const socket = new WebSocket(url, {
      origin: base,
      handshakeTimeout: 15000,
    });
    this.ws = socket;
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "auth", token: this.account.token })),
    );
    socket.on("message", (raw) => {
      if (this.ws !== socket) return;
      try {
        const packet = JSON.parse(raw);
        if (packet.type === "connected") {
          this.connected = true;
          this.attempt = 0;
          if (!this.first) this.reconnects++;
          this.first = false;
        }
        if (packet.type === "state") {
          const room = packet.room,
            other = room.seats.find((s) => s.id !== this.user.id);
          if (other && ("hand" in other || "reserve" in other))
            throw new Error("Opponent private cards were sent");
          if (raw.toString().includes("Fictional example:"))
            throw new Error("Private descriptions were sent");
          if (this.room?.id === room.id)
            assert.ok(
              room.turnNumber >= this.room.turnNumber,
              "Turn number moved backward",
            );
          if (this.pendingRecovery) {
            const before = this.pendingRecovery,
              after = own(room, this.user);
            assert.equal(room.id, before.id);
            assert.equal(room.endsAt, before.endsAt);
            assert.deepEqual(after.board, before.board);
            assert.ok(
              before.handIds.every((id) => after.hand.some((c) => c.id === id)),
              "Held cards changed during reconnect",
            );
            assert.ok(after.mana >= before.mana, "Reconnection lost mana");
            report.recovery.push({
              kind: before.kind,
              elapsedMs: Date.now() - before.at,
              hand: true,
              board: true,
              mana: true,
              matchClock: true,
            });
            this.pendingRecovery = null;
          }
          this.room = room;
          this.versionCount++;
          if (this.transitions.at(-1) !== room.turnNumber)
            this.transitions.push(room.turnNumber);
        }
        if (packet.type === "left") this.room = null;
        if (packet.type === "pong")
          this.rtt.push(performance.now() - packet.at);
        if (packet.type === "error") report.errors.push(packet.message);
      } catch (e) {
        report.privacyFailures.push(e.message);
        stopping = true;
      }
    });
    socket.on("error", (e) => {
      report.sockets.push({ event: "socket-error", code: e.code || e.name });
    });
    socket.on("close", (code, reason) => {
      if (this.ws !== socket) return;
      this.connected = false;
      if (stopping || this.closed) return;
      const kind = this.planned ? "planned reconnect" : "hosting/network close";
      this.planned = false;
      report.sockets.push({
        event: "close",
        kind,
        code,
        at: new Date().toISOString(),
      });
      if ([4001, 4003, 1008].includes(code)) {
        report.errors.push(`Socket rejected: ${code} ${reason}`);
        stopping = true;
        return;
      }
      if (this.room?.phase === "playing") {
        const self = own(this.room, this.user);
        this.pendingRecovery = {
          kind,
          at: Date.now(),
          id: this.room.id,
          endsAt: this.room.endsAt,
          board: structuredClone(self.board),
          handIds: self.hand.map((c) => c.id),
          mana: self.mana,
        };
      }
      this.retry = setTimeout(
        () => this.connect(),
        Math.min(500 * 2 ** this.attempt++, 4000) + Math.random() * 300,
      );
    });
  }
  start() {
    this.connect();
    this.heartbeat = setInterval(() => {
      if (this.connected && this.ws.readyState === WebSocket.OPEN)
        this.send({ type: "ping", at: performance.now() });
    }, 1500);
  }
  stop() {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    this.ws?.terminate();
  }
}
const p = (values, percent) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor((sorted.length - 1) * percent)] || 0);
};
try {
  await health();
  for (const suffix of ["a", "b"]) {
    const account = await request("/api/cards/auth/register", {
      name: `Fictional endurance ${suffix.toUpperCase()}`,
      username: `${runId}_${suffix}`,
      password: randomUUID(),
    });
    users.push(account);
    account.boot = await request("/api/cards/me", undefined, account.token);
    const seat = new Seat(account);
    seats.push(seat);
    seat.start();
    await until(() => seat.connected, "Authentication did not complete");
  }
  const [a, b] = seats;
  a.send({ type: "create", deckId: users[0].boot.decks[0].id });
  await until(() => a.room, "Room did not open");
  b.send({
    type: "join",
    code: a.room.code,
    deckId: users[1].boot.decks[0].id,
  });
  await until(
    () => a.room?.seats.length === 2 && b.room,
    "Second player did not join",
  );
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await until(
    () => a.room.seats.every((s) => s.ready),
    "Ready states were not synchronized",
  );
  a.send({ type: "start" });
  await until(
    () => a.room?.phase === "playing" && b.room?.phase === "playing",
    "Duel did not start",
  );
  const id = a.room.id,
    endsAt = a.room.endsAt;
  report.matchStartedAt = new Date(endsAt - 480000).toISOString();
  report.expectedEndAt = new Date(endsAt).toISOString();
  // One normal summon each, then let the normal thirty-second timers progress.
  for (const c of [a, b]) {
    await until(
      () => c.room?.currentPlayerId === c.user.id,
      "Player turn did not arrive",
    );
    let version = c.room.version;
    c.send({
      type: "act",
      actionId: c.room.legalActions.find((x) => x.type === "play").id,
    });
    await until(() => c.room.version > version, "Summon was not confirmed");
    assert.equal(own(c.room, c.user).board.length, 1);
    version = c.room.version;
    c.send({
      type: "act",
      actionId: c.room.legalActions.find((x) => x.type === "end").id,
    });
    await until(() => c.room.version > version, "End turn was not confirmed");
  }
  console.log(
    "Two live players summoned cards. Holding this ordinary match through the full eight-minute deadline.",
  );
  let forced = false,
    lastHealth = 0,
    lastLog = 0;
  while (seats.some((c) => c.room?.phase === "playing")) {
    if (stopping || report.errors.length || report.privacyFailures.length)
      throw new Error("Live session failed its integrity checks");
    const now = Date.now(),
      elapsed = now - (endsAt - 480000);
    if (now > endsAt + 20000)
      throw new Error(
        "Match did not finish within twenty seconds of its deadline",
      );
    if (
      !forced &&
      elapsed > 90000 &&
      b.connected &&
      b.room.turnEndsAt - now > 5000
    ) {
      b.planned = true;
      b.ws.terminate();
      forced = true;
      console.log(
        "Exercising a normal reconnect; the other player remains connected.",
      );
    }
    if (now - lastHealth >= 60000) {
      await health();
      lastHealth = now;
    }
    if (now - lastLog >= 30000) {
      console.log(
        JSON.stringify({
          elapsedSeconds: Math.round(elapsed / 1000),
          turn: a.room?.turnNumber,
          connected: seats.filter((c) => c.connected).length,
          recoveries: report.recovery.length,
          health: "ok",
        }),
      );
      lastLog = now;
    }
    await sleep(500);
  }
  await until(
    () => seats.every((c) => c.room?.phase === "finished"),
    "Both players did not receive the final result",
  );
  assert.equal(a.room.id, id);
  assert.equal(a.room.reason, "time");
  assert.equal(a.room.winner, null);
  assert.ok(a.room.seats.every((s) => s.health === 30));
  assert.ok(a.room.turnNumber >= 16);
  assert.ok(
    forced && report.recovery.some((r) => r.kind === "planned reconnect"),
  );
  for (const user of users)
    assert.ok(
      (await request("/api/cards/me", undefined, user.token)).matches.some(
        (m) => m.id === id && m.result === "draw",
      ),
    );
  report.finalTurnNumber = a.room.turnNumber;
  report.turnTimeouts = a.room.turnNumber - 3;
  a.send({ type: "rematch" });
  await until(
    () => a.room?.phase === "lobby" && b.room?.phase === "lobby",
    "Rematch lobby did not open",
  );
  a.send({ type: "leave" });
  await until(() => a.room === null, "First seat did not leave");
  b.send({ type: "leave" });
  await until(() => b.room === null, "Second seat did not leave");
  report.passed = true;
  report.reason = "time";
  report.savedResults = 2;
  report.rematch = true;
  report.roomsCleaned = true;
} catch (e) {
  report.passed = false;
  report.failure = e.message;
  process.exitCode = 1;
  console.error(e.message);
} finally {
  stopping = true;
  // Best-effort cleanup is restricted to these two synthetic accounts and their room.
  for (const c of seats) {
    if (c.room && c.ws?.readyState === WebSocket.OPEN) {
      try {
        c.send({ type: "leave" });
      } catch {}
    }
  }
  await sleep(500);
  for (const c of seats) c.stop();
  for (const user of users) {
    try {
      await request("/api/cards/logout", {}, user.token);
    } catch (e) {
      report.errors.push(`Cleanup: ${e.message}`);
    }
  }
  await health().catch((e) => report.errors.push(`Final health: ${e.message}`));
  if (report.errors.length || report.privacyFailures.length) {
    report.passed = false;
    process.exitCode = 1;
  }
  const rtt = seats.flatMap((c) => c.rtt);
  report.elapsedSeconds = Math.round((Date.now() - started) / 1000);
  report.completedAt = new Date().toISOString();
  report.rttMs = { p50: p(rtt, 0.5), p95: p(rtt, 0.95), p99: p(rtt, 0.99) };
  report.stateSnapshots = seats.reduce((n, c) => n + c.versionCount, 0);
  report.hostingOrNetworkCloses = report.sockets.filter(
    (s) => s.event === "close" && s.kind === "hosting/network close",
  ).length;
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(
    new URL(`../artifacts/online-endurance-${started}.json`, import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, http: report.http.length, health: report.health.length },
      null,
      2,
    ),
  );
}
