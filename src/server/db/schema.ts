import { relations, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
    /** 0028: über welches Event (Einladungscode pro Event) sich der Benutzer registriert hat. */
    registeredViaMainEventId: text("registered_via_main_event_id").references(
      (): AnySQLiteColumn => mainEvents.id,
      { onDelete: "set null" }
    ),
    /** 0028: Eventname zum Zeitpunkt der Registrierung (bleibt, falls das Event gelöscht wird). */
    registeredViaMainEventName: text("registered_via_main_event_name"),
    /** 0028: verwendeter Einladungscode. */
    registeredViaInviteCodeId: text("registered_via_invite_code_id").references(
      (): AnySQLiteColumn => inviteCodes.id,
      { onDelete: "set null" }
    ),
    /** 0031: von allen Event-Infos abgemeldet (Abmeldelink); Login-Mails kommen weiter. */
    eventInfoUnsubscribedAt: text("event_info_unsubscribed_at"),
    /** 0034: gewähltes aktuelles Event (globaler Umschalter); NULL = alle Events. */
    currentMainEventId: text("current_main_event_id").references((): AnySQLiteColumn => mainEvents.id, {
      onDelete: "set null"
    }),
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

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceKeyHash: text("device_key_hash").notNull(),
    name: text("name").notNull(),
    deviceSignals: text("device_signals"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    forgottenAt: text("forgotten_at")
  },
  (table) => [
    uniqueIndex("devices_user_key_active_unique")
      .on(table.userId, table.deviceKeyHash)
      .where(sql`${table.forgottenAt} IS NULL`),
    index("devices_user_idx").on(table.userId)
  ]
);

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
  deviceSignals: text("device_signals"),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
  renewedAt: text("renewed_at")
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_device_idx").on(table.deviceId),
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

/** Phase 15: Bindung Spieltitel (normalisiert) -> AMP-Instanz. */
export const gameServerBindings = sqliteTable(
  "game_server_bindings",
  {
    id: text("id").primaryKey(),
    gameTitleNorm: text("game_title_norm").notNull(),
    displayTitle: text("display_title").notNull(),
    ampInstanceId: text("amp_instance_id").notNull(),
    ampInstanceName: text("amp_instance_name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    connectScheme: text("connect_scheme", { enum: ["steam", "ut2004", "factorio", "minecraft", "copy"] })
      .notNull()
      .default("copy"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Leerlauf-Stopp für diese Bindung erlaubt (nur bei verlässlicher Spielerzählung in AMP). */
    autoStopEnabled: integer("auto_stop_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("game_server_bindings_title_unique").on(table.gameTitleNorm)]
);

/** 0025: Event (z. B. LAN-Party, Turniertag), dem Runden und deren Benachrichtigungen zugeordnet sind. */
export const mainEvents = sqliteTable(
  "main_events",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["planned", "running", "ended"] })
      .notNull()
      .default("planned"),
    /** 0026: private Events sehen nur Eingeladene sowie Manager und Admins. */
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    plannedStartAt: text("planned_start_at"),
    plannedEndAt: text("planned_end_at"),
    /** 0027: Plätze (null = unbegrenzt); ist das Event voll, wird man Nachrücker. */
    maxParticipants: integer("max_participants"),
    /** 0027: Anmeldeschluss (null = keiner); gilt nur, solange das Event geplant ist. */
    /** 0035: Infos zum Event (Markdown), zusätzlich zu den allgemeinen Infos. */
    infosMarkdown: text("infos_markdown"),
    registrationDeadline: text("registration_deadline"),
    /** 0031: geplante Erinnerungen an Teilnehmer verschicken. */
    remindersEnabled: integer("reminders_enabled", { mode: "boolean" }).notNull().default(true),
    startedAt: text("started_at"),
    startedByUserId: text("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
    endedAt: text("ended_at"),
    endedByUserId: text("ended_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  }
);

/** 0026: Einladungen zu privaten Events. */
export const mainEventInvites = sqliteTable(
  "main_event_invites",
  {
    id: text("id").primaryKey(),
    mainEventId: text("main_event_id")
      .notNull()
      .references(() => mainEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull()
  },
  (table) => [uniqueIndex("main_event_invites_event_user_unique").on(table.mainEventId, table.userId)]
);

/**
 * 0025: Teilnahme am Event; „joined" bekommt die Benachrichtigungen zu dessen Runden.
 * 0027: „interested" (Interessentenliste) und „waitlisted" (Nachrücker, Event voll).
 */
/** 0029: Rechte (Kern und Module). */
export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  moduleId: text("module_id"),
  label: text("label").notNull(),
  description: text("description"),
  scopable: integer("scopable", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull()
});

/** 0029: Rollen als Bündel von Rechten; builtin = user, organizer, manager, admin. */
export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("roles_key_unique").on(table.key)]
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" })
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })]
);

/** 0029: Vergabe einer Rolle oder eines Rechts an einen Benutzer, global oder nur für ein Event. */
export const userGrants = sqliteTable("user_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").references(() => roles.id, { onDelete: "cascade" }),
  permissionKey: text("permission_key").references(() => permissions.key, { onDelete: "cascade" }),
  mainEventId: text("main_event_id").references(() => mainEvents.id, { onDelete: "cascade" }),
  grantedByUserId: text("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at")
});

/** 0031: Kanalwahl pro Benutzer für Event-Infos; fehlt die Zeile, gilt die Vorgabe des Kanals. */
export const notificationChannelPreferences = sqliteTable(
  "notification_channel_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.channelId] })]
);

/** 0031: persönlicher Abmeldelink für Event-Infos. */
export const notificationUnsubscribeTokens = sqliteTable("notification_unsubscribe_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull()
});

/** 0031: Rundnachricht an Teilnehmer eines Events. */
export const mainEventBroadcasts = sqliteTable("main_event_broadcasts", {
  id: text("id").primaryKey(),
  mainEventId: text("main_event_id")
    .notNull()
    .references(() => mainEvents.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const mainEventBroadcastDeliveries = sqliteTable(
  "main_event_broadcast_deliveries",
  {
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => mainEventBroadcasts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    status: text("status", { enum: ["sent", "failed", "skipped"] }).notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.broadcastId, table.userId, table.channelId] })]
);

/** 0031: welche Erinnerung für ein Event schon verschickt wurde. */
export const mainEventRemindersSent = sqliteTable(
  "main_event_reminders_sent",
  {
    mainEventId: text("main_event_id")
      .notNull()
      .references(() => mainEvents.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["start_7d", "start_1d", "deadline_1d"] }).notNull(),
    sentAt: text("sent_at").notNull(),
    recipientCount: integer("recipient_count").notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.mainEventId, table.kind] })]
);

/** 0031: persönlicher Kalender-Link. */
export const calendarFeedTokens = sqliteTable("calendar_feed_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull()
});

export const mainEventParticipants = sqliteTable(
  "main_event_participants",
  {
    id: text("id").primaryKey(),
    mainEventId: text("main_event_id")
      .notNull()
      .references(() => mainEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["joined", "interested", "waitlisted", "declined"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [uniqueIndex("main_event_participants_event_user_unique").on(table.mainEventId, table.userId)]
);

/** 0037: Gameserver, die ein Event anbietet; keine Zeile = alle Server. */
export const mainEventServers = sqliteTable(
  "main_event_servers",
  {
    mainEventId: text("main_event_id")
      .notNull()
      .references(() => mainEvents.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => gameServerBindings.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.mainEventId, table.bindingId] })]
);

export const gameEvents = sqliteTable("game_events", {
  id: text("id").primaryKey(),
  /** 0025: zugeordnetes Event (null = keinem Event zugeordnet). */
  mainEventId: text("main_event_id").references(() => mainEvents.id, { onDelete: "set null" }),
  gameTitle: text("game_title").notNull(),
  serverBindingId: text("server_binding_id").references(() => gameServerBindings.id, {
    onDelete: "set null"
  }),
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
    /** 0028: Code gehört zu einem Event; Registrierte werden dort als interessiert eingetragen. */
    mainEventId: text("main_event_id").references(() => mainEvents.id, { onDelete: "set null" }),
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

/* Die Tabellen presence_* (bis 0.16 user_game_accounts, user_game_account_prefs, game_agent_keys)
 * gehören seit 0.17 dem Modul „presence“ (matchdesk-modules). */

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

/* Die Tabellen pizza_* gehören seit 0.17 dem Modul „pizza“ (matchdesk-modules). */

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  devices: many(devices),
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
  serverBinding: one(gameServerBindings, {
    fields: [gameEvents.serverBindingId],
    references: [gameServerBindings.id]
  }),
  participations: many(participations)
}));
