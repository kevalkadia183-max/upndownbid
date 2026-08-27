import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SECURITY_DATABASE_PREFIX = "signalrank_security_";
export const CLEANUP_TIMEOUT_MS = 10_000;
export const STALE_DATABASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_STALE_DATABASES_PER_RUN = 20;
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

function captureCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `${command} exited with status ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
}

function normalizeSchemaDump(schemaDump) {
  return schemaDump
    .split("\n")
    .filter((line) => !/^\\(?:un)?restrict\b/.test(line))
    .join("\n");
}

function hashRows(rows) {
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

export function normalizeDataDump(dataDump) {
  const tables = new Map();
  let currentTable;

  for (const line of dataDump.split(/\r?\n/)) {
    const copyHeader = line.match(/^COPY (.+?) \(.+\) FROM stdin;$/);
    if (copyHeader) {
      currentTable = { name: copyHeader[1], rows: [] };
      tables.set(currentTable.name, currentTable);
      continue;
    }

    if (!currentTable) continue;
    if (line === "\\.") {
      currentTable = undefined;
      continue;
    }
    currentTable.rows.push(line);
  }

  return {
    version: 1,
    tables: Object.fromEntries(
      [...tables.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, { rows }]) => {
          const sortedRows = [...rows].sort();
          return [
            name,
            {
              rowCount: sortedRows.length,
              fingerprint: hashRows(sortedRows),
            },
          ];
        }),
    ),
  };
}

export async function captureSchemaSnapshot({
  databaseUrl = process.env.DATABASE_URL,
  runCommand = captureCommand,
} = {}) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to inspect the shared database schema.",
    );
  }

  const schemaDump = await runCommand(
    "pg_dump",
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      `--dbname=${databaseUrl}`,
    ],
    {
      env: {
        ...process.env,
        PGOPTIONS: [
          process.env.PGOPTIONS,
          "-c default_transaction_read_only=on",
        ]
          .filter(Boolean)
          .join(" "),
      },
    },
  );
  return normalizeSchemaDump(schemaDump);
}

export async function captureDataSnapshot({
  databaseUrl = process.env.DATABASE_URL,
  runCommand = captureCommand,
} = {}) {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to inspect shared database records.",
    );
  }

  const dataDump = await runCommand(
    "pg_dump",
    [
      "--data-only",
      "--no-owner",
      "--no-privileges",
      "--no-comments",
      "--schema=public",
      `--dbname=${databaseUrl}`,
    ],
    {
      env: {
        ...process.env,
        PGOPTIONS: [
          process.env.PGOPTIONS,
          "-c default_transaction_read_only=on",
        ]
          .filter(Boolean)
          .join(" "),
      },
    },
  );
  return normalizeDataDump(dataDump);
}

function schemaDumpDifferences(before, after) {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = new Set(after.split("\n"));
  const added = [...afterLines]
    .filter((line) => line && !beforeLines.has(line))
    .sort();
  const removed = [...beforeLines]
    .filter((line) => line && !afterLines.has(line))
    .sort();
  return { added, removed };
}

function formatSchemaDifferences(label, lines) {
  if (!lines.length) return [];
  const displayedLines = lines.slice(0, 20);
  const more =
    lines.length > displayedLines.length
      ? [`  …and ${lines.length - displayedLines.length} more lines`]
      : [];
  return [`${label}:`, ...displayedLines.map((line) => `  ${line}`), ...more];
}

export function assertSchemaUnchanged(before, after) {
  if (before === after) return;

  const { added, removed } = schemaDumpDifferences(before, after);
  throw new Error(
    [
      "Shared development database schema changed during the API security suite.",
      ...formatSchemaDifferences("Added schema definitions", added),
      ...formatSchemaDifferences("Removed schema definitions", removed),
      "The security suite must use its disposable database; no shared schema changes are permitted.",
    ].join("\n"),
  );
}

function dataSnapshotDifferences(before, after) {
  const beforeTables = before.tables ?? {};
  const afterTables = after.tables ?? {};
  const tableNames = new Set([
    ...Object.keys(beforeTables),
    ...Object.keys(afterTables),
  ]);
  const added = [];
  const removed = [];
  const changed = [];

  for (const table of [...tableNames].sort()) {
    const beforeTable = beforeTables[table];
    const afterTable = afterTables[table];
    if (!beforeTable) {
      added.push({ table, before: null, after: afterTable });
    } else if (!afterTable) {
      removed.push({ table, before: beforeTable, after: null });
    } else if (
      beforeTable.rowCount !== afterTable.rowCount ||
      beforeTable.fingerprint !== afterTable.fingerprint
    ) {
      changed.push({ table, before: beforeTable, after: afterTable });
    }
  }

  return { added, removed, changed };
}

function formatDataDifference({ table, before, after }) {
  const beforeCount = before?.rowCount ?? 0;
  const afterCount = after?.rowCount ?? 0;
  const countDescription =
    beforeCount === afterCount
      ? `${afterCount} rows`
      : `${beforeCount} → ${afterCount} rows`;
  return `  ${table} (${countDescription}; records may have been inserted, updated, or deleted)`;
}

export function assertDataUnchanged(before, after) {
  const { added, removed, changed } = dataSnapshotDifferences(before, after);
  if (!added.length && !removed.length && !changed.length) return;

  throw new Error(
    [
      "Shared development database records changed during the API security suite.",
      "Affected tables:",
      ...[...added, ...removed, ...changed].map(formatDataDifference),
      "The security suite must use its disposable database; no shared record changes are permitted.",
    ].join("\n"),
  );
}

function withTimeout(operation, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  const task =
    typeof operation === "function"
      ? Promise.resolve().then(operation)
      : Promise.resolve(operation);
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

export function run(command, args, { onSpawn, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: "inherit",
      ...options,
    });
    onSpawn?.(child);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
    });
  });
}

async function writeSchemaSnapshot(snapshotPath) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to inspect the shared database schema.",
    );
  }
  if (!snapshotPath) {
    throw new Error("A schema snapshot path is required.");
  }

  const snapshot = await captureSchemaSnapshot();
  await writeFile(snapshotPath, snapshot, "utf8");
}

async function writeDataSnapshot(snapshotPath) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to inspect shared database records.",
    );
  }
  if (!snapshotPath) {
    throw new Error("A data snapshot path is required.");
  }

  const snapshot = await captureDataSnapshot();
  await writeFile(
    snapshotPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

async function verifySchemaSnapshot(snapshotPath) {
  if (!snapshotPath) {
    throw new Error("A schema snapshot path is required.");
  }

  const before = await readFile(snapshotPath, "utf8");
  const after = await captureSchemaSnapshot();
  assertSchemaUnchanged(before, after);
}

async function verifyDataSnapshot(snapshotPath) {
  if (!snapshotPath) {
    throw new Error("A data snapshot path is required.");
  }

  const before = JSON.parse(await readFile(snapshotPath, "utf8"));
  const after = await captureDataSnapshot();
  assertDataUnchanged(before, after);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function cleanupStaleDatabases(
  pool,
  {
    now = Date.now(),
    maxAgeMs = STALE_DATABASE_MAX_AGE_MS,
    maxDatabases = MAX_STALE_DATABASES_PER_RUN,
    cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
  } = {},
) {
  const result = await pool.query(
    "SELECT datname FROM pg_database WHERE datname LIKE $1",
    [`${SECURITY_DATABASE_PREFIX}%`],
  );
  const staleDatabases = result.rows
    .map(({ datname }) => datname)
    .filter((datname) => {
      const match = datname.match(
        new RegExp(`^${SECURITY_DATABASE_PREFIX}(\\d+)_`),
      );
      if (!match) return false;
      const ageMs = now - Number(match[1]);
      return ageMs >= maxAgeMs;
    })
    .sort()
    .slice(0, maxDatabases);

  for (const staleDatabase of staleDatabases) {
    await withTimeout(
      () =>
        pool.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(staleDatabase)} WITH (FORCE)`,
        ),
      cleanupTimeoutMs,
      `stale security-test database cleanup for ${staleDatabase}`,
    );
  }

  return staleDatabases;
}

export function createCleanupManager({
  pool,
  databaseName,
  getChild,
  verifySourceDatabase,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
  onChildShutdownTimeout = (error) => {
    console.error(
      "Security-test child did not stop before database cleanup; forcing database shutdown:",
      error,
    );
  },
}) {
  let cleanupPromise;

  async function waitForChild(child, signal) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill(signal);
    try {
      await withTimeout(
        exited,
        cleanupTimeoutMs,
        "security-test child shutdown",
      );
    } catch (error) {
      onChildShutdownTimeout(error);
    }
  }

  function cleanup({ childSignal = "SIGTERM" } = {}) {
    cleanupPromise ??= (async () => {
      await waitForChild(getChild(), childSignal);
      let verificationError;
      try {
        await verifySourceDatabase?.();
      } catch (error) {
        verificationError = error;
      }
      try {
        await withTimeout(
          () =>
            pool.query(
              `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
            ),
          cleanupTimeoutMs,
          "security-test database cleanup",
        );
      } finally {
        await withTimeout(
          () => pool.end(),
          cleanupTimeoutMs,
          "security-test database pool shutdown",
        );
      }
      if (verificationError) throw verificationError;
    })();
    return cleanupPromise;
  }

  async function handleSignal(signal, exit) {
    try {
      await cleanup({ childSignal: signal });
    } catch (error) {
      console.error("Security-test cleanup after interruption failed:", error);
    }
    exit(signal === "SIGINT" ? 130 : 143);
  }

  return { cleanup, handleSignal };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to create the isolated security-test database.",
    );
  }

  const sourceUrl = new URL(process.env.DATABASE_URL);
  const databaseName = `${SECURITY_DATABASE_PREFIX}${Date.now()}_${process.pid}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 16)}`;
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;

  const { pool } = await import("@workspace/db");
  let child;
  let sourceSchemaSnapshot;
  let sourceDataSnapshot;
  const cleanupManager = createCleanupManager({
    pool,
    databaseName,
    getChild: () => child,
    verifySourceDatabase: async () => {
      if (!sourceSchemaSnapshot || !sourceDataSnapshot) return;
      assertSchemaUnchanged(
        sourceSchemaSnapshot,
        await captureSchemaSnapshot(),
      );
      assertDataUnchanged(sourceDataSnapshot, await captureDataSnapshot());
    },
  });
  const signalHandlers = {
    SIGINT: () =>
      void cleanupManager.handleSignal("SIGINT", (code) => process.exit(code)),
    SIGTERM: () =>
      void cleanupManager.handleSignal("SIGTERM", (code) => process.exit(code)),
  };
  process.once("SIGINT", signalHandlers.SIGINT);
  process.once("SIGTERM", signalHandlers.SIGTERM);

  try {
    sourceSchemaSnapshot = await captureSchemaSnapshot();
    sourceDataSnapshot = await captureDataSnapshot();
    // SIGKILL cannot be trapped. Timestamped names plus an age and count limit
    // keep the next run's recovery limited to old disposable databases.
    await cleanupStaleDatabases(pool);
    await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
      onSpawn: (spawnedChild) => {
        child = spawnedChild;
      },
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
    });
    await run(
      path.join(workspaceRoot, "scripts/node_modules/.bin/tsx"),
      [
        "--test",
        "src/moderation-security.test.ts",
        "src/admin-response-contract.test.ts",
        "src/deferred-listing-creation.test.ts",
        "src/archived-banned-scoping.test.ts",
        "src/top4-board.test.ts",
        "src/demo-video.test.ts",
        "src/invoices.test.ts",
        "src/sponsorships.test.ts",
        "src/accent-colors.test.ts",
      ],
      {
        cwd: artifactDir,
        onSpawn: (spawnedChild) => {
          child = spawnedChild;
        },
        env: {
          ...process.env,
          DATABASE_URL: testUrl.toString(),
          NODE_ENV: "test",
        },
      },
    );
  } finally {
    try {
      await cleanupManager.cleanup();
    } finally {
      process.off("SIGINT", signalHandlers.SIGINT);
      process.off("SIGTERM", signalHandlers.SIGTERM);
    }
  }
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  if (process.argv[2] === "--schema-snapshot") {
    await writeSchemaSnapshot(process.argv[3]);
  } else if (process.argv[2] === "--verify-schema-snapshot") {
    await verifySchemaSnapshot(process.argv[3]);
  } else if (process.argv[2] === "--data-snapshot") {
    await writeDataSnapshot(process.argv[3]);
  } else if (process.argv[2] === "--verify-data-snapshot") {
    await verifyDataSnapshot(process.argv[3]);
  } else {
    await main();
  }
}
