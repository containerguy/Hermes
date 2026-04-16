export type User = {
  id: string;
  phoneNumber: string;
  username: string;
  displayName: string;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
  deletedAt?: string | null;
};

export type AppSettings = {
  appName: string;
  defaultNotificationsEnabled: boolean;
  eventAutoArchiveHours: number;
  publicRegistrationEnabled: boolean;
  themePrimaryColor: string;
  themeLoginColor: string;
  themeManagerColor: string;
  themeAdminColor: string;
  themeSurfaceColor: string;
};

export type StorageLocationDetails = {
  bucket: string;
  key: string;
  region: string;
  endpoint: string;
};

export type StorageBackupStatus = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCode: string | null;
  failureSummary: string | null;
};

export type RestoreDiagnostics = {
  kind: "validation_failed" | "copy_failed" | "recovery_failed";
  summary: string;
  snapshot?: { bucket: string; key: string; region: string; endpoint: string };
  recovery?: { id: string; key: string };
  missingTables?: string[];
  columnMismatches?: Array<{ table: string; missingInSnapshot: string[]; extraInSnapshot: string[] }>;
  foreignKeyFailures?: Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  migrations?: {
    liveLatest?: string | null;
    snapshotLatest?: string | null;
    liveCount?: number;
    snapshotCount?: number;
  };
};

export type RestoreRecovery = { id: string; key: string };

export type StorageInfo = {
  backend: "s3" | "disabled";
  location: StorageLocationDetails | null;
  backupStatus: StorageBackupStatus | null;
};

export type GameEvent = {
  id: string;
  gameTitle: string;
  startMode: "now" | "scheduled";
  startsAt: string;
  minPlayers: number;
  maxPlayers: number;
  serverHost: string | null;
  connectionInfo: string | null;
  status: "open" | "ready" | "running" | "cancelled" | "archived";
  createdByUserId: string;
  createdByUsername: string;
  joinedCount: number;
  myParticipation: "joined" | "declined" | null;
};

export type AuditLogEntry = {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: unknown;
  createdAt: string;
};

export type UserSession = {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

export type InviteCode = {
  id: string;
  code: string;
  label: string;
  maxUses: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  usedCount: number;
};

export type RateLimitEntry = {
  id: string;
  scope: string;
  key: string;
  attemptCount: number;
  windowStartedAt: string;
  lastAttemptAt: string;
  blockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RateLimitAllowlistEntry = {
  id: string;
  ipOrCidr: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

