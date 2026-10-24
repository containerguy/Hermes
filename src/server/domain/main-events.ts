import { z } from "zod";

/** Ablauf eines Events: geplant -> läuft -> beendet. Beendete Events sind abgeschlossen. */
export const mainEventStatusSchema = z.enum(["planned", "running", "ended"]);

export type MainEventStatus = z.infer<typeof mainEventStatusSchema>;

const optionalIso = z.string().datetime().nullable().optional();

export const mainEventInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(4000).nullable().optional(),
    plannedStartAt: optionalIso,
    plannedEndAt: optionalIso
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
  plannedStartAt: optionalIso,
  plannedEndAt: optionalIso
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
