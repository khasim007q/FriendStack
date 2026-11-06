import test from "node:test";
import assert from "node:assert/strict";
import { createGameServer } from "../server/index.mjs";
import {
  createTrial,
  playTrial,
  reconnectTrial,
  until,
  openClient,
} from "../scripts/concurrent-trial.mjs";

test(
  "20 simultaneous 5v5 rooms remain isolated under 200-player traffic and concurrent reconnects",
  { timeout: 45000 },
  async (t) => {
    const server = createGameServer({ port: 0, host: "127.0.0.1" });
    const address = await server.ready;
    t.after(() => server.close());
    const trial = await createTrial({
      url: `ws://127.0.0.1:${address.port}/ws`,
      teamSizes: Array(20).fill(5),
    });
    t.after(() => trial.cleanup());
    const summary = await playTrial(trial, 10000);
    summary.concurrentReconnects = await reconnectTrial(trial);

    // A room code in an action cannot target another room: the socket's own membership wins.
    const [a, b, ...others] = trial.groups;
    const otherHost = b.host.auth.playerId;
    a.host.send({ type: "start", code: b.code });
    await until(
      () => a.host.errors.length,
      "Already-playing start should be rejected",
    );
    assert.equal(b.host.state.hostId, otherHost);
    assert.equal(b.host.state.phase, "playing");
    const outsider = await openClient(trial.url, trial.clients);
    outsider.send({
      type: "resume",
      code: b.code,
      playerId: a.host.auth.playerId,
      token: a.host.auth.token,
    });
    await until(
      () => outsider.errors.length,
      "Cross-room credentials should be rejected",
    );
    assert.match(outsider.errors[0], /expired/);
    assert.equal(outsider.state, null);

    // Deterministic goal setup is test-only. The active server still computes and broadcasts it.
    // Freeze other balls so incidental real play cannot make this assertion ambiguous.
    const scores = new Map(
      trial.groups.map((g) => [g.code, { ...g.host.state.score }]),
    );
    for (const room of server.rooms.rooms.values()) {
      room.goal = null;
      room.ball = { x: 500, y: 310, vx: 0, vy: 0, lastTouch: null };
      for (const p of room.players.values()) {
        p.x = 200;
        p.y = 80;
      }
    }
    server.rooms.rooms.get(a.code).ball = {
      x: 944,
      y: 310,
      vx: 670,
      vy: 0,
      lastTouch: a.host.auth.playerId,
    };
    await until(
      () =>
        a.clients.every(
          (c) => c.state.score.home === scores.get(a.code).home + 1,
        ),
      "Goal did not sync within its own room",
    );
    for (const g of trial.groups.slice(1))
      for (const c of g.clients)
        assert.deepEqual(
          c.state.score,
          scores.get(g.code),
          "Score leaked into another room",
        );

    // Finishing and rematching one room must not stop any of the other nineteen games.
    server.rooms.rooms.get(b.code).endsAt = Date.now() - 1;
    await until(
      () => b.clients.every((c) => c.state.phase === "finished"),
      "Room-specific final whistle failed",
    );
    assert.ok(
      [a, ...others].every((g) =>
        g.clients.every((c) => c.state.phase === "playing"),
      ),
    );
    b.host.send({ type: "rematch" });
    await until(
      () => b.clients.every((c) => c.state.phase === "lobby"),
      "Room-specific rematch failed",
    );
    assert.ok(b.clients.every((c) => c.state.players.every((p) => !p.ready)));
    assert.ok(
      [a, ...others].every((g) =>
        g.clients.every((c) => c.state.phase === "playing"),
      ),
    );

    const hosts = new Map(others.map((g) => [g.code, g.host.state.hostId]));
    const successor = a.host.state.players.find(
      (p) => p.id !== a.host.auth.playerId && p.connected && !p.bot,
    ).id;
    a.host.send({ type: "leave" });
    await until(
      () => a.clients[1].state.hostId === successor,
      "Room-specific host transfer failed",
    );
    for (const g of others)
      assert.equal(g.host.state.hostId, hosts.get(g.code));
    assert.equal(server.rooms.rooms.size, 20);
    await trial.cleanup();
    await until(
      () => server.rooms.rooms.size === 0,
      "Trial rooms were not cleaned up",
    );
    t.diagnostic(
      JSON.stringify({
        ...summary,
        scoreIsolation: true,
        independentRematch: true,
        independentHostTransfer: true,
        roomsAfterCleanup: server.rooms.rooms.size,
      }),
    );
  },
);
