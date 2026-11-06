import test from "node:test";
import assert from "node:assert/strict";
import { CardStore } from "../server/cards/store.mjs";
import { Duels } from "../server/cards/duels.mjs";

async function fixture(t) {
  const store = new CardStore(":memory:");
  t.after(() => store.close());
  const user = (
    await store.register({
      name: "Alice",
      username: "alice",
      password: "Testing-12345",
    })
  ).user;
  let now = 10000;
  const duels = new Duels(store, () => now);
  const deck = store.bootstrap(user).decks[0];
  const room = duels.create(user, { deckId: deck.id, solo: true });
  return {
    store,
    user,
    duels,
    room,
    a: room.seats[0],
    b: room.seats[1],
    advance: (ms) => {
      now += ms;
    },
  };
}
const card = (name = "Test friend", abilities = []) => ({
  id: `unit-${name}-${Math.random()}`,
  personId: name,
  name,
  color: "mint",
  face: 0,
  kind: "friend",
  cost: 3,
  abilities,
});
const ability = (type, trigger, effect, target, amount = 1) => ({
  type,
  name: type,
  ability: { trigger, effect, target, amount },
});

test("opening hands guarantee a friend, players have independent hidden hands, and card definitions freeze at kickoff", async (t) => {
  const { store, user, duels, room, a, b } = await fixture(t);
  assert.equal(a.hand.length, 3);
  assert.ok(
    a.hand.filter((c) => c.kind === "friend").every((c) => !c.superior),
  );
  assert.ok(
    duels
      .view(room, user.id)
      .seats[0].hand.filter((c) => c.kind === "friend")
      .every((c) => c.sample),
  );
  assert.ok(a.hand.some((c) => c.kind === "friend"));
  assert.equal(b.mana, 4);
  const view = duels.view(room, user.id),
    op = view.seats[1];
  assert.ok(!("hand" in op));
  assert.ok(!("reserve" in op));
  assert.equal(op.handCount, 3);
  assert.ok(!JSON.stringify(view).includes("PRIVATE DESCRIPTION"));
  const before = structuredClone(a.definition);
  store.defineTrait(user, "sample-maya", {
    type: "bold",
    name: "Changed later",
    description: "Not part of the match",
    ability: {
      trigger: "active",
      effect: "damage",
      target: "enemy",
      amount: 3,
    },
  });
  assert.deepEqual(a.definition, before);
  assert.ok(
    store.all("SELECT id FROM card_versions WHERE owner=?", user.id).length ===
      13,
  );
  assert.throws(() => duels.action(room, b.user.id, "end:::"), /not available/);
});

test("summoning rests a unit, mana carries and replenishes, and guards enforce legal attack targets", async (t) => {
  const { duels, room, a, b } = await fixture(t);
  const friend = a.hand.find((c) => c.kind === "friend");
  duels.action(
    room,
    a.user.id,
    duels.legal(room, a.user.id).find((x) => x.cardId === friend.id).id,
  );
  const unit = a.board[0];
  assert.equal(a.mana, 0);
  assert.ok(unit.acted);
  assert.ok(!duels.legal(room, a.user.id).some((x) => x.unitId === unit.id));
  duels.action(room, a.user.id, "end:::");
  duels.action(room, b.user.id, "end:::");
  assert.equal(a.mana, 2);
  assert.equal(unit.acted, false);
  assert.equal(a.hand.length, 3);
  const guard = duels.unit(card("Guard"), false, 0);
  guard.guard = true;
  b.board.push(guard);
  const attacks = duels
    .legal(room, a.user.id)
    .filter((x) => x.type === "attack");
  assert.ok(attacks.length);
  assert.ok(attacks.every((x) => x.targetId === guard.id));
  const hp = unit.health;
  duels.action(room, a.user.id, attacks[0].id);
  assert.equal(unit.health, hp - 2);
  assert.equal(guard.health, 3);
});

test("trigger priority rotates deterministically and all abilities share one activation per round", async (t) => {
  const { duels, room, a } = await fixture(t);
  const u = duels.unit(
    card("Reactive", [
      ability("first", "hurt", "shield", "self", 1),
      ability("second", "hurt", "heal", "self", 1),
      ability("manual", "active", "shield", "self", 2),
    ]),
    false,
    0,
  );
  u.acted = false;
  a.board.push(u);
  a.mana = 10;
  duels.hit(room, u.id, 1, room.seats[1].user.id);
  duels.resolve(room);
  assert.equal(u.cursor, 1);
  assert.equal(u.shield, 1);
  assert.ok(
    !duels
      .legal(room, a.user.id)
      .some((x) => x.type === "ability" && x.unitId === u.id),
  );
  room.turnNumber = 3;
  u.shield = 0;
  duels.hit(room, u.id, 1, room.seats[1].user.id);
  duels.resolve(room);
  assert.equal(u.cursor, 2);
  assert.equal(u.health, 4);
  const before = u.health;
  duels.hit(room, u.id, 1, room.seats[1].user.id);
  duels.resolve(room);
  assert.equal(u.health, before - 1);
});

test("linked power-ups require their friend; superior upgrades preserve damage, actions and reserve spending", async (t) => {
  const { duels, room, a } = await fixture(t);
  a.mana = 10;
  const power = a.hand.find((c) => c.kind === "power") || {
    ...card("Power"),
    id: "power",
    kind: "power",
    effect: "heal",
    personId: "sample-maya",
    cost: 2,
  };
  a.hand = [power];
  assert.ok(!duels.legal(room, a.user.id).some((x) => x.cardId === power.id));
  const u = duels.unit(
    { ...card("Maya"), personId: a.reserve.personId },
    false,
    0,
  );
  u.health = 2;
  u.acted = true;
  u.usedAbilityRound = duels.round(room);
  a.board = [u];
  const upgrade = duels
    .legal(room, a.user.id)
    .find((x) => x.type === "upgrade");
  assert.ok(upgrade);
  duels.action(room, a.user.id, upgrade.id);
  assert.equal(a.board[0].health, 5);
  assert.equal(a.board[0].acted, true);
  assert.equal(a.board[0].usedAbilityRound, duels.round(room));
  assert.equal(a.reserveUsed, true);
  assert.equal(a.mana, 5);
  assert.ok(
    !duels
      .legal(room, a.user.id)
      .some((x) => ["upgrade", "superior"].includes(x.type)),
  );
});

test("combat mana is capped, fatigue increases, simultaneous defeat draws, and results persist once", async (t) => {
  const { store, duels, room, a, b } = await fixture(t);
  a.mana = 0;
  for (let i = 0; i < 3; i++) {
    const u = duels.unit(card(`Enemy ${i}`), false, 0);
    u.health = 0;
    u.lastDamagedBy = a.user.id;
    b.board.push(u);
  }
  duels.resolve(room);
  assert.equal(a.mana, 2);
  a.deck = [];
  a.health = 30;
  duels.draw(room, a);
  duels.draw(room, a);
  assert.equal(a.health, 27);
  assert.equal(a.fatigue, 2);
  a.health = 1;
  duels.draw(room, a);
  duels.effect(room, a, null, { effect: "heal", amount: 3 }, a.user.id);
  assert.ok(a.health <= 0, "Healing must not reverse a player defeat.");
  a.health = 0;
  b.health = 0;
  duels.resolve(room);
  assert.equal(room.phase, "finished");
  assert.equal(room.winner, null);
  assert.equal(store.all("SELECT * FROM matches").length, 1);
  duels.resolve(room);
  assert.equal(store.all("SELECT * FROM matches").length, 1);
});

test("turn deadlines advance turns, time limits compare health, and disconnected seats forfeit after 30 seconds", async (t) => {
  const one = await fixture(t);
  one.advance(30001);
  one.duels.tick();
  assert.equal(one.room.turnNumber, 2);
  one.a.health = 20;
  one.b.health = 10;
  one.advance(480000);
  one.duels.tick();
  assert.equal(one.room.winner, one.a.user.id);
  assert.equal(one.room.reason, "time");
  const two = await fixture(t);
  two.duels.disconnect(two.user.id);
  two.advance(29000);
  two.duels.tick();
  assert.equal(two.room.phase, "playing");
  two.duels.reconnect(two.user.id);
  assert.equal(two.a.connected, true);
  two.duels.disconnect(two.user.id);
  two.advance(30001);
  two.duels.tick();
  assert.equal(two.room.phase, "finished");
  assert.equal(two.room.winner, two.b.user.id);
  assert.equal(two.room.reason, "forfeit");
});

test("a bot completes a full legal duel without inspecting or receiving its opponent’s hand", async (t) => {
  const { duels, room, a, b } = await fixture(t);
  let moves = 0;
  while (room.phase === "playing" && moves++ < 1000) {
    const active = room.seats[room.current];
    const action = duels.botAction(room);
    assert.ok(
      duels.legal(room, active.user.id).some((x) => x.id === action.id),
    );
    duels.action(room, active.user.id, action.id);
  }
  assert.equal(room.phase, "finished");
  assert.ok(moves < 1000);
  const view = duels.view(room, a.user.id);
  assert.ok(!("hand" in view.seats.find((s) => s.id === b.user.id)));
});

test("late action packets cannot play beyond a turn deadline or change an expired match result", async (t) => {
  const { duels, room, a, b, advance } = await fixture(t);
  const play = duels.legal(room, a.user.id).find((x) => x.type === "play");
  advance(30001);
  duels.action(room, a.user.id, play.id);
  assert.equal(a.board.length, 0);
  assert.equal(a.mana, 3);
  assert.equal(room.turnNumber, 2);
  a.health = 25;
  b.health = 20;
  advance(480000);
  duels.action(room, b.user.id, "end:::");
  assert.equal(room.phase, "finished");
  assert.equal(room.reason, "time");
  assert.equal(room.winner, a.user.id);
});
