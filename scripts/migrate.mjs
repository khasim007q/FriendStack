import { Database } from "../server/cloud/database.mjs";
import { CloudStore } from "../server/cloud/store.mjs";
const db = new Database(process.env.DATABASE_URL);
try {
  await db.migrate();
  await new CloudStore(db).init();
  console.log("FriendStack schema is ready.");
} finally {
  await db.close();
}
