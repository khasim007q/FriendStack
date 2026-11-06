import { createServer, request } from "node:http";
import { connect } from "node:net";

// Test-only round-robin ingress. Production ingress/scaling is provided by Vercel.
export async function balancer(servers) {
  let cursor = 0;
  const counts = servers.map(() => ({ http: 0, websocket: 0 })),
    sockets = new Set();
  const choose = (kind) => {
    const i = cursor++ % servers.length;
    counts[i][kind]++;
    return new URL(servers[i].base);
  };
  const http = createServer((req, res) => {
    const target = choose("http");
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    });
    req.pipe(upstream);
  });
  http.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  http.on("upgrade", (req, client, head) => {
    const target = choose("websocket"),
      upstream = connect(Number(target.port), target.hostname, () => {
        upstream.write(
          `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(
            req.headers,
          )
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n")}\r\n\r\n`,
        );
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    sockets.add(upstream);
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${http.address().port}`;
  return {
    base,
    url: base.replace("http:", "ws:") + "/api/ws/cards",
    counts,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => http.close(r));
    },
  };
}
