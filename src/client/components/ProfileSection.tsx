import React, { FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";

interface ProfileSectionProps {
  displayNameDraft: string;
  localeDraft: "" | "de" | "en";
  emailDraft: string;
  emailVerifyCode: string;
  busy: boolean;
  onDisplayNameChange: (value: string) => void;
  onLocaleChange: (value: "" | "de" | "en") => void;
  onEmailChange: (value: string) => void;
  onEmailVerifyCodeChange: (value: string) => void;
  onUpdateProfile: (event: FormEvent<HTMLFormElement>) => void;
  onRequestEmailChange: (event: FormEvent<HTMLFormElement>) => void;
  onVerifyEmailChange: (event: FormEvent<HTMLFormElement>) => void;
}

export function ProfileSection({
  displayNameDraft,
  localeDraft,
  emailDraft,
  emailVerifyCode,
  busy,
  onDisplayNameChange,
  onLocaleChange,
  onEmailChange,
  onEmailVerifyCodeChange,
  onUpdateProfile,
  onRequestEmailChange,
  onVerifyEmailChange
}: ProfileSectionProps) {
  const { t } = useI18n();

  return (
    <section className="device-panel" aria-label={t("loginProfile.profileSectionAria")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{t("loginProfile.profileEyebrow")}</p>
          <h3>{t("loginProfile.profileTitle")}</h3>
          <p className="muted">{t("loginProfile.profileHelp")}</p>
        </div>
      </div>

      <form onSubmit={onUpdateProfile} className="admin-form">
        <label>
          {t("loginProfile.displayName")}
          <input
            value={displayNameDraft}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            required
          />
        </label>
        <label>
          {t("loginProfile.localeLabel")}
          <select
            value={localeDraft}
            onChange={(event) => onLocaleChange(event.target.value as "" | "de" | "en")}
          >
            <option value="">{t("loginProfile.localeAuto")}</option>
            <option value="de">{t("loginProfile.locale.de")}</option>
            <option value="en">{t("loginProfile.locale.en")}</option>
          </select>
        </label>
        <p className="muted">{t("loginProfile.localeHelp")}</p>
        <button type="submit" disabled={busy}>
          {t("loginProfile.saveProfile")}
        </button>
      </form>

      <form onSubmit={onRequestEmailChange} className="admin-form">
        <label>
          {t("loginProfile.newEmail")}
          <input
            type="email"
            value={emailDraft}
            onChange={(event) => onEmailChange(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {t("loginProfile.sendEmailCode")}
        </button>
      </form>

      <form onSubmit={onVerifyEmailChange} className="admin-form">
        <label>
          {t("loginProfile.emailCode")}
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            value={emailVerifyCode}
            onChange={(event) => onEmailVerifyCodeChange(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {t("loginProfile.confirmEmail")}
        </button>
      </form>
    </section>
  );
}
