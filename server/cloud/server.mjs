import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Database } from "./database.mjs";
import { CloudStore, hash } from "./store.mjs";
import { SharedDuels } from "./duels.mjs";
import { validOrigin } from "../cards/service.mjs";

export function createCloudServer({
  url = process.env.DATABASE_URL,
  schema = "friendstack",
  port = 0,
  host = "127.0.0.1",
  listen = true,
  migrate = true,
  maxRooms = 1000,
  pollMs = 250,
} = {}) {
  const db = new Database(url, { schema }),
    store = new CloudStore(db),
    duels = new SharedDuels(store, { maxRooms }),
    app = express(),
    http = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  let pollTimer,
    busy = false,
    closing = false,
    lastSweep = 0;
  const initialized = (async () => {
    if (migrate) await db.migrate();
    await store.init();
  })();
  // Attach a rejection handler immediately; requests receive a bounded 503 below.
  initialized.catch(() => {});
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      await initialized;
    } catch {
      return res.status(503).json({
        error: "Shared storage is unavailable. Please try again shortly.",
      });
    }
    if (!["GET", "HEAD"].includes(req.method) && !validOrigin(req))
      return res.status(403).json({ error: "Use this app’s own address." });
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body)))
      return res.status(400).json({ error: "Invalid request." });
    next();
  });
  const safeError = (e) =>
    e.code && /^\d|^ECONN|^ENOT/.test(e.code)
      ? "Shared storage is busy. Please try again."
      : e.message;
  const handle = (fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      if (req.user && req.method === "POST") {
        let person = req.params.id;
        if (req.path.startsWith("/api/cards/review/"))
          person = (
            await db.get(
              "SELECT t.person FROM __SCHEMA__.revisions r JOIN __SCHEMA__.traits t ON t.id=r.trait_id WHERE r.id=$1",
              req.params.id,
            )
          )?.person;
        await store.notify(req.user, person);
      }
      res.json(result);
    } catch (e) {
      res.status(e.status || 400).json({ error: safeError(e) });
    }
  };
  app.get(
    "/api/health",
    handle(async () => {
      await db.query("SELECT 1");
      return { ok: true, mode: "shared", protocol: 1 };
    }),
  );
  app.post(
    "/api/cards/auth/:action",
    handle(async (req) => {
      if (!["login", "register"].includes(req.params.action))
        throw new Error("Unknown sign-in action.");
      const ip = process.env.VERCEL
        ? req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress
        : req.socket.remoteAddress;
      await db.rate(`auth:ip:${hash(String(ip))}`, 40);
      await db.rate(
        `auth:name:${hash(String(req.body?.username || "").toLowerCase())}`,
        10,
      );
      return store[req.params.action](req.body || {});
    }),
  );
  app.use("/api/cards", async (req, res, next) => {
    try {
      req.token = req.headers.authorization?.replace(/^Bearer /, "");
      req.user = await store.auth(req.token);
      if (!req.user)
        return res
          .status(401)
          .json({ error: "Sign in to your identity first." });
      if (req.method !== "GET") await db.rate(`api:${req.user.id}`, 120);
      next();
    } catch {
      res.status(503).json({
        error: "Shared storage is unavailable. Please try again shortly.",
      });
    }
  });
  app.get(
    "/api/cards/me",
    handle(async (req) => {
      await duels.sweep(10);
      return store.bootstrap(req.user);
    }),
  );
  app.post(
    "/api/cards/logout",
    handle((req) => store.logout(req.token)),
  );
  app.post(
    "/api/cards/friends",
    handle((req) => store.addFriend(req.user, req.body)),
  );
  app.post(
    "/api/cards/friends/:id/traits",
    handle((req) => store.defineTrait(req.user, req.params.id, req.body)),
  );
  app.post(
    "/api/cards/friends/:id/invite",
    handle((req) => store.invite(req.user, req.params.id)),
  );
  app.get(
    "/api/cards/invite/:token",
    handle(async (req) => {
      const i = await store.invitation(req.params.token);
      return {
        name: (await store.person(i.person)).name,
        creator: (
          await db.get(
            "SELECT name FROM __SCHEMA__.accounts WHERE id=$1",
            i.creator,
          )
        ).name,
      };
    }),
  );
  app.post(
    "/api/cards/claim",
    handle((req) => store.claim(req.user, req.body.token)),
  );
  app.post(
    "/api/cards/review/:id",
    handle((req) => {
      if (typeof req.body.approve !== "boolean")
        throw new Error("Choose approve or reject.");
      return store.review(req.user, req.params.id, req.body.approve);
    }),
  );
  app.post(
    "/api/cards/decks",
    handle((req) => store.saveDeck(req.user, req.body)),
  );
  // Optional authenticated external scheduler; timers also reconcile on reads/actions.
  app.get(
    "/api/maintenance",
    handle(async (req) => {
      if (
        !process.env.CRON_SECRET ||
        req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
      ) {
        const e = new Error("Not authorized.");
        e.status = 401;
        throw e;
      }
      return { processed: await duels.sweep(200) };
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown API route." }),
  );
  app.use(
    express.static(fileURLToPath(new URL("../../dist", import.meta.url))),
  );
  app.get("/{*path}", (_req, res) =>
    res.sendFile(
      fileURLToPath(new URL("../../dist/index.html", import.meta.url)),
    ),
  );
  app.use((e, _req, res, _next) =>
    res.status(e.status || 500).json({
      error:
        e.type === "entity.too.large"
          ? "Request is too large."
          : "Invalid request.",
    }),
  );
  const send = (ws, data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 262144) {
      ws.close(1013, "Connection is too slow. Reconnect to resume.");
      return;
    }
    ws.send(JSON.stringify(data));
  };
  const sendRoom = (ws, room) => {
    ws.version = room?.version;
    ws.code = room?.code;
    send(
      ws,
      room ? { type: "state", room, serverTime: Date.now() } : { type: "left" },
    );
  };
  const poll = async () => {
    if (busy || closing) return;
    busy = true;
    try {
      await initialized;
      const sockets = [...wss.clients].filter((ws) => ws.user);
      if (!sockets.length) return;
      const ids = sockets.map((ws) => ws.user.id),
        now = Date.now();
      if (now - lastSweep >= 500) {
        lastSweep = now;
        await duels.sweep(100);
      }
      const leases = await db.all(
        "SELECT * FROM __SCHEMA__.connections WHERE user_id=ANY($1::text[])",
        ids,
      );
      const refreshes = await db.all(
        "SELECT * FROM __SCHEMA__.social_refresh WHERE user_id=ANY($1::text[])",
        ids,
      );
      const sessions = await db.all(
        "SELECT hash FROM __SCHEMA__.sessions WHERE hash=ANY($1::text[]) AND expires>$2",
        sockets.map((ws) => hash(ws.token)),
        now,
      );
      const valid = new Set(sessions.map((s) => s.hash));
      const rows = await db.all(
        "SELECT r.* FROM __SCHEMA__.rooms r WHERE code IN(SELECT code FROM __SCHEMA__.memberships WHERE user_id=ANY($1::text[]))",
        ids,
      );
      for (const ws of sockets) {
        if (!valid.has(hash(ws.token))) {
          ws.close(4003, "Signed out");
          continue;
        }
        if (
          leases.find((c) => c.user_id === ws.user.id)?.connection_id !==
          ws.connectionId
        ) {
          ws.close(4001, "This identity opened another table window.");
          continue;
        }
        const social =
          refreshes.find((r) => r.user_id === ws.user.id)?.version || 0;
        if (ws.social !== undefined && social !== ws.social)
          send(ws, { type: "refresh" });
        ws.social = social;
        if (now - (ws.lastHeartbeat || 0) > 5000) {
          if (!ws.alive) {
            ws.terminate();
            continue;
          }
          ws.alive = false;
          ws.lastHeartbeat = now;
          ws.ping();
        }
        const row = rows.find((r) =>
          r.state.seats.some((s) => s.user.id === ws.user.id),
        );
        if (row?.version !== ws.version || row?.code !== ws.code)
          sendRoom(ws, duels.view(row, ws.user.id));
      }
    } catch {
      for (const ws of wss.clients)
        send(ws, {
          type: "error",
          message:
            "Shared storage is recovering. Your last confirmed move is saved.",
        });
    } finally {
      busy = false;
    }
  };
  wss.on("connection", (ws) => {
    ws.connectionId = randomUUID();
    ws.version = null;
    ws.alive = true;
    let queue = Promise.resolve(),
      count = 0,
      window = Date.now(),
      lastTouch = 0;
    const deadline = setTimeout(() => {
      if (!ws.user) ws.close(4003, "Sign in first");
    }, 5000);
    ws.on("pong", () => {
      ws.alive = true;
    });
    if (!pollTimer) {
      pollTimer = setInterval(poll, pollMs);
      pollTimer.unref();
    }
    ws.on("message", (raw) => {
      if (Date.now() - window > 1000) {
        count = 0;
        window = Date.now();
      }
      if (++count > 40) {
        ws.close(1008, "Too many card actions");
        return;
      }
      queue = queue
        .then(async () => {
          await initialized;
          const data = JSON.parse(raw.toString());
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw new Error("Invalid message.");
          if (data.type === "auth") {
            if (ws.user) throw new Error("Already signed in.");
            const user = await store.auth(data.token);
            if (!user) {
              ws.close(4003, "Sign in again");
              return;
            }
            const room = await duels.connect(user, ws.connectionId);
            ws.user = user;
            ws.token = data.token;
            clearTimeout(deadline);
            lastTouch = Date.now();
            if (ws.readyState !== WebSocket.OPEN) {
              await duels.disconnect(user.id, ws.connectionId);
              return;
            }
            send(ws, { type: "connected", user, serverTime: Date.now() });
            sendRoom(ws, room);
            return;
          }
          if (!ws.user) {
            ws.close(4003, "Sign in first");
            return;
          }
          if (data.type === "ping") {
            if (Date.now() - lastTouch > 4000) {
              if (!(await duels.touch(ws.user.id, ws.connectionId))) {
                ws.close(4001, "Opened elsewhere");
                return;
              }
              lastTouch = Date.now();
            }
            send(ws, { type: "pong", at: data.at, serverTime: Date.now() });
            return;
          }
          if (!(await store.auth(ws.token))) {
            ws.close(4003, "Sign in again");
            return;
          }
          await db.rate(`moves:${ws.user.id}`, 1200);
          sendRoom(ws, await duels.action(ws.user, ws.connectionId, data));
        })
        .catch(async (e) => {
          if (e.code === 4001) {
            ws.close(4001, e.message);
            return;
          }
          if (e.stale && ws.user)
            sendRoom(ws, await duels.read(ws.user.id).catch(() => null));
          send(ws, {
            type: "error",
            message:
              e instanceof SyntaxError ? "Invalid message." : safeError(e),
          });
        });
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(deadline);
      queue = queue
        .then(() =>
          ws.user ? duels.disconnect(ws.user.id, ws.connectionId) : null,
        )
        .catch(() => {});
      ws.done = queue;
      if (!wss.clients.size) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });
  });
  http.on("upgrade", async (req, socket, head) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (
        !["/ws/cards", "/api/ws/cards", "/api/server"].includes(path) ||
        !validOrigin(req) ||
        closing
      ) {
        socket.destroy();
        return;
      }
      await initialized;
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } catch {
      socket.destroy();
    }
  });
  const ready = (async () => {
    await initialized;
    if (!listen) return null;
    return new Promise((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, host, () => resolve(http.address()));
    });
  })();
  ready.catch(() => {});
  const close = async () => {
    closing = true;
    clearInterval(pollTimer);
    const clients = [...wss.clients];
    for (const ws of clients) ws.terminate();
    await new Promise((r) => wss.close(r));
    await Promise.all(clients.map((ws) => ws.done));
    while (busy) await new Promise((r) => setTimeout(r, 10));
    if (http.listening) {
      http.closeIdleConnections();
      await new Promise((r) => http.close(r));
    }
    await db.close();
  };
  return { http, wss, db, store, duels, ready, close, poll };
}
