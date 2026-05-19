import { tryWriteAuditLog } from "../audit-log";
import type { DatabaseContext } from "../db/client";
import {
  getS3CredentialSourcePresence,
  getS3LocationDetails,
  getStorageBackend,
  persistDatabaseSnapshot,
  RestoreValidationError,
  restoreDatabaseSnapshotIntoLive,
  toSafeBackupFailureSummary,
  toSafeRestoreDiagnostics
} from "../storage/s3-storage";

type Actor = { id: string; username: string } | undefined;

function adminName(admin: Actor) {
  return admin?.username ?? "Admin";
}

function writeConfigCheck(context: DatabaseContext, admin: Actor) {
  const backend = getStorageBackend(context.sqlite);
  const location = getS3LocationDetails(context.sqlite);
  const creds = getS3CredentialSourcePresence();

  tryWriteAuditLog(context, {
    actor: admin,
    action: "storage.config_check",
    entityType: "storage",
    entityId: "s3",
    summary: `${adminName(admin)} hat Storage-Konfiguration geprüft.`,
    metadata: {
      backend,
      location,
      credentialSource: {
        envAccessKeyPresent: creds.envAccessKeyPresent,
        envSecretPresent: creds.envSecretPresent,
        credsFileConfigured: creds.credsFileConfigured,
        credsFileExists: creds.credsFileExists
      }
    }
  });

  return { backend, location };
}

export type BackupResult =
  | { ok: true }
  | { ok: false; status: 500; error: "backup_fehlgeschlagen" };

export async function runBackup(context: DatabaseContext, admin: Actor): Promise<BackupResult> {
  const { backend, location } = writeConfigCheck(context, admin);

  tryWriteAuditLog(context, {
    actor: admin,
    action: "storage.backup_start",
    entityType: "storage",
    entityId: "s3",
    summary: `${adminName(admin)} hat ein S3-Backup gestartet.`
  });

  try {
    await persistDatabaseSnapshot(context.sqlite);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.backup_success",
      entityType: "storage",
      entityId: "s3",
      summary: `${adminName(admin)} hat ein S3-Backup erstellt.`
    });
    return { ok: true };
  } catch (error) {
    console.error("[Hermes] Failed to create admin backup", error);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.backup_failed",
      entityType: "storage",
      entityId: "s3",
      summary: `${adminName(admin)} konnte kein S3-Backup erstellen.`,
      metadata: {
        hint: toSafeBackupFailureSummary(error),
        backend,
        location
      }
    });
    return { ok: false, status: 500, error: "backup_fehlgeschlagen" };
  }
}

type RestoreSuccess = Awaited<ReturnType<typeof restoreDatabaseSnapshotIntoLive>>;
type RestoreDiagnostics = ReturnType<typeof toSafeRestoreDiagnostics>;

export type RestoreResult =
  | { ok: true; recovery: RestoreSuccess["recovery"] | null; restoredFrom: RestoreSuccess["restoredFrom"] | null }
  | { ok: false; status: 400 | 500; error: "restore_fehlgeschlagen"; diagnostics: RestoreDiagnostics };

export async function runRestore(context: DatabaseContext, admin: Actor): Promise<RestoreResult> {
  writeConfigCheck(context, admin);

  tryWriteAuditLog(context, {
    actor: admin,
    action: "storage.restore_start",
    entityType: "storage",
    entityId: "s3",
    summary: `${adminName(admin)} hat ein S3-Restore gestartet.`
  });

  try {
    const result = await restoreDatabaseSnapshotIntoLive(context.sqlite);
    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.restore_validated",
      entityType: "storage",
      entityId: "s3",
      summary: `${adminName(admin)} hat ein Restore validiert.`
    });
    if (result?.recovery) {
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_recovery_created",
        entityType: "storage",
        entityId: "s3",
        summary: `${adminName(admin)} hat ein Recovery-Snapshot erstellt.`,
        metadata: { recoveryId: result.recovery.id, recoveryKey: result.recovery.key }
      });
    }
    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.restore_completed",
      entityType: "storage",
      entityId: "s3",
      summary: `${adminName(admin)} hat ein S3-Restore abgeschlossen.`
    });
    return {
      ok: true,
      recovery: result?.recovery ?? null,
      restoredFrom: result?.restoredFrom ?? null
    };
  } catch (error) {
    console.error("[Hermes] Failed to restore admin backup", error);
    const diagnostics = toSafeRestoreDiagnostics(error);
    const kind = diagnostics.kind;

    if (kind !== "validation_failed") {
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_validated",
        entityType: "storage",
        entityId: "s3",
        summary: `${adminName(admin)} hat ein Restore validiert.`
      });
    }
    if (diagnostics.recovery) {
      tryWriteAuditLog(context, {
        actor: admin,
        action: "storage.restore_recovery_created",
        entityType: "storage",
        entityId: "s3",
        summary: `${adminName(admin)} hat ein Recovery-Snapshot erstellt.`,
        metadata: { recoveryId: diagnostics.recovery.id, recoveryKey: diagnostics.recovery.key }
      });
    }
    tryWriteAuditLog(context, {
      actor: admin,
      action: "storage.restore_failed",
      entityType: "storage",
      entityId: "s3",
      summary: `${adminName(admin)} konnte kein S3-Restore durchführen.`,
      metadata: {
        kind,
        summary: diagnostics.summary,
        snapshotKey: diagnostics.snapshot?.key ?? null,
        recoveryId: diagnostics.recovery?.id ?? null
      }
    });

    const status = error instanceof RestoreValidationError ? 400 : 500;
    return { ok: false, status, error: "restore_fehlgeschlagen", diagnostics };
  }
}
