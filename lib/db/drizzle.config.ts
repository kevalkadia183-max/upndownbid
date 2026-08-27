import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const databaseName = decodeURIComponent(
  new URL(process.env.DATABASE_URL).pathname,
)
  .replace(/^\/+/, "")
  .split("?")[0];
if (
  process.env.NODE_ENV === "test" &&
  !databaseName.startsWith("signalrank_security_")
) {
  throw new Error(
    "Refusing to run test schema setup against the shared database. " +
      "Security tests must use a signalrank_security_* database.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
