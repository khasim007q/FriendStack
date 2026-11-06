import { WebSocketServer, WebSocket } from "ws";
import { Duels } from "./duels.mjs";

export function validOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    );
    const host =
      local && req.headers["x-forwarded-host"]
        ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
        : req.headers.host;
    return new URL(req.headers.origin).host === host;
  } catch {
    return false;
  }
}

export function installCards(app, http, store) {
  const duels = new Duels(store),
    wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 262144)
      ws.send(JSON.stringify(data));
  };
  const publish = (room) => {
    if (!room) return;
    for (const ws of wss.clients)
      if (ws.user && room.seats.some((s) => s.user.id === ws.user.id))
        send(ws, {
          type: "state",
          room: duels.view(room, ws.user.id),
          serverTime: Date.now(),
        });
  };
  const refresh = () => {
    for (const ws of wss.clients) if (ws.user) send(ws, { type: "refresh" });
  };
  const auth = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = store.auth(token);
    if (!user)
      return res.status(401).json({ error: "Sign in to your identity first." });
    req.user = user;
    req.token = token;
    next();
  };
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  const attempts = new Map();
  app.use("/api/cards", (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method) && !validOrigin(req))
      return res.status(403).json({ error: "Use this app’s own address." });
    next();
  });
  app.post(
    "/api/cards/auth/:action",
    handle(async (req) => {
      const key = req.socket.remoteAddress || "local",
        window = attempts.get(key) || { time: Date.now(), count: 0 };
      if (Date.now() - window.time > 60000) {
        window.time = Date.now();
        window.count = 0;
      }
      window.count++;
      attempts.set(key, window);
      if (window.count > 40)
        throw new Error(
          "Too many sign-in attempts. Wait a minute and try again.",
        );
      if (!["login", "register"].includes(req.params.action))
        throw new Error("Unknown sign-in action.");
      return store[req.params.action](req.body);
    }),
  );
  app.use("/api/cards", auth);
  app.get(
    "/api/cards/me",
    handle((req) => store.bootstrap(req.user)),
  );
  app.post(
    "/api/cards/logout",
    handle((req) => {
      store.logout(req.token);
      for (const ws of wss.clients)
        if (ws.token === req.token) ws.close(4003, "Signed out");
      return { ok: true };
    }),
  );
  app.post(
    "/api/cards/friends",
    handle((req) => {
      const result = store.addFriend(req.user, req.body);
      refresh();
      return result;
    }),
  );
  app.post(
    "/api/cards/friends/:id/traits",
    handle((req) => {
      const result = store.defineTrait(req.user, req.params.id, req.body);
      refresh();
      return result;
    }),
  );
  app.post(
    "/api/cards/friends/:id/invite",
    handle((req) => store.invite(req.user, req.params.id)),
  );
  app.get(
    "/api/cards/invite/:token",
    handle((req) => {
      const i = store.invitation(req.params.token);
      return {
        name: store.person(i.person).name,
        creator: store.get("SELECT name FROM accounts WHERE id=?", i.creator)
          .name,
      };
    }),
  );
  app.post(
    "/api/cards/claim",
    handle((req) => {
      const result = store.claim(req.user, req.body.token);
      refresh();
      return result;
    }),
  );
  app.post(
    "/api/cards/review/:id",
    handle((req) => {
      if (typeof req.body.approve !== "boolean")
        throw new Error("Choose approve or reject.");
      const result = store.review(req.user, req.params.id, req.body.approve);
      refresh();
      return result;
    }),
  );
  app.post(
    "/api/cards/decks",
    handle((req) => {
      const result = store.saveDeck(req.user, req.body);
      refresh();
      return result;
    }),
  );
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    let window = Date.now(),
      count = 0;
    const deadline = setTimeout(() => {
      if (!ws.user) ws.close(4003, "Sign in first");
    }, 5000);
    ws.on("message", (raw) => {
      try {
        if (Date.now() - window > 1000) {
          window = Date.now();
          count = 0;
        }
        if (++count > 40) {
          ws.close(1008, "Too many card actions");
          return;
        }
        const data = JSON.parse(raw.toString());
        if (!data || typeof data !== "object")
          throw new Error("Invalid message.");
        if (data.type === "auth") {
          if (ws.user) throw new Error("Already signed in.");
          const user = store.auth(data.token);
          if (!user) {
            ws.close(4003, "Sign in again");
            return;
          }
          ws.token = data.token;
          ws.user = user;
          clearTimeout(deadline);
          for (const other of wss.clients)
            if (other !== ws && other.user?.id === user.id) {
              other.replaced = true;
              other.close(4001, "This identity opened another table window.");
            }
          send(ws, { type: "connected", user, serverTime: Date.now() });
          const room = duels.reconnect(user.id);
          if (room) publish(room);
          else send(ws, { type: "left" });
          return;
        }
        if (!ws.user || !store.auth(ws.token)) {
          ws.close(4003, "Sign in again");
          return;
        }
        const user = ws.user;
        if (data.type === "ping") {
          send(ws, { type: "pong", at: data.at, serverTime: Date.now() });
          return;
        }
        let room = duels.find(user.id);
        if (data.type === "create") room = duels.create(user, data);
        else if (data.type === "join") room = duels.join(user, data);
        else {
          if (!room) throw new Error("Join a card table first.");
          if (data.type === "ready") {
            if (room.phase !== "lobby")
              throw new Error("This duel is underway.");
            room.seats.find((s) => s.user.id === user.id).ready =
              data.ready === true;
          } else if (data.type === "start") duels.start(room, user);
          else if (data.type === "act")
            duels.action(room, user.id, data.actionId);
          else if (data.type === "rematch") duels.rematch(room, user.id);
          else if (data.type === "leave") {
            duels.leave(room, user.id);
            send(ws, { type: "left" });
            send(ws, { type: "refresh" });
          } else throw new Error("Unknown card-table action.");
        }
        publish(room);
      } catch (e) {
        send(ws, {
          type: "error",
          message: e instanceof SyntaxError ? "Invalid message." : e.message,
        });
      }
    });
    ws.on("close", () => {
      clearTimeout(deadline);
      if (ws.user && !ws.replaced) {
        const room = duels.disconnect(ws.user.id);
        publish(room);
      }
    });
    ws.on("error", () => {});
  });
  const interval = setInterval(() => {
    try {
      const before = new Map(
        [...duels.rooms.values()].map((r) => [
          r.code,
          `${r.phase}:${r.turnNumber}:${r.log[0]?.id}:${r.seats.length}`,
        ]),
      );
      duels.tick();
      for (const r of duels.rooms.values())
        if (
          before.get(r.code) !==
          `${r.phase}:${r.turnNumber}:${r.log[0]?.id}:${r.seats.length}`
        )
          publish(r);
      for (const ws of wss.clients)
        if (ws.user && !duels.find(ws.user.id) && ws.hadRoom) {
          send(ws, { type: "left" });
          ws.hadRoom = false;
        } else if (ws.user) ws.hadRoom = !!duels.find(ws.user.id);
    } catch (error) {
      console.error("Card clock:", error.message);
    }
  }, 200);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
    for (const [key, value] of attempts)
      if (Date.now() - value.time > 60000) attempts.delete(key);
  }, 5000);
  return {
    duels,
    wss,
    upgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    },
    async close() {
      clearInterval(interval);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      store.close();
    },
  };
}
