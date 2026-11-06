import {
  randomUUID as uid,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  CATALOG,
  SAMPLE_FRIENDS,
  defaultAbility,
  validateAbility,
} from "../../shared/cards.mjs";

const derive = promisify(scrypt);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (v, max = 80) =>
  typeof v === "string"
    ? v
        .trim()
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, max)
    : "";
const json = JSON.stringify;

// The online adapter uses the same public store contract as the local SQLite store.
// All writes and multi-step ownership checks run in Postgres transactions.
export class CloudStore {
  constructor(db) {
    this.db = db;
  }
  async notify(user, personId) {
    await this.db.query(
      `INSERT INTO __SCHEMA__.social_refresh(user_id,version)
      SELECT DISTINCT id,1 FROM __SCHEMA__.accounts WHERE id=$1 OR person_id IN(SELECT canonical FROM __SCHEMA__.people WHERE id=$2)
      OR id IN(SELECT r.author FROM __SCHEMA__.relationships r JOIN __SCHEMA__.people p ON p.id=r.person WHERE p.canonical=$3 OR p.canonical IN(SELECT canonical FROM __SCHEMA__.people WHERE id=$2))
      ON CONFLICT(user_id) DO UPDATE SET version=social_refresh.version+1`,
      [user.id, personId || user.personId, user.personId],
    );
  }
  async init() {
    for (const p of SAMPLE_FRIENDS)
      await this.db.query(
        `INSERT INTO __SCHEMA__.people VALUES($1,$2,'fictional','fictional',$1,$3,$4,1,$5) ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.color, p.face, Date.now()],
      );
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
    const salt = randomBytes(16).toString("hex"),
      password = (await derive(data.password, salt, 64)).toString("hex"),
      id = uid(),
      personId = uid();
    try {
      await this.db.transaction(async () => {
        await this.db.query(
          "INSERT INTO __SCHEMA__.accounts VALUES($1,$2,$3,$4,$5,$6,$7)",
          [id, username, name, password, salt, personId, Date.now()],
        );
        await this.db.query(
          "INSERT INTO __SCHEMA__.people VALUES($1,$2,$3,$3,$1,'lavender',0,0,$4)",
          [personId, name, id, Date.now()],
        );
        await this.seed(id);
      });
    } catch (e) {
      if (e.code === "23505")
        throw new Error("That username is already taken.");
      throw e;
    }
    return this.login({ username, password: data.password });
  }
  async login(data) {
    if (typeof data.password !== "string" || data.password.length > 128)
      throw new Error("Check your username and password.");
    const a = await this.db.get(
      "SELECT * FROM __SCHEMA__.accounts WHERE username=$1",
      text(data.username, 24).toLowerCase(),
    );
    const value = await derive(
      data.password,
      a?.salt || "not-a-real-account-salt",
      64,
    );
    if (!a || !timingSafeEqual(value, Buffer.from(a.password, "hex")))
      throw new Error("Check your username and password.");
    const token = randomBytes(32).toString("hex");
    await this.db.query("INSERT INTO __SCHEMA__.sessions VALUES($1,$2,$3)", [
      hash(token),
      a.id,
      Date.now() + 7 * 86400000,
    ]);
    return { token, user: this.publicUser(a) };
  }
  async auth(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const a = await this.db.get(
      "SELECT a.* FROM __SCHEMA__.sessions s JOIN __SCHEMA__.accounts a ON a.id=s.account_id WHERE s.hash=$1 AND s.expires>$2",
      hash(token),
      Date.now(),
    );
    return a ? this.publicUser(a) : null;
  }
  async logout(token) {
    await this.db.query("DELETE FROM __SCHEMA__.sessions WHERE hash=$1", [
      hash(token),
    ]);
    return { ok: true };
  }
  async person(id) {
    const p = await this.db.get(
      "SELECT * FROM __SCHEMA__.people WHERE id=$1",
      id,
    );
    if (!p) throw new Error("Friend not found.");
    return p.canonical !== p.id
      ? this.db.get("SELECT * FROM __SCHEMA__.people WHERE id=$1", p.canonical)
      : p;
  }
  async aliases(id) {
    const p = await this.person(id);
    return (
      await this.db.all(
        "SELECT id FROM __SCHEMA__.people WHERE canonical=$1 OR id=$1",
        p.id,
      )
    ).map((x) => x.id);
  }
  async requireFriend(user, id) {
    const p = await this.person(id);
    if (
      p.claimed_by !== user.id &&
      !(await this.db.get(
        "SELECT 1 FROM __SCHEMA__.relationships WHERE author=$1 AND person=ANY($2::text[])",
        user.id,
        await this.aliases(p.id),
      ))
    )
      throw new Error("This friend is not in your pool.");
    return p;
  }
  async addFriend(user, data) {
    const name = text(data.name, 36);
    if (!name) throw new Error("Give your friend a name.");
    const id = uid(),
      color = ["lavender", "mint", "peach"].includes(data.color)
        ? data.color
        : "lavender";
    await this.db.transaction(async () => {
      await this.db.query(
        "SELECT id FROM __SCHEMA__.accounts WHERE id=$1 FOR UPDATE",
        [user.id],
      );
      if (
        (
          await this.db.get(
            "SELECT COUNT(*)::int AS n FROM __SCHEMA__.relationships WHERE author=$1",
            user.id,
          )
        ).n >= 100
      )
        throw new Error("Your friend pool is full.");
      await this.db.query(
        "INSERT INTO __SCHEMA__.people VALUES($1,$2,$3,NULL,$1,$4,$5,0,$6)",
        [
          id,
          name,
          user.id,
          color,
          Number.isInteger(Number(data.face))
            ? Math.max(0, Math.min(2, Number(data.face)))
            : 0,
          Date.now(),
        ],
      );
      await this.db.query(
        "INSERT INTO __SCHEMA__.relationships VALUES($1,$2,$3)",
        [user.id, id, Date.now()],
      );
    });
    return this.profile(user, id);
  }
  async traitsFor(id, author) {
    const traits = await this.db.all(
      `SELECT t.*,a.name AS author_name FROM __SCHEMA__.traits t LEFT JOIN __SCHEMA__.accounts a ON a.id=t.author WHERE person=ANY($1::text[]) ${author ? "AND author=$2" : ""} ORDER BY t.created,t.id`,
      await this.aliases(id),
      ...(author ? [author] : []),
    );
    if (!traits.length) return [];
    const revisions = await this.db.all(
      "SELECT * FROM __SCHEMA__.revisions WHERE trait_id=ANY($1::text[]) ORDER BY created DESC,id",
      traits.map((t) => t.id),
    );
    const groups = new Map();
    for (const r of revisions) {
      if (!groups.has(r.trait_id)) groups.set(r.trait_id, []);
      groups.get(r.trait_id).push(r);
    }
    return traits.map((t) => ({ ...t, revisions: groups.get(t.id) || [] }));
  }
  async defineTrait(user, id, data) {
    const p = await this.requireFriend(user, id);
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
    await this.db.transaction(async () => {
      await this.db.query(
        "SELECT id FROM __SCHEMA__.people WHERE id=$1 FOR UPDATE",
        [p.id],
      );
      let trait = (await this.traitsFor(p.id, user.id)).find(
        (t) => t.type === data.type,
      );
      if (!trait) {
        trait = { id: uid() };
        await this.db.query(
          "INSERT INTO __SCHEMA__.traits VALUES($1,$2,$3,$4,$5)",
          [trait.id, user.id, p.id, data.type, Date.now()],
        );
      }
      await this.db.query(
        "UPDATE __SCHEMA__.revisions SET status='superseded' WHERE trait_id=$1 AND status='pending'",
        [trait.id],
      );
      const latest =
        (
          await this.db.get(
            "SELECT MAX(created) AS latest FROM __SCHEMA__.revisions WHERE trait_id=$1",
            trait.id,
          )
        ).latest || 0;
      await this.db.query(
        "INSERT INTO __SCHEMA__.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          uid(),
          trait.id,
          name,
          description,
          json(ability),
          p.sample ? "approved" : "pending",
          Math.max(Date.now(), latest + 1),
          p.sample ? Date.now() : null,
        ],
      );
    });
    return this.profile(user, p.id);
  }
  async review(user, id, approve) {
    return this.db.transaction(async () => {
      const r = await this.db.get(
        "SELECT r.*,t.person,t.author FROM __SCHEMA__.revisions r JOIN __SCHEMA__.traits t ON t.id=r.trait_id WHERE r.id=$1 FOR UPDATE OF r",
        id,
      );
      if (
        !r ||
        (await this.person(r.person)).claimed_by !== user.id ||
        r.author === user.id
      )
        throw new Error("Only the described friend can review this trait.");
      if (r.status !== "pending")
        throw new Error("This revision has already been reviewed.");
      await this.db.query(
        "UPDATE __SCHEMA__.revisions SET status=$1,reviewed=$2 WHERE id=$3",
        [approve ? "approved" : "rejected", Date.now(), id],
      );
      return { ok: true };
    });
  }
  async invite(user, id) {
    const p = await this.requireFriend(user, id);
    if (p.claimed_by || p.sample)
      throw new Error("This profile is already claimed.");
    if (p.creator !== user.id)
      throw new Error("Only the creator can invite this friend.");
    const token = randomBytes(24).toString("hex");
    await this.db.query(
      "INSERT INTO __SCHEMA__.invites VALUES($1,$2,$3,$4,0)",
      [hash(token), p.id, user.id, Date.now() + 7 * 86400000],
    );
    return { token, name: p.name };
  }
  async invitation(token, lock = false) {
    if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token))
      throw new Error("That invitation is invalid or expired.");
    const i = await this.db.get(
      `SELECT * FROM __SCHEMA__.invites WHERE hash=$1 AND used=0 AND expires>$2 ${lock ? "FOR UPDATE" : ""}`,
      hash(token),
      Date.now(),
    );
    if (!i) throw new Error("That invitation is invalid or expired.");
    return i;
  }
  async claim(user, token) {
    return this.db.transaction(async () => {
      const i = await this.invitation(token, true);
      await this.db.query(
        "SELECT id FROM __SCHEMA__.people WHERE id=$1 FOR UPDATE",
        [i.person],
      );
      const p = await this.person(i.person);
      if (p.claimed_by || i.creator === user.id)
        throw new Error("Sign in as the invited friend to claim this profile.");
      await this.db.query(
        "UPDATE __SCHEMA__.people SET claimed_by=$1,canonical=$2 WHERE id=$3",
        [user.id, user.personId, p.id],
      );
      await this.db.query(
        "UPDATE __SCHEMA__.invites SET used=1 WHERE hash=$1",
        [hash(token)],
      );
      await this.db.query(
        "INSERT INTO __SCHEMA__.relationships SELECT $1,person_id,$2 FROM __SCHEMA__.accounts WHERE id=$3 ON CONFLICT DO NOTHING",
        [user.id, Date.now(), i.creator],
      );
      return { ok: true, name: p.name };
    });
  }
  async card(user, id, drafts = false) {
    const p = await this.requireFriend(user, id),
      aliases = await this.aliases(p.id);
    const totals = await this.db.all(
      `SELECT t.type,COUNT(DISTINCT t.author)::int AS count FROM __SCHEMA__.traits t WHERE t.person=ANY($1::text[]) AND t.author<>COALESCE($2,'') AND EXISTS(SELECT 1 FROM __SCHEMA__.revisions r WHERE r.trait_id=t.id AND r.status='approved') GROUP BY t.type`,
      aliases,
      p.claimed_by,
    );
    const endorsements = CATALOG.map((t) => ({
      ...t,
      count: totals.find((x) => x.type === t.id)?.count || 0,
    }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count || a.index - b.index);
    const own = new Map();
    for (const t of await this.traitsFor(
      p.id,
      p.claimed_by === user.id ? undefined : user.id,
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
    const approvedCount = [...own.values()].filter(
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
      superior: approvedCount >= 3,
      approvedCount,
      endorsements: endorsements.map(({ id, name, count }) => ({
        id,
        name,
        count,
      })),
    };
  }
  async profile(user, id) {
    const p = await this.requireFriend(user, id),
      own = await this.traitsFor(
        p.id,
        p.claimed_by === user.id ? undefined : user.id,
      );
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      face: p.face,
      sample: !!p.sample,
      claimed: !!p.claimed_by,
      isYou: p.claimed_by === user.id,
      card: await this.card(user, p.id),
      draftCard: await this.card(user, p.id, true),
      traits: own.map((t) => ({
        id: t.id,
        type: t.type,
        authorId: t.author,
        authorName: t.author_name || "Fictional starter",
        revisions: t.revisions,
      })),
    };
  }
  async seed(author) {
    for (const p of SAMPLE_FRIENDS) {
      await this.db.query(
        "INSERT INTO __SCHEMA__.relationships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [author, p.id, Date.now()],
      );
      for (const type of p.types) {
        const trait = uid(),
          name = CATALOG.find((t) => t.id === type).name;
        await this.db.query(
          "INSERT INTO __SCHEMA__.traits VALUES($1,$2,$3,$4,$5)",
          [trait, author, p.id, type, Date.now()],
        );
        await this.db.query(
          "INSERT INTO __SCHEMA__.revisions VALUES($1,$2,$3,$4,$5,'approved',$6,$6)",
          [
            uid(),
            trait,
            `${name} ${p.name.split(" ")[0]}`,
            `Fictional example: ${p.quote} This sample trait is pre-approved for playtests.`,
            json(defaultAbility(type)),
            Date.now(),
          ],
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
    await this.db.query(
      "INSERT INTO __SCHEMA__.decks VALUES($1,$2,$3,$4,$5,$6)",
      [
        uid(),
        author,
        "The inner circle",
        json(cards),
        SAMPLE_FRIENDS[0].id,
        Date.now(),
      ],
    );
  }
  async validateDeck(user, data, drafts = false) {
    if (!Array.isArray(data.cards) || data.cards.length !== 12)
      throw new Error(
        "A deck needs six friend cards and six linked power-ups.",
      );
    const friends = data.cards.filter((c) => c.kind === "friend"),
      powers = data.cards.filter((c) => c.kind === "power");
    if (friends.length !== 6 || powers.length !== 6)
      throw new Error("Choose six friends and six linked power-ups.");
    const cache = new Map();
    for (const c of data.cards)
      if (!cache.has(c.personId))
        cache.set(c.personId, await this.card(user, c.personId, drafts));
    const counts = new Map();
    for (const c of friends) {
      const id = cache.get(c.personId).personId;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (counts.size < 3 || [...counts.values()].some((n) => n > 2))
      throw new Error(
        "Use at least three different friends, with at most two copies each.",
      );
    for (const c of powers)
      if (
        !counts.has(cache.get(c.personId).personId) ||
        !["heal", "shield", "attack", "guard"].includes(c.effect)
      )
        throw new Error("Link each power-up to a friend in your deck.");
    const cards = data.cards.map((c) => ({
      ...cache.get(c.personId),
      kind: c.kind,
      ...(c.kind === "power" ? { effect: c.effect, cost: 2 } : {}),
    }));
    const reserve = data.reserve
      ? cache.get(data.reserve) || (await this.card(user, data.reserve, drafts))
      : null;
    if (reserve && !reserve.superior)
      throw new Error("Your reserve needs three approved personal traits.");
    return { cards, reserve };
  }
  async saveDeck(user, data) {
    const def = await this.validateDeck(user, data),
      id = data.id || uid();
    const cards = def.cards.map((c) => ({
      kind: c.kind,
      personId: c.personId,
      ...(c.kind === "power" ? { effect: c.effect } : {}),
    }));
    const r = await this.db.query(
      `INSERT INTO __SCHEMA__.decks VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cards=excluded.cards,reserve=excluded.reserve,updated=excluded.updated WHERE decks.owner=excluded.owner RETURNING id`,
      [
        id,
        user.id,
        text(data.name, 36) || "My friend deck",
        json(cards),
        def.reserve?.personId || null,
        Date.now(),
      ],
    );
    if (!r.rowCount) throw new Error("That deck belongs to another player.");
    return { id };
  }
  async deck(user, id, drafts = false) {
    const d = await this.db.get(
      "SELECT * FROM __SCHEMA__.decks WHERE id=$1 AND owner=$2",
      id,
      user.id,
    );
    if (!d) throw new Error("Select one of your saved decks.");
    return this.validateDeck(user, d, drafts);
  }
  async snapshotCards(user, definition) {
    for (const c of [
      ...definition.cards,
      ...(definition.reserve ? [definition.reserve] : []),
    ])
      await this.db.query(
        "INSERT INTO __SCHEMA__.card_versions VALUES($1,$2,$3,$4,$5)",
        [uid(), user.id, c.personId, json(c), Date.now()],
      );
  }
  async bootstrap(user) {
    const ids = new Set(
      (
        await this.db.all(
          "SELECT DISTINCT p.canonical FROM __SCHEMA__.relationships r JOIN __SCHEMA__.people p ON p.id=r.person WHERE r.author=$1",
          user.id,
        )
      ).map((r) => r.canonical),
    );
    ids.add(user.personId);
    const people = [];
    for (const id of ids) people.push(await this.profile(user, id));
    const incoming = await this.db.all(
      `SELECT r.*,t.type,a.name AS "authorName",p.name AS "personName" FROM __SCHEMA__.revisions r JOIN __SCHEMA__.traits t ON t.id=r.trait_id JOIN __SCHEMA__.people alias ON alias.id=t.person JOIN __SCHEMA__.people p ON p.id=alias.canonical JOIN __SCHEMA__.accounts a ON a.id=t.author WHERE r.status='pending' AND p.claimed_by=$1`,
      user.id,
    );
    const decks = await this.db.all(
      "SELECT * FROM __SCHEMA__.decks WHERE owner=$1 ORDER BY updated DESC",
      user.id,
    );
    for (const d of decks) {
      for (const c of d.cards) c.personId = (await this.person(c.personId)).id;
      if (d.reserve) d.reserve = (await this.person(d.reserve)).id;
    }
    return {
      user,
      people,
      incoming,
      catalog: CATALOG,
      decks,
      matches: await this.db.all(
        "SELECT * FROM __SCHEMA__.matches WHERE owner=$1 ORDER BY created DESC LIMIT 20",
        user.id,
      ),
    };
  }
  async result(room) {
    for (const s of room.seats.filter((s) => !s.bot))
      await this.db.query(
        "INSERT INTO __SCHEMA__.matches VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [
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
        ],
      );
  }
}
