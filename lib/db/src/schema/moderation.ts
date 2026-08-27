import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id"),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  resolvedById: text("resolved_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type Report = typeof reportsTable.$inferSelect;

export const rateLimitsTable = pgTable("rate_limits", {
  action: text("action").primaryKey(),
  maxRequests: integer("max_requests").notNull(),
  windowSeconds: integer("window_seconds").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const actionRateWindowsTable = pgTable(
  "action_rate_windows",
  {
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.action, table.actorId, table.windowStartedAt],
      name: "action_rate_windows_pkey",
    }),
  ],
);

export type RateLimit = typeof rateLimitsTable.$inferSelect;

export const auditEventsTable = pgTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditEvent = typeof auditEventsTable.$inferSelect;