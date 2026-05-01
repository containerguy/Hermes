import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    email: text("email").notNull(),
    role: text("role", { enum: ["user", "organizer", "manager", "admin"] }).notNull().default("user"),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    /** "de" | "en" | NULL — NULL: Browser + Admin-Fallback */
    locale: text("locale"),
    createdByUserId: text("created_by_user_id"),
    deletedAt: text("deleted_at"),
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
}, (table) => [
  index("login_challenges_username_created_at_idx").on(table.username, table.createdAt),
  index("login_challenges_username_consumed_expires_idx").on(
    table.username,
    table.consumedAt,
    table.expiresAt
  ),
  index("login_challenges_expires_at_idx").on(table.expiresAt)
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
  tokenHash: text("token_hash"),
  revokedAt: text("revoked_at"),
  deviceKeyHash: text("device_key_hash"),
  deviceSignals: text("device_signals")
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_device_key_idx").on(table.userId, table.deviceKeyHash),
  index("sessions_user_device_signals_idx").on(table.userId, table.deviceSignals)
]);

export const emailChangeChallenges = sqliteTable(
  "email_change_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newEmail: text("new_email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("email_change_challenges_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("email_change_challenges_user_id_consumed_expires_idx").on(
      table.userId,
      table.consumedAt,
      table.expiresAt
    ),
    index("email_change_challenges_expires_at_idx").on(table.expiresAt),
    index("email_change_challenges_new_email_idx").on(table.newEmail)
  ]
);

export const rateLimitEntries = sqliteTable(
  "rate_limit_entries",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: text("window_started_at").notNull(),
    lastAttemptAt: text("last_attempt_at").notNull(),
    blockedUntil: text("blocked_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("rate_limit_entries_scope_key_unique").on(table.scope, table.key),
    index("rate_limit_entries_blocked_until_idx").on(table.blockedUntil),
    index("rate_limit_entries_updated_at_idx").on(table.updatedAt)
  ]
);

export const rateLimitAllowlist = sqliteTable(
  "rate_limit_allowlist",
  {
    id: text("id").primaryKey(),
    ipOrCidr: text("ip_or_cidr").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("rate_limit_allowlist_ip_or_cidr_unique").on(table.ipOrCidr)]
);

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
    revokedAt: text("revoked_at"),
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureAt: text("last_failure_at"),
    lastSuccessAt: text("last_success_at")
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
  details: text("details"),
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
  deletedByUserId: text("deleted_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  cancelledAt: text("cancelled_at"),
  archivedAt: text("archived_at"),
  deletedAt: text("deleted_at"),
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

export const storageBackupStatus = sqliteTable("storage_backup_status", {
  backend: text("backend").primaryKey(),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  failureCode: text("failure_code"),
  failureSummary: text("failure_summary"),
  bucket: text("bucket"),
  key: text("key"),
  region: text("region"),
  endpoint: text("endpoint"),
  updatedAt: text("updated_at").notNull()
});

export const storageRestoreRecoveries = sqliteTable("storage_restore_recoveries", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  bucket: text("bucket"),
  region: text("region"),
  endpoint: text("endpoint"),
  createdAt: text("created_at").notNull()
});

export const inviteCodes = sqliteTable(
  "invite_codes",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    maxUses: integer("max_uses"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("invite_codes_code_unique").on(table.code)]
);

export const inviteCodeUses = sqliteTable(
  "invite_code_uses",
  {
    id: text("id").primaryKey(),
    inviteCodeId: text("invite_code_id")
      .notNull()
      .references(() => inviteCodes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedAt: text("used_at").notNull()
  },
  (table) => [uniqueIndex("invite_code_uses_user_unique").on(table.userId)]
);

export const pairingTokens = sqliteTable(
  "pairing_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originSessionId: text("origin_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    consumedSessionId: text("consumed_session_id").references(() => sessions.id, {
      onDelete: "set null"
    }),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("pairing_tokens_token_hash_unique").on(table.tokenHash),
    index("pairing_tokens_origin_session_idx").on(table.originSessionId),
    index("pairing_tokens_user_expires_idx").on(table.userId, table.expiresAt),
    index("pairing_tokens_expires_at_idx").on(table.expiresAt)
  ]
);

export const userApiTokens = sqliteTable(
  "user_api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    scope: text("scope", { enum: ["full", "read_only"] }).notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at")
  },
  (table) => [
    uniqueIndex("user_api_tokens_token_hash_unique").on(table.tokenHash),
    index("user_api_tokens_user_id_idx").on(table.userId)
  ]
);

export const pizzaMenuItems = sqliteTable(
  "pizza_menu_items",
  {
    id: text("id").primaryKey(),
    number: text("number"),
    name: text("name").notNull(),
    ingredients: text("ingredients"),
    allergens: text("allergens"),
    category: text("category", { enum: ["pizza", "pasta"] }).notNull().default("pizza"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("pizza_menu_items_active_sort_idx").on(table.active, table.sortOrder)]
);

export const pizzaMenuVariants = sqliteTable(
  "pizza_menu_variants",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => pizzaMenuItems.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label"),
    priceCents: integer("price_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0)
  },
  (table) => [index("pizza_menu_variants_item_idx").on(table.itemId)]
);

export const pizzaSessions = sqliteTable(
  "pizza_sessions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => gameEvents.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["draft", "open", "locked", "delivered"] })
      .notNull()
      .default("draft"),
    openedAt: text("opened_at"),
    openedByUserId: text("opened_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lockedAt: text("locked_at"),
    lockedByUserId: text("locked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    deliveredAt: text("delivered_at"),
    deliveredByUserId: text("delivered_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("pizza_sessions_event_unique").on(table.eventId)]
);

export const pizzaOrders = sqliteTable(
  "pizza_orders",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => pizzaSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "paid_paypal", "paid_cash"]
    })
      .notNull()
      .default("unpaid"),
    paidAt: text("paid_at"),
    paidByAdminId: text("paid_by_admin_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("pizza_orders_session_user_unique").on(table.sessionId, table.userId)]
);

export const pizzaOrderLines = sqliteTable(
  "pizza_order_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => pizzaOrders.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => pizzaMenuVariants.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
    customNote: text("custom_note"),
    createdAt: text("created_at").notNull()
  },
  (table) => [index("pizza_order_lines_order_idx").on(table.orderId)]
);

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  pushSubscriptions: many(pushSubscriptions),
  participations: many(participations),
  createdEvents: many(gameEvents),
  inviteCodeUses: many(inviteCodeUses),
  apiTokens: many(userApiTokens)
}));

export const gameEventRelations = relations(gameEvents, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [gameEvents.createdByUserId],
    references: [users.id]
  }),
  participations: many(participations)
}));
