import { z } from "zod";

/** Ablauf eines Events: geplant -> läuft -> beendet. Beendete Events sind abgeschlossen. */
export const mainEventStatusSchema = z.enum(["planned", "running", "ended"]);

export type MainEventStatus = z.infer<typeof mainEventStatusSchema>;

/** Öffentliche Events sieht jeder, private nur Eingeladene sowie Manager und Admins. */
export const mainEventVisibilitySchema = z.enum(["public", "private"]);

const optionalIso = z.string().datetime().nullable().optional();

/** null = unbegrenzt viele Plätze. */
const optionalCapacity = z.number().int().min(1).max(10000).nullable().optional();

/**
 * Anmeldung zum Event. „waitlisted" (Nachrücker) wählt niemand selbst: wer zusagt, obwohl das
 * Event voll ist, kommt auf die Nachrückerliste und rückt automatisch nach, sobald ein Platz frei wird.
 */
export const mainEventParticipationStatusSchema = z.enum(["joined", "interested", "waitlisted", "declined"]);
export const mainEventParticipationRequestSchema = z.object({
  status: z.enum(["joined", "interested", "declined"])
});

export type MainEventParticipationStatus = z.infer<typeof mainEventParticipationStatusSchema>;
export type RequestedMainEventParticipation = z.infer<typeof mainEventParticipationRequestSchema>["status"];

export const mainEventInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).nullable().optional(),
    visibility: mainEventVisibilitySchema.optional(),
    plannedStartAt: optionalIso,
    plannedEndAt: optionalIso,
    maxParticipants: optionalCapacity,
    registrationDeadline: optionalIso
  })
  .superRefine((value, context) => {
    if (
      value.plannedStartAt &&
      value.plannedEndAt &&
      new Date(value.plannedEndAt).getTime() < new Date(value.plannedStartAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "plannedEndAt must not be before plannedStartAt",
        path: ["plannedEndAt"]
      });
    }
  });

export const mainEventUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  visibility: mainEventVisibilitySchema.optional(),
  plannedStartAt: optionalIso,
  plannedEndAt: optionalIso,
  maxParticipants: optionalCapacity,
  registrationDeadline: optionalIso,
  /** 0031: geplante Erinnerungen ein/aus. */
  remindersEnabled: z.boolean().optional()
});

export const mainEventInviteSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).min(1).max(500)
});

export type MainEventInput = z.infer<typeof mainEventInputSchema>;

/** Runden können nur geplanten oder laufenden Events zugeordnet werden. */
export function acceptsRounds(status: MainEventStatus) {
  return status !== "ended";
}

/** Zusatz für Push-Titel von Runden, die zu einem Event gehören: „Neue Runde · LAN Oktober“. */
export function withMainEventLabel(title: string, mainEventName: string | null | undefined) {
  return mainEventName ? `${title} · ${mainEventName}` : title;
}

/** Der Anmeldeschluss gilt nur vor dem Start; läuft das Event, kann man noch dazukommen. */
export function isRegistrationClosed(
  event: { status: MainEventStatus; registrationDeadline: string | null },
  now: Date = new Date()
) {
  return (
    event.status === "planned" &&
    Boolean(event.registrationDeadline) &&
    now.getTime() > new Date(event.registrationDeadline!).getTime()
  );
}

/** Welchen Status bekommt eine Zusage? Ist das Event voll, wird man Nachrücker. */
export function resolveParticipationStatus(input: {
  requested: RequestedMainEventParticipation;
  previous: MainEventParticipationStatus | null;
  joinedCount: number;
  maxParticipants: number | null;
  /** Wartende Nachrücker: Neue stellen sich hinten an, statt einen Platz vorbei an der Liste zu nehmen. */
  waitlistCount?: number;
}): MainEventParticipationStatus {
  if (input.requested !== "joined") {
    return input.requested;
  }
  if (input.previous === "joined") {
    return "joined";
  }
  if (input.maxParticipants === null) {
    return "joined";
  }
  if (input.previous === "waitlisted") {
    return "waitlisted";
  }
  if (input.joinedCount >= input.maxParticipants || (input.waitlistCount ?? 0) > 0) {
    return "waitlisted";
  }
  return "joined";
}

/** Wert für eine CSV-Zelle: Anführungszeichen verdoppeln und Formeln entschärfen (CSV-Injection). */
export function csvCell(value: string | number | null | undefined) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
