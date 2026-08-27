import { randomUUID } from "node:crypto";
import pg from "pg";

const [clerkUserId, role] = process.argv.slice(2);
const allowedRoles = new Set(["moderator", "admin"]);

if (!clerkUserId?.startsWith("user_") || !allowedRoles.has(role)) {
  throw new Error(
    "Usage: pnpm --filter @workspace/db grant-role <Clerk user_... id> <moderator|admin>",
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to assign a moderation role.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(
    `
      INSERT INTO users (id, clerk_user_id, display_name, role, status)
      VALUES ($1, $2, 'Moderation operator', $3, 'active')
      ON CONFLICT (clerk_user_id)
      DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
    `,
    [randomUUID(), clerkUserId, role],
  );
} finally {
  await pool.end();
}