import { randomInt } from "node:crypto";
import { Duels } from "../cards/duels.mjs";

// A row lock, not a function instance, owns a room mutation. State, memberships,
// card versions and results commit together, so retries cannot spend mana twice.
export class SharedDuels {
  constructor(store, { maxRooms = 1000, now = () => Date.now() } = {}) {
    this.store = store;
    this.db = store.db;
    this.maxRooms = maxRooms;
    this.now = now;
  }
  engine(room, definitions = new Map()) {
    const snapshots = [],
      results = [];
    const engine = new Duels(
      {
        deck: (user, id) => {
          const d = definitions.get(`${user.id}:${id}`);
          if (!d) throw new Error("Select one of your saved decks.");
          return d;
        },
        snapshotCards: (user, def) => snapshots.push([user, def]),
        result: (r) => results.push(structuredClone(r)),
      },
      this.now,
    );
    if (room) engine.rooms.set(room.code, room);
    return { engine, snapshots, results };
  }
  async prepare(seats, solo = false) {
    const defs = new Map();
    for (const s of seats.filter((s) => !s.bot))
      defs.set(
        `${s.user.id}:${s.deckId}`,
        await this.store.deck(s.user, s.deckId, solo),
      );
    return defs;
  }
  async lockMember(userId) {
    // Serialize this identity across different rooms, including simultaneous joins.
    await this.db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [userId],
    );
    return this.db.get(
      "SELECT r.* FROM __SCHEMA__.memberships m JOIN __SCHEMA__.rooms r ON r.code=m.code WHERE m.user_id=$1 FOR UPDATE OF r",
      userId,
    );
  }
  async save(row, context) {
    const { engine, snapshots, results } = context,
      room = row.state;
    for (const args of snapshots) await this.store.snapshotCards(...args);
    for (const r of results) await this.store.result(r);
    if (!engine.rooms.has(room.code)) {
      await this.db.query("DELETE FROM __SCHEMA__.rooms WHERE code=$1", [
        room.code,
      ]);
      return null;
    }
    const version = row.version + 1,
      now = this.now();
    await this.db.query(
      "UPDATE __SCHEMA__.rooms SET state=$2,version=$3,next_tick=$4,expires=$5 WHERE code=$1",
      [room.code, JSON.stringify(room), version, now + 500, now + 30 * 60000],
    );
    await this.db.query("DELETE FROM __SCHEMA__.memberships WHERE code=$1", [
      room.code,
    ]);
    for (const s of room.seats.filter((s) => !s.bot))
      await this.db.query("INSERT INTO __SCHEMA__.memberships VALUES($1,$2)", [
        s.user.id,
        room.code,
      ]);
    return { ...row, state: room, version };
  }
  async reconcile(context, room) {
    const now = this.now(),
      ids = room.seats.filter((s) => !s.bot).map((s) => s.user.id);
    const online = await this.db.all(
      "SELECT * FROM __SCHEMA__.connections WHERE user_id=ANY($1::text[])",
      ids,
    );
    for (const s of room.seats.filter((s) => !s.bot)) {
      const c = online.find((c) => c.user_id === s.user.id);
      if (s.connected && (!c || c.expires <= now)) {
        context.engine.disconnect(s.user.id);
        s.disconnectedAt = c ? c.last_seen : now;
      }
    }
    context.engine.tick();
  }
  view(row, userId) {
    if (!row || !row.state.seats.some((s) => s.user.id === userId)) return null;
    return {
      ...this.engine(row.state).engine.view(row.state, userId),
      version: row.version,
    };
  }
  async connect(user, connectionId) {
    return this.db.transaction(async () => {
      let row = await this.lockMember(user.id);
      if (row) {
        const ctx = this.engine(row.state);
        await this.reconcile(ctx, row.state);
        // Expired seats are removed before an arriving connection can claim them.
        row = await this.save(row, ctx);
      }
      const now = this.now();
      await this.db.query(
        "INSERT INTO __SCHEMA__.connections VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET connection_id=excluded.connection_id,last_seen=excluded.last_seen,expires=excluded.expires",
        [user.id, connectionId, now, now + 15000],
      );
      if (row?.state.seats.some((s) => s.user.id === user.id)) {
        const ctx = this.engine(row.state);
        ctx.engine.reconnect(user.id);
        row = await this.save(row, ctx);
      }
      return this.view(row, user.id);
    });
  }
  async touch(userId, connectionId) {
    const now = this.now();
    return (
      (
        await this.db.query(
          "UPDATE __SCHEMA__.connections SET last_seen=$3,expires=$4 WHERE user_id=$1 AND connection_id=$2 RETURNING user_id",
          [userId, connectionId, now, now + 15000],
        )
      ).rowCount > 0
    );
  }
  async owns(userId, connectionId) {
    return !!(await this.db.get(
      "SELECT 1 FROM __SCHEMA__.connections WHERE user_id=$1 AND connection_id=$2 AND expires>$3",
      userId,
      connectionId,
      this.now(),
    ));
  }
  async disconnect(userId, connectionId) {
    return this.db.transaction(async () => {
      const row = await this.lockMember(userId);
      const r = await this.db.query(
        "DELETE FROM __SCHEMA__.connections WHERE user_id=$1 AND connection_id=$2",
        [userId, connectionId],
      );
      if (r.rowCount && row) {
        const ctx = this.engine(row.state);
        ctx.engine.disconnect(userId);
        await this.save(row, ctx);
      }
    });
  }
  async action(user, connectionId, data) {
    return this.db.transaction(async () => {
      let row = await this.lockMember(user.id);
      if (!(await this.owns(user.id, connectionId))) {
        const e = new Error("This identity opened another table window.");
        e.code = 4001;
        throw e;
      }
      if (
        row?.state.receipts?.some((r) => r === `${user.id}:${data.requestId}`)
      )
        return this.view(row, user.id);
      if (data.type === "create") {
        if (row) throw new Error("Leave your current duel room first.");
        await this.db.query(
          "SELECT pg_advisory_xact_lock(hashtext('friendstack:room-capacity'))",
        );
        if (
          (await this.db.get("SELECT COUNT(*)::int AS n FROM __SCHEMA__.rooms"))
            .n >= this.maxRooms
        )
          throw new Error(
            "All card tables are currently full. Try again shortly.",
          );
        const defs = await this.prepare(
            [{ user, deckId: data.deckId }],
            data.solo === true,
          ),
          ctx = this.engine(null, defs);
        const room = ctx.engine.create(user, data);
        // 40 random bits; uniqueness is also enforced across instances by Postgres.
        ctx.engine.rooms.delete(room.code);
        room.code = Array.from(
          { length: 8 },
          () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
        ).join("");
        ctx.engine.rooms.set(room.code, room);
        row = { state: room, version: 0 };
        await this.db.query(
          "INSERT INTO __SCHEMA__.rooms VALUES($1,$2,0,$3,$4)",
          [
            room.code,
            JSON.stringify(room),
            this.now(),
            this.now() + 30 * 60000,
          ],
        );
        this.receipt(room, user.id, data.requestId);
        row = await this.save(row, ctx);
        return this.view(row, user.id);
      }
      if (data.type === "join") {
        if (row) throw new Error("Leave your current duel room first.");
        const code = String(data.code || "")
          .trim()
          .toUpperCase();
        row = await this.db.get(
          "SELECT * FROM __SCHEMA__.rooms WHERE code=$1 FOR UPDATE",
          code,
        );
        if (!row)
          throw new Error("That card room was not found. Check the code.");
        const defs = await this.prepare([{ user, deckId: data.deckId }]),
          ctx = this.engine(row.state, defs);
        ctx.engine.join(user, { ...data, code });
        this.receipt(row.state, user.id, data.requestId);
        row = await this.save(row, ctx);
        return this.view(row, user.id);
      }
      if (!row) throw new Error("Join a card table first.");
      const room = row.state,
        defs = ["start", "rematch"].includes(data.type)
          ? await this.prepare(room.seats, room.solo)
          : new Map(),
        ctx = this.engine(room, defs);
      const beforeClock = JSON.stringify(room);
      await this.reconcile(ctx, room);
      if (!ctx.engine.find(user.id)) {
        await this.save(row, ctx);
        return null;
      }
      if (data.type === "act") {
        if (JSON.stringify(room) !== beforeClock) {
          row = await this.save(row, ctx);
          return this.view(row, user.id);
        }
        if (
          !Number.isSafeInteger(data.version) ||
          data.version !== row.version
        ) {
          const e = new Error(
            "The table changed. Your cards have been refreshed; choose your move again.",
          );
          e.stale = true;
          throw e;
        }
        ctx.engine.action(room, user.id, data.actionId);
      } else if (data.type === "ready") {
        if (room.phase !== "lobby") throw new Error("This duel is underway.");
        room.seats.find((s) => s.user.id === user.id).ready =
          data.ready === true;
      } else if (data.type === "start") ctx.engine.start(room, user);
      else if (data.type === "rematch") ctx.engine.rematch(room, user.id);
      else if (data.type === "leave") ctx.engine.leave(room, user.id);
      else throw new Error("Unknown card-table action.");
      this.receipt(room, user.id, data.requestId);
      row = await this.save(row, ctx);
      return this.view(row, user.id);
    });
  }
  receipt(room, userId, id) {
    if (typeof id === "string" && id.length <= 80) {
      room.receipts ||= [];
      room.receipts.push(`${userId}:${id}`);
      room.receipts = room.receipts.slice(-128);
    }
  }
  async current(userId) {
    return this.db.get(
      "SELECT r.* FROM __SCHEMA__.memberships m JOIN __SCHEMA__.rooms r ON r.code=m.code WHERE m.user_id=$1",
      userId,
    );
  }
  async read(userId) {
    return this.view(await this.current(userId), userId);
  }
  async sweep(limit = 50) {
    return this.db.transaction(async () => {
      const now = this.now(),
        rows = await this.db.all(
          "SELECT * FROM __SCHEMA__.rooms WHERE next_tick<=$1 ORDER BY next_tick LIMIT $2 FOR UPDATE SKIP LOCKED",
          now,
          limit,
        );
      for (const row of rows) {
        const before = JSON.stringify(row.state),
          ctx = this.engine(row.state);
        await this.reconcile(ctx, row.state);
        if (
          JSON.stringify(row.state) !== before ||
          !ctx.engine.rooms.has(row.code)
        )
          await this.save(row, ctx);
        else
          await this.db.query(
            "UPDATE __SCHEMA__.rooms SET next_tick=$2 WHERE code=$1",
            [row.code, now + 1000],
          );
      }
      await this.db.query(
        "DELETE FROM __SCHEMA__.rate_limits WHERE until_ms<$1",
        [now - 60000],
      );
      await this.db.query("DELETE FROM __SCHEMA__.sessions WHERE expires<$1", [
        now,
      ]);
      return rows.length;
    });
  }
}
