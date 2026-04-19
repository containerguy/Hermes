import type { BrandMark } from "../../shared/brand-mark";
import type { AppLocale } from "../../shared/locale";

export type { BrandMark };

export type User = {
  id: string;
  phoneNumber: string;
  username: string;
  displayName: string;
  email: string;
  role: "user" | "manager" | "admin";
  notificationsEnabled: boolean;
  /** Explizite UI-Sprache; fehlt → Browser + Admin-Fallback */
  locale?: AppLocale | null;
  deletedAt?: string | null;
};

export type AppSettings = {
  appName: string;
  /** Welches Marken-Icon in Shell, Boards und Login gezeigt wird. */
  brandMark: BrandMark;
  defaultNotificationsEnabled: boolean;
  eventAutoArchiveHours: number;
  publicRegistrationEnabled: boolean;
  /** Leer = Client-Standardtext für den Start-Hero */
  shellStartTitle: string;
  /** Leer = kein Beschreibungsabsatz unter der Start-Überschrift */
  shellStartDescription: string;
  shellEventsEmptyTitle: string;
  shellEventsEmptyBody: string;
  /** Zentrale Spieltitel für Manager-Dropdown (Event anlegen) */
  gameCatalog: string[];
  themePrimaryColor: string;
  themeLoginColor: string;
  themeManagerColor: string;
  themeAdminColor: string;
  themeSurfaceColor: string;
  /** Menüpunkt „Infos“ (#infos) sichtbar */
  infosEnabled: boolean;
  /** Markdown-Inhalt der Infos-Seite (Überschriften, Listen, Links) */
  infosMarkdown: string;
  /**
   * true: S3-Snapshots wenn HERMES_STORAGE_BACKEND=s3.
   * false: S3-Backups/Restore in der App abgeschaltet (Default an).
   */
  s3SnapshotEnabled: boolean;
  /** Fallback, wenn die Browsersprache weder klar DE noch EN ist (Default de). */
  defaultLocale: AppLocale;
  /** Öffentliche Kiosk-/Stream-Ansicht ohne Login (URL-Pfad + Query id). */
  kioskStreamEnabled: boolean;
  /** Ein URL-Pfadsegment, z. B. stream → /stream?id=… */
  kioskStreamPath: string;
  /** Geheimer Zugriffsschlüssel; nur in Admin-API sichtbar, nicht in /api/settings/public */
  kioskStreamSecret: string;
};

/** Öffentliche App-Einstellungen (ohne Admin-/Betriebsfelder) für Bootstrap ohne Admin-Session. */
export type PublicAppSettings = Pick<
  AppSettings,
  | "appName"
  | "brandMark"
  | "publicRegistrationEnabled"
  | "shellStartTitle"
  | "shellStartDescription"
  | "shellEventsEmptyTitle"
  | "shellEventsEmptyBody"
  | "gameCatalog"
  | "themePrimaryColor"
  | "themeLoginColor"
  | "themeManagerColor"
  | "themeAdminColor"
  | "themeSurfaceColor"
  | "infosEnabled"
  | "infosMarkdown"
  | "defaultLocale"
  | "kioskStreamEnabled"
  | "kioskStreamPath"
>;

export type AdminSection =
  | "users"
  | "betrieb"
  | "design"
  | "infos"
  | "sicherheit"
  | "invites"
  | "audit";

export type BulkImportFormat = "csv" | "json";

export type BulkImportIssueCode =
  | "ungueltige_import_daten"
  | "ungueltige_import_zeile"
  | "doppelte_dateiwerte"
  | "bestehender_user_konflikt";

export type BulkImportIssueField = "source" | "username" | "email" | "row";

export type BulkImportCandidate = {
  phoneNumber?: string;
  username: string;
  displayName?: string;
  email: string;
  role: User["role"];
  notificationsEnabled?: boolean;
};

export type BulkImportIssue = {
  row: number;
  code: BulkImportIssueCode;
  field: BulkImportIssueField;
  message: string;
  value?: string;
  conflictWithRow?: number;
};

export type BulkImportResult = {
  format: BulkImportFormat;
  totalRows: number;
  acceptedRows: number;
  blockingIssueCount: number;
  hasBlockingIssues: boolean;
  validCandidates: BulkImportCandidate[];
  issues: BulkImportIssue[];
};

export type BulkImportPreviewResponse = {
  import: BulkImportResult;
};

export type BulkImportCommitResponse = {
  importedCount: number;
  users: User[];
  import: BulkImportResult;
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
  /** true wenn HERMES_STORAGE_BACKEND=s3 (unabhängig vom App-Schalter s3SnapshotEnabled). */
  envS3Configured: boolean;
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
