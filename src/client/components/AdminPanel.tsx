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
import { AdminPanelAudit } from "./AdminPanelAudit";
import { AdminPanelBetrieb } from "./AdminPanelBetrieb";
import { AdminPanelDesign } from "./AdminPanelDesign";
import { AdminPanelInfos } from "./AdminPanelInfos";
import { AdminPanelInvites } from "./AdminPanelInvites";
import { AdminPanelSicherheit } from "./AdminPanelSicherheit";
import { AdminPanelUsers } from "./AdminPanelUsers";

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
  featuresPizzaEnabled: false,
  pizzaPaypalHandle: "",
  pizzaPaypalName: "",
  pizzaCashRecipient: "",
  ampIntegrationEnabled: false,
  ampBaseUrl: "",
  ampAutoStartOnReady: false,
  ampAutoStopIdleMinutes: 0,
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
        <AdminPanelUsers
          users={users}
          currentUser={currentUser}
          newUser={newUser}
          bulkImportDraft={bulkImportDraft}
          bulkImportPreview={bulkImportPreview}
          bulkImportBusy={bulkImportBusy}
          bulkImportCanCommit={bulkImportCanCommit}
          usersExportImportRef={usersExportImportRef}
          bulkImportSummary={bulkImportSummary}
          onNewUserChange={setNewUser}
          onBulkImportDraftChange={setBulkImportDraft}
          onClearBulkImportPreview={() => setBulkImportPreview(null)}
          onCreateUser={createUser}
          onUpdateRole={updateRole}
          onDeleteUser={deleteUser}
          onDownloadJsonAttachment={(p, n) => void downloadJsonAttachment(p, n)}
          onRunUsersExportImport={(f) => void runUsersExportImport(f)}
          onPreviewBulkImport={previewBulkImport}
          onCommitBulkImport={() => void commitBulkImport()}
        />
      ) : null}

      {adminSection === "betrieb" ? (
        <AdminPanelBetrieb
          settings={settings}
          gameCatalogDraft={gameCatalogDraft}
          storage={storage}
          restoreDiagnostics={restoreDiagnostics}
          restoreRecovery={restoreRecovery}
          opsBusy={opsBusy}
          dateTag={dateTag}
          settingsImportRef={settingsImportRef}
          onSettingsChange={setSettings}
          onGameCatalogDraftChange={setGameCatalogDraft}
          onSaveSettings={saveSettings}
          onMessage={setMessage}
          onError={setError}
          onDownloadJsonAttachment={(p, n) => void downloadJsonAttachment(p, n)}
          onRunSettingsImport={(f) => void runSettingsImport(f)}
          onRunBackup={runBackup}
          onRunRestore={runRestore}
        />
      ) : null}


      {adminSection === "design" ? (
        <AdminPanelDesign settings={settings} onSettingsChange={setSettings} onSubmit={saveSettings} />
      ) : null}

      {adminSection === "infos" ? (
        <AdminPanelInfos settings={settings} onSettingsChange={setSettings} onSubmit={saveSettings} />
      ) : null}

      {adminSection === "sicherheit" ? (
        <AdminPanelSicherheit
          activeRateLimits={activeRateLimits}
          rateLimitAllowlist={rateLimitAllowlist}
          allowlistDraft={allowlistDraft}
          rateLimitBusy={rateLimitBusy}
          dateTag={dateTag}
          onAllowlistDraftChange={setAllowlistDraft}
          onAddAllowlistEntry={addAllowlistEntry}
          onDeleteAllowlistEntry={deleteAllowlistEntry}
          onClearRateLimitEntry={clearRateLimitEntry}
          onRefresh={() => loadAdminData()}
        />
      ) : null}

      {adminSection === "invites" ? (
        <AdminPanelInvites
          inviteCodes={inviteCodes}
          newInvite={newInvite}
          inviteDrafts={inviteDrafts}
          dateTag={dateTag}
          onNewInviteChange={setNewInvite}
          onInviteDraftsChange={setInviteDrafts}
          onCreate={createInviteCode}
          onUpdate={updateInviteCode}
          onDeactivate={deactivateInviteCode}
          onReactivate={reactivateInviteCode}
          onDeleteUnused={deleteUnusedInviteCode}
        />
      ) : null}

      {adminSection === "audit" ? (
        <AdminPanelAudit auditLogs={auditLogs} dateTag={dateTag} onRefresh={() => loadAdminData()} />
      ) : null}
    </section>
  );
}
