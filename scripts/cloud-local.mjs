import { createCloudServer } from "../server/cloud/server.mjs";
const server = createCloudServer({ port: Number(process.env.PORT) || 3002 });
const address = await server.ready;
console.log(
  `FriendStack shared-storage server → http://localhost:${address.port}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
