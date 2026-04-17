import React, { FormEvent, useEffect, useState } from "react";
import type {
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

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  return new Date(value).toISOString();
}

const defaultSettings: AppSettings = {
  appName: "Hermes",
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
  themeSurfaceColor: "#f6f8f4"
};

function summarizeBulkImportIssues(result: BulkImportResult) {
  if (result.issues.length === 0) {
    return "Keine blockierenden Konflikte erkannt.";
  }

  return `${result.blockingIssueCount} blockierende Probleme erkannt.`;
}

export function AdminPanel({
  currentUser,
  onSettingsChanged
}: {
  currentUser: User | null;
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

  const isAdmin = currentUser?.role === "admin";

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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const result = await requestJson<{ settings: AppSettings }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(result.settings);
      onSettingsChanged(result.settings);
      setMessage("Einstellungen gespeichert.");
    } catch (caught) {
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
      setError(getErrorMessage(caught));
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
        <img src="/icon.svg" alt="" />
        <p className="eyebrow">Admin</p>
        <h2>User, Manager und Einstellungen.</h2>
        <p>Der Adminbereich ist nach Admin-Login verfügbar.</p>
        <a className="text-link" href="#login">
          Admin-Login öffnen
        </a>
      </article>
    );
  }

  const activeRateLimits = getActiveRateLimitEntries();
  const bulkImportCanCommit = Boolean(
    bulkImportPreview && !bulkImportPreview.hasBlockingIssues && bulkImportPreview.acceptedRows > 0
  );

  return (
    <section id="admin" className="admin-panel" aria-label="Adminbereich">
      <p className="eyebrow">Admin</p>
      <h2>User, Manager und Einstellungen.</h2>
      <p className="muted admin-intro">
        Verwalte hier Zugänge, Theme-Farben, Invite-Codes, Betriebszustand und den letzten
        Änderungsverlauf der LAN-Runde, ohne die Routing- oder Login-Flows zu verändern.
      </p>

      <nav className="admin-subnav" aria-label="Admin Bereiche">
        <a href="#admin-users">Benutzer</a>
        <a href="#admin-betrieb">Betrieb</a>
        <a href="#admin-sicherheit">Sicherheit</a>
        <a href="#admin-invites">Invites</a>
        <a href="#admin-audit">Audit</a>
      </nav>

      <div className="admin-section">
      <form id="admin-users" onSubmit={createUser} className="admin-form">
        <label>
          Username
          <input
            value={newUser.username}
            onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
            required
          />
        </label>
        <label>
          E-Mail
          <input
            type="email"
            value={newUser.email}
            onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
            required
          />
        </label>
        <label>
          Rolle
          <select
            value={newUser.role}
            onChange={(event) => setNewUser({ ...newUser, role: event.target.value as User["role"] })}
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit">User anlegen</button>
      </form>

      <section className="invite-panel" aria-label="Bulk User Import">
        <p className="eyebrow">Bulk Import</p>
        <h2>User aus CSV oder JSON importieren.</h2>
        <p className="muted">
          Hermes prüft jede Zeile serverseitig gegen denselben Admin-Contract wie Einzel-User.
          Vorschau zeigt blockierende Konflikte, Commit bleibt gesperrt bis der letzte Preview-Lauf sauber ist.
        </p>
        <form onSubmit={previewBulkImport} className="admin-form" aria-label="Bulk Import Formular">
          <label>
            Format
            <select
              aria-label="Importformat"
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
            Importdaten
            <textarea
              aria-label="Importdaten"
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
              Vorschau laden
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void commitBulkImport()}
              disabled={bulkImportBusy || !bulkImportCanCommit}
            >
              Import committen
            </button>
          </div>
        </form>

        {bulkImportPreview ? (
          <div className="device-list" aria-label="Bulk Import Vorschau">
            <article className="device-row">
              <div>
                <strong>Preview Zusammenfassung</strong>
                <span>Format: {bulkImportPreview.format.toUpperCase()}</span>
                <span>Zeilen gesamt: {bulkImportPreview.totalRows}</span>
                <span>Gültige Kandidaten: {bulkImportPreview.acceptedRows}</span>
                <span>{summarizeBulkImportIssues(bulkImportPreview)}</span>
              </div>
            </article>

            <article className="device-row" aria-label="Blockierende Probleme">
              <div>
                <strong>Blockierende Probleme</strong>
                {bulkImportPreview.issues.length > 0 ? (
                  <ul>
                    {bulkImportPreview.issues.map((issue, index) => (
                      <li key={`${issue.row}-${issue.field}-${index}`}>
                        Zeile {issue.row}: {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>Keine blockierenden Konflikte erkannt.</span>
                )}
              </div>
            </article>

            <article className="device-row" aria-label="Import Kandidaten">
              <div>
                <strong>Importierbare User</strong>
                {bulkImportPreview.validCandidates.length > 0 ? (
                  <ul>
                    {bulkImportPreview.validCandidates.map((candidate) => (
                      <li key={`${candidate.username}-${candidate.email}`}>
                        {candidate.username} · {candidate.email} · {candidate.role}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>Noch keine importierbaren User in dieser Vorschau.</span>
                )}
              </div>
            </article>
          </div>
        ) : null}
      </section>

      <div className="admin-list" aria-label="Userliste">
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
              <option value="user">User</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              className="secondary danger"
              onClick={() => deleteUser(user)}
              disabled={user.id === currentUser?.id}
            >
              Löschen
            </button>
          </div>
        ))}
      </div>
      </div>

      <div className="admin-section">
      <form id="admin-betrieb" onSubmit={saveSettings} className="admin-form">
        <label>
          App-Name
          <input
            value={settings.appName}
            onChange={(event) => setSettings({ ...settings, appName: event.target.value })}
            required
          />
        </label>
        <label>
          Auto-Archiv nach Stunden
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
          Notifications standardmäßig aktiv
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
          Öffentliche Registrierung per Invite-Code erlauben
        </label>
        <p className="muted">
          Shell-Texte für Startseite und leeres Event-Board. Leer lassen, um die eingebauten
          Standardtexte zu nutzen.
        </p>
        <label>
          Start · Hero-Überschrift (optional)
          <input
            value={settings.shellStartTitle}
            onChange={(event) =>
              setSettings({ ...settings, shellStartTitle: event.target.value })
            }
            maxLength={240}
            placeholder="Von der Idee bis zum Server-Join an einem Ort."
          />
        </label>
        <label>
          Start · Hero-Beschreibung (optional)
          <textarea
            value={settings.shellStartDescription}
            onChange={(event) =>
              setSettings({ ...settings, shellStartDescription: event.target.value })
            }
            maxLength={2000}
            rows={4}
            placeholder="Sieh auf einen Blick, welche Runde tragfähig ist …"
          />
        </label>
        <label>
          Events-Board · Leerzustand Überschrift (optional)
          <input
            value={settings.shellEventsEmptyTitle}
            onChange={(event) =>
              setSettings({ ...settings, shellEventsEmptyTitle: event.target.value })
            }
            maxLength={240}
            placeholder="Noch keine Runden im Board."
          />
        </label>
        <label>
          Events-Board · Leerzustand Text (optional)
          <textarea
            value={settings.shellEventsEmptyBody}
            onChange={(event) =>
              setSettings({ ...settings, shellEventsEmptyBody: event.target.value })
            }
            maxLength={2000}
            rows={3}
            placeholder="Sobald ein Manager eine Runde vorbereitet …"
          />
        </label>
        <p className="muted">
          Diese fünf Farben werden serverseitig gespeichert und steuern die Shell-Akzente für Events,
          Login, Manager, Admin und die gemeinsame Oberfläche auf allen Geräten.
        </p>
        <p className="muted">
          Änderungen wirken sofort in der Shell und bleiben der zentrale Theme-Vertrag für Desktop
          und Smartphone.
        </p>
        <div className="color-grid" aria-label="Designfarben">
          <label>
            Primärfarbe
            <input
              type="color"
              value={settings.themePrimaryColor}
              onChange={(event) =>
                setSettings({ ...settings, themePrimaryColor: event.target.value })
              }
            />
          </label>
          <label>
            Loginfarbe
            <input
              type="color"
              value={settings.themeLoginColor}
              onChange={(event) => setSettings({ ...settings, themeLoginColor: event.target.value })}
            />
          </label>
          <label>
            Managerfarbe
            <input
              type="color"
              value={settings.themeManagerColor}
              onChange={(event) =>
                setSettings({ ...settings, themeManagerColor: event.target.value })
              }
            />
          </label>
          <label>
            Adminfarbe
            <input
              type="color"
              value={settings.themeAdminColor}
              onChange={(event) => setSettings({ ...settings, themeAdminColor: event.target.value })}
            />
          </label>
          <label>
            Hintergrund
            <input
              type="color"
              value={settings.themeSurfaceColor}
              onChange={(event) =>
                setSettings({ ...settings, themeSurfaceColor: event.target.value })
              }
            />
          </label>
        </div>
        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Einstellungen speichern</button>
      </form>

      <section className="admin-ops" aria-label="Backup und Restore">
        <p className="eyebrow">Storage</p>
        <h2>Backup und Restore.</h2>
        <p className="muted">
          Backup schreibt den aktuellen SQLite-Snapshot nach S3. Restore ersetzt die aktiven Daten
          durch den Snapshot aus S3.
        </p>
        <p className="muted">
          Nutze Restore nur bewusst zwischen Spielrunden und prüfe danach direkt Users, Events und
          die aktuelle Session.
        </p>
        {storage?.backend === "disabled" ? (
          <p className="muted">S3 Snapshot Storage ist deaktiviert (HERMES_STORAGE_BACKEND ≠ s3).</p>
        ) : (
          <div className="device-list" aria-label="Backup Status">
            <article className="device-row">
              <div>
                <strong>Backup Status</strong>
                <span>
                  Letzter Erfolg:{" "}
                  {storage?.backupStatus?.lastSuccessAt
                    ? new Date(storage.backupStatus.lastSuccessAt).toLocaleString("de-DE")
                    : "—"}
                </span>
                <span>
                  Letzter Fehler:{" "}
                  {storage?.backupStatus?.lastFailureAt
                    ? new Date(storage.backupStatus.lastFailureAt).toLocaleString("de-DE")
                    : "—"}
                </span>
                <span>
                  Fehlercode:{" "}
                  {storage?.backupStatus?.failureCode ? storage.backupStatus.failureCode : "—"}
                </span>
                <span>
                  Hinweis:{" "}
                  {storage?.backupStatus?.failureSummary ? storage.backupStatus.failureSummary : "—"}
                </span>
                <span>
                  Ziel:{" "}
                  {storage?.location
                    ? `s3://${storage.location.bucket}/${storage.location.key} (${storage.location.region})`
                    : "—"}
                </span>
                <span>Endpoint: {storage?.location?.endpoint ?? "—"}</span>
              </div>
            </article>
          </div>
        )}
        <div className="action-row">
          <button type="button" onClick={runBackup} disabled={opsBusy}>
            Backup starten
          </button>
          <button type="button" className="secondary" onClick={runRestore} disabled={opsBusy}>
            Restore starten
          </button>
        </div>
        {restoreRecovery ? (
          <p className="muted">
            Recovery: <strong>{restoreRecovery.id}</strong> · <code>{restoreRecovery.key}</code>
          </p>
        ) : null}
        {restoreDiagnostics ? (
          <div className="device-list" aria-label="Restore Diagnostik">
            <article className="device-row">
              <div>
                <strong>Restore Diagnostik</strong>
                <span>Typ: {restoreDiagnostics.kind}</span>
                <span>Hinweis: {restoreDiagnostics.summary}</span>
                {restoreDiagnostics.migrations ? (
                  <span>
                    Migrationen: live {restoreDiagnostics.migrations.liveLatest ?? "—"} · snapshot{" "}
                    {restoreDiagnostics.migrations.snapshotLatest ?? "—"}
                  </span>
                ) : null}
                {restoreDiagnostics.missingTables?.length ? (
                  <span>
                    Fehlende Tabellen: {restoreDiagnostics.missingTables.slice(0, 10).join(", ")}
                  </span>
                ) : null}
                {restoreDiagnostics.columnMismatches?.length ? (
                  <span>
                    Spalten:{" "}
                    {restoreDiagnostics.columnMismatches
                      .slice(0, 5)
                      .map(
                        (m) =>
                          `${m.table} (missing: ${m.missingInSnapshot.slice(0, 6).join(", ")})`
                      )
                      .join(" · ")}
                  </span>
                ) : null}
                {restoreDiagnostics.foreignKeyFailures?.length ? (
                  <span>
                    FK Fehler:{" "}
                    {restoreDiagnostics.foreignKeyFailures
                      .slice(0, 5)
                      .map((fk) => `${fk.table}#${fk.rowid} -> ${fk.parent}`)
                      .join(" · ")}
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
      </div>

      <div className="admin-section">
      <section
        id="admin-sicherheit"
        className="rate-limit-panel"
        aria-label="Rate-Limit Betrieb"
      >
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Rate-Limits</p>
            <h2>Sperren prüfen und aufheben.</h2>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => loadAdminData()}
            disabled={rateLimitBusy}
          >
            Aktualisieren
          </button>
        </div>
        <p className="muted">
          Wenn sich jemand im LAN versehentlich aussperrt, kannst du aktive IP/Username-Sperren hier
          sehen, löschen und lokale IPs/PREFIXe in eine Allowlist aufnehmen.
        </p>

        <div className="device-list" aria-label="Aktive Rate-Limit Sperren">
          {activeRateLimits.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.scope}</strong>
                <span>Key: {entry.key.slice(0, 10)}…</span>
                <span>Versuche: {entry.attemptCount}</span>
                <time dateTime={entry.blockedUntil ?? undefined}>
                  Gesperrt bis:{" "}
                  {entry.blockedUntil
                    ? new Date(entry.blockedUntil).toLocaleString("de-DE")
                    : "—"}
                </time>
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => clearRateLimitEntry(entry)}
                  disabled={rateLimitBusy}
                >
                  Sperre löschen
                </button>
              </div>
            </article>
          ))}
          {activeRateLimits.length === 0 ? (
            <article className="device-row">
              <strong>Keine aktiven Sperren.</strong>
              <span>Wenn Rate-Limits aktiv sind, erscheinen sie hier.</span>
            </article>
          ) : null}
        </div>

        <form
          onSubmit={addAllowlistEntry}
          className="admin-form inline-form"
          aria-label="Allowlist Eintrag hinzufügen"
        >
          <label>
            IP oder CIDR (z.B. 192.168.0.42 oder 192.168.0.0/24)
            <input
              value={allowlistDraft.ipOrCidr}
              onChange={(event) =>
                setAllowlistDraft({ ...allowlistDraft, ipOrCidr: event.target.value })
              }
              required
            />
          </label>
          <label>
            Label (z.B. "Router", "Gaming-PC", "Admin-Laptop")
            <input
              value={allowlistDraft.note}
              onChange={(event) => setAllowlistDraft({ ...allowlistDraft, note: event.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={rateLimitBusy}>
            Allowlist speichern
          </button>
        </form>

        <div className="device-list" aria-label="Rate-Limit Allowlist">
          {rateLimitAllowlist.map((entry) => (
            <article className="device-row" key={entry.id}>
              <div>
                <strong>{entry.ipOrCidr}</strong>
                <span>{entry.note ?? "Ohne Label"}</span>
                <time dateTime={entry.updatedAt}>
                  Aktualisiert: {new Date(entry.updatedAt).toLocaleString("de-DE")}
                </time>
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => deleteAllowlistEntry(entry)}
                  disabled={rateLimitBusy}
                >
                  Entfernen
                </button>
              </div>
            </article>
          ))}
          {rateLimitAllowlist.length === 0 ? (
            <article className="device-row">
              <strong>Noch keine Allowlist-Einträge.</strong>
              <span>Für stabile LAN-Setups können lokale IPs hier ausgenommen werden.</span>
            </article>
          ) : null}
        </div>
      </section>
      </div>

      <div className="admin-section">
      <section id="admin-invites" className="invite-panel" aria-label="Invite-Codes">
        <p className="eyebrow">Invites</p>
        <h2>LAN-Party Invite-Codes.</h2>
        <p className="muted">
          Wenn Felder leer bleiben, nutzt Hermes standardmäßig <strong>300</strong> Nutzungen und{" "}
          <strong>30 Tage</strong> Laufzeit.
        </p>
        <form onSubmit={createInviteCode} className="admin-form inline-form">
          <label>
            Name
            <input
              value={newInvite.label}
              onChange={(event) => setNewInvite({ ...newInvite, label: event.target.value })}
              placeholder="LAN Party April"
              required
            />
          </label>
          <label>
            Max. Nutzungen
            <input
              type="number"
              min={1}
              max={500}
              value={newInvite.maxUses}
              onChange={(event) => setNewInvite({ ...newInvite, maxUses: event.target.value })}
              placeholder="300"
            />
          </label>
          <label>
            Gültig bis
            <input
              type="datetime-local"
              value={newInvite.expiresAt}
              onChange={(event) => setNewInvite({ ...newInvite, expiresAt: event.target.value })}
              placeholder="30 Tage"
            />
          </label>
          <button type="submit">Invite erstellen</button>
        </form>
        <div className="invite-list">
          {inviteCodes.map((invite) => (
            <article className="invite-row" key={invite.id}>
              <div>
                <strong>{invite.label}</strong>
                <code>{invite.code}</code>
                <span>
                  {invite.usedCount} / {invite.maxUses ?? "∞"} genutzt
                  {invite.expiresAt
                    ? ` · gültig bis ${new Date(invite.expiresAt).toLocaleString("de-DE")}`
                    : ""}
                  {invite.revokedAt ? " · deaktiviert" : ""}
                </span>
                <div className="form-grid">
                  <label>
                    Label
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
                    Max. Nutzungen (leer = ∞)
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
                    Gültig bis (leer = nie)
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
                  Speichern
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => deactivateInviteCode(invite)}
                  disabled={Boolean(invite.revokedAt)}
                >
                  Deaktivieren
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => reactivateInviteCode(invite)}
                  disabled={!invite.revokedAt}
                >
                  Reaktivieren
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => deleteUnusedInviteCode(invite)}
                >
                  Löschen
                </button>
              </div>
            </article>
          ))}
          {inviteCodes.length === 0 ? (
            <article className="invite-row">
              <strong>Noch keine Invite-Codes.</strong>
              <span>Neue Registrierungen brauchen einen aktiven Code.</span>
            </article>
          ) : null}
        </div>
      </section>
      </div>

      <div className="admin-section">
      <section id="admin-audit" className="audit-panel" aria-label="Audit-Log">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Audit</p>
            <h2>Letzte Aktionen.</h2>
            <p className="muted">
              Das Audit-Log hilft dir beim Nachvollziehen von Änderungen, wenn Invite-, User- oder
              Restore-Aktionen später geprüft werden müssen.
            </p>
          </div>
          <button type="button" className="secondary" onClick={() => loadAdminData()}>
            Aktualisieren
          </button>
        </div>
        <div className="audit-list">
          {auditLogs.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString("de-DE")}
              </time>
              <strong>{entry.summary}</strong>
              <span>{[entry.action, entry.actorUsername ?? "System"].filter(Boolean).join(" | ")}</span>
            </article>
          ))}
          {auditLogs.length === 0 ? (
            <article className="audit-row">
              <strong>Noch keine Audit-Einträge.</strong>
              <span>Neue Aktionen erscheinen hier nach dem Speichern.</span>
            </article>
          ) : null}
        </div>
      </section>
      </div>
    </section>
  );
}
