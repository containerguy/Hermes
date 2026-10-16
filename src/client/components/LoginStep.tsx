import React, { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";

interface LoginStepProps {
  step: "request" | "verify";
  username: string;
  code: string;
  deviceName: string;
  /** Name under which this browser is already known for the entered user (display only). */
  knownDeviceName: string | null;
  message: string;
  error: string;
  busy: boolean;
  publicRegistrationEnabled: boolean;
  onUsernameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onDeviceNameChange: (value: string) => void;
  onBackToRequest: () => void;
  onSwitchToRegister: () => void;
  onRequest: (event: FormEvent<HTMLFormElement>) => void;
  onVerify: (event: FormEvent<HTMLFormElement>) => void;
}

export function LoginStep({
  step,
  username,
  code,
  deviceName,
  knownDeviceName,
  message,
  error,
  busy,
  publicRegistrationEnabled,
  onUsernameChange,
  onCodeChange,
  onDeviceNameChange,
  onBackToRequest,
  onSwitchToRegister,
  onRequest,
  onVerify
}: LoginStepProps) {
  const { t } = useI18n();
  const [editDeviceName, setEditDeviceName] = useState(false);

  useEffect(() => {
    setEditDeviceName(false);
  }, [knownDeviceName]);

  const showDeviceNameField = !knownDeviceName || editDeviceName;

  return (
    <form onSubmit={step === "request" ? onRequest : onVerify}>
      <label>
        {t("login.field.username")}
        <input
          autoComplete="username"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          required
        />
      </label>
      {step === "verify" ? (
        <>
          <label>
            {t("login.field.code")}
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              required
            />
          </label>
          {showDeviceNameField ? (
            <>
              <label>
                {t("login.field.deviceName")}
                <input
                  placeholder={knownDeviceName ?? t("login.deviceName.placeholder")}
                  value={deviceName}
                  maxLength={120}
                  aria-describedby="login-device-name-hint"
                  onChange={(event) => onDeviceNameChange(event.target.value)}
                />
              </label>
              <p className="muted field-hint" id="login-device-name-hint">
                {t("login.deviceName.optionalHint")}
              </p>
            </>
          ) : (
            <div className="known-device-row">
              <p className="muted">{t("login.deviceName.known", { name: knownDeviceName ?? "" })}</p>
              <button type="button" className="secondary" onClick={() => setEditDeviceName(true)}>
                {t("login.deviceName.change")}
              </button>
            </div>
          )}
        </>
      ) : null}
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="action-row">
        {step === "verify" ? (
          <button type="button" className="secondary" onClick={onBackToRequest}>
            {t("login.back")}
          </button>
        ) : null}
        <button type="submit" disabled={busy}>
          {step === "request" ? t("login.sendCode") : t("login.signIn")}
        </button>
      </div>
      {publicRegistrationEnabled ? (
        <button type="button" className="secondary" onClick={onSwitchToRegister}>
          {t("login.register.cta")}
        </button>
      ) : null}
    </form>
  );
}
