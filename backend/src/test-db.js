import "dotenv/config";

const url = process.env.DATABASE_URL || "";
console.log("DATABASE_URL loaded?", Boolean(url));

try {
  const masked = url.replace(/:(.*)@/, ":***@");
  console.log("Using:", masked);
} catch {}

import { pool } from "./db.js";

try {
  const r = await pool.query("select now()");
  console.log("OK:", r.rows[0]);
  process.exit(0);
} catch (e) {
  console.error("DB FAIL:", e);
  process.exit(1);
}
