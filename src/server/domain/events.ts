import { z } from "zod";

export const eventStatusSchema = z.enum(["open", "ready", "running", "cancelled", "archived"]);
export const startModeSchema = z.enum(["now", "scheduled"]);
export const participationStatusSchema = z.enum(["joined", "declined"]);

export type EventStatus = z.infer<typeof eventStatusSchema>;
export type StartMode = z.infer<typeof startModeSchema>;
export type ParticipationStatus = z.infer<typeof participationStatusSchema>;

export const eventInputSchema = z
  .object({
    gameTitle: z.string().trim().min(1).max(120),
    startMode: startModeSchema,
    startsAt: z.string().datetime().optional(),
    minPlayers: z.number().int().min(1).max(256),
    maxPlayers: z.number().int().min(1).max(256),
    serverHost: z.string().trim().max(160).optional(),
    connectionInfo: z.string().trim().max(2000).optional()
  })
  .superRefine((value, context) => {
    if (value.maxPlayers < value.minPlayers) {
      context.addIssue({
        code: "custom",
        message: "maxPlayers must be greater than or equal to minPlayers",
        path: ["maxPlayers"]
      });
    }

    if (value.startMode === "scheduled" && !value.startsAt) {
      context.addIssue({
        code: "custom",
        message: "startsAt is required for scheduled events",
        path: ["startsAt"]
      });
    }
  });

export type EventInput = z.infer<typeof eventInputSchema>;

type StatusInput = {
  status: EventStatus;
  startsAt: Date;
  joinedCount: number;
  minPlayers: number;
  now?: Date;
};

export function deriveEventStatus(input: StatusInput): EventStatus {
  if (input.status === "cancelled" || input.status === "archived") {
    return input.status;
  }

  const now = input.now ?? new Date();

  if (input.startsAt.getTime() <= now.getTime()) {
    return "running";
  }

  return input.joinedCount >= input.minPlayers ? "ready" : "open";
}

export function shouldAutoArchive(startsAt: Date, now = new Date(), archiveAfterHours = 8) {
  return now.getTime() >= startsAt.getTime() + archiveAfterHours * 60 * 60 * 1000;
}
