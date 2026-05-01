import React, { FormEvent, useEffect, useRef, useState } from "react";
import type {
  AdminSection,
  AppSettings,
  AuditLogEntry,
  BulkImportCommitResponse,
  BulkImportFormat,
  BulkImportPreviewResponse,
  BulkImportResult,
  InviteCode,
  RateLimitAllowlistEntry,
  RateLimitEntry,
  RestoreDiagnostics,
  RestoreRecovery,
  StorageInfo,
  User
} from "../types/core";
import { requestJson } from "../api/request";
import { ApiError, getErrorMessage } from "../errors/errors";
import { useI18n } from "../i18n/I18nContext";
import { useBrandIconSrc } from "../lib/BrandingContext";

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
}

function parseGameCatalogDraft(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function generateKioskStreamSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "")).join("");
}

const defaultSettings: AppSettings = {
  appName: "",
  brandMark: "mitspiel",
  projectTemplate: "lan_party",
  defaultNotificationsEnabled: true,
  eventAutoArchiveHours: 8,
  publicRegistrationEnabled: false,
  shellStartTitle: "",
  shellStartDescription: "",
  shellEventsEmptyTitle: "",
  shellEventsEmptyBody: "",
  themePrimaryColor: "#0f766e",
  themeLoginColor: "#be123c",
  themeManagerColor: "#b7791f",
  themeAdminColor: "#2563eb",
  themeSurfaceColor: "#f6f8f4",
  gameCatalog: [],
  infosEnabled: false,
  infosMarkdown: "",
  s3SnapshotEnabled: true,
  defaultLocale: "de",
  kioskStreamEnabled: false,
  kioskStreamPath: "stream",
  kioskStreamSecret: "",
  pizzaPaypalHandle: "",
  pizzaPaypalName: "",
  pizzaCashRecipient: ""
};

export function AdminPanel({
  currentUser,
  adminSection,
  onSettingsChanged
}: {
  currentUser: User | null;
  adminSection: AdminSection;
  onSettingsChanged: (settings: AppSettings) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitEntry[]>([]);
  const [rateLimitAllowlist, setRateLimitAllowlist] = useState<RateLimitAllowlistEntry[]>([]);
  const [allowlistDraft, setAllowlistDraft] = useState({ ipOrCidr: "", note: "" });
  const [inviteDrafts, setInviteDrafts] = useState<
    Record<string, { label: string; maxUses: string; expiresAt: string }>
  >({});
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [gameCatalogDraft, setGameCatalogDraft] = useState("");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [restoreDiagnostics, setRestoreDiagnostics] = useState<RestoreDiagnostics | null>(null);
  const [restoreRecovery, setRestoreRecovery] = useState<RestoreRecovery | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    role: "user" as User["role"]
  });
  const [bulkImportDraft, setBulkImportDraft] = useState<{ format: BulkImportFormat; source: string }>({
    format: "csv",
    source: ""
  });
  const [bulkImportPreview, setBulkImportPreview] = useState<BulkImportResult | null>(null);
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [newInvite, setNewInvite] = useState({
    label: "",
    maxUses: "",
    expiresAt: ""
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [opsBusy, setOpsBusy] = useState(false);
  const [rateLimitBusy, setRateLimitBusy] = useState(false);
  const settingsImportRef = useRef<HTMLInputElement>(null);
  const usersExportImportRef = useRef<HTMLInputElement>(null);
  const { t, locale } = useI18n();
  const gateMarkSrc = useBrandIconSrc();
  const dateTag = locale === "en" ? "en-US" : "de-DE";

  function bulkImportSummary(result: BulkImportResult) {
    if (result.issues.length === 0) {
      return t("admin.bulk.noBlocking");
    }
    return t("admin.bulk.summaryBlocking", { count: result.blockingIssueCount });
  }

  const isAdmin = currentUser?.role === "admin";

  async function downloadJsonAttachment(path: string, fallbackName: string) {
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError({
          code: body.error ?? "request_failed",
          status: response.status,
          body
        });
      }
      const blob = await response.blob();
      const cd = response.headers.get("Content-Disposition");
      let filename = fallbackName;
      const match = cd?.match(/filename="([^"]+)"/);
      if (match?.[1]) {
        filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(t("login.msg.downloadStarted"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function runSettingsImport(file: File) {
    setError("");
    setMessage("");
    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      let settingsPayload: unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>;
        if (record.settings && typeof record.settings === "object" && !Array.isArray(record.settings)) {
          settingsPayload = record.settings;
        } else if (typeof record.appName === "string") {
          settingsPayload = record;
        }
      }
      if (!settingsPayload || typeof settingsPayload !== "object" || Array.isArray(settingsPayload)) {
        setError(t("login.error.invalidSettingsFile"));
        return;
      }
      const result = await requestJson<{ settings: AppSettings }>("/api/admin/settings/import", {
        method: "POST",
        body: JSON.stringify({ settings: settingsPayload })
      });
      setSettings(result.settings);
      setGameCatalogDraft(result.settings.gameCatalog.join("\n"));
      onSettingsChanged(result.settings);
      setMessage(t("login.msg.settingsImported"));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      if (settingsImportRef.current) {
        settingsImportRef.current.value = "";
      }
    }
  }

  async function runUsersExportImport(file: File) {
    setError("");
    setMessage("");
    setBulkImportBusy(true);
    try {
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !Array.isArray((raw as { users?: unknown }).users)
      ) {
        setError(t("login.error.invalidUserExport"));
        return;
      }
      const result = await requestJson<BulkImportCommitResponse>("/api/admin/users/import/from-export", {
        method: "POST",
        body: text
      });
      await loadAdminData();
      setBulkImportPreview(null);
      setMessage(t("login.msg.userImportDone", { count: result.importedCount }));
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setBulkImportBusy(false);
      if (usersExportImportRef.current) {
        usersExportImportRef.current.value = "";
      }
    }
  }

  async function loadAdminData() {
    if (!isAdmin) {
      return;
    }

    const [
      userResult,
      settingsResult,
      auditResult,
      inviteResult,
      rateLimitResult,
      allowlistResult
    ] = await Promise.all([
      requestJson<{ users: User[] }>("/api/admin/users"),
      requestJson<{ settings: AppSettings; storage?: StorageInfo }>("/api/admin/settings"),
      requestJson<{ auditLogs: AuditLogEntry[] }>("/api/admin/audit-log?limit=80"),
      requestJson<{ inviteCodes: InviteCode[] }>("/api/admin/invite-codes"),
      requestJson<{ rateLimits: RateLimitEntry[] }>("/api/admin/rate-limits"),
      requestJson<{ allowlist: RateLimitAllowlistEntry[] }>("/api/admin/rate-limits/allowlist")
    ]);
    setUsers(userResult.users);
    setSettings(settingsResult.settings);
    setGameCatalogDraft(settingsResult.settings.gameCatalog.join("\n"));
    setStorage(settingsResult.storage ?? null);
    setAuditLogs(auditResult.auditLogs);
    setInviteCodes(inviteResult.inviteCodes);
    setRateLimits(rateLimitResult.rateLimits);
    setRateLimitAllowlist(allowlistResult.allowlist);
    setInviteDrafts(
      Object.fromEntries(
        inviteResult.inviteCodes.map((invite) => [
          invite.id,
          {
            label: invite.label,
            maxUses: invite.maxUses === null ? "" : String(invite.maxUses),
            expiresAt: invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : ""
          }
        ])
      )
    );
  }

  useEffect(() => {
    loadAdminData().catch(() => undefined);
  }, [isAdmin]);

  function getActiveRateLimitEntries() {
    const now = Date.now();
    return rateLimits
      .filter((entry) => entry.blockedUntil && new Date(entry.blockedUntil).getTime() > now)
      .sort(
        (a, b) =>
          new Date(b.blockedUntil ?? 0).getTime() - new Date(a.blockedUntil ?? 0).getTime()
      );
  }

  async function clearRateLimitEntry(entry: RateLimitEntry) {
    const confirmed = window.confirm("Rate-Limit wirklich löschen? (Block wird sofort aufgehoben)");
    if (!confirmed) {
      return;
    }

    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true }>(`/api/admin/rate-limits/${entry.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("Rate-Limit gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function addAllowlistEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true; id: string }>("/api/admin/rate-limits/allowlist", {
        method: "POST",
        body: JSON.stringify({
          ipOrCidr: allowlistDraft.ipOrCidr,
          note: allowlistDraft.note
        })
      });
      setAllowlistDraft({ ipOrCidr: "", note: "" });
      await loadAdminData();
      setMessage("Allowlist-Eintrag gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function deleteAllowlistEntry(entry: RateLimitAllowlistEntry) {
    const confirmed = window.confirm("Allowlist-Eintrag wirklich löschen?");
    if (!confirmed) {
      return;
    }

    setRateLimitBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: true }>(`/api/admin/rate-limits/allowlist/${entry.id}`, {
        method: "DELETE"
      });
      await loadAdminData();
      setMessage("Allowlist-Eintrag gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setRateLimitBusy(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      });
      setNewUser({ username: "", email: "", role: "user" });
      await loadAdminData();
      setMessage("User gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function previewBulkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBulkImportBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<BulkImportPreviewResponse>("/api/admin/users/import/preview", {
        method: "POST",
        body: JSON.stringify(bulkImportDraft)
      });
      setBulkImportPreview(result.import);
      setMessage(
        result.import.hasBlockingIssues
          ? "Import-Vorschau geladen. Bitte blockierende Probleme erst auflösen."
          : "Import-Vorschau geladen. Commit kann jetzt ausgeführt werden."
      );
    } catch (caught) {
      setBulkImportPreview(null);
      setError(getErrorMessage(caught, locale));
    } finally {
      setBulkImportBusy(false);
    }
  }

  async function commitBulkImport() {
    setBulkImportBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await requestJson<BulkImportCommitResponse>("/api/admin/users/import/commit", {
        method: "POST",
        body: JSON.stringify(bulkImportDraft)
      });
      setBulkImportPreview(result.import);
      setBulkImportDraft({ format: bulkImportDraft.format, source: "" });
      await loadAdminData();
      setMessage(`${result.importedCount} User per Bulk-Import angelegt.`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.body && typeof caught.body === "object") {
        const importResult = (caught.body as { import?: BulkImportResult }).import;
        if (importResult) {
          setBulkImportPreview(importResult);
        }
      }
      setError(getErrorMessage(caught, locale));
    } finally {
      setBulkImportBusy(false);
    }
  }

  async function updateRole(userId: string, role: User["role"]) {
    setError("");
    setMessage("");

    try {
      await requestJson<{ user: User }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      await loadAdminData();
      setMessage("Rolle gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function deleteUser(user: User) {
    const confirmed = window.confirm(`User ${user.username} wirklich löschen?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<void>(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("User gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function createInviteCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const payload: { label: string; maxUses?: number | null; expiresAt?: string | null } = {
        label: newInvite.label
      };

      if (newInvite.maxUses !== "") {
        payload.maxUses = Number(newInvite.maxUses);
      }

      if (newInvite.expiresAt !== "") {
        payload.expiresAt = fromDatetimeLocal(newInvite.expiresAt);
      }

      await requestJson<{ inviteCode: InviteCode }>("/api/admin/invite-codes", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setNewInvite({ label: "", maxUses: "", expiresAt: "" });
      await loadAdminData();
      setMessage("Invite-Code erstellt.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function deactivateInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(`Invite ${invite.label} wirklich deaktivieren?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<{ inviteCode: InviteCode }>(
        `/api/admin/invite-codes/${invite.id}/deactivate`,
        {
          method: "POST"
        }
      );
      await loadAdminData();
      setMessage("Invite-Code deaktiviert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function reactivateInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(`Invite ${invite.label} wirklich reaktivieren?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<{ inviteCode: InviteCode }>(
        `/api/admin/invite-codes/${invite.id}/reactivate`,
        {
          method: "POST"
        }
      );
      await loadAdminData();
      setMessage("Invite-Code reaktiviert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function updateInviteCode(invite: InviteCode) {
    setError("");
    setMessage("");

    const draft = inviteDrafts[invite.id];
    if (!draft) {
      return;
    }

    try {
      const payload: { label?: string; maxUses?: number | null; expiresAt?: string | null } = {
        label: draft.label.trim()
      };

      if (draft.maxUses.trim() === "") {
        payload.maxUses = null;
      } else {
        payload.maxUses = Number(draft.maxUses);
      }

      payload.expiresAt = draft.expiresAt.trim() ? fromDatetimeLocal(draft.expiresAt) : null;

      await requestJson<{ inviteCode: InviteCode }>(`/api/admin/invite-codes/${invite.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadAdminData();
      setMessage("Invite gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function deleteUnusedInviteCode(invite: InviteCode) {
    const confirmed = window.confirm(
      `Invite ${invite.label} wirklich löschen? (Nur möglich ohne Nutzungen)`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await requestJson<void>(`/api/admin/invite-codes/${invite.id}`, { method: "DELETE" });
      await loadAdminData();
      setMessage("Invite gelöscht.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const payload: AppSettings = {
        ...settings,
        gameCatalog: parseGameCatalogDraft(gameCatalogDraft)
      };
      const result = await requestJson<{ settings: AppSettings }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setSettings(result.settings);
      setGameCatalogDraft(result.settings.gameCatalog.join("\n"));
      onSettingsChanged(result.settings);
      setMessage("Einstellungen gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    }
  }

  async function runBackup() {
    setOpsBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson<{ ok: boolean }>("/api/admin/backup", { method: "POST" });
      await loadAdminData();
      setMessage("Backup wurde nach S3 geschrieben.");
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
    } finally {
      setOpsBusy(false);
    }
  }

  async function runRestore() {
    const confirmed = window.confirm(
      "Restore wirklich starten? Hermes validiert zuerst den Snapshot und erstellt vor dem Restore ein Recovery-Backup."
    );

    if (!confirmed) {
      return;
    }

    setOpsBusy(true);
    setError("");
    setMessage("");
    setRestoreDiagnostics(null);
    setRestoreRecovery(null);

    try {
      const result = await requestJson<{
        ok: boolean;
        recovery?: RestoreRecovery | null;
      }>("/api/admin/restore", { method: "POST" });
      await loadAdminData();
      const recovery = result.recovery ?? null;
      setRestoreRecovery(recovery);
      setMessage(
        recovery
          ? `Restore abgeschlossen. Recovery: ${recovery.id} (${recovery.key}). Bitte prüfe User, Events und deine aktuelle Session.`
          : "Restore abgeschlossen. Bitte prüfe User, Events und deine aktuelle Session."
      );
    } catch (caught) {
      setError(getErrorMessage(caught, locale));
      if (caught instanceof ApiError) {
        const body = caught.body as
          | { diagnostics?: RestoreDiagnostics; recovery?: RestoreRecovery | null }
          | null
          | undefined;
        const diagnostics = body?.diagnostics ?? null;
        setRestoreDiagnostics(diagnostics);
        setRestoreRecovery(body?.recovery ?? diagnostics?.recovery ?? null);
      }
    } finally {
      setOpsBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <article id="admin" className="access-panel admin-access">
        <img src={gateMarkSrc} alt="" />
        <p className="eyebrow">{t("main.nav.admin")}</p>
        <h2>{t("admin.gate.title")}</h2>
        <p>{t("admin.gate.body")}</p>
        <a className="text-link" href="#login">
          {t("admin.gate.link")}
        </a>
      </article>
    );
  }

  const activeRateLimits = getActiveRateLimitEntries();
  const bulkImportCanCommit = Boolean(
    bulkImportPreview && !bulkImportPreview.hasBlockingIssues && bulkImportPreview.acceptedRows > 0
  );

  return (
    <section
      id="admin"
      className={`admin-panel ${adminSection === "users" ? "admin-panel--users" : "admin-panel--single"}`}
      aria-label={t("admin.panel.aria")}
    >
      {message ? <p className="notice admin-panel-notice">{message}</p> : null}
      {error ? <p className="error admin-panel-notice">{error}</p> : null}

      {adminSection === "users" ? (
        <>
          <header className="admin-section-head">
            <p className="eyebrow">{t("main.admin.nav.users")}</p>
            <h2>{t("admin.users.title")}</h2>
            <p className="muted">{t("admin.users.intro")}</p>
          </header>
          <section className="invite-panel" aria-label={t("admin.exportUsers.title")}>
            <p className="eyebrow">{t("admin.exportUsers.eyebrow")}</p>
            <h2>{t("admin.exportUsers.title")}</h2>
            <p className="muted">{t("admin.exportUsers.help")}</p>
            <div className="action-row">
              <button
                type="button"
                onClick={() =>
                  void downloadJsonAttachment("/api/admin/users/export", "hermes-users.json")
                }
              >
                {t("admin.exportUsers.export")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => usersExportImportRef.current?.click()}
                disabled={bulkImportBusy}
              >
                {t("admin.exportUsers.import")}
              </button>
              <input
                ref={usersExportImportRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void runUsersExportImport(file);
                  }
                }}
              />
            </div>
          </section>
          <form id="admin-users" onSubmit={createUser} className="admin-form admin-user-create-form">
        <label>
          {t("login.field.username")}
          <input
            value={newUser.username}
            onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
            required
          />
        </label>
        <label>
          {t("login.field.email")}
          <input
            type="email"
            value={newUser.email}
            onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
            required
          />
        </label>
        <label>
          {t("main.hero.role")}
          <select
            value={newUser.role}
            onChange={(event) => setNewUser({ ...newUser, role: event.target.value as User["role"] })}
          >
            <option value="user">{t("admin.role.user")}</option>
            <option value="organizer">{t("admin.role.organizer")}</option>
            <option value="manager">{t("admin.role.manager")}</option>
            <option value="admin">{t("admin.role.admin")}</option>
          </select>
        </label>
        <button type="submit">{t("admin.user.create")}</button>
      </form>

      <section className="invite-panel" aria-label={t("admin.bulk.title")}>
        <p className="eyebrow">{t("admin.bulk.eyebrow")}</p>
        <h2>{t("admin.bulk.title")}</h2>
        <p className="muted">{t("admin.bulk.intro")}</p>
        <form onSubmit={previewBulkImport} className="admin-form" aria-label={t("admin.bulk.formAria")}>
          <label>
            {t("admin.bulk.format")}
            <select
              aria-label={t("admin.bulk.formatAria")}
              value={bulkImportDraft.format}
              onChange={(event) => {
                setBulkImportDraft({
                  format: event.target.value as BulkImportFormat,
                  source: bulkImportDraft.source
                });
                setBulkImportPreview(null);
              }}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <label>
            {t("admin.bulk.data")}
            <textarea
              aria-label={t("admin.bulk.dataAria")}
              value={bulkImportDraft.source}
              onChange={(event) => {
                setBulkImportDraft({ ...bulkImportDraft, source: event.target.value });
                setBulkImportPreview(null);
              }}
              rows={8}
              placeholder={
                bulkImportDraft.format === "csv"
                  ? "username,email,role\nanna,anna@example.test,user"
                  : '[{"username":"anna","email":"anna@example.test","role":"user"}]'
              }
              required
            />
          </label>
          <div className="action-row">
            <button type="submit" disabled={bulkImportBusy || bulkImportDraft.source.trim().length === 0}>
              {t("admin.bulk.preview")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void commitBulkImport()}
              disabled={bulkImportBusy || !bulkImportCanCommit}
            >
              {t("admin.bulk.commit")}
            </button>
          </div>
        </form>

        {bulkImportPreview ? (
          <div className="device-list" aria-label={t("admin.bulk.previewAria")}>
            <article className="device-row">
              <div>
                <strong>{t("admin.bulk.summary")}</strong>
                <span>{t("admin.bulk.summaryFormat", { fmt: bulkImportPreview.format.toUpperCase() })}</span>
                <span>
                  {t("admin.bulk.rowsTotal")} {bulkImportPreview.totalRows}
                </span>
                <span>
                  {t("admin.bulk.candidates")} {bulkImportPreview.acceptedRows}
                </span>
                <span>{bulkImportSummary(bulkImportPreview)}</span>
              </div>
            </article>

            <article className="device-row" aria-label={t("admin.bulk.blockingAria")}>
              <div>
                <strong>{t("admin.bulk.blocking")}</strong>
                {bulkImportPreview.issues.length > 0 ? (
                  <ul>
                    {bulkImportPreview.issues.map((issue, index) => (
                      <li key={`${issue.row}-${issue.field}-${index}`}>
                        {t("admin.bulk.issueRow", { row: issue.row, message: issue.message })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>{t("admin.bulk.noBlocking")}</span>
                )}
              </div>
            </article>

            <article className="device-row" aria-label={t("admin.bulk.candidatesAria")}>
              <div>
                <strong>{t("admin.bulk.importable")}</strong>
                {bulkImportPreview.validCandidates.length > 0 ? (
                  <ul>
                    {bulkImportPreview.validCandidates.map((candidate) => (
                      <li key={`${candidate.username}-${candidate.email}`}>
                        {candidate.username} · {candidate.email} · {candidate.role}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>{t("admin.bulk.noneYet")}</span>
                )}
              </div>
            </article>
          </div>
        ) : null}
      </section>

      <div className="admin-list" aria-label={t("admin.user.listAria")}>
        {users.map((user) => (
          <div className="admin-list-row" key={user.id}>
            <div>
              <strong>{user.username}</strong>
              <span>{user.email}</span>
            </div>
            <select
              value={user.role}
              onChange={(event) => updateRole(user.id, event.target.value as User["role"])}
            >
              <option value="user">{t("admin.role.user")}</option>
              <option value="organizer">{t("admin.role.organizer")}</option>
              <option value="manager">{t("admin.role.manager")}</option>
              <option value="admin">{t("admin.role.admin")}</option>
            </select>
            <button
              type="button"
              className="secondary danger"
              onClick={() => deleteUser(user)}
              disabled={user.id === currentUser?.id}
            >
              {t("admin.user.delete")}
            </button>
          </div>
        ))}
      </div>
        </>
      ) : null}

      {adminSection === "betrieb" ? (
        <>
          <header className="admin-section-head">
            <p className="eyebrow">{t("main.admin.nav.ops")}</p>
            <h2>{t("admin.betrieb.title")}</h2>
          </header>
          <form id="admin-betrieb" onSubmit={saveSettings} className="admin-form">
        <label>
          {t("admin.label.appName")}
          <input
            value={settings.appName}
            onChange={(event) => setSettings({ ...settings, appName: event.target.value })}
            maxLength={80}
            placeholder={t("brand.displayName")}
          />
        </label>
        <p className="muted">{t("admin.help.appName")}</p>
        <label>
          {t("admin.label.brandMark")}
          <select
            value={settings.brandMark}
            onChange={(event) =>
              setSettings({
                ...settings,
                brandMark: event.target.value as AppSettings["brandMark"]
              })
            }
          >
            <option value="mitspiel">{t("admin.brandMark.mitspiel")}</option>
            <option value="hermes">{t("admin.brandMark.hermes")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.help.brandMark")}</p>
        <label>
          {t("admin.label.archiveHours")}
          <input
            type="number"
            min={1}
            max={72}
            value={settings.eventAutoArchiveHours}
            onChange={(event) =>
              setSettings({
                ...settings,
                eventAutoArchiveHours: Number(event.target.value)
              })
            }
            required
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.defaultNotificationsEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                defaultNotificationsEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.notifyDefault")}
        </label>
               <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.publicRegistrationEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                publicRegistrationEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.publicReg")}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.s3SnapshotEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                s3SnapshotEnabled: event.target.checked
              })
            }
          />
          {t("admin.label.s3snap")}
        </label>
        <p className="muted">{t("admin.help.s3snap")}</p>
        <label>
          {t("admin.projectTemplate.label")}
          <select
            value={settings.projectTemplate}
            onChange={(event) =>
              setSettings({
                ...settings,
                projectTemplate: event.target.value as AppSettings["projectTemplate"]
              })
            }
          >
            <option value="lan_party">{t("admin.projectTemplate.lan_party")}</option>
            <option value="table_tennis">{t("admin.projectTemplate.table_tennis")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.projectTemplate.help")}</p>
        <label>
          {t("admin.label.defaultLocale")}
          <select
            value={settings.defaultLocale}
            onChange={(event) =>
              setSettings({
                ...settings,
                defaultLocale: event.target.value as AppSettings["defaultLocale"]
              })
            }
          >
            <option value="de">{t("admin.locale.de")}</option>
            <option value="en">{t("admin.locale.en")}</option>
          </select>
        </label>
        <p className="muted">{t("admin.help.defaultLocale")}</p>
        <p className="eyebrow admin-kiosk-eyebrow">{t("admin.kiosk.title")}</p>
        <p className="muted">{t("admin.kiosk.help")}</p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.kioskStreamEnabled}
            onChange={(event) =>
              setSettings({
                ...settings,
                kioskStreamEnabled: event.target.checked
              })
            }
          />
          {t("admin.kiosk.enabled")}
        </label>
        <label>
          {t("admin.kiosk.path")}
          <input
            value={settings.kioskStreamPath}
            onChange={(event) =>
              setSettings({ ...settings, kioskStreamPath: event.target.value.trim() })
            }
            maxLength={63}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
            spellCheck={false}
            autoComplete="off"
            placeholder="stream"
          />
        </label>
        <label>
          {t("admin.kiosk.secret")}
          <input
            type="password"
            value={settings.kioskStreamSecret}
            onChange={(event) =>
              setSettings({ ...settings, kioskStreamSecret: event.target.value })
            }
            maxLength={128}
            spellCheck={false}
            autoComplete="new-password"
            placeholder={t("admin.kiosk.secretPlaceholder")}
          />
        </label>
        <div className="action-row">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setSettings({ ...settings, kioskStreamSecret: generateKioskStreamSecret() })
            }
          >
            {t("admin.kiosk.generate")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const path = settings.kioskStreamPath.trim().replace(/^\/+|\/+$/g, "") || "stream";
              const origin = window.location.origin;
              const url = `${origin}/${path}?id=${encodeURIComponent(settings.kioskStreamSecret)}`;
              try {
                await navigator.clipboard.writeText(url);
                setMessage(t("admin.kiosk.copied"));
                setError("");
              } catch {
                setError(t("admin.kiosk.copyFailed"));
              }
            }}
          >
            {t("admin.kiosk.copyUrl")}
          </button>
        </div>
        <p className="muted">{t("admin.shell.help")}</p>
        <label>
          {t("admin.shell.heroTitle")}
          <input
            value={settings.shellStartTitle}
            onChange={(event) =>
              setSettings({ ...settings, shellStartTitle: event.target.value })
            }
            maxLength={240}
            placeholder={t("main.route.events.title")}
          />
        </label>
        <label>
          {t("admin.shell.heroDesc")}
          <textarea
            value={settings.shellStartDescription}
            onChange={(event) =>
              setSettings({ ...settings, shellStartDescription: event.target.value })
            }
            maxLength={2000}
            rows={4}
            placeholder={t("main.route.events.description")}
          />
        </label>
        <label>
          {t("admin.shell.emptyTitle")}
          <input
            value={settings.shellEventsEmptyTitle}
            onChange={(event) =>
              setSettings({ ...settings, shellEventsEmptyTitle: event.target.value })
            }
            maxLength={240}
            placeholder={t("events.empty.defaultTitle")}
          />
        </label>
        <label>
          {t("admin.shell.emptyBody")}
          <textarea
            value={settings.shellEventsEmptyBody}
            onChange={(event) =>
              setSettings({ ...settings, shellEventsEmptyBody: event.target.value })
            }
            maxLength={2000}
            rows={3}
            placeholder={t("events.empty.defaultBody")}
          />
        </label>
        <label>
          {t("admin.catalog.label")}
          <textarea
            value={gameCatalogDraft}
            onChange={(event) => setGameCatalogDraft(event.target.value)}
            rows={6}
            placeholder={"Counter-Strike 2\nLeague of Legends"}
          />
        </label>
        <p className="muted">{t("admin.catalog.help")}</p>
        <section className="admin-ops" aria-label={t("admin.portability.title")}>
          <p className="eyebrow">{t("admin.portability.eyebrow")}</p>
          <h3>{t("admin.portability.title")}</h3>
          <p className="muted">{t("admin.portability.help")}</p>
          <div className="action-row">
            <button
              type="button"
              onClick={() =>
                void downloadJsonAttachment("/api/admin/settings/export", "hermes-settings.json")
              }
            >
              {t("admin.settings.export")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => settingsImportRef.current?.click()}
            >
              {t("admin.settings.import")}
            </button>
            <input
              ref={settingsImportRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void runSettingsImport(file);
                }
              }}
            />
          </div>
        </section>
        <button type="submit">{t("admin.settings.save")}</button>
      </form>

      <section className="admin-ops" aria-label={t("admin.storage.title")}>
        <p className="eyebrow">{t("admin.storage.eyebrow")}</p>
        <h2>{t("admin.storage.title")}</h2>
        <p className="muted">{t("admin.storage.intro1")}</p>
        <p className="muted">{t("admin.storage.intro2")}</p>
        {storage?.backend === "disabled" ? (
          storage?.envS3Configured ? (
            <p className="muted">{t("admin.storage.disabled.app")}</p>
          ) : (
            <p className="muted">{t("admin.storage.disabled.env")}</p>
          )
        ) : (
          <div className="device-list" aria-label={t("admin.storage.backupStatus")}>
            <article className="device-row">
              <div>
                <strong>{t("admin.storage.backupStatus")}</strong>
                <span>
                  {t("admin.storage.lastOk")}{" "}
                  {storage?.backupStatus?.lastSuccessAt
                    ? new Date(storage.backupStatus.lastSuccessAt).toLocaleString(dateTag)
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.lastErr")}{" "}
                  {storage?.backupStatus?.lastFailureAt
                    ? new Date(storage.backupStatus.lastFailureAt).toLocaleString(dateTag)
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.errCode")}{" "}
                  {storage?.backupStatus?.failureCode ? storage.backupStatus.failureCode : "—"}
                </span>
                <span>
                  {t("admin.storage.hint")}{" "}
                  {storage?.backupStatus?.failureSummary ? storage.backupStatus.failureSummary : "—"}
                </span>
                <span>
                  {t("admin.storage.target")}{" "}
                  {storage?.location
                    ? `s3://${storage.location.bucket}/${storage.location.key} (${storage.location.region})`
                    : "—"}
                </span>
                <span>
                  {t("admin.storage.endpoint")} {storage?.location?.endpoint ?? "—"}
                </span>
              </div>
            </article>
          </div>
        )}
        <div className="action-row">
          <button type="button" onClick={runBackup} disabled={opsBusy}>
            {t("admin.storage.backupRun")}
          </button>
          <button type="button" className="secondary" onClick={runRestore} disabled={opsBusy}>
            {t("admin.storage.restoreRun")}
          </button>
        </div>
        {restoreRecovery ? (
          <p className="muted">
            {t("admin.storage.recovery")} <strong>{restoreRecovery.id}</strong> ·{" "}
            <code>{restoreRecovery.key}</code>
          </p>
        ) : null}
        {restoreDiagnostics ? (
          <div className="device-list" aria-label={t("admin.storage.diagTitle")}>
            <article className="device-row">
              <div>
                <strong>{t("admin.storage.diagTitle")}</strong>
                <span>
                  {t("admin.storage.diagType")} {restoreDiagnostics.kind}
                </span>
                <span>
                  {t("admin.storage.diagHint")} {restoreDiagnostics.summary}
                </span>
                {restoreDiagnostics.migrations ? (
                  <span>
                    {t("admin.storage.diagMigrations", {
                      live: restoreDiagnostics.migrations.liveLatest ?? "—",
                      snap: restoreDiagnostics.migrations.snapshotLatest ?? "—"
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.missingTables?.length ? (
                  <span>
                    {t("admin.storage.diagMissing", {
                      tables: restoreDiagnostics.missingTables.slice(0, 10).join(", ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.columnMismatches?.length ? (
                  <span>
                    {t("admin.storage.diagColumns", {
                      detail: restoreDiagnostics.columnMismatches
                        .slice(0, 5)
                        .map(
                          (m) =>
                            `${m.table} (missing: ${m.missingInSnapshot.slice(0, 6).join(", ")})`
                        )
                        .join(" · ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.foreignKeyFailures?.length ? (
                  <span>
                    {t("admin.storage.diagFk", {
                      detail: restoreDiagnostics.foreignKeyFailures
                        .slice(0, 5)
                        .map((fk) => `${fk.table}#${fk.rowid} -> ${fk.parent}`)
                        .join(" · ")
                    })}
                  </span>
                ) : null}
                {restoreDiagnostics.snapshot ? (
                  <span>
                    Snapshot: s3://{restoreDiagnostics.snapshot.bucket}/{restoreDiagnostics.snapshot.key}
                  </span>
                ) : null}
              </div>
            </article>
          </div>
        ) : null}
      </section>
        </>
      ) : null}

      {adminSection === "design" ? (
        <>
          <header className="admin-section-head">
            <p className="eyebrow">{t("main.admin.nav.design")}</p>
            <h2>{t("admin.design.title")}</h2>
          </header>
          <form id="admin-design" onSubmit={saveSettings} className="admin-form">
            <p className="muted">{t("admin.design.help")}</p>
            <p className="muted">{t("admin.design.help2")}</p>
            <div className="color-grid" aria-label={t("admin.design.colorsAria")}>
              <label>
                {t("admin.design.primary")}
                <input
                  type="color"
                  value={settings.themePrimaryColor}
                  onChange={(event) =>
                    setSettings({ ...settings, themePrimaryColor: event.target.value })
                  }
                />
              </label>
              <label>
                {t("admin.design.login")}
                <input
                  type="color"
                  value={settings.themeLoginColor}
                  onChange={(event) =>
                    setSettings({ ...settings, themeLoginColor: event.target.value })
                  }
                />
              </label>
              <label>
                {t("admin.design.manager")}
                <input
                  type="color"
                  value={settings.themeManagerColor}
                  onChange={(event) =>
                    setSettings({ ...settings, themeManagerColor: event.target.value })
                  }
                />
              </label>
              <label>
                {t("admin.design.admin")}
                <input
                  type="color"
                  value={settings.themeAdminColor}
                  onChange={(event) =>
                    setSettings({ ...settings, themeAdminColor: event.target.value })
                  }
                />
              </label>
              <label>
                {t("admin.design.surface")}
                <input
                  type="color"
                  value={settings.themeSurfaceColor}
                  onChange={(event) =>
                    setSettings({ ...settings, themeSurfaceColor: event.target.value })
                  }
                />
              </label>
            </div>
            <button type="submit">{t("admin.settings.save")}</button>
          </form>
        </>
      ) : null}

      {adminSection === "infos" ? (
        <>
          <header className="admin-section-head">
            <p className="eyebrow">{t("main.admin.nav.infos")}</p>
            <h2>{t("admin.infos.title")}</h2>
            <p className="muted">{t("admin.infos.help")}</p>
          </header>
          <form id="admin-infos" onSubmit={saveSettings} className="admin-form">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.infosEnabled}
                onChange={(event) =>
                  setSettings({ ...settings, infosEnabled: event.target.checked })
                }
              />
              {t("admin.infos.menuCheck")}
            </label>
            <label>
              {t("admin.infos.markdownLabel")}
              <textarea
                value={settings.infosMarkdown}
                onChange={(event) =>
                  setSettings({ ...settings, infosMarkdown: event.target.value })
                }
                rows={18}
                maxLength={100_000}
                spellCheck="true"
                aria-label={t("admin.infos.markdownAria")}
                placeholder={t("admin.infos.markdownPlaceholder")}
              />
            </label>
            <button type="submit">{t("admin.settings.save")}</button>
          </form>
        </>
      ) : null}

      {adminSection === "sicherheit" ? (
        <section
        id="admin-sicherheit"
        className="rate-limit-panel"
        aria-label={t("admin.rate.sectionAria")}
      >
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("admin.rate.eyebrow")}</p>
            <h2>{t("admin.rate.title")}</h2>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => loadAdminData()}
            disabled={rateLimitBusy}
          >
            {t("loginProfile.devicesRefresh")}
          </button>
        </div>
        <p className="muted">{t("admin.rate.intro")}</p>

        <div className="device-list" aria-label={t("admin.rate.listAria")}>
          {activeRateLimits.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.scope}</strong>
                <span>
                  {t("admin.rate.key")} {entry.key.slice(0, 10)}…
                </span>
                <span>
                  {t("admin.rate.attempts")} {entry.attemptCount}
                </span>
                <time dateTime={entry.blockedUntil ?? undefined}>
                  {t("admin.rate.blockedUntil")}{" "}
                  {entry.blockedUntil ? new Date(entry.blockedUntil).toLocaleString(dateTag) : "—"}
                </time>
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => clearRateLimitEntry(entry)}
                  disabled={rateLimitBusy}
                >
                  {t("admin.rate.clearLock")}
                </button>
              </div>
            </article>
          ))}
          {activeRateLimits.length === 0 ? (
            <article className="device-row">
              <strong>{t("admin.rate.noneActive")}</strong>
              <span>{t("admin.rate.noneHint")}</span>
            </article>
          ) : null}
        </div>

        <form
          onSubmit={addAllowlistEntry}
          className="admin-form inline-form"
          aria-label={t("admin.rate.allowlistFormAria")}
        >
          <label>
            {t("admin.rate.allowlistIp")}
            <input
              value={allowlistDraft.ipOrCidr}
              onChange={(event) =>
                setAllowlistDraft({ ...allowlistDraft, ipOrCidr: event.target.value })
              }
              required
            />
          </label>
          <label>
            {t("admin.rate.allowlistNote")}
            <input
              value={allowlistDraft.note}
              onChange={(event) => setAllowlistDraft({ ...allowlistDraft, note: event.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={rateLimitBusy}>
            {t("admin.rate.allowlistSave")}
          </button>
        </form>

        <div className="device-list" aria-label={t("admin.rate.allowlistAria")}>
          {rateLimitAllowlist.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.ipOrCidr}</strong>
                <span>{entry.note ?? t("admin.rate.allowlistNoLabel")}</span>
                <time dateTime={entry.updatedAt}>
                  {t("admin.rate.allowlistUpdated")}{" "}
                  {new Date(entry.updatedAt).toLocaleString(dateTag)}
                </time>
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => deleteAllowlistEntry(entry)}
                  disabled={rateLimitBusy}
                >
                  {t("admin.rate.allowlistRemove")}
                </button>
              </div>
            </article>
          ))}
          {rateLimitAllowlist.length === 0 ? (
            <article className="device-row">
              <strong>{t("admin.allowlist.empty")}</strong>
              <span>{t("admin.allowlist.emptyHint")}</span>
            </article>
          ) : null}
        </div>
      </section>
      ) : null}

      {adminSection === "invites" ? (
        <section id="admin-invites" className="invite-panel" aria-label={t("admin.invites.sectionAria")}>
        <p className="eyebrow">{t("main.admin.nav.invites")}</p>
        <h2>{t("admin.invites.title")}</h2>
        <p className="muted">{t("admin.invites.help")}</p>
        <form onSubmit={createInviteCode} className="admin-form inline-form">
          <label>
            {t("admin.invites.fieldName")}
            <input
              value={newInvite.label}
              onChange={(event) => setNewInvite({ ...newInvite, label: event.target.value })}
              placeholder={t("admin.invites.placeholderName")}
              required
            />
          </label>
          <label>
            {t("admin.invites.fieldMaxUses")}
            <input
              type="number"
              min={1}
              max={500}
              value={newInvite.maxUses}
              onChange={(event) => setNewInvite({ ...newInvite, maxUses: event.target.value })}
              placeholder={t("admin.invites.placeholderMax")}
            />
          </label>
          <label>
            {t("admin.invites.fieldExpires")}
            <input
              type="datetime-local"
              value={newInvite.expiresAt}
              onChange={(event) => setNewInvite({ ...newInvite, expiresAt: event.target.value })}
              placeholder={t("admin.invites.placeholderExpires")}
            />
          </label>
          <button type="submit">{t("admin.invites.create")}</button>
        </form>
        <div className="invite-list">
          {inviteCodes.map((invite) => (
            <article className="invite-row" key={invite.id}>
              <div>
                <strong>{invite.label}</strong>
                <code>{invite.code}</code>
                <span>
                  {t("admin.invites.used", {
                    used: invite.usedCount,
                    max: invite.maxUses ?? "∞"
                  })}
                  {invite.expiresAt
                    ? t("admin.invites.validUntil", {
                        at: new Date(invite.expiresAt).toLocaleString(dateTag)
                      })
                    : ""}
                  {invite.revokedAt ? t("admin.invites.revoked") : ""}
                </span>
                <div className="form-grid">
                  <label>
                    {t("admin.invites.rowLabel")}
                    <input
                      value={inviteDrafts[invite.id]?.label ?? invite.label}
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: event.target.value,
                            maxUses:
                              inviteDrafts[invite.id]?.maxUses ??
                              (invite.maxUses === null ? "" : String(invite.maxUses)),
                            expiresAt:
                              inviteDrafts[invite.id]?.expiresAt ??
                              (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("admin.invites.rowMaxEmpty")}
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={
                        inviteDrafts[invite.id]?.maxUses ??
                        (invite.maxUses === null ? "" : String(invite.maxUses))
                      }
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: inviteDrafts[invite.id]?.label ?? invite.label,
                            maxUses: event.target.value,
                            expiresAt:
                              inviteDrafts[invite.id]?.expiresAt ??
                              (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")
                          }
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("admin.invites.rowExpiresEmpty")}
                    <input
                      type="datetime-local"
                      value={
                        inviteDrafts[invite.id]?.expiresAt ??
                        (invite.expiresAt ? toDatetimeLocal(invite.expiresAt) : "")
                      }
                      onChange={(event) =>
                        setInviteDrafts({
                          ...inviteDrafts,
                          [invite.id]: {
                            label: inviteDrafts[invite.id]?.label ?? invite.label,
                            maxUses:
                              inviteDrafts[invite.id]?.maxUses ??
                              (invite.maxUses === null ? "" : String(invite.maxUses)),
                            expiresAt: event.target.value
                          }
                        })
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="device-actions">
                <button type="button" className="secondary" onClick={() => updateInviteCode(invite)}>
                  {t("admin.invites.save")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => deactivateInviteCode(invite)}
                  disabled={Boolean(invite.revokedAt)}
                >
                  {t("admin.invites.deactivate")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => reactivateInviteCode(invite)}
                  disabled={!invite.revokedAt}
                >
                  {t("admin.invites.reactivate")}
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => deleteUnusedInviteCode(invite)}
                >
                  {t("admin.user.delete")}
                </button>
              </div>
            </article>
          ))}
          {inviteCodes.length === 0 ? (
            <article className="invite-row">
              <strong>{t("admin.invites.empty")}</strong>
              <span>{t("admin.invites.emptyHint")}</span>
            </article>
          ) : null}
        </div>
      </section>
      ) : null}

      {adminSection === "audit" ? (
        <section id="admin-audit" className="audit-panel" aria-label={t("admin.audit.sectionAria")}>
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{t("main.admin.nav.audit")}</p>
            <h2>{t("admin.audit.title")}</h2>
            <p className="muted">{t("admin.audit.intro")}</p>
          </div>
          <button type="button" className="secondary" onClick={() => loadAdminData()}>
            {t("loginProfile.devicesRefresh")}
          </button>
        </div>
        <div className="audit-list">
          {auditLogs.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString(dateTag)}
              </time>
              <strong>{entry.summary}</strong>
              <span>
                {[entry.action, entry.actorUsername ?? t("admin.audit.actorSystem")]
                  .filter(Boolean)
                  .join(" | ")}
              </span>
            </article>
          ))}
          {auditLogs.length === 0 ? (
            <article className="audit-row">
              <strong>{t("admin.audit.empty")}</strong>
              <span>{t("admin.audit.emptyHint")}</span>
            </article>
          ) : null}
        </div>
      </section>
      ) : null}
    </section>
  );
}
