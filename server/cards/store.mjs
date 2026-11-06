import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  CATALOG,
  SAMPLE_FRIENDS,
  defaultAbility,
  validateAbility,
} from "../../shared/cards.mjs";

const derive = promisify(scrypt);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value, max = 80) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, max)
    : "";
const json = (value) => JSON.stringify(value);
export class CardStore {
  constructor(path = "data/friendstack.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,name TEXT,password TEXT,salt TEXT,person_id TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,account_id TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT,creator TEXT,claimed_by TEXT,canonical TEXT,color TEXT,face INTEGER,sample INTEGER DEFAULT 0,created INTEGER);
      CREATE TABLE IF NOT EXISTS relationships(author TEXT,person TEXT,created INTEGER,PRIMARY KEY(author,person));
      CREATE TABLE IF NOT EXISTS traits(id TEXT PRIMARY KEY,author TEXT,person TEXT,type TEXT,created INTEGER,UNIQUE(author,person,type));
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,trait_id TEXT,name TEXT,description TEXT,ability TEXT,status TEXT,created INTEGER,reviewed INTEGER);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,person TEXT,creator TEXT,expires INTEGER,used INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS decks(id TEXT PRIMARY KEY,owner TEXT,name TEXT,cards TEXT,reserve TEXT,updated INTEGER);
      CREATE TABLE IF NOT EXISTS card_versions(id TEXT PRIMARY KEY,owner TEXT,person TEXT,definition TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS matches(id TEXT,owner TEXT,result TEXT,opponent TEXT,details TEXT,created INTEGER,PRIMARY KEY(id,owner));
      CREATE INDEX IF NOT EXISTS rev_trait ON revisions(trait_id,created);
      CREATE INDEX IF NOT EXISTS trait_person ON traits(person,author);
      PRAGMA user_version=1;`);
    for (const p of SAMPLE_FRIENDS)
      this.run(
        "INSERT OR IGNORE INTO people VALUES(?,?,?,?,?,?,?,?,?)",
        p.id,
        p.name,
        "fictional",
        "fictional",
        p.id,
        p.color,
        p.face,
        1,
        Date.now(),
      );
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  publicUser(a) {
    return {
      id: a.id,
      name: a.name,
      username: a.username,
      personId: a.person_id,
    };
  }
  async register(data) {
    const name = text(data.name, 30),
      username = text(data.username, 24).toLowerCase();
    if (!name || !/^[a-z0-9_]{3,24}$/.test(username))
      throw new Error(
        "Use a name and a username with 3–24 letters, numbers, or underscores.",
      );
    if (
      typeof data.password !== "string" ||
      data.password.length < 8 ||
      data.password.length > 128
    )
      throw new Error("Choose a password with 8–128 characters.");
    if (this.get("SELECT id FROM accounts WHERE username=?", username))
      throw new Error("That username is already taken.");
    const salt = randomBytes(16).toString("hex"),
      password = (await derive(data.password, salt, 64)).toString("hex");
    const id = randomUUID(),
      personId = randomUUID();
    this.transaction(() => {
      this.run(
        "INSERT INTO accounts VALUES(?,?,?,?,?,?,?)",
        id,
        username,
        name,
        password,
        salt,
        personId,
        Date.now(),
      );
      this.run(
        "INSERT INTO people VALUES(?,?,?,?,?,?,?,?,?)",
        personId,
        name,
        id,
        id,
        personId,
        "lavender",
        0,
        0,
        Date.now(),
      );
      this.seed(id);
    });
    return this.login({ username, password: data.password });
  }
  async login(data) {
    if (typeof data.password !== "string" || data.password.length > 128)
      throw new Error("Check your username and password.");
    const a = this.get(
      "SELECT * FROM accounts WHERE username=?",
      text(data.username, 24),
    );
    const value = await derive(
      data.password,
      a?.salt || "not-a-real-account-salt",
      64,
    );
    if (!a || !timingSafeEqual(value, Buffer.from(a.password, "hex")))
      throw new Error("Check your username and password.");
    const token = randomBytes(32).toString("hex");
    this.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      a.id,
      Date.now() + 7 * 86400000,
    );
    return { token, user: this.publicUser(a) };
  }
  auth(token) {
    if (typeof token !== "string" || token.length !== 64) return null;
    const a = this.get(
      "SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>?",
      hash(token),
      Date.now(),
    );
    return a ? this.publicUser(a) : null;
  }
  logout(token) {
    if (typeof token === "string")
      this.run("DELETE FROM sessions WHERE hash=?", hash(token));
  }
  person(id) {
    const p = this.get("SELECT * FROM people WHERE id=?", id);
    if (!p) throw new Error("Friend not found.");
    return p.canonical !== p.id
      ? this.get("SELECT * FROM people WHERE id=?", p.canonical)
      : p;
  }
  aliases(id) {
    const p = this.person(id);
    return this.all(
      "SELECT id FROM people WHERE canonical=? OR id=?",
      p.id,
      p.id,
    ).map((x) => x.id);
  }
  canSee(user, id) {
    const p = this.person(id);
    return (
      p.claimed_by === user.id ||
      this.aliases(id).some((alias) =>
        this.get(
          "SELECT 1 FROM relationships WHERE author=? AND person=?",
          user.id,
          alias,
        ),
      )
    );
  }
  requireFriend(user, id) {
    if (!this.canSee(user, id))
      throw new Error("This friend is not in your pool.");
    return this.person(id);
  }
  addFriend(user, data) {
    const name = text(data.name, 36);
    if (!name) throw new Error("Give your friend a name.");
    if (
      this.all("SELECT person FROM relationships WHERE author=?", user.id)
        .length >= 100
    )
      throw new Error("Your local friend pool is full.");
    const id = randomUUID(),
      color = ["lavender", "mint", "peach"].includes(data.color)
        ? data.color
        : "lavender";
    this.transaction(() => {
      this.run(
        "INSERT INTO people VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        name,
        user.id,
        null,
        id,
        color,
        Number.isInteger(Number(data.face))
          ? Math.max(0, Math.min(2, Number(data.face)))
          : 0,
        0,
        Date.now(),
      );
      this.run(
        "INSERT INTO relationships VALUES(?,?,?)",
        user.id,
        id,
        Date.now(),
      );
    });
    return this.profile(user, id);
  }
  traitsFor(id) {
    const aliases = this.aliases(id),
      slots = aliases.map(() => "?").join(",");
    return this.all(
      `SELECT t.*,a.name AS author_name FROM traits t LEFT JOIN accounts a ON a.id=t.author WHERE person IN (${slots}) ORDER BY t.created,t.id`,
      ...aliases,
    ).map((t) => ({
      ...t,
      revisions: this.all(
        "SELECT * FROM revisions WHERE trait_id=? ORDER BY created DESC,id",
        t.id,
      ).map((r) => ({ ...r, ability: JSON.parse(r.ability) })),
    }));
  }
  defineTrait(user, personId, data) {
    const p = this.requireFriend(user, personId);
    if (p.claimed_by === user.id)
      throw new Error(
        "Your friends describe you. You cannot endorse yourself.",
      );
    if (!CATALOG.some((t) => t.id === data.type))
      throw new Error("Select a catalogue trait.");
    const name = text(data.name, 40),
      description = text(data.description, 600),
      ability = validateAbility(data.ability);
    if (!name || !description)
      throw new Error("Add a trait name and a private description.");
    return this.transaction(() => {
      let trait = this.traitsFor(p.id).find(
        (t) => t.author === user.id && t.type === data.type,
      );
      if (!trait) {
        trait = { id: randomUUID() };
        this.run(
          "INSERT INTO traits VALUES(?,?,?,?,?)",
          trait.id,
          user.id,
          p.id,
          data.type,
          Date.now(),
        );
      }
      this.run(
        "UPDATE revisions SET status='superseded' WHERE trait_id=? AND status='pending'",
        trait.id,
      );
      const id = randomUUID();
      this.run(
        "INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)",
        id,
        trait.id,
        name,
        description,
        json(ability),
        p.sample ? "approved" : "pending",
        Math.max(
          Date.now(),
          Number(
            this.get(
              "SELECT MAX(created) AS latest FROM revisions WHERE trait_id=?",
              trait.id,
            ).latest || 0,
          ) + 1,
        ),
        p.sample ? Date.now() : null,
      );
      return this.profile(user, p.id);
    });
  }
  review(user, revisionId, approve) {
    const r = this.get(
      "SELECT r.*,t.person,t.author FROM revisions r JOIN traits t ON t.id=r.trait_id WHERE r.id=?",
      revisionId,
    );
    if (
      !r ||
      this.person(r.person).claimed_by !== user.id ||
      r.author === user.id
    )
      throw new Error("Only the described friend can review this trait.");
    if (r.status !== "pending")
      throw new Error("This revision has already been reviewed.");
    this.run(
      "UPDATE revisions SET status=?,reviewed=? WHERE id=?",
      approve ? "approved" : "rejected",
      Date.now(),
      revisionId,
    );
    return { ok: true };
  }
  invite(user, id) {
    const p = this.requireFriend(user, id);
    if (p.claimed_by || p.sample)
      throw new Error("This profile is already claimed.");
    if (p.creator !== user.id)
      throw new Error("Only the creator can invite this friend.");
    const token = randomBytes(24).toString("hex");
    this.run(
      "INSERT INTO invites VALUES(?,?,?,?,0)",
      hash(token),
      p.id,
      user.id,
      Date.now() + 7 * 86400000,
    );
    return { token, name: p.name };
  }
  invitation(token) {
    if (typeof token !== "string" || token.length !== 48)
      throw new Error("That invitation is invalid or expired.");
    const i = this.get(
      "SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?",
      hash(token),
      Date.now(),
    );
    if (!i) throw new Error("That invitation is invalid or expired.");
    return i;
  }
  claim(user, token) {
    return this.transaction(() => {
      const i = this.invitation(token),
        p = this.person(i.person);
      if (p.claimed_by || i.creator === user.id)
        throw new Error("Sign in as the invited friend to claim this profile.");
      this.run(
        "UPDATE people SET claimed_by=?,canonical=? WHERE id=?",
        user.id,
        user.personId,
        p.id,
      );
      this.run("UPDATE invites SET used=1 WHERE hash=?", hash(token));
      this.run(
        "INSERT OR IGNORE INTO relationships VALUES(?,?,?)",
        user.id,
        this.get("SELECT person_id FROM accounts WHERE id=?", i.creator)
          .person_id,
        Date.now(),
      );
      return { ok: true, name: p.name };
    });
  }
  card(user, id, drafts = false) {
    const p = this.requireFriend(user, id),
      traits = this.traitsFor(p.id);
    const approved = traits.flatMap((t) => {
      const r = t.revisions.find((r) => r.status === "approved");
      return r ? [{ ...r, type: t.type, author: t.author }] : [];
    });
    const endorsements = CATALOG.map((t) => ({
      ...t,
      count: new Set(
        approved
          .filter((r) => r.type === t.id && r.author !== p.claimed_by)
          .map((r) => r.author),
      ).size,
    }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count || a.index - b.index);
    const own = new Map();
    for (const t of traits.filter(
      (t) => t.author === user.id || p.claimed_by === user.id,
    )) {
      const r = t.revisions.find((r) =>
        drafts
          ? ["pending", "approved"].includes(r.status)
          : r.status === "approved",
      );
      if (r && (!own.has(t.type) || r.created > own.get(t.type).created))
        own.set(t.type, { ...r, type: t.type });
    }
    const abilities = new Map(
      endorsements.slice(0, 2).map((t) => [
        t.id,
        {
          type: t.id,
          name: t.name,
          ability: defaultAbility(t.id),
          source: "shared",
        },
      ]),
    );
    for (const [type, r] of own)
      abilities.set(type, {
        type,
        name: r.name,
        ability: r.ability,
        source: r.status === "approved" ? "personal" : "draft",
      });
    const count = [...own.values()].filter(
      (r) => r.status === "approved",
    ).length;
    return {
      personId: p.id,
      name: p.name,
      color: p.color,
      face: p.face,
      sample: !!p.sample,
      attack: 2,
      health: 5,
      cost: 3,
      abilities: [...abilities.values()].sort(
        (a, b) =>
          CATALOG.findIndex((t) => t.id === a.type) -
          CATALOG.findIndex((t) => t.id === b.type),
      ),
      superior: count >= 3,
      approvedCount: count,
      endorsements: endorsements.map(({ id, name, count }) => ({
        id,
        name,
        count,
      })),
    };
  }
  profile(user, id) {
    const p = this.requireFriend(user, id),
      own = this.traitsFor(p.id).filter(
        (t) => t.author === user.id || p.claimed_by === user.id,
      );
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      face: p.face,
      sample: !!p.sample,
      claimed: !!p.claimed_by,
      isYou: p.claimed_by === user.id,
      card: this.card(user, p.id),
      draftCard: this.card(user, p.id, true),
      traits: own.map((t) => ({
        id: t.id,
        type: t.type,
        authorId: t.author,
        authorName: t.author_name || "Fictional starter",
        revisions: t.revisions,
      })),
    };
  }
  seed(author) {
    for (const [index, p] of SAMPLE_FRIENDS.entries()) {
      this.run(
        "INSERT OR IGNORE INTO relationships VALUES(?,?,?)",
        author,
        p.id,
        Date.now(),
      );
      for (const type of p.types) {
        const trait = randomUUID(),
          revision = randomUUID(),
          name = CATALOG.find((t) => t.id === type).name;
        this.run(
          "INSERT INTO traits VALUES(?,?,?,?,?)",
          trait,
          author,
          p.id,
          type,
          Date.now(),
        );
        this.run(
          "INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)",
          revision,
          trait,
          `${name} ${p.name.split(" ")[0]}`,
          `Fictional example: ${p.quote} This sample trait is pre-approved for local playtests.`,
          json(defaultAbility(type)),
          "approved",
          Date.now(),
          Date.now(),
        );
      }
    }
    const cards = SAMPLE_FRIENDS.flatMap((p) => [
      { kind: "friend", personId: p.id },
      { kind: "friend", personId: p.id },
      {
        kind: "power",
        personId: p.id,
        effect:
          p.types[0] === "loyal"
            ? "shield"
            : p.types[0] === "calm"
              ? "guard"
              : "attack",
      },
      { kind: "power", personId: p.id, effect: "heal" },
    ]);
    this.run(
      "INSERT INTO decks VALUES(?,?,?,?,?,?)",
      randomUUID(),
      author,
      "The inner circle",
      json(cards),
      SAMPLE_FRIENDS[0].id,
      Date.now(),
    );
  }
  validateDeck(user, data, drafts = false) {
    if (!Array.isArray(data.cards) || data.cards.length !== 12)
      throw new Error(
        "A deck needs six friend cards and six linked power-ups.",
      );
    const friends = data.cards.filter((c) => c.kind === "friend"),
      powers = data.cards.filter((c) => c.kind === "power");
    if (friends.length !== 6 || powers.length !== 6)
      throw new Error("Choose six friends and six linked power-ups.");
    const counts = new Map();
    for (const c of friends) {
      const p = this.requireFriend(user, c.personId);
      counts.set(p.id, (counts.get(p.id) || 0) + 1);
    }
    if (counts.size < 3 || [...counts.values()].some((n) => n > 2))
      throw new Error(
        "Use at least three different friends, with at most two copies each.",
      );
    for (const c of powers) {
      const p = this.requireFriend(user, c.personId);
      if (
        !counts.has(p.id) ||
        !["heal", "shield", "attack", "guard"].includes(c.effect)
      )
        throw new Error("Link each power-up to a friend in your deck.");
    }
    const cards = data.cards.map((c) => ({
      ...this.card(user, c.personId, drafts),
      kind: c.kind,
      ...(c.kind === "power" ? { effect: c.effect, cost: 2 } : {}),
    }));
    let reserve = null;
    if (data.reserve) {
      reserve = this.card(user, data.reserve, drafts);
      if (!reserve.superior)
        throw new Error("Your reserve needs three approved personal traits.");
    }
    return { cards, reserve };
  }
  saveDeck(user, data) {
    this.validateDeck(user, data);
    const id = data.id || randomUUID(),
      existing = this.get("SELECT * FROM decks WHERE id=?", id);
    if (existing && existing.owner !== user.id)
      throw new Error("That deck belongs to another player.");
    const cards = data.cards.map((c) => ({
      kind: c.kind,
      personId: this.person(c.personId).id,
      ...(c.kind === "power" ? { effect: c.effect } : {}),
    }));
    this.run(
      "INSERT INTO decks VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cards=excluded.cards,reserve=excluded.reserve,updated=excluded.updated",
      id,
      user.id,
      text(data.name, 36) || "My friend deck",
      json(cards),
      data.reserve || null,
      Date.now(),
    );
    return { id };
  }
  deck(user, id, drafts = false) {
    const d = this.get(
      "SELECT * FROM decks WHERE id=? AND owner=?",
      id,
      user.id,
    );
    if (!d) throw new Error("Select one of your saved decks.");
    return this.validateDeck(
      user,
      { cards: JSON.parse(d.cards), reserve: d.reserve },
      drafts,
    );
  }
  snapshotCards(user, definition) {
    const ids = [];
    for (const c of [
      ...definition.cards,
      ...(definition.reserve ? [definition.reserve] : []),
    ]) {
      const id = randomUUID();
      this.run(
        "INSERT INTO card_versions VALUES(?,?,?,?,?)",
        id,
        user.id,
        c.personId,
        json(c),
        Date.now(),
      );
      ids.push(id);
    }
    return ids;
  }
  bootstrap(user) {
    const ids = new Set(
      this.all("SELECT person FROM relationships WHERE author=?", user.id).map(
        (r) => this.person(r.person).id,
      ),
    );
    ids.add(user.personId);
    const people = [...ids].map((id) => this.profile(user, id));
    const incoming = this.all(
      "SELECT r.id,t.person FROM revisions r JOIN traits t ON r.trait_id=t.id WHERE r.status='pending'",
    )
      .filter((r) => this.person(r.person).claimed_by === user.id)
      .map((r) => {
        const t = this.traitsFor(r.person).find((t) =>
          t.revisions.some((v) => v.id === r.id),
        );
        return {
          id: r.id,
          authorName: t.author_name,
          type: t.type,
          personName: this.person(r.person).name,
          ...t.revisions.find((v) => v.id === r.id),
        };
      });
    return {
      user,
      people,
      incoming,
      catalog: CATALOG,
      decks: this.all(
        "SELECT * FROM decks WHERE owner=? ORDER BY updated DESC",
        user.id,
      ).map((d) => ({
        ...d,
        cards: JSON.parse(d.cards).map((c) => ({
          ...c,
          personId: this.person(c.personId).id,
        })),
        reserve: d.reserve ? this.person(d.reserve).id : null,
      })),
      matches: this.all(
        "SELECT * FROM matches WHERE owner=? ORDER BY created DESC LIMIT 20",
        user.id,
      ).map((m) => ({ ...m, details: JSON.parse(m.details) })),
    };
  }
  result(room) {
    this.transaction(() => {
      for (const s of room.seats.filter((s) => !s.bot))
        this.run(
          "INSERT OR IGNORE INTO matches VALUES(?,?,?,?,?,?)",
          room.id,
          s.user.id,
          room.winner === null
            ? "draw"
            : room.winner === s.user.id
              ? "win"
              : "loss",
          room.seats.find((x) => x !== s)?.user.name || "Opponent",
          json({
            reason: room.reason,
            health: Math.max(0, s.health),
            turns: room.turnNumber,
            room: room.code,
          }),
          Date.now(),
        );
    });
  }
}
