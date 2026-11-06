import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCloudServer } from "../../server/cloud/server.mjs";
import { CATALOG, defaultAbility } from "../../shared/cards.mjs";
import { fixture, api, account, duel, until, wait } from "./helpers.mjs";

test("three independent instances share identities, claims, private approvals, immutable histories and legal decks", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice"),
    bob = await account(f.b, "bob"),
    eve = await account(f.c, "eve");
  assert.equal(
    (await api(f.b, "/me", undefined, alice.token)).body.user.id,
    alice.user.id,
  );
  assert.equal((await api(f.a, "/me")).status, 401);
  const p = (await api(f.a, "/friends", { name: "Bob" }, alice.token)).body;
  const description = "PRIVATE online relationship perspective";
  for (const type of CATALOG)
    assert.equal(
      (
        await api(
          f.a,
          `/friends/${p.id}/traits`,
          {
            type: type.id,
            name: type.name,
            description,
            ability: defaultAbility(type.id),
          },
          alice.token,
        )
      ).status,
      200,
    );
  assert.ok(
    !(await api(f.b, "/me", undefined, eve.token)).body.people.some((p) =>
      p.traits.some((t) =>
        t.revisions.some((r) => r.description === description),
      ),
    ),
  );
  const invite = (await api(f.a, `/friends/${p.id}/invite`, {}, alice.token))
    .body;
  const claims = await Promise.all([
    api(f.b, "/claim", { token: invite.token }, bob.token),
    api(f.c, "/claim", { token: invite.token }, eve.token),
  ]);
  assert.equal(
    claims.filter((r) => r.status === 200).length,
    1,
    "Single-use claim must be atomic",
  );
  const subject = claims[0].status === 200 ? bob : eve;
  let boot = (await api(f.c, "/me", undefined, subject.token)).body;
  assert.equal(boot.incoming.length, 12);
  assert.equal(
    (
      await api(
        f.a,
        `/review/${boot.incoming[0].id}`,
        { approve: true },
        alice.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        f.b,
        `/friends/${subject.user.personId}/traits`,
        {
          type: "bold",
          name: "Self endorsement",
          description,
          ability: defaultAbility("bold"),
        },
        subject.token,
      )
    ).status,
    400,
  );
  for (const r of boot.incoming)
    assert.equal(
      (await api(f.b, `/review/${r.id}`, { approve: true }, subject.token))
        .status,
      200,
    );
  const profile = (
    await api(f.b, "/me", undefined, alice.token)
  ).body.people.find((x) => x.id === subject.user.personId);
  assert.equal(profile.traits.length, 12);
  assert.equal(profile.card.abilities.length, 12);
  assert.ok(profile.card.superior);
  assert.deepEqual(
    profile.card.endorsements.slice(0, 2).map((t) => t.id),
    CATALOG.slice(0, 2).map((t) => t.id),
  );
  await api(
    f.c,
    `/friends/${p.id}/traits`,
    {
      type: "bold",
      name: "Revised bold",
      description: "New private draft",
      ability: defaultAbility("bold"),
    },
    alice.token,
  );
  const edited = (
    await api(f.a, "/me", undefined, alice.token)
  ).body.people.find((x) => x.id === subject.user.personId);
  assert.equal(
    edited.card.abilities.find((a) => a.type === "bold").name,
    "Bold",
  );
  assert.equal(
    edited.draftCard.abilities.find((a) => a.type === "bold").name,
    "Revised bold",
  );
  assert.equal(
    edited.traits.find((t) => t.type === "bold").revisions.length,
    2,
  );
  assert.equal(
    (
      await api(
        f.a,
        "/decks",
        { ...alice.boot.decks[0], cards: [] },
        alice.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (await api(f.b, "/decks", alice.boot.decks[0], eve.token)).status,
    400,
  );
  assert.equal(
    (
      await api(f.b, "/friends", { name: "Invalid" }, alice.token, {
        Origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  await api(f.c, "/logout", {}, alice.token);
  assert.equal((await api(f.a, "/me", undefined, alice.token)).status, 401);
});

test("players on different instances duel privately; duplicate and stale moves cannot double-spend", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice"),
    bob = await account(f.b, "bob"),
    { a, b } = await duel(f, alice, bob);
  assert.equal(a.room.code.length, 8);
  assert.equal(b.room.code, a.room.code);
  const move = a.room.legalActions.find((a) => a.type === "play"),
    version = a.room.version,
    id = randomUUID();
  a.send({ type: "act", actionId: move.id, requestId: id, version });
  a.send({ type: "act", actionId: move.id, requestId: id, version });
  await until(
    () => b.room.seats.find((s) => s.id === alice.user.id).board.length === 1,
  );
  assert.equal(a.room.seats.find((s) => s.id === alice.user.id).mana, 0);
  assert.deepEqual(a.errors, []);
  a.send({ type: "act", actionId: "end:::", version });
  await until(() => a.errors.length === 1);
  assert.match(a.errors[0], /table changed/);
  assert.equal(a.room.currentPlayerId, alice.user.id);
  assert.deepEqual(a.leaks, []);
  assert.deepEqual(b.leaks, []);
  assert.equal(
    (
      await f.c.db.get(
        "SELECT COUNT(*)::int AS n FROM __SCHEMA__.card_versions",
      )
    ).n,
    26,
  );
});

test("instance termination and reconnect on a different instance preserve frozen hand, board, mana and timer", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice"),
    bob = await account(f.b, "bob");
  const { a, b } = await duel(f, alice, bob),
    code = a.room.code;
  a.send({
    type: "act",
    actionId: a.room.legalActions.find((x) => x.type === "play").id,
  });
  await until(() => b.room.seats[0].board.length === 1);
  const before = structuredClone(a.room);
  await f.a.close();
  f.servers.splice(f.servers.indexOf(f.a), 1);
  const recovered = await f.socket(f.c, alice);
  await until(() => recovered.room?.code === code);
  const self = recovered.room.seats.find((s) => s.id === alice.user.id),
    prior = before.seats.find((s) => s.id === alice.user.id);
  assert.deepEqual(self.hand, prior.hand);
  assert.deepEqual(self.board, prior.board);
  assert.equal(self.mana, prior.mana);
  assert.equal(recovered.room.turnEndsAt, before.turnEndsAt);
  assert.equal(recovered.room.phase, "playing");
  assert.deepEqual(recovered.leaks, []);
});

test("cross-instance takeover cannot disconnect the newer session, and logout revokes sockets everywhere", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice");
  const old = await f.socket(f.a, alice);
  old.send({ type: "create", deckId: alice.boot.decks[0].id });
  await until(() => old.room);
  const fresh = await f.socket(f.c, alice);
  await until(() => old.closed === 4001 && fresh.room);
  await wait(100);
  assert.ok((await f.b.duels.current(alice.user.id)).state.seats[0].connected);
  await api(f.b, "/logout", {}, alice.token);
  await until(() => fresh.closed === 4003);
});

test("concurrent joins and room admission have a single authoritative winner", async (t) => {
  const f = await fixture(t, { maxRooms: 2 }),
    aUser = await account(f.a, "hosta"),
    bUser = await account(f.b, "hostb"),
    cUser = await account(f.c, "guest");
  const a = await f.socket(f.a, aUser),
    b = await f.socket(f.b, bUser),
    c = await f.socket(f.c, cUser);
  a.send({ type: "create", deckId: aUser.boot.decks[0].id });
  b.send({ type: "create", deckId: bUser.boot.decks[0].id });
  await until(() => a.room && b.room);
  c.send({ type: "create", deckId: cUser.boot.decks[0].id });
  await until(() => c.errors.length);
  assert.match(c.errors[0], /full/);
  const connection = (
    await f.a.db.get(
      "SELECT connection_id FROM __SCHEMA__.connections WHERE user_id=$1",
      cUser.user.id,
    )
  ).connection_id;
  const results = await Promise.allSettled([
    f.a.duels.action(cUser.user, connection, {
      type: "join",
      code: a.room.code,
      deckId: cUser.boot.decks[0].id,
    }),
    f.b.duels.action(cUser.user, connection, {
      type: "join",
      code: b.room.code,
      deckId: cUser.boot.decks[0].id,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await f.c.db.get(
        "SELECT COUNT(*)::int AS n FROM __SCHEMA__.memberships WHERE user_id=$1",
        cUser.user.id,
      )
    ).n,
    1,
  );
});

test("late packets obey deadlines; simultaneous sweeps persist one result; expiry and fatigue survive reload", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice"),
    bob = await account(f.b, "bob"),
    { a, b } = await duel(f, alice, bob);
  const row = await f.c.duels.current(alice.user.id);
  row.state.endsAt = Date.now() - 1;
  row.state.seats[0].health = 12;
  row.state.seats[1].health = 8;
  await f.c.db.query(
    "UPDATE __SCHEMA__.rooms SET state=$2,next_tick=0 WHERE code=$1",
    [row.code, JSON.stringify(row.state)],
  );
  a.send({ type: "act", actionId: "end:::" });
  await Promise.all([f.a.duels.sweep(), f.b.duels.sweep(), f.c.duels.sweep()]);
  await until(() => a.room.phase === "finished" && b.room.phase === "finished");
  assert.equal(a.room.winner, alice.user.id);
  assert.equal(a.room.reason, "time");
  assert.equal(
    (await f.a.db.get("SELECT COUNT(*)::int AS n FROM __SCHEMA__.matches")).n,
    2,
  );
  await Promise.all([f.a.duels.sweep(), f.c.duels.sweep()]);
  assert.equal(
    (await f.a.db.get("SELECT COUNT(*)::int AS n FROM __SCHEMA__.matches")).n,
    2,
  );
  assert.equal(
    (await api(f.b, "/me", undefined, alice.token)).body.matches[0].details
      .health,
    12,
  );
});

test("lost connections forfeit after the grace period; old room data and unapproved powers stay private", async (t) => {
  const f = await fixture(t),
    alice = await account(f.a, "alice"),
    bob = await account(f.b, "bob"),
    { a, b } = await duel(f, alice, bob);
  b.ws.terminate();
  await until(
    async () =>
      !(await f.c.duels.current(bob.user.id)).state.seats.find(
        (s) => s.user.id === bob.user.id,
      ).connected,
  );
  const row = await f.c.duels.current(alice.user.id);
  row.state.seats.find((s) => s.user.id === bob.user.id).disconnectedAt =
    Date.now() - 31000;
  await f.c.db.query(
    "UPDATE __SCHEMA__.rooms SET state=$2,next_tick=0 WHERE code=$1",
    [row.code, JSON.stringify(row.state)],
  );
  await f.c.duels.sweep();
  await until(() => a.room.phase === "finished");
  assert.equal(a.room.reason, "forfeit");
  assert.equal(a.room.winner, alice.user.id);
  assert.deepEqual(a.leaks, []);
  assert.equal(await f.a.duels.read(bob.user.id), null);
});

test("shared HTTP limits, malformed payloads, health, maintenance authentication and unknown routes", async (t) => {
  const f = await fixture(t);
  const health = await fetch(f.a.base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(f.a.base + "/api/maintenance")).status, 401);
  assert.equal((await fetch(f.a.base + "/api/missing")).status, 404);
  assert.equal(
    (
      await fetch(f.b.base + "/api/cards/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(f.b.base + "/api/cards/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(34000),
      })
    ).status,
    413,
  );
  for (let i = 0; i < 10; i++)
    await api(i % 2 ? f.a : f.b, "/auth/login", {
      username: "missing",
      password: "bad",
    });
  assert.equal(
    (await api(f.c, "/auth/login", { username: "missing", password: "bad" }))
      .status,
    429,
  );
});

test(
  "a shared-storage practice bot completes a natural duel and a rematch starts with fresh state",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t),
      user = await account(f.a, "practice"),
      c = await f.socket(f.b, user);
    c.send({ type: "create", solo: true, deckId: user.boot.decks[0].id });
    await until(() => c.room?.phase === "playing");
    const originalId = c.room.id;
    assert.ok(c.room.seats.find((s) => s.id === user.user.id).reserve);
    while (c.room.phase === "playing") {
      const version = c.room.version;
      if (c.room.currentPlayerId === user.user.id)
        c.send({
          type: "act",
          actionId: c.room.legalActions.find((a) => a.type === "end").id,
        });
      await until(
        () => c.room.version > version,
        "Bot or player should advance the duel",
        5000,
      );
    }
    assert.equal(c.room.reason, "health");
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.leaks, []);
    assert.equal(
      (await api(f.c, "/me", undefined, user.token)).body.matches.length,
      1,
    );
    c.send({ type: "rematch" });
    await until(() => c.room.id !== originalId && c.room.phase === "playing");
    assert.equal(c.room.seats.find((s) => s.id === user.user.id).health, 30);
    assert.equal(
      c.room.seats.find((s) => s.id === user.user.id).hand.length,
      3,
    );
  },
);

test("an unavailable schema reports a safe health code and the same instance recovers after repair", async (t) => {
  const runtime = createCloudServer({
    url: process.env.FRIENDSTACK_TEST_DATABASE_URL,
    schema: `repair_${randomUUID().replaceAll("-", "")}`,
    listen: false,
    migrate: false,
  });
  t.after(() => runtime.close());
  await runtime.ready.catch(() => {});
  await new Promise((r) => runtime.http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${runtime.http.address().port}/api/health`;
  let response = await fetch(url);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).storageCode, "42P01");
  await runtime.db.migrate();
  response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "shared");
});
