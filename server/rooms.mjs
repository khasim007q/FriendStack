import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resetPositions } from "./engine.mjs";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const emptyInput = () => ({ x: 0, y: 0, sprint: false, kick: false });
const cleanName = (value) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\x00-\x1F\x7F]/g, "")
        .slice(0, 18)
    : "";
function validToken(a, b) {
  if (typeof a !== "string") return false;
  const provided = Buffer.from(a),
    expected = Buffer.from(b);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export class Rooms {
  rooms = new Map();
  constructor(now = () => Date.now()) {
    this.now = now;
  }
  newPlayer(name, team, bot = false) {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString("hex"),
      name,
      team,
      bot,
      ready: bot,
      connected: true,
      x: 0,
      y: 0,
      dx: team === "home" ? 1 : -1,
      dy: 0,
      stamina: 1,
      input: emptyInput(),
      lastInputAt: 0,
      disconnectedAt: null,
    };
  }
  create(data) {
    if (this.rooms.size >= 100)
      throw new Error("The sandbox is full. Try again in a moment.");
    const name = cleanName(data.name);
    if (!name) throw new Error("Enter a player name to get started.");
    if (
      !Number.isInteger(data.teamSize) ||
      data.teamSize < 1 ||
      data.teamSize > 5
    )
      throw new Error("Choose a team size from 1v1 to 5v5.");
    if (![1, 3, 5].includes(data.duration))
      throw new Error("Choose a 1, 3, or 5 minute match.");
    let code;
    do {
      code = Array.from(
        randomBytes(6),
        (n) => ROOM_ALPHABET[n % ROOM_ALPHABET.length],
      ).join("");
    } while (this.rooms.has(code));
    const player = this.newPlayer(name, "home");
    const room = {
      code,
      hostId: player.id,
      teamSize: data.teamSize,
      duration: data.duration,
      phase: "lobby",
      players: new Map([[player.id, player]]),
      score: { home: 0, away: 0 },
      ball: null,
      startsAt: null,
      endsAt: null,
      goal: null,
      createdAt: this.now(),
      events: [
        { type: "room", text: `${name} created the room`, at: this.now() },
      ],
    };
    resetPositions(room);
    this.rooms.set(code, room);
    return { room, player };
  }
  join(data) {
    const code =
      typeof data.code === "string" ? data.code.toUpperCase().trim() : "";
    const room = this.rooms.get(code);
    if (!room)
      throw new Error("Room not found. Double-check the six-character code.");
    if (!["lobby", "finished"].includes(room.phase))
      throw new Error(
        "This match is underway. Ask your friends to finish it first.",
      );
    if (room.players.size >= room.teamSize * 2)
      throw new Error(
        "This room is full. Ask the host to remove a practice bot or create a bigger room.",
      );
    const name = cleanName(data.name);
    if (!name) throw new Error("Enter your player name first.");
    if (
      [...room.players.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("That name is already in this room. Choose another.");
    const home = [...room.players.values()].filter(
      (p) => p.team === "home",
    ).length;
    const away = [...room.players.values()].filter(
      (p) => p.team === "away",
    ).length;
    const player = this.newPlayer(name, home <= away ? "home" : "away");
    room.players.set(player.id, player);
    this.event(room, `${name} joined`);
    if (room.phase === "lobby") resetPositions(room);
    return { room, player };
  }
  resume(data) {
    const room = this.rooms.get(data.code);
    const player = room?.players.get(data.playerId);
    if (!player || player.bot || !validToken(data.token, player.token))
      throw new Error("Your saved session has expired. Join the room again.");
    if (player.connected)
      throw new Error(
        "This player is already connected in another tab. Use a different name to join.",
      );
    player.connected = true;
    player.disconnectedAt = null;
    player.input = emptyInput();
    this.event(room, `${player.name} reconnected`);
    return { room, player };
  }
  event(room, text) {
    room.events.unshift({ type: "session", text, at: this.now() });
    room.events.length = Math.min(20, room.events.length);
  }
  action(room, player, data) {
    const isHost = room.hostId === player.id;
    const editable = room.phase === "lobby" || room.phase === "finished";
    if (data.type === "input") {
      if (room.phase !== "playing") return;
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      player.input = {
        x: Math.max(-1, Math.min(1, data.x)),
        y: Math.max(-1, Math.min(1, data.y)),
        sprint: data.sprint === true,
        kick: player.input.kick || data.kick === true,
      };
      player.lastInputAt = this.now();
      return;
    }
    if (data.type === "team") {
      if (!editable) throw new Error("You can change sides after the match.");
      if (!["home", "away"].includes(data.team))
        throw new Error("Choose Mint or Coral.");
      if (player.team === data.team) return;
      if (
        [...room.players.values()].filter((p) => p.team === data.team).length >=
        room.teamSize
      )
        throw new Error("That side is full. Pick the other side.");
      player.team = data.team;
      player.ready = false;
      this.event(
        room,
        `${player.name} switched to ${data.team === "home" ? "Mint" : "Coral"}`,
      );
      if (room.phase === "lobby") resetPositions(room);
    } else if (data.type === "ready") {
      if (!editable) throw new Error("The match has already started.");
      player.ready = data.ready === true;
    } else if (data.type === "bots") {
      if (!isHost || !editable)
        throw new Error(
          "Only the host can change practice bots between matches.",
        );
      if (data.remove) {
        for (const [id, p] of room.players) if (p.bot) room.players.delete(id);
        this.event(room, "Practice bots removed");
      } else {
        for (const team of ["home", "away"]) {
          let count = [...room.players.values()].filter(
            (p) => p.team === team,
          ).length;
          while (count++ < room.teamSize) {
            const bot = this.newPlayer(
              `${team === "home" ? "Mint" : "Coral"} Bot ${count}`,
              team,
              true,
            );
            room.players.set(bot.id, bot);
          }
        }
        this.event(room, "Practice bots joined");
      }
      if (room.phase === "lobby") resetPositions(room);
    } else if (data.type === "start") {
      if (!isHost) throw new Error("Only the host can kick off.");
      if (!editable) throw new Error("The match is already underway.");
      const players = [...room.players.values()];
      if (
        !players.some((p) => p.team === "home") ||
        !players.some((p) => p.team === "away")
      )
        throw new Error(
          "Both sides need at least one player. Add a friend or practice bots.",
        );
      if (players.some((p) => !p.ready || !p.connected))
        throw new Error(
          "Everyone needs to be connected and ready before kickoff.",
        );
      room.score = { home: 0, away: 0 };
      room.phase = "countdown";
      room.startsAt = this.now() + 3000;
      room.endsAt = null;
      room.goal = null;
      resetPositions(room);
      this.event(room, "Kickoff!");
    } else if (data.type === "rematch") {
      if (!isHost || room.phase !== "finished")
        throw new Error(
          "Only the host can set up a rematch after the final whistle.",
        );
      room.phase = "lobby";
      room.score = { home: 0, away: 0 };
      room.endsAt = null;
      for (const p of room.players.values()) p.ready = p.bot;
      resetPositions(room);
      this.event(room, "Rematch lobby opened");
    } else throw new Error("Unknown room action.");
  }
  disconnect(room, player) {
    player.connected = false;
    player.disconnectedAt = this.now();
    player.input = emptyInput();
    player.ready = false;
    this.event(room, `${player.name} disconnected · seat held for 30s`);
  }
  leave(room, player) {
    room.players.delete(player.id);
    this.event(room, `${player.name} left`);
    this.cleanRoom(room);
  }
  cleanRoom(room) {
    const humans = [...room.players.values()].filter((p) => !p.bot);
    if (!humans.length) {
      this.rooms.delete(room.code);
      return;
    }
    const host = room.players.get(room.hostId);
    if (!host || !host.connected) {
      const next = humans.find((p) => p.connected);
      if (next) {
        room.hostId = next.id;
        this.event(room, `${next.name} is now the host`);
      }
    }
  }
  sweep() {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values())
        if (!p.bot && !p.connected && this.now() - p.disconnectedAt > 30_000)
          room.players.delete(p.id);
      this.cleanRoom(room);
    }
  }
  snapshot(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      teamSize: room.teamSize,
      duration: room.duration,
      phase: room.phase,
      score: room.score,
      ball: room.ball,
      startsAt: room.startsAt,
      endsAt: room.endsAt,
      goal: room.goal,
      events: room.events,
      players: [...room.players.values()].map(
        ({
          token,
          input,
          lastInputAt,
          lastKick,
          disconnectedAt,
          ...publicPlayer
        }) => publicPlayer,
      ),
    };
  }
}
