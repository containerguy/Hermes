import React, { FormEvent } from "react";
import type { InviteCode } from "../types/core";
import { useI18n } from "../i18n/I18nContext";

type InviteDraft = { label: string; maxUses: string; expiresAt: string };
type InviteDraftMap = Record<string, InviteDraft>;

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface AdminPanelInvitesProps {
  inviteCodes: InviteCode[];
  newInvite: { label: string; maxUses: string; expiresAt: string };
  inviteDrafts: InviteDraftMap;
  dateTag: string;
  onNewInviteChange: (next: { label: string; maxUses: string; expiresAt: string }) => void;
  onInviteDraftsChange: (next: InviteDraftMap) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (invite: InviteCode) => void;
  onDeactivate: (invite: InviteCode) => void;
  onReactivate: (invite: InviteCode) => void;
  onDeleteUnused: (invite: InviteCode) => void;
}

export function AdminPanelInvites({
  inviteCodes,
  newInvite,
  inviteDrafts,
  dateTag,
  onNewInviteChange,
  onInviteDraftsChange,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  onDeleteUnused
}: AdminPanelInvitesProps) {
  const { t } = useI18n();

  return (
    <section id="admin-invites" className="invite-panel" aria-label={t("admin.invites.sectionAria")}>
      <p className="eyebrow">{t("main.admin.nav.invites")}</p>
      <h2>{t("admin.invites.title")}</h2>
      <p className="muted">{t("admin.invites.help")}</p>
      <form onSubmit={onCreate} className="admin-form inline-form">
        <label>
          {t("admin.invites.fieldName")}
          <input
            value={newInvite.label}
            onChange={(event) => onNewInviteChange({ ...newInvite, label: event.target.value })}
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
            onChange={(event) => onNewInviteChange({ ...newInvite, maxUses: event.target.value })}
            placeholder={t("admin.invites.placeholderMax")}
          />
        </label>
        <label>
          {t("admin.invites.fieldExpires")}
          <input
            type="datetime-local"
            value={newInvite.expiresAt}
            onChange={(event) => onNewInviteChange({ ...newInvite, expiresAt: event.target.value })}
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
                      onInviteDraftsChange({
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
                      onInviteDraftsChange({
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
                      onInviteDraftsChange({
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
              <button type="button" className="secondary" onClick={() => onUpdate(invite)}>
                {t("admin.invites.save")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onDeactivate(invite)}
                disabled={Boolean(invite.revokedAt)}
              >
                {t("admin.invites.deactivate")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onReactivate(invite)}
                disabled={!invite.revokedAt}
              >
                {t("admin.invites.reactivate")}
              </button>
              <button
                type="button"
                className="secondary danger"
                onClick={() => onDeleteUnused(invite)}
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
  );
}
