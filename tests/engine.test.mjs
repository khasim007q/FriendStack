import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.mjs";
import { FIELD, resetPositions, tickRoom } from "../server/engine.mjs";

const create = (service, overrides = {}) =>
  service.create({ name: "Alex", teamSize: 3, duration: 1, ...overrides });

test("room sizes 1v1 through 5v5 have correct capacity and never leak resume tokens", () => {
  for (let size = 1; size <= 5; size++) {
    const service = new Rooms();
    const { room, player } = create(service, { teamSize: size });
    for (let i = 1; i < size * 2; i++)
      service.join({ code: room.code, name: `Friend ${i}` });
    assert.equal(room.players.size, size * 2);
    assert.equal(
      [...room.players.values()].filter((p) => p.team === "home").length,
      size,
    );
    assert.throws(
      () => service.join({ code: room.code, name: "Extra" }),
      /full/,
    );
    assert.ok(!JSON.stringify(service.snapshot(room)).includes(player.token));
    assert.ok(!("token" in service.snapshot(room).players[0]));
  }
});

test("room validation rejects invalid input and duplicate player names", () => {
  const service = new Rooms();
  assert.throws(() => create(service, { name: "   " }), /name/);
  assert.throws(() => create(service, { teamSize: 6 }), /team size/);
  assert.throws(() => create(service, { duration: 2 }), /minute/);
  assert.throws(
    () => service.join({ code: "ABCDEF", name: "Sam" }),
    /not found/,
  );
  const { room } = create(service);
  assert.throws(
    () => service.join({ code: room.code, name: "aLeX" }),
    /already/,
  );
});

test("side selection enforces capacity and clears the switching player’s ready state", () => {
  const service = new Rooms();
  const { room, player } = create(service, { teamSize: 2 });
  service.join({ code: room.code, name: "Jamie" });
  const { player: third } = service.join({ code: room.code, name: "Sam" });
  service.action(room, player, { type: "ready", ready: true });
  service.action(room, player, { type: "team", team: "away" });
  assert.equal(player.team, "away");
  assert.equal(player.ready, false);
  assert.throws(
    () => service.action(room, third, { type: "team", team: "away" }),
    /full/,
  );
});

test("only the host starts; both sides and every connected player must be ready", () => {
  const service = new Rooms(() => 1000);
  const { room, player: host } = create(service);
  assert.throws(
    () => service.action(room, host, { type: "start" }),
    /Both sides/,
  );
  const { player: guest } = service.join({ code: room.code, name: "Jamie" });
  assert.throws(() => service.action(room, guest, { type: "start" }), /host/);
  assert.throws(() => service.action(room, host, { type: "start" }), /ready/);
  service.action(room, host, { type: "ready", ready: true });
  service.action(room, guest, { type: "ready", ready: true });
  service.action(room, host, { type: "start" });
  assert.equal(room.phase, "countdown");
  assert.equal(room.startsAt, 4000);
  assert.throws(
    () => service.join({ code: room.code, name: "Late" }),
    /underway/,
  );
  assert.throws(
    () => service.action(room, guest, { type: "team", team: "home" }),
    /after/,
  );
  tickRoom(room, 1 / 60, 4000);
  assert.equal(room.phase, "playing");
  assert.equal(room.endsAt, 64000);
  tickRoom(room, 1 / 60, 64000);
  assert.equal(room.phase, "finished");
  assert.throws(() => service.action(room, guest, { type: "rematch" }), /host/);
  service.action(room, host, { type: "rematch" });
  assert.equal(room.phase, "lobby");
  assert.equal(host.ready, false);
  assert.deepEqual(room.score, { home: 0, away: 0 });
});

test("practice bots fill only empty slots, are ready, and can be removed only by host", () => {
  const service = new Rooms();
  const { room, player: host } = create(service, { teamSize: 5 });
  const { player: guest } = service.join({ code: room.code, name: "Jamie" });
  assert.throws(() => service.action(room, guest, { type: "bots" }), /host/);
  service.action(room, host, { type: "bots" });
  assert.equal(room.players.size, 10);
  assert.equal(
    [...room.players.values()].filter((p) => p.bot && p.ready).length,
    8,
  );
  service.action(room, host, { type: "bots", remove: true });
  assert.equal(room.players.size, 2);
});

test("resume requires a secret token, holds seats for 30s, and transfers host on disconnect", () => {
  let now = 1000;
  const service = new Rooms(() => now);
  const { room, player: host } = create(service);
  const { player: guest } = service.join({ code: room.code, name: "Jamie" });
  assert.throws(
    () =>
      service.resume({ code: room.code, playerId: host.id, token: host.token }),
    /already connected/,
  );
  service.disconnect(room, host);
  service.cleanRoom(room);
  assert.equal(room.hostId, guest.id);
  assert.throws(
    () => service.resume({ code: room.code, playerId: host.id, token: "bad" }),
    /expired/,
  );
  const result = service.resume({
    code: room.code,
    playerId: host.id,
    token: host.token,
  });
  assert.equal(result.player.id, host.id);
  assert.equal(host.connected, true);
  assert.equal(room.hostId, guest.id);
  service.disconnect(room, host);
  now += 29_000;
  service.sweep();
  assert.ok(room.players.has(host.id));
  now += 2000;
  service.sweep();
  assert.ok(!room.players.has(host.id));
  service.leave(room, guest);
  assert.equal(service.rooms.size, 0);
});

test("the simulation limits movement, normalizes diagonal speed, rejects NaN, and stops stale inputs", () => {
  let now = 1000;
  const service = new Rooms(() => now);
  const { room, player } = create(service);
  room.phase = "playing";
  room.endsAt = 100000;
  player.x = 200;
  player.y = 200;
  service.action(room, player, { type: "input", x: NaN, y: Infinity });
  assert.equal(player.input.x, 0);
  service.action(room, player, { type: "input", x: 1, y: 1 });
  tickRoom(room, 1 / 60, now);
  assert.ok(
    Math.abs(Math.hypot(player.x - 200, player.y - 200) - 165 / 60) < 0.001,
  );
  const x = player.x;
  now += 301;
  tickRoom(room, 1 / 60, now);
  assert.equal(player.x, x);
  player.x = FIELD.right - 16;
  service.action(room, player, { type: "input", x: 1, y: 0 });
  tickRoom(room, 1 / 60, now);
  assert.equal(player.x, FIELD.right - 16);
});

test("goals are server-scored, pause play once, reset positions, and obey the goal mouth", () => {
  const service = new Rooms();
  const { room, player } = create(service);
  room.phase = "playing";
  room.endsAt = 100000;
  room.ball = { x: 944, y: 310, vx: 670, vy: 0, lastTouch: player.id };
  tickRoom(room, 1 / 60, 1000);
  assert.equal(room.score.home, 1);
  assert.equal(room.goal.scorer, "Alex");
  tickRoom(room, 1 / 60, 1100);
  assert.equal(room.score.home, 1);
  tickRoom(room, 1 / 60, 2801);
  assert.equal(room.goal, null);
  assert.equal(room.ball.x, 500);
  room.ball = { x: 944, y: 100, vx: 670, vy: 0, lastTouch: null };
  tickRoom(room, 1 / 60, 2900);
  assert.equal(room.score.home, 1);
  assert.ok(room.ball.vx < 0);
});

test("kicking sends the ball in the facing direction; sprint consumes and recovers stamina", () => {
  let now = 1000;
  const service = new Rooms(() => now);
  const { room, player } = create(service);
  room.phase = "playing";
  room.endsAt = 100000;
  player.x = 500;
  player.y = 310;
  player.dx = 1;
  player.dy = 0;
  room.ball = { x: 530, y: 310, vx: 0, vy: 0, lastTouch: null };
  service.action(room, player, { type: "input", x: 0, y: 0, kick: true });
  tickRoom(room, 1 / 60, now);
  assert.ok(room.ball.vx > 600);
  assert.equal(room.ball.lastTouch, player.id);
  service.action(room, player, { type: "input", x: 1, y: 0, sprint: true });
  tickRoom(room, 1 / 60, now);
  assert.ok(player.stamina < 1);
  const depleted = player.stamina;
  service.action(room, player, { type: "input", x: 0, y: 0, sprint: false });
  tickRoom(room, 1 / 60, now);
  assert.ok(player.stamina > depleted);
});

test("uneven teams may start as long as both sides have a ready player", () => {
  const service = new Rooms();
  const { room, player } = create(service);
  service.join({ code: room.code, name: "Two" });
  service.join({ code: room.code, name: "Three" });
  for (const p of room.players.values())
    service.action(room, p, { type: "ready", ready: true });
  service.action(room, player, { type: "start" });
  assert.equal(room.phase, "countdown");
});
