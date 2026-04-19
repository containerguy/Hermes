import type { AppLocale } from "../../shared/locale";

export const errorMessages: Record<string, string> = {
  admin_erforderlich: "Adminrechte erforderlich.",
  manager_erforderlich:
    "Zum Anlegen von Runden sind Manager-, Organisator- oder Adminrechte nötig.",
  backup_fehlgeschlagen: "Backup konnte nicht erstellt werden. Prüfe S3-Konfiguration und Logs.",
  csrf_token_ungueltig: "Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.",
  device_key_required: "Dieses Gerät hat noch keinen Geräteschlüssel. Bitte Seite neu laden.",
  device_name_ungueltig: "Der Gerätename ist ungültig.",
  email_code_abgelehnt: "Der Bestätigungscode wurde abgelehnt.",
  email_existiert_bereits: "Diese E-Mail-Adresse wird bereits verwendet.",
  eigener_user_nicht_loeschbar: "Der eigene Admin-User kann nicht gelöscht werden.",
  import_blockiert: "Der Import hat blockierende Probleme. Bitte Vorschau prüfen und Daten korrigieren.",
  import_konnte_nicht_gespeichert_werden:
    "Der Bulk-Import konnte nicht gespeichert werden. Bitte Vorschau erneut laden und später noch einmal versuchen.",
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
    "Die ursprüngliche Sitzung ist abgelaufen. Auf dem anderen Gerät erneut anmelden und einen neuen QR-Code erzeugen.",
  pair_token_consumed: "Pairing-Code wurde bereits eingelöst. Bitte einen neuen QR-Code erzeugen.",
  pair_token_expired: "Pairing-Code ist abgelaufen. Bitte einen neuen QR-Code erzeugen.",
  pair_token_invalid: "Pairing-Code ist ungültig. Bitte einen neuen QR-Code erzeugen.",
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
  ungueltiger_import: "Importdaten sind ungültig. Bitte Format und Inhalt prüfen.",
  ungueltiger_invite_code: "Invite-Code ist ungültig.",
  ungueltiger_profilname: "Der Profilname ist ungültig.",
  ungueltiger_user: "Userdaten sind ungültig.",
  user_existiert_bereits: "Username oder E-Mail existiert bereits.",
  user_update_konflikt: "User konnte wegen eines Konflikts nicht gespeichert werden.",
  ungueltige_settings_import: "Einstellungen-Import ist ungültig.",
  ungueltiger_export_bundle: "User-Export-Paket ist ungültig.",
  nicht_angemeldet: "Nicht angemeldet.",
  mailversand_fehlgeschlagen: "Mailversand fehlgeschlagen.",
  code_abgelehnt: "Code abgelehnt.",
  event_voll: "Event ist voll.",
  kiosk_ungueltig: "Kiosk-Anzeige ist deaktiviert oder der Schlüssel in der URL ist ungültig."
};

export const errorMessagesEn: Record<string, string> = {
  admin_erforderlich: "Admin rights required.",
  manager_erforderlich: "Creating rounds requires manager, organizer, or admin permissions.",
  backup_fehlgeschlagen: "Backup could not be created. Check S3 configuration and logs.",
  csrf_token_ungueltig: "Security check failed. Reload the page and try again.",
  device_key_required: "This device has no device key yet. Please reload the page.",
  device_name_ungueltig: "The device name is invalid.",
  email_code_abgelehnt: "The confirmation code was rejected.",
  email_existiert_bereits: "This email address is already in use.",
  eigener_user_nicht_loeschbar: "You cannot delete your own admin user.",
  import_blockiert: "The import has blocking issues. Review the preview and fix the data.",
  import_konnte_nicht_gespeichert_werden:
    "The bulk import could not be saved. Reload the preview and try again later.",
  invite_abgelaufen: "This invite code has expired and cannot be reactivated.",
  invite_ausgeschoepft: "This invite code is already exhausted.",
  invite_code_custom_deaktiviert:
    "Custom invite codes are disabled. Hermes generates secure codes automatically.",
  invite_code_existiert: "This invite code already exists.",
  invite_hat_nutzungen: "This invite code already has uses and cannot be deleted.",
  invite_ungueltig: "This invite code is invalid or expired.",
  invite_code_nicht_gefunden: "Invite code not found.",
  invite_max_uses_unter_used_count: "Max uses cannot be below the already used count.",
  pair_origin_revoked:
    "The original session expired. Sign in again on the other device and create a new QR code.",
  pair_token_consumed: "Pairing code was already redeemed. Please create a new QR code.",
  pair_token_expired: "Pairing code expired. Please create a new QR code.",
  pair_token_invalid: "Pairing code is invalid. Please create a new QR code.",
  permission_abgelehnt: "Notification was denied by the browser.",
  push_nicht_konfiguriert: "Push is not configured on the server. VAPID keys are missing.",
  push_nicht_unterstuetzt:
    "Push is not supported in this browser or context. On plain HTTP LAN URLs Web Push usually needs HTTPS; localhost is the exception.",
  rate_limit_aktiv: "Too many attempts. Please wait briefly and try again.",
  request_failed: "Request failed.",
  registrierung_deaktiviert: "Public registration is currently disabled.",
  registrierung_fehlgeschlagen: "Registration failed.",
  restore_fehlgeschlagen: "Restore could not run. Check S3 configuration and logs.",
  teilnahme_fehlgeschlagen: "Participation could not be saved. Please try again.",
  session_nicht_gefunden: "Device not found.",
  secure_context_erforderlich:
    "Push needs HTTPS or localhost. On a normal HTTP LAN URL browsers disable Web Push.",
  ungueltige_registrierung: "Registration data is invalid.",
  ungueltige_settings: "Settings are invalid.",
  ungueltiger_import: "Import data is invalid. Check format and content.",
  ungueltiger_invite_code: "Invite code is invalid.",
  ungueltiger_profilname: "Profile data is invalid.",
  ungueltiger_user: "User data is invalid.",
  user_existiert_bereits: "Username or email already exists.",
  user_update_konflikt: "User could not be saved due to a conflict.",
  ungueltige_settings_import: "Settings import is invalid.",
  ungueltiger_export_bundle: "User export bundle is invalid.",
  nicht_angemeldet: "Not signed in.",
  mailversand_fehlgeschlagen: "Mail delivery failed.",
  code_abgelehnt: "Code rejected.",
  event_voll: "Event is full.",
  kiosk_ungueltig: "The kiosk display is disabled or the URL key is invalid."
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

export function getErrorMessage(caught: unknown, locale: AppLocale = "de") {
  const code = caught instanceof Error ? caught.message : "request_failed";
  if (locale === "en") {
    return errorMessagesEn[code] ?? errorMessages[code] ?? code;
  }
  return errorMessages[code] ?? code;
}
