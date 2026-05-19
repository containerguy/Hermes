import React, { FormEvent, RefObject } from "react";
import type { BulkImportFormat, BulkImportResult, User } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

interface NewUserDraft {
  username: string;
  email: string;
  role: User["role"];
}

interface BulkImportDraft {
  format: BulkImportFormat;
  source: string;
}

interface AdminPanelUsersProps {
  users: User[];
  currentUser: User | null;
  newUser: NewUserDraft;
  bulkImportDraft: BulkImportDraft;
  bulkImportPreview: BulkImportResult | null;
  bulkImportBusy: boolean;
  bulkImportCanCommit: boolean;
  usersExportImportRef: RefObject<HTMLInputElement | null>;
  bulkImportSummary: (result: BulkImportResult) => string;
  onNewUserChange: (next: NewUserDraft) => void;
  onBulkImportDraftChange: (next: BulkImportDraft) => void;
  onClearBulkImportPreview: () => void;
  onCreateUser: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateRole: (userId: string, role: User["role"]) => void;
  onDeleteUser: (user: User) => void;
  onDownloadJsonAttachment: (path: string, fallbackName: string) => void;
  onRunUsersExportImport: (file: File) => void;
  onPreviewBulkImport: (event: FormEvent<HTMLFormElement>) => void;
  onCommitBulkImport: () => void;
}

export function AdminPanelUsers({
  users,
  currentUser,
  newUser,
  bulkImportDraft,
  bulkImportPreview,
  bulkImportBusy,
  bulkImportCanCommit,
  usersExportImportRef,
  bulkImportSummary,
  onNewUserChange,
  onBulkImportDraftChange,
  onClearBulkImportPreview,
  onCreateUser,
  onUpdateRole,
  onDeleteUser,
  onDownloadJsonAttachment,
  onRunUsersExportImport,
  onPreviewBulkImport,
  onCommitBulkImport
}: AdminPanelUsersProps) {
  const { t } = useI18n();

  return (
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
            onClick={() => onDownloadJsonAttachment("/api/admin/users/export", "hermes-users.json")}
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
                onRunUsersExportImport(file);
              }
            }}
          />
        </div>
      </section>
      <form id="admin-users" onSubmit={onCreateUser} className="admin-form admin-user-create-form">
        <label>
          {t("login.field.username")}
          <input
            value={newUser.username}
            onChange={(event) => onNewUserChange({ ...newUser, username: event.target.value })}
            required
          />
        </label>
        <label>
          {t("login.field.email")}
          <input
            type="email"
            value={newUser.email}
            onChange={(event) => onNewUserChange({ ...newUser, email: event.target.value })}
            required
          />
        </label>
        <label>
          {t("main.hero.role")}
          <select
            value={newUser.role}
            onChange={(event) =>
              onNewUserChange({ ...newUser, role: event.target.value as User["role"] })
            }
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
        <form onSubmit={onPreviewBulkImport} className="admin-form" aria-label={t("admin.bulk.formAria")}>
          <label>
            {t("admin.bulk.format")}
            <select
              aria-label={t("admin.bulk.formatAria")}
              value={bulkImportDraft.format}
              onChange={(event) => {
                onBulkImportDraftChange({
                  format: event.target.value as BulkImportFormat,
                  source: bulkImportDraft.source
                });
                onClearBulkImportPreview();
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
                onBulkImportDraftChange({ ...bulkImportDraft, source: event.target.value });
                onClearBulkImportPreview();
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
            <button
              type="submit"
              disabled={bulkImportBusy || bulkImportDraft.source.trim().length === 0}
            >
              {t("admin.bulk.preview")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onCommitBulkImport()}
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
                <span>
                  {t("admin.bulk.summaryFormat", { fmt: bulkImportPreview.format.toUpperCase() })}
                </span>
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
              onChange={(event) => onUpdateRole(user.id, event.target.value as User["role"])}
            >
              <option value="user">{t("admin.role.user")}</option>
              <option value="organizer">{t("admin.role.organizer")}</option>
              <option value="manager">{t("admin.role.manager")}</option>
              <option value="admin">{t("admin.role.admin")}</option>
            </select>
            <button
              type="button"
              className="secondary danger"
              onClick={() => onDeleteUser(user)}
              disabled={user.id === currentUser?.id}
            >
              {t("admin.user.delete")}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
