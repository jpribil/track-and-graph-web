import { migrate, db } from "./db.js";

try {
  await migrate();
  console.log("Database schema is ready.");
} finally {
  await db.end();
}
