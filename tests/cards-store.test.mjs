import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../server/cards/store.mjs";
import { CATALOG, defaultAbility, validateAbility } from "../shared/cards.mjs";

const signup = (s, username) =>
  s.register({ name: username, username, password: "Testing-friends-123" });
const trait = (type, name = "A personal interpretation") => ({
  type,
  name,
  description: `PRIVATE DESCRIPTION: ${name}`,
  ability: defaultAbility(type),
});

test("identities are persistent, passwords are hashed, sessions expire and logout revokes them", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "friendstack-")),
    path = join(dir, "test.sqlite");
  let s = new CardStore(path);
  t.after(() => {
    s.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = join(dir, "test.sqlite" + suffix);
      if (existsSync(file)) unlinkSync(file);
    }
    rmdirSync(dir);
  });
  const a = await signup(s, "alice");
  assert.ok(s.auth(a.token));
  assert.ok(
    !s
      .get("SELECT password FROM accounts WHERE id=?", a.user.id)
      .password.includes("Testing"),
  );
  assert.equal(s.bootstrap(a.user).decks[0].cards.length, 12);
  s.close();
  s = new CardStore(path);
  const again = await s.login({
    username: "ALICE",
    password: "Testing-friends-123",
  });
  assert.equal(again.user.id, a.user.id);
  assert.equal(s.bootstrap(again.user).people.length, 4);
  await assert.rejects(
    () => s.login({ username: "alice", password: "wrong" }),
    /Check/,
  );
  await assert.rejects(() => signup(s, "alice"), /taken/);
  s.logout(a.token);
  assert.equal(s.auth(a.token), null);
  assert.ok(s.auth(again.token));
  s.run("UPDATE sessions SET expires=0");
  assert.equal(s.auth(again.token), null);
});

test("claiming requires an invitation; only the subject approves; private perspectives survive canonical profile linking", async (t) => {
  const s = new CardStore(":memory:");
  t.after(() => s.close());
  const alice = (await signup(s, "alice")).user,
    bob = (await signup(s, "bob")).user,
    eve = (await signup(s, "eve")).user;
  const p = s.addFriend(alice, { name: "Bob as I know him", face: 1 });
  s.defineTrait(alice, p.id, trait("bold", "My midnight rescue"));
  assert.equal(s.profile(alice, p.id).card.approvedCount, 0);
  assert.ok(
    s
      .profile(alice, p.id)
      .draftCard.abilities.some((a) => a.source === "draft"),
  );
  assert.throws(() => s.profile(eve, p.id), /not in your pool/);
  assert.equal(s.bootstrap(bob).incoming.length, 0);
  assert.throws(() => s.claim(bob, "invalid"), /invalid/);
  const invitation = s.invite(alice, p.id);
  assert.throws(() => s.claim(alice, invitation.token), /invited friend/);
  s.claim(bob, invitation.token);
  assert.throws(() => s.claim(bob, invitation.token), /expired/);
  const pending = s.bootstrap(bob).incoming[0];
  assert.equal(pending.name, "My midnight rescue");
  assert.throws(() => s.review(eve, pending.id, true), /Only/);
  s.review(bob, pending.id, true);
  const aCard = s.card(alice, p.id);
  assert.equal(aCard.personId, bob.personId);
  assert.equal(aCard.approvedCount, 1);
  assert.ok(
    s
      .card(bob, bob.personId)
      .abilities.some((a) => a.name === "My midnight rescue"),
  );
  const other = s.addFriend(eve, { name: "Bob, the messy one" });
  s.defineTrait(eve, other.id, trait("messy", "Food fight specialist"));
  const invite2 = s.invite(eve, other.id);
  s.claim(bob, invite2.token);
  const pending2 = s.bootstrap(bob).incoming[0];
  s.review(bob, pending2.id, true);
  assert.equal(s.profile(eve, other.id).id, bob.personId);
  assert.ok(
    s
      .card(eve, other.id)
      .abilities.some((a) => a.name === "Food fight specialist"),
  );
  assert.ok(
    !JSON.stringify(s.profile(alice, p.id)).includes("Food fight specialist"),
  );
  assert.ok(
    !JSON.stringify(s.profile(eve, other.id)).includes("My midnight rescue"),
  );
  assert.ok(!JSON.stringify(aCard).includes("PRIVATE DESCRIPTION"));
  assert.throws(
    () => s.defineTrait(bob, bob.personId, trait("bold")),
    /cannot endorse yourself/,
  );
});

test("approved revisions stay playable while changes wait; rejecting a revision preserves earlier powers", async (t) => {
  const s = new CardStore(":memory:");
  t.after(() => s.close());
  const alice = (await signup(s, "alice")).user,
    bob = (await signup(s, "bob")).user;
  const p = s.addFriend(alice, { name: "Bob" });
  s.defineTrait(alice, p.id, trait("bold", "First version"));
  s.claim(bob, s.invite(alice, p.id).token);
  s.review(bob, s.bootstrap(bob).incoming[0].id, true);
  s.defineTrait(alice, p.id, trait("bold", "Pending second version"));
  assert.ok(
    s.card(alice, p.id).abilities.some((a) => a.name === "First version"),
  );
  assert.ok(
    s
      .card(alice, p.id, true)
      .abilities.some((a) => a.name === "Pending second version"),
  );
  s.review(bob, s.bootstrap(bob).incoming[0].id, false);
  assert.ok(
    s.card(alice, p.id).abilities.some((a) => a.name === "First version"),
  );
  s.defineTrait(alice, p.id, trait("bold", "Approved third version"));
  s.review(bob, s.bootstrap(bob).incoming[0].id, true);
  assert.ok(
    s
      .card(alice, p.id)
      .abilities.some((a) => a.name === "Approved third version"),
  );
  assert.equal(s.profile(alice, p.id).traits[0].revisions.length, 3);
  assert.equal(
    s.card(alice, p.id).endorsements.find((x) => x.id === "bold").count,
    1,
  );
});

test("all twelve discovered types remain, consensus ties use catalogue order, and superior unlocks need approved personal traits", async (t) => {
  const s = new CardStore(":memory:");
  t.after(() => s.close());
  const a = (await signup(s, "alice")).user;
  const sample = "sample-maya";
  for (const type of CATALOG)
    s.defineTrait(a, sample, trait(type.id, `${type.name} personally`));
  const c = s.card(a, sample);
  assert.equal(c.abilities.length, 12);
  assert.equal(c.approvedCount, 12);
  assert.equal(c.superior, true);
  assert.deepEqual(
    c.endorsements.slice(0, 2).map((x) => x.id),
    ["bold", "loyal"],
  );
  assert.ok(
    s.profile(a, sample).traits.find((t) => t.type === "bold").revisions
      .length === 2,
  );
  const real = s.addFriend(a, { name: "New friend" });
  for (const type of ["bold", "loyal", "caring"])
    s.defineTrait(a, real.id, trait(type));
  assert.equal(s.card(a, real.id).superior, false);
  assert.equal(s.card(a, real.id, true).abilities.length, 3);
});

test("decks reject invalid counts, inaccessible people, foreign deck IDs, and locked reserves", async (t) => {
  const s = new CardStore(":memory:");
  t.after(() => s.close());
  const a = (await signup(s, "alice")).user,
    b = (await signup(s, "bob")).user;
  const d = s.bootstrap(a).decks[0];
  assert.equal(s.validateDeck(a, d).cards.length, 12);
  assert.throws(() => s.saveDeck(b, d), /belongs/);
  assert.throws(
    () => s.validateDeck(a, { ...d, cards: d.cards.slice(1) }),
    /six/,
  );
  const p = s.addFriend(a, { name: "Unrated" });
  assert.throws(
    () => s.validateDeck(a, { ...d, reserve: p.id }),
    /three approved/,
  );
  const bad = structuredClone(d);
  for (const c of bad.cards.filter((c) => c.kind === "friend"))
    c.personId = "sample-maya";
  assert.throws(() => s.validateDeck(a, bad), /different friends/);
  assert.throws(
    () =>
      validateAbility({
        trigger: "active",
        target: "opponent",
        effect: "damage",
        amount: 999,
      }),
    /budget/,
  );
  assert.throws(
    () =>
      validateAbility({
        trigger: "hurt",
        target: "opponent",
        effect: "heal",
        amount: 1,
      }),
    /target/,
  );
});
