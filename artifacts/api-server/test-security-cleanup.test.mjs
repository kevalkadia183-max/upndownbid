import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  assertDataUnchanged,
  assertSchemaUnchanged,
  captureDataSnapshot,
  captureSchemaSnapshot,
  cleanupStaleDatabases,
  createCleanupManager,
  normalizeDataDump,
  run,
  SECURITY_DATABASE_PREFIX,
} from "./test-security.mjs";

function fakeChild({ exits = true } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.killSignal = signal;
    if (exits) {
      queueMicrotask(() => {
        child.signalCode = signal;
        child.emit("exit", null, signal);
      });
    }
    return true;
  };
  return child;
}

test("SIGTERM stops the child and cleans the disposable database before exiting", async () => {
  const child = fakeChild();
  const queries = [];
  let poolEnded = false;
  let exitCode;
  const manager = createCleanupManager({
    pool: {
      query: async (query) => {
        queries.push(query);
      },
      end: async () => {
        poolEnded = true;
      },
    },
    databaseName: `${SECURITY_DATABASE_PREFIX}test_database`,
    getChild: () => child,
    cleanupTimeoutMs: 100,
  });

  await manager.handleSignal("SIGTERM", (code) => {
    exitCode = code;
  });

  assert.equal(child.killSignal, "SIGTERM");
  assert.match(queries[0], /DROP DATABASE IF EXISTS/);
  assert.equal(poolEnded, true);
  assert.equal(exitCode, 143);
});

test("cleanup verifies the shared schema before closing the source pool", async () => {
  const child = fakeChild();
  const events = [];
  const manager = createCleanupManager({
    pool: {
      query: async (query) => {
        events.push(query.startsWith("DROP DATABASE") ? "drop" : "query");
      },
      end: async () => {
        events.push("end");
      },
    },
    databaseName: `${SECURITY_DATABASE_PREFIX}verified_database`,
    getChild: () => child,
    verifySourceDatabase: async () => {
      events.push("verify");
    },
    cleanupTimeoutMs: 100,
  });

  await manager.cleanup();

  assert.deepEqual(events, ["verify", "drop", "end"]);
});

test("schema guard rejects unexpected shared-database changes", () => {
  assert.throws(
    () => assertSchemaUnchanged("CREATE TABLE public.before ();", ""),
    /Shared development database schema changed/,
  );
});

test("data snapshot uses a read-only data dump", async () => {
  const calls = [];
  const snapshot = await captureDataSnapshot({
    databaseUrl: "postgres://example.test/source",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return [
        "\\restrict random-dump-token",
        "COPY public.users (id) FROM stdin;",
        "owner",
        "\\.",
        "\\unrestrict random-dump-token",
        "",
      ].join("\n");
    },
  });

  assert.deepEqual(
    snapshot,
    normalizeDataDump("COPY public.users (id) FROM stdin;\nowner\n\\.\n"),
  );
  assert.equal(calls[0].command, "pg_dump");
  assert.deepEqual(calls[0].args.slice(0, 5), [
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--schema=public",
  ]);
  assert.match(
    calls[0].options.env.PGOPTIONS,
    /default_transaction_read_only=on/,
  );
});

test("data guard rejects unexpected shared-database record changes", () => {
  assert.throws(
    () =>
      assertDataUnchanged(
        normalizeDataDump("COPY public.users (id) FROM stdin;\nbefore\n\\.\n"),
        normalizeDataDump("COPY public.users (id) FROM stdin;\nafter\n\\.\n"),
      ),
    /Shared development database records changed/,
  );
});

test("SIGINT cleanup is bounded when a child does not exit", async () => {
  const child = fakeChild({ exits: false });
  const queries = [];
  let exitCode;
  const manager = createCleanupManager({
    pool: {
      query: async (query) => {
        queries.push(query);
      },
      end: async () => {},
    },
    databaseName: `${SECURITY_DATABASE_PREFIX}bounded_database`,
    getChild: () => child,
    cleanupTimeoutMs: 10,
    onChildShutdownTimeout: () => {},
  });

  await manager.handleSignal("SIGINT", (code) => {
    exitCode = code;
  });

  assert.equal(child.killSignal, "SIGINT");
  assert.equal(queries.length, 1);
  assert.equal(exitCode, 130);
});

test("startup cleanup removes only timestamped stale security databases", async () => {
  const now = 2_000_000;
  const staleName = `${SECURITY_DATABASE_PREFIX}${now - 1000}_1_old`;
  const freshName = `${SECURITY_DATABASE_PREFIX}${now - 10}_1_fresh`;
  const legacyName = `${SECURITY_DATABASE_PREFIX}legacy_name`;
  const queries = [];
  const removed = await cleanupStaleDatabases(
    {
      query: async (query, values) => {
        queries.push({ query, values });
        if (values)
          return {
            rows: [
              { datname: staleName },
              { datname: freshName },
              { datname: legacyName },
            ],
          };
      },
    },
    { now, maxAgeMs: 100, cleanupTimeoutMs: 100 },
  );

  assert.deepEqual(removed, [staleName]);
  assert.equal(queries.length, 2);
  assert.match(
    queries[1].query,
    new RegExp(`DROP DATABASE IF EXISTS "${staleName}"`),
  );
});

test("child failures reject with a non-zero status", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "process.exit(7)"], { cwd: process.cwd() }),
    /node exited with status 7/,
  );
});

test("schema snapshots detect added, removed, and renamed tables and columns", () => {
  const before = `
CREATE TABLE public.listings (
    name text
);
`;
  const after = `
CREATE TABLE public.products (
    title text
);
`;
  assert.throws(
    () => assertSchemaUnchanged(before, after),
    (error) =>
      error.message.includes("CREATE TABLE public.products") &&
      error.message.includes("CREATE TABLE public.listings") &&
      error.message.includes("title text") &&
      error.message.includes("name text"),
  );
});

test("schema snapshots detect leaked functions, triggers, indexes, and constraints", () => {
  const after = `
CREATE INDEX listings_slug_index ON public.listings USING btree (slug);
ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_slug_key UNIQUE (slug);
CREATE FUNCTION public.audit_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RETURN NEW; END; $$;
CREATE TRIGGER audit_listing BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.audit_listing();
`;

  assert.throws(
    () => assertSchemaUnchanged("", after),
    (error) =>
      error.message.includes("CREATE INDEX listings_slug_index") &&
      error.message.includes("ADD CONSTRAINT listings_slug_key") &&
      error.message.includes("CREATE FUNCTION public.audit_listing") &&
      error.message.includes("CREATE TRIGGER audit_listing"),
  );
});

test("schema snapshots use a read-only schema-only PostgreSQL dump", async () => {
  const calls = [];
  const snapshot = await captureSchemaSnapshot({
    databaseUrl: "postgresql://localhost/signalrank",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return "\\restrict random_dump_key\nCREATE TABLE public.listings ();";
    },
  });

  assert.equal(snapshot, "CREATE TABLE public.listings ();");
  assert.deepEqual(calls[0].args.slice(0, 3), [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
  ]);
  assert.equal(calls[0].command, "pg_dump");
  assert.match(
    calls[0].options.env.PGOPTIONS,
    /default_transaction_read_only=on/,
  );
});

test("data fingerprints include public table rows but exclude dump metadata", () => {
  const before = normalizeDataDump(`
SET statement_timeout = 0;
SELECT pg_catalog.setval('public.listings_id_seq', 4, true);
COPY public.listings (id, name) FROM stdin;
listing-2\tSecond
listing-1\tFirst
\\.
`);
  const after = normalizeDataDump(`
SET statement_timeout = 9000;
SELECT pg_catalog.setval('public.listings_id_seq', 40, true);
COPY public.listings (id, name) FROM stdin;
listing-1\tFirst
listing-2\tSecond
\\.
`);

  assert.deepEqual(after, before);
});

test("data snapshots use a read-only public data-only PostgreSQL dump", async () => {
  const calls = [];
  const snapshot = await captureDataSnapshot({
    databaseUrl: "postgresql://localhost/signalrank",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return "COPY public.listings (id) FROM stdin;\nlisting-1\n\\.\n";
    },
  });

  assert.deepEqual(snapshot, {
    version: 1,
    tables: {
      "public.listings": {
        rowCount: 1,
        fingerprint:
          "e25e57dc2851fd17e73a0f2623363afd9f36bf476ee9d653f2c3dfa70bfeb783",
      },
    },
  });
  assert.equal(calls[0].command, "pg_dump");
  assert.deepEqual(calls[0].args.slice(0, 5), [
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--schema=public",
  ]);
  assert.match(
    calls[0].options.env.PGOPTIONS,
    /default_transaction_read_only=on/,
  );
});

test("data guard reports every table with changed records", () => {
  const before = normalizeDataDump(`
COPY public.listings (id) FROM stdin;
listing-1
\\.
COPY public.users (id) FROM stdin;
user-1
\\.
`);
  const after = normalizeDataDump(`
COPY public.listings (id) FROM stdin;
listing-1
listing-2
\\.
COPY public.users (id) FROM stdin;
user-renamed
\\.
COPY public.reports (id) FROM stdin;
report-1
\\.
`);

  assert.throws(
    () => assertDataUnchanged(before, after),
    (error) =>
      error.message.includes("Affected tables:") &&
      error.message.includes("public.listings") &&
      error.message.includes("public.users") &&
      error.message.includes("public.reports") &&
      error.message.includes("inserted, updated, or deleted"),
  );
});
