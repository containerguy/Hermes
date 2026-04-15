import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["user", "manager", "admin"] }).notNull().default("user"),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("users_phone_number_unique").on(table.phoneNumber),
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_email_unique").on(table.email)
  ]
);

export const loginChallenges = sqliteTable("login_challenges", {
  id: text("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  username: text("username").notNull(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull()
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at")
});

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at")
  },
  (table) => [uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint)]
);

export const gameEvents = sqliteTable("game_events", {
  id: text("id").primaryKey(),
  gameTitle: text("game_title").notNull(),
  startMode: text("start_mode", { enum: ["now", "scheduled"] }).notNull(),
  startsAt: text("starts_at").notNull(),
  minPlayers: integer("min_players").notNull(),
  maxPlayers: integer("max_players").notNull(),
  serverHost: text("server_host"),
  connectionInfo: text("connection_info"),
  status: text("status", {
    enum: ["open", "ready", "running", "cancelled", "archived"]
  })
    .notNull()
    .default("open"),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  archivedByUserId: text("archived_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  cancelledAt: text("cancelled_at"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const participations = sqliteTable(
  "participations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => gameEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["joined", "declined"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("participations_event_user_unique").on(table.eventId, table.userId)]
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  updatedAt: text("updated_at").notNull()
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    actorUsername: text("actor_username"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId)
  ]
);

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  pushSubscriptions: many(pushSubscriptions),
  participations: many(participations),
  createdEvents: many(gameEvents)
}));

export const gameEventRelations = relations(gameEvents, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [gameEvents.createdByUserId],
    references: [users.id]
  }),
  participations: many(participations)
}));
