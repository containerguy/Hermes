import React, { FormEvent } from "react";
import { useI18n } from "../i18n/I18nContext";

interface RegisterStepProps {
  registration: { inviteCode: string; username: string; email: string };
  message: string;
  error: string;
  busy: boolean;
  onRegistrationChange: (next: { inviteCode: string; username: string; email: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}

export function RegisterStep({
  registration,
  message,
  error,
  busy,
  onRegistrationChange,
  onSubmit,
  onBack
}: RegisterStepProps) {
  const { t } = useI18n();

  return (
    <form onSubmit={onSubmit}>
      <label>
        {t("login.field.invite")}
        <input
          value={registration.inviteCode}
          onChange={(event) =>
            onRegistrationChange({ ...registration, inviteCode: event.target.value })
          }
          required
        />
      </label>
      <label>
        {t("login.field.username")}
        <input
          autoComplete="username"
          value={registration.username}
          onChange={(event) =>
            onRegistrationChange({ ...registration, username: event.target.value })
          }
          required
        />
      </label>
      <label>
        {t("login.field.email")}
        <input
          type="email"
          value={registration.email}
          onChange={(event) =>
            onRegistrationChange({ ...registration, email: event.target.value })
          }
          required
        />
      </label>
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="action-row">
        <button type="button" className="secondary" onClick={onBack}>
          {t("login.backToLogin")}
        </button>
        <button type="submit" disabled={busy}>
          {t("login.register.submit")}
        </button>
      </div>
    </form>
  );
}
