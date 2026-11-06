import { createCloudServer } from "../server/cloud/server.mjs";

// No SQLite or process-local authority in the Vercel entry point.
// Migrate with npm run db:migrate before deploying a new schema.
const runtime = createCloudServer({
  listen: false,
  migrate: false,
  maxRooms: Number(process.env.MAX_CARD_ROOMS) || 1000,
});
export default runtime.http;
