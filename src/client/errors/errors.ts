export const errorMessages: Record<string, string> = {
  admin_erforderlich: "Adminrechte erforderlich.",
  backup_fehlgeschlagen: "Backup konnte nicht erstellt werden. Prüfe S3-Konfiguration und Logs.",
  csrf_token_ungueltig: "Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.",
  device_name_ungueltig: "Der Gerätename ist ungültig.",
  email_code_abgelehnt: "Der Bestätigungscode wurde abgelehnt.",
  email_existiert_bereits: "Diese E-Mail-Adresse wird bereits verwendet.",
  eigener_user_nicht_loeschbar: "Der eigene Admin-User kann nicht gelöscht werden.",
  invite_abgelaufen: "Dieser Invite-Code ist abgelaufen und kann nicht reaktiviert werden.",
  invite_ausgeschoepft: "Dieser Invite-Code ist bereits ausgeschöpft.",
  invite_code_custom_deaktiviert:
    "Eigene Invite-Codes sind deaktiviert. Hermes erstellt sichere Codes automatisch.",
  invite_code_existiert: "Dieser Invite-Code existiert bereits.",
  invite_hat_nutzungen: "Dieser Invite-Code hat bereits Nutzungen und kann nicht gelöscht werden.",
  invite_ungueltig: "Dieser Invite-Code ist ungültig oder abgelaufen.",
  invite_code_nicht_gefunden: "Invite-Code nicht gefunden.",
  invite_max_uses_unter_used_count:
    "Max. Nutzungen kann nicht unter die bereits genutzte Anzahl gesetzt werden.",
  pair_origin_revoked:
    "Die Quelle dieses Pairing-Links ist nicht mehr aktiv. Bitte lass einen neuen Link erstellen.",
  pair_token_consumed: "Dieser Pairing-Link wurde bereits benutzt. Bitte fordere einen neuen an.",
  pair_token_expired: "Dieser Pairing-Link ist abgelaufen. Bitte fordere einen neuen an.",
  pair_token_invalid: "Der Pairing-Link ist ungültig. Bitte fordere einen neuen an.",
  permission_abgelehnt: "Benachrichtigung wurde vom Browser abgelehnt.",
  push_nicht_konfiguriert: "Push ist serverseitig noch nicht konfiguriert. VAPID Keys fehlen.",
  push_nicht_unterstuetzt:
    "Push wird in diesem Browser oder Kontext nicht unterstützt. Auf LAN-HTTP-Adressen braucht Web Push normalerweise HTTPS; localhost ist die Ausnahme.",
  rate_limit_aktiv: "Zu viele Versuche. Bitte warte kurz und probiere es erneut.",
  request_failed: "Anfrage fehlgeschlagen.",
  registrierung_deaktiviert: "Öffentliche Registrierung ist derzeit deaktiviert.",
  registrierung_fehlgeschlagen: "Registrierung fehlgeschlagen.",
  restore_fehlgeschlagen: "Restore konnte nicht ausgeführt werden. Prüfe S3-Konfiguration und Logs.",
  teilnahme_fehlgeschlagen: "Teilnahme konnte gerade nicht gespeichert werden. Bitte erneut versuchen.",
  session_nicht_gefunden: "Gerät nicht gefunden.",
  secure_context_erforderlich:
    "Push benötigt HTTPS oder localhost. Über eine normale HTTP-LAN-Adresse deaktivieren Browser Web Push.",
  ungueltige_registrierung: "Registrierungsdaten sind ungültig.",
  ungueltige_settings: "Einstellungen sind ungültig.",
  ungueltiger_invite_code: "Invite-Code ist ungültig.",
  ungueltiger_profilname: "Der Profilname ist ungültig.",
  ungueltiger_user: "Userdaten sind ungültig.",
  user_existiert_bereits: "Username oder E-Mail existiert bereits.",
  user_update_konflikt: "User konnte wegen eines Konflikts nicht gespeichert werden."
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(input: { code: string; status: number; body: unknown }) {
    super(input.code);
    this.status = input.status;
    this.body = input.body;
  }
}

export function getErrorMessage(caught: unknown) {
  const code = caught instanceof Error ? caught.message : "request_failed";
  return errorMessages[code] ?? code;
}

