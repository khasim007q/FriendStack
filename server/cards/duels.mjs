import { randomUUID, randomInt } from "node:crypto";
import { RULES, CATALOG } from "../../shared/cards.mjs";

const clone = (value) => structuredClone(value);
const uid = () => randomUUID();
const alive = (unit) => unit.health > 0;
export class Duels {
  rooms = new Map();
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
  }
  find(userId) {
    return [...this.rooms.values()].find((r) =>
      r.seats.some((s) => s.user.id === userId),
    );
  }
  seat(user, deckId, bot = false) {
    return {
      user,
      deckId,
      bot,
      ready: bot,
      connected: true,
      disconnectedAt: null,
      health: 30,
      shield: 0,
      mana: 3,
      hand: [],
      deck: [],
      board: [],
      discard: [],
      reserve: null,
      turns: 0,
      fatigue: 0,
      rewards: 0,
      reserveUsed: false,
    };
  }
  create(user, data) {
    if (this.find(user.id))
      throw new Error("Leave your current duel room first.");
    if (this.rooms.size >= 50)
      throw new Error("The local card playground is full.");
    this.store.deck(user, data.deckId, data.solo === true);
    let code;
    do {
      code = Array.from(
        { length: 6 },
        () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
      ).join("");
    } while (this.rooms.has(code));
    const room = {
      id: uid(),
      code,
      hostId: user.id,
      phase: "lobby",
      solo: data.solo === true,
      seats: [this.seat(user, data.deckId)],
      turnNumber: 0,
      current: 0,
      log: [],
      events: [],
      winner: null,
      reason: null,
      created: this.now(),
      updated: this.now(),
      recorded: false,
    };
    this.rooms.set(code, room);
    this.log(room, `${user.name} opened the table.`);
    if (room.solo) {
      room.seats.push(
        this.seat(
          { id: `bot-${uid()}`, name: "The Practice Pal" },
          data.deckId,
          true,
        ),
      );
      room.seats[0].ready = true;
      this.start(room, user);
    }
    return room;
  }
  join(user, data) {
    if (this.find(user.id))
      throw new Error("Leave your current duel room first.");
    const room = this.rooms.get(
      String(data.code || "")
        .trim()
        .toUpperCase(),
    );
    if (!room) throw new Error("That card room was not found. Check the code.");
    if (room.phase !== "lobby" || room.seats.length >= 2)
      throw new Error("That table is already full or playing.");
    this.store.deck(user, data.deckId);
    room.seats.push(this.seat(user, data.deckId));
    this.log(room, `${user.name} joined the table.`);
    return room;
  }
  log(room, text) {
    room.log.unshift({ id: uid(), text, at: this.now() });
    room.log.length = Math.min(room.log.length, 60);
    room.updated = this.now();
  }
  start(room, user) {
    if (room.hostId !== user.id || room.phase !== "lobby")
      throw new Error("Only the host can start a waiting table.");
    if (
      room.seats.length !== 2 ||
      room.seats.some((s) => !s.ready || !s.connected)
    )
      throw new Error("Both players must be connected and ready.");
    const definitions = room.seats.map((s) =>
      this.store.deck(s.bot ? room.seats[0].user : s.user, s.deckId, room.solo),
    );
    definitions.forEach((def, i) => {
      const s = room.seats[i];
      if (!s.bot) this.store.snapshotCards(s.user, def);
      const cards = clone(def.cards).map((c) => ({
        ...c,
        id: uid(),
        superior: false,
      }));
      for (let j = cards.length - 1; j > 0; j--) {
        const k = randomInt(j + 1);
        [cards[j], cards[k]] = [cards[k], cards[j]];
      }
      s.definition = clone(def);
      s.deck = cards;
      s.hand = [];
      s.board = [];
      s.discard = [];
      s.health = 30;
      s.shield = 0;
      s.mana = i === 0 ? 3 : 4;
      s.turns = 0;
      s.fatigue = 0;
      s.reserve = def.reserve ? { ...clone(def.reserve), id: uid() } : null;
      s.reserveUsed = false;
      const index = s.deck.findIndex((c) => c.kind === "friend");
      s.hand.push(s.deck.splice(index, 1)[0]);
      s.hand.push(s.deck.pop(), s.deck.pop());
    });
    room.phase = "playing";
    room.current = 0;
    room.turnNumber = 1;
    room.endsAt = this.now() + RULES.matchMs;
    room.events = [];
    this.beginTurn(room);
    this.log(room, "Cards down. Friendships up. The duel begins!");
  }
  round(room) {
    return Math.floor((room.turnNumber - 1) / 2);
  }
  beginTurn(room) {
    const s = room.seats[room.current];
    s.turns++;
    room.turnEndsAt = this.now() + RULES.turnMs;
    for (const p of room.seats) p.rewards = 0;
    for (const u of s.board) {
      u.acted = false;
      u.guard = false;
      u.attackBonus = 0;
    }
    if (s.turns > 1) {
      s.mana = Math.min(10, s.mana + 2);
      this.draw(room, s);
    }
    for (const u of [...s.board])
      room.events.push({ trigger: "turn", owner: s.user.id, unitId: u.id });
    this.resolve(room);
    room.botAt = this.now() + 850;
  }
  draw(room, s) {
    if (s.deck.length) s.hand.push(s.deck.pop());
    else {
      s.fatigue++;
      s.health -= s.fatigue;
      this.log(room, `${s.user.name} takes ${s.fatigue} fatigue damage.`);
    }
  }
  unit(card, superior, turns) {
    return {
      ...clone(card),
      kind: "friend",
      health: superior ? 8 : 5,
      maxHealth: superior ? 8 : 5,
      attack: superior ? 4 : 2,
      attackBonus: 0,
      shield: 0,
      guard: false,
      superior,
      acted: true,
      summonedTurn: turns,
      usedAbilityRound: -1,
      cursor: 0,
    };
  }
  guards(s) {
    return s.board.filter((u) => alive(u) && u.guard);
  }
  targets(room, s, u, ability) {
    const enemy = room.seats.find((x) => x !== s),
      g = this.guards(enemy);
    switch (ability.target) {
      case "self":
        return u && alive(u) ? [u.id] : [];
      case "ally":
        return s.board.filter(alive).map((x) => x.id);
      case "enemy":
        return (g.length ? g : enemy.board.filter(alive)).map((x) => x.id);
      case "player":
        return [s.user.id];
      case "opponent":
        return g.length ? [] : [enemy.user.id];
      default:
        return [];
    }
  }
  legal(room, userId) {
    if (room.phase !== "playing") return [];
    const s = room.seats[room.current];
    if (s.user.id !== userId) return [];
    const enemy = room.seats.find((x) => x !== s),
      result = [];
    const push = (a) =>
      result.push({
        ...a,
        id: [
          a.type,
          a.cardId || a.unitId || "",
          a.abilityIndex ?? "",
          a.targetId || "",
        ].join(":"),
      });
    for (const c of s.hand) {
      if (c.cost > s.mana) continue;
      if (c.kind === "friend") {
        if (s.board.length < 3) push({ type: "play", cardId: c.id });
      } else {
        const linked = s.board.filter((u) => u.personId === c.personId);
        for (const u of linked)
          push({ type: "play", cardId: c.id, targetId: u.id });
      }
    }
    for (const u of s.board) {
      if (u.acted) continue;
      const guards = this.guards(enemy),
        targets = guards.length
          ? guards.map((x) => x.id)
          : [...enemy.board.map((x) => x.id), enemy.user.id];
      for (const targetId of targets)
        push({ type: "attack", unitId: u.id, targetId });
      if (s.mana >= RULES.activeCost && u.usedAbilityRound !== this.round(room))
        u.abilities.forEach((a, index) => {
          if (a.ability.trigger === "active")
            for (const targetId of this.targets(room, s, u, a.ability))
              push({
                type: "ability",
                unitId: u.id,
                abilityIndex: index,
                targetId,
              });
        });
    }
    if (s.reserve && !s.reserveUsed) {
      if (s.mana >= 8 && s.board.length < 3) push({ type: "superior" });
      if (s.mana >= 5)
        for (const u of s.board.filter(
          (x) => x.personId === s.reserve.personId && !x.superior,
        ))
          push({ type: "upgrade", unitId: u.id });
    }
    push({ type: "end" });
    return result;
  }
  locate(room, id) {
    for (const s of room.seats) {
      if (s.user.id === id) return { seat: s, target: s, player: true };
      const u = s.board.find((u) => u.id === id);
      if (u) return { seat: s, target: u, player: false };
    }
    return null;
  }
  hit(room, id, amount, sourceOwner) {
    const location = this.locate(room, id);
    if (!location) return;
    const t = location.target,
      absorbed = Math.min(t.shield || 0, amount);
    t.shield -= absorbed;
    t.health -= amount - absorbed;
    if (!location.player && amount > absorbed) {
      t.lastDamagedBy = sourceOwner;
      room.events.push({
        trigger: "hurt",
        owner: location.seat.user.id,
        unitId: t.id,
      });
    }
  }
  effect(room, s, u, rule, targetId, superior = false) {
    const found = this.locate(room, targetId);
    if (!found) return;
    const t = found.target,
      amount =
        rule.amount +
        (superior && ["damage", "heal", "shield"].includes(rule.effect)
          ? 1
          : 0);
    switch (rule.effect) {
      case "damage":
        this.hit(room, targetId, amount, s.user.id);
        break;
      case "heal":
        if (t.health <= 0) break;
        t.health = Math.min(found.player ? 30 : t.maxHealth, t.health + amount);
        break;
      case "shield":
        t.shield = Math.min(20, (t.shield || 0) + amount);
        break;
      case "draw":
        for (let i = 0; i < amount; i++) this.draw(room, s);
        break;
      case "mana": {
        const gain = Math.min(amount, 3 - (s.abilityMana || 0));
        s.abilityMana = (s.abilityMana || 0) + gain;
        s.mana = Math.min(10, s.mana + gain);
        break;
      }
      case "attack":
        if (!found.player) t.attackBonus += amount;
        break;
      case "guard":
        if (!found.player) t.guard = true;
        break;
    }
  }
  deaths(room) {
    for (const s of room.seats) {
      const dead = s.board.filter((u) => u.health <= 0);
      if (!dead.length) continue;
      s.board = s.board.filter(alive);
      for (const u of dead) {
        s.discard.push(u);
        this.log(room, `${u.name} was defeated.`);
        const killer = room.seats.find(
          (x) => x.user.id === u.lastDamagedBy && x !== s,
        );
        if (killer && killer.rewards < 2) {
          killer.mana = Math.min(10, killer.mana + 1);
          killer.rewards++;
        }
        for (const ally of s.board)
          room.events.push({
            trigger: "ally_defeated",
            owner: s.user.id,
            unitId: ally.id,
          });
      }
    }
  }
  resolve(room) {
    let steps = 0;
    this.deaths(room);
    while (room.events.length && steps++ < 64) {
      const event = room.events.shift(),
        s = room.seats.find((x) => x.user.id === event.owner),
        u = s?.board.find((x) => x.id === event.unitId);
      if (!u || u.usedAbilityRound === this.round(room) || !u.abilities.length)
        continue;
      for (let offset = 0; offset < u.abilities.length; offset++) {
        const index = (u.cursor + offset) % u.abilities.length,
          a = u.abilities[index];
        if (
          a.ability.trigger !== event.trigger ||
          a.ability.trigger === "active"
        )
          continue;
        let targets = this.targets(room, s, u, a.ability);
        if (!targets.length && a.ability.target === "opponent")
          targets = this.guards(room.seats.find((x) => x !== s)).map(
            (x) => x.id,
          );
        if (!targets.length) continue;
        u.usedAbilityRound = this.round(room);
        u.cursor = (index + 1) % u.abilities.length;
        this.effect(room, s, u, a.ability, targets[0], u.superior);
        this.log(room, `${u.name} triggered ${a.name}.`);
        this.deaths(room);
        break;
      }
    }
    room.events = [];
    const dead = room.seats.filter((s) => s.health <= 0);
    if (dead.length)
      this.finish(
        room,
        dead.length === 2 ? null : room.seats.find((s) => s.health > 0).user.id,
        "health",
      );
  }
  action(room, userId, actionId, automatic = false) {
    if (room.phase === "playing" && this.now() >= room.endsAt) {
      const [a, b] = room.seats;
      this.finish(
        room,
        a.health === b.health
          ? null
          : a.health > b.health
            ? a.user.id
            : b.user.id,
        "time",
      );
      return;
    }
    if (
      room.phase === "playing" &&
      !automatic &&
      this.now() >= room.turnEndsAt
    ) {
      this.action(room, room.seats[room.current].user.id, "end:::", true);
      return;
    }
    const a = this.legal(room, userId).find((a) => a.id === actionId);
    if (!a)
      throw new Error(
        "That move is not available. Check the turn, mana, and target.",
      );
    const s = room.seats[room.current];
    room.updated = this.now();
    if (a.type === "end") {
      for (const u of s.board) u.attackBonus = 0;
      room.current = 1 - room.current;
      room.turnNumber++;
      for (const p of room.seats) p.abilityMana = 0;
      this.beginTurn(room);
      this.log(room, `${room.seats[room.current].user.name}’s turn.`);
      return;
    }
    if (a.type === "play") {
      const index = s.hand.findIndex((c) => c.id === a.cardId),
        c = s.hand.splice(index, 1)[0];
      s.mana -= c.cost;
      if (c.kind === "friend") {
        const u = this.unit(c, false, s.turns);
        s.board.push(u);
        room.events.push({ trigger: "enter", owner: userId, unitId: u.id });
        this.log(room, `${s.user.name} played ${c.name}.`);
      } else {
        this.effect(
          room,
          s,
          null,
          { effect: c.effect, amount: c.effect === "guard" ? 1 : 2 },
          a.targetId,
        );
        s.discard.push(c);
        this.log(room, `${s.user.name} used ${c.name}’s ${c.effect} power-up.`);
      }
    } else if (a.type === "superior") {
      s.mana -= 8;
      s.reserveUsed = true;
      const u = this.unit(s.reserve, true, s.turns);
      s.board.push(u);
      room.events.push({ trigger: "enter", owner: userId, unitId: u.id });
      this.log(room, `${s.user.name} summoned superior ${u.name}!`);
    } else if (a.type === "upgrade") {
      const index = s.board.findIndex((u) => u.id === a.unitId),
        old = s.board[index],
        up = this.unit(s.reserve, true, s.turns);
      up.id = old.id;
      up.health = 8 - (old.maxHealth - old.health);
      up.acted = old.acted;
      up.shield = old.shield;
      up.guard = old.guard;
      up.attackBonus = old.attackBonus;
      up.usedAbilityRound = old.usedAbilityRound;
      up.cursor = old.cursor;
      up.summonedTurn = old.summonedTurn;
      s.board[index] = up;
      s.mana -= 5;
      s.reserveUsed = true;
      this.log(room, `${old.name} became their superior self!`);
    } else {
      const u = s.board.find((u) => u.id === a.unitId);
      u.acted = true;
      if (a.type === "attack") {
        const target = this.locate(room, a.targetId);
        this.hit(room, a.targetId, u.attack + u.attackBonus, userId);
        if (!target.player)
          this.hit(
            room,
            u.id,
            target.target.attack + target.target.attackBonus,
            target.seat.user.id,
          );
        room.events.push({ trigger: "attack", owner: userId, unitId: u.id });
        this.log(
          room,
          `${u.name} attacked ${target.player ? target.seat.user.name : target.target.name}.`,
        );
      } else {
        const ability = u.abilities[a.abilityIndex];
        s.mana -= 2;
        u.usedAbilityRound = this.round(room);
        u.cursor = (a.abilityIndex + 1) % u.abilities.length;
        this.effect(room, s, u, ability.ability, a.targetId, u.superior);
        this.log(room, `${u.name} used ${ability.name}.`);
      }
    }
    this.resolve(room);
    room.botAt = this.now() + 750;
  }
  finish(room, winner, reason) {
    if (room.phase === "finished") return;
    room.phase = "finished";
    room.winner = winner;
    room.reason = reason;
    room.finishedAt = this.now();
    this.log(
      room,
      winner
        ? `${room.seats.find((s) => s.user.id === winner)?.user.name} wins!`
        : "It’s a draw. Good game!",
    );
    if (!room.recorded) {
      this.store.result(room);
      room.recorded = true;
    }
  }
  disconnect(userId) {
    const room = this.find(userId),
      s = room?.seats.find((s) => s.user.id === userId);
    if (s) {
      s.connected = false;
      s.disconnectedAt = this.now();
      this.log(room, `${s.user.name} disconnected. Seat held for 30 seconds.`);
    }
    return room;
  }
  reconnect(userId) {
    const room = this.find(userId),
      s = room?.seats.find((s) => s.user.id === userId);
    if (s) {
      s.connected = true;
      s.disconnectedAt = null;
      this.log(room, `${s.user.name} reconnected.`);
    }
    return room;
  }
  leave(room, userId) {
    const s = room.seats.find((s) => s.user.id === userId);
    if (!s) return;
    if (room.phase === "playing")
      this.finish(room, room.seats.find((x) => x !== s).user.id, "forfeit");
    room.seats = room.seats.filter((x) => x !== s);
    if (!room.seats.some((x) => !x.bot)) {
      this.rooms.delete(room.code);
      return;
    }
    room.hostId = room.seats.find((x) => !x.bot).user.id;
    this.log(room, `${s.user.name} left the table.`);
  }
  rematch(room, userId) {
    if (
      room.phase !== "finished" ||
      room.hostId !== userId ||
      room.seats.length !== 2
    )
      throw new Error(
        "The host can open a rematch when both players are at the table.",
      );
    room.phase = "lobby";
    room.id = uid();
    room.recorded = false;
    room.winner = null;
    room.reason = null;
    for (const s of room.seats) s.ready = s.bot;
    if (room.solo) {
      room.seats[0].ready = true;
      this.start(room, room.seats[0].user);
    }
  }
  botAction(room) {
    const s = room.seats[room.current],
      actions = this.legal(room, s.user.id),
      enemy = room.seats[1 - room.current];
    const score = (a) => {
      if (a.type === "end") return -100;
      if (a.type === "superior" || a.type === "upgrade") return 30;
      if (a.type === "attack") {
        const u = s.board.find((u) => u.id === a.unitId),
          target = this.locate(room, a.targetId);
        return target.player
          ? enemy.health <= u.attack + u.attackBonus
            ? 1000
            : 15
          : target.target.health <= u.attack + u.attackBonus
            ? 24
            : 12;
      }
      if (a.type === "play") {
        const c = s.hand.find((c) => c.id === a.cardId);
        if (c.kind === "friend") return 20;
        const u = s.board.find((u) => u.id === a.targetId);
        return c.effect === "heal"
          ? u.health < u.maxHealth
            ? 14
            : -200
          : c.effect === "attack"
            ? u.acted
              ? -200
              : 16
            : 8;
      }
      if (a.type === "ability") {
        const u = s.board.find((u) => u.id === a.unitId),
          rule = u.abilities[a.abilityIndex].ability,
          target = this.locate(room, a.targetId);
        if (
          rule.effect === "heal" &&
          target.target.health >= (target.player ? 30 : target.target.maxHealth)
        )
          return -200;
        if (rule.effect === "damage")
          return target.target.health <= rule.amount ? 50 : 18;
        return 9;
      }
      return 0;
    };
    return actions.sort((a, b) => score(b) - score(a))[0];
  }
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const s of [...room.seats])
        if (
          !s.bot &&
          !s.connected &&
          now - s.disconnectedAt >= RULES.reconnectMs
        )
          this.leave(room, s.user.id);
      if (!this.rooms.has(room.code)) continue;
      if (room.phase === "playing") {
        if (now >= room.endsAt) {
          const [a, b] = room.seats;
          this.finish(
            room,
            a.health === b.health
              ? null
              : a.health > b.health
                ? a.user.id
                : b.user.id,
            "time",
          );
        } else if (now >= room.turnEndsAt)
          this.action(room, room.seats[room.current].user.id, "end:::");
        else if (room.seats[room.current]?.bot && now >= room.botAt) {
          const a = this.botAction(room);
          if (a) this.action(room, room.seats[room.current].user.id, a.id);
        }
      }
      if (room.phase !== "playing" && now - room.updated > 30 * 60000)
        this.rooms.delete(room.code);
    }
  }
  view(room, userId) {
    const viewer = room.seats.find((s) => s.user.id === userId);
    if (!viewer) throw new Error("You are not a member of this card room.");
    const publicCard = (c) => {
      const {
        personId,
        name,
        color,
        face,
        sample,
        kind,
        id,
        cost,
        abilities,
        superior,
        health,
        maxHealth,
        attack,
        attackBonus,
        shield,
        guard,
        acted,
        usedAbilityRound,
        cursor,
        effect,
      } = c;
      return {
        personId,
        name,
        color,
        face,
        sample,
        kind,
        id,
        cost,
        abilities,
        superior,
        health,
        maxHealth,
        attack,
        attackBonus,
        shield,
        guard,
        acted,
        usedAbilityRound,
        cursor,
        effect,
      };
    };
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      solo: room.solo,
      turnNumber: room.turnNumber,
      round: this.round(room),
      currentPlayerId: room.seats[room.current]?.user.id,
      turnEndsAt: room.turnEndsAt,
      endsAt: room.endsAt,
      winner: room.winner,
      reason: room.reason,
      log: room.log,
      seats: room.seats.map((s) => ({
        id: s.user.id,
        name: s.user.name,
        bot: s.bot,
        ready: s.ready,
        connected: s.connected,
        disconnectedAt: s.disconnectedAt,
        health: s.health,
        shield: s.shield,
        mana: s.mana,
        handCount: s.hand.length,
        deckCount: s.deck.length,
        fatigue: s.fatigue,
        board: s.board.map(publicCard),
        discard: s.discard.map(publicCard),
        ...(s.user.id === userId
          ? {
              hand: s.hand.map(publicCard),
              reserve:
                s.reserve && !s.reserveUsed ? publicCard(s.reserve) : null,
              reserveUsed: s.reserveUsed,
            }
          : {}),
      })),
      legalActions: this.legal(room, userId),
    };
  }
}
