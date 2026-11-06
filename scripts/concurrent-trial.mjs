import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(check, message, timeout = 8000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (check()) return;
    await wait(20);
  }
  throw new Error(message);
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? Math.round(
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10,
      ) / 10
    : null;
};

export async function openClient(url, registry) {
  const ws = new WebSocket(url);
  const c = {
    ws,
    state: null,
    auth: null,
    errors: [],
    issues: [],
    expectedCode: null,
    snapshots: 0,
    rtts: [],
    lastStateAt: null,
    maxGapMs: 0,
    bytes: 0,
    closed: false,
  };
  registry.add(c);
  c.send = (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  ws.on("message", (bytes) => {
    c.bytes += bytes.length;
    const message = JSON.parse(bytes.toString());
    if (message.type === "joined") {
      c.auth = message;
      c.expectedCode = message.code;
    } else if (message.type === "error") c.errors.push(message.message);
    else if (message.type === "pong")
      c.rtts.push(performance.now() - message.at);
    else if (message.type === "state") {
      const now = performance.now();
      if (c.expectedCode && message.room.code !== c.expectedCode)
        c.issues.push("Received another room's snapshot");
      if (message.room.players.some((p) => "token" in p || "input" in p))
        c.issues.push("Private fields leaked into snapshot");
      if (c.lastStateAt !== null)
        c.maxGapMs = Math.max(c.maxGapMs, now - c.lastStateAt);
      c.lastStateAt = now;
      c.snapshots++;
      c.state = message.room;
    }
  });
  ws.on("close", () => {
    c.closed = true;
  });
  // Keep the listener installed for errors after the handshake too.
  ws.on("error", (error) => c.issues.push(error.message));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Client connection timed out"));
    }, 5000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return c;
}

export async function createTrial({ url, teamSizes }) {
  const clients = new Set();
  const groups = [];
  async function cleanup() {
    // Explicitly leave only rooms created by this run. Never enumerate or alter other rooms.
    for (const c of clients) c.send({ type: "leave" });
    await wait(150);
    for (const c of clients)
      if (c.ws.readyState !== WebSocket.CLOSED) c.ws.terminate();
  }
  try {
    for (let index = 0; index < teamSizes.length; index++) {
      const size = teamSizes[index];
      const host = await openClient(url, clients);
      host.send({
        type: "create",
        name: "Player 1",
        teamSize: size,
        duration: 1,
      });
      await until(() => host.auth, `Room ${index + 1} creation failed`);
      const group = {
        code: host.auth.code,
        size,
        host,
        clients: [host],
        ids: new Set([host.auth.playerId]),
      };
      groups.push(group);
      const results = await Promise.allSettled(
        Array.from({ length: size * 2 - 1 }, async (_, i) => {
          const c = await openClient(url, clients);
          c.send({ type: "join", code: group.code, name: `Player ${i + 2}` });
          await until(
            () => c.auth,
            `Player ${i + 2} could not join room ${index + 1}`,
          );
          return c;
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        group.clients.push(result.value);
        group.ids.add(result.value.auth.playerId);
      }
      await until(
        () => group.clients.every((c) => c.state?.players.length === size * 2),
        `Roster did not sync in room ${index + 1}`,
      );
    }
    assert.equal(
      new Set(groups.map((g) => g.code)).size,
      teamSizes.length,
      "Room codes must be unique",
    );
    return { url, groups, clients, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function playTrial(trial, durationMs = 8000) {
  const { groups, clients } = trial;
  for (const g of groups)
    for (const c of g.clients) c.send({ type: "ready", ready: true });
  await until(
    () => groups.every((g) => g.host.state.players.every((p) => p.ready)),
    "Readiness did not synchronize across rooms",
  );
  for (const g of groups) g.host.send({ type: "start" });
  await until(
    () =>
      groups.every((g) => g.clients.every((c) => c.state?.phase === "playing")),
    "Rooms did not start concurrently",
  );
  const connected = [...clients];
  const before = new Map(
    connected.map((c) => [c, { snapshots: c.snapshots, bytes: c.bytes }]),
  );
  const began = performance.now();
  let inputs = 0;
  let failed;
  const inputTimer = setInterval(() => {
    const elapsed = (performance.now() - began) / 1000;
    connected.forEach((c, i) => {
      c.send({
        type: "input",
        x: Math.cos(elapsed + i),
        y: Math.sin(elapsed + i),
        sprint: i % 3 === 0,
        kick: inputs % 7 === 0,
      });
      inputs++;
    });
    for (const g of groups)
      for (const c of g.clients) {
        if (c.closed || c.errors.length || c.issues.length)
          failed ||= `Room ${g.code}: unexpected connection error or room leakage`;
        if (
          c.state?.code !== g.code ||
          c.state?.players.some((p) => !g.ids.has(p.id))
        )
          failed ||= "Room membership leaked across sessions";
      }
  }, 50);
  const pingTimer = setInterval(() => {
    for (const c of connected) c.send({ type: "ping", at: performance.now() });
  }, 1000);
  try {
    await wait(durationMs);
  } finally {
    clearInterval(inputTimer);
    clearInterval(pingTimer);
  }
  const elapsedSeconds = (performance.now() - began) / 1000;
  for (const c of connected)
    c.send({ type: "input", x: 0, y: 0, sprint: false, kick: false });
  assert.ok(!failed, failed);
  const rates = connected.map(
    (c) => (c.snapshots - before.get(c).snapshots) / elapsedSeconds,
  );
  assert.ok(
    Math.min(...rates) >= 12,
    "A client received fewer than 12 snapshots/second under concurrent load",
  );
  assert.ok(
    connected.every((c) => c.rtts.length >= 3),
    "Every client should receive heartbeat replies",
  );
  const summary = {
    rooms: groups.length,
    simultaneousPlayers: connected.length,
    activeSeconds: Math.round(elapsedSeconds * 10) / 10,
    inputMessages: inputs,
    snapshotsPerSecond: {
      minimum: percentile(rates, 0),
      median: percentile(rates, 0.5),
      maximum: percentile(rates, 1),
    },
    roundTripMs: {
      median: percentile(
        connected.flatMap((c) => c.rtts),
        0.5,
      ),
      p95: percentile(
        connected.flatMap((c) => c.rtts),
        0.95,
      ),
      maximum: percentile(
        connected.flatMap((c) => c.rtts),
        1,
      ),
    },
    unexpectedDisconnects: connected.filter((c) => c.closed).length,
    roomLeaks: connected.reduce((sum, c) => sum + c.issues.length, 0),
  };
  return summary;
}

export async function reconnectTrial(trial) {
  const replacements = await Promise.allSettled(
    trial.groups.map(async (g) => {
      const original = g.clients[1];
      const credentials = original.auth;
      original.ws.terminate();
      await until(
        () =>
          g.host.state.players.find((p) => p.id === credentials.playerId)
            ?.connected === false,
        "Disconnect failed to sync",
      );
      const replacement = await openClient(trial.url, trial.clients);
      replacement.send({
        type: "resume",
        code: g.code,
        playerId: credentials.playerId,
        token: credentials.token,
      });
      await until(
        () => replacement.state?.phase === "playing",
        "Concurrent resume failed",
      );
      assert.equal(replacement.auth.playerId, credentials.playerId);
      assert.equal(replacement.state.players.length, g.size * 2);
      g.clients[1] = replacement;
      return replacement;
    }),
  );
  for (const result of replacements)
    if (result.status === "rejected") throw result.reason;
  return replacements.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const url = process.argv[2];
  if (!url || !/^ws:\/\/(localhost|127\.0\.0\.1):\d+\/ws$/.test(url))
    throw new Error(
      "Usage: node scripts/concurrent-trial.mjs ws://localhost:3001/ws (local sandbox only)",
    );
  const trial = await createTrial({ url, teamSizes: [1, 2, 3, 4, 5] });
  try {
    const summary = await playTrial(trial, 10000);
    summary.concurrentReconnects = await reconnectTrial(trial);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await trial.cleanup();
  }
}
