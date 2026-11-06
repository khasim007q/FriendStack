import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Rooms } from "./rooms.mjs";
import { tickRoom, TICK_RATE, SNAPSHOT_RATE } from "./engine.mjs";
import { CardStore } from "./cards/store.mjs";
import { installCards, validOrigin } from "./cards/service.mjs";

export function createGameServer({
  port = Number(process.env.PORT) || 3001,
  host = "0.0.0.0",
  cardDbPath = ":memory:",
} = {}) {
  const rooms = new Rooms();
  const app = express();
  const http = createServer(app);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  const cards = installCards(app, http, new CardStore(cardDbPath));
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      service: "FriendStack Playground",
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      rooms: rooms.rooms.size,
      cardRooms: cards.duels.rooms.size,
    }),
  );
  app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
  );
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
  });
  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/ws/cards" || path === "/api/ws/cards") {
      if (!validOrigin(req)) {
        socket.destroy();
        return;
      }
      cards.upgrade(req, socket, head);
    } else if (path === "/ws")
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    else socket.destroy();
  });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024)
      ws.send(JSON.stringify(data));
  };
  const publish = (room) => {
    const packet = {
      type: "state",
      room: rooms.snapshot(room),
      serverTime: Date.now(),
    };
    for (const ws of wss.clients) if (ws.room === room) send(ws, packet);
  };
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.rateWindow = Date.now();
    ws.rateCount = 0;
    ws.on("pong", () => {
      ws.alive = true;
    });
    send(ws, {
      type: "welcome",
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      serverTime: Date.now(),
    });
    ws.on("message", (raw) => {
      try {
        const now = Date.now();
        if (now - ws.rateWindow > 1000) {
          ws.rateWindow = now;
          ws.rateCount = 0;
        }
        if (++ws.rateCount > 100) {
          if (ws.rateCount > 200) ws.close(1008, "Too many messages");
          return;
        }
        const data = JSON.parse(raw.toString());
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid message.");
        if (data.type === "ping") {
          send(ws, { type: "pong", at: data.at, serverTime: now });
          return;
        }
        if (["create", "join", "resume"].includes(data.type)) {
          if (ws.player)
            throw new Error("Leave your current room before joining another.");
          const { room, player } = rooms[data.type](data);
          ws.room = room;
          ws.player = player;
          send(ws, {
            type: "joined",
            playerId: player.id,
            token: player.token,
            code: room.code,
          });
          publish(room);
        } else if (data.type === "leave") {
          if (ws.room && ws.player) {
            const room = ws.room;
            rooms.leave(room, ws.player);
            ws.room = null;
            ws.player = null;
            send(ws, { type: "left" });
            publish(room);
          }
        } else {
          if (!ws.room || !ws.player) throw new Error("Join a room first.");
          rooms.action(ws.room, ws.player, data);
          if (data.type !== "input") publish(ws.room);
        }
      } catch (error) {
        send(ws, {
          type: "error",
          message:
            error instanceof SyntaxError
              ? "Invalid message format."
              : error.message,
        });
      }
    });
    ws.on("close", () => {
      if (ws.room && ws.player && ws.room.players.has(ws.player.id)) {
        rooms.disconnect(ws.room, ws.player);
        rooms.cleanRoom(ws.room);
        publish(ws.room);
      }
    });
    ws.on("error", () => {});
  });
  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.rooms.values()) tickRoom(room, 1 / TICK_RATE, now);
  }, 1000 / TICK_RATE);
  const broadcast = setInterval(() => {
    for (const room of rooms.rooms.values()) publish(room);
  }, 1000 / SNAPSHOT_RATE);
  const sweep = setInterval(() => rooms.sweep(), 1000);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 5000);
  const ready = new Promise((resolve) =>
    http.listen(port, host, () => resolve(http.address())),
  );
  const close = async () => {
    for (const timer of [tick, broadcast, sweep, heartbeat])
      clearInterval(timer);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await cards.close();
    await new Promise((resolve) => http.close(resolve));
  };
  return { http, wss, rooms, cards, ready, close };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const server = createGameServer({
    cardDbPath:
      process.env.CARD_DB_PATH ||
      fileURLToPath(new URL("../data/friendstack.sqlite", import.meta.url)),
  });
  const address = await server.ready;
  console.log(
    `\n  FriendStack game server → http://localhost:${address.port}\n  60 Hz simulation · 20 Hz snapshots · WebSocket /ws\n`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
}
