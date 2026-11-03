import { z } from "zod";

/**
 * Logo in der Oberfläche. Seit der Umbenennung in Matchdesk gibt es nur noch das M;
 * gespeicherte Altwerte "hermes" (H-Logo) werden beim Lesen auf "mitspiel" abgebildet.
 */
export const brandMarkSchema = z.preprocess(
  (value) => (value === "hermes" ? "mitspiel" : value),
  z.enum(["mitspiel"])
);

export type BrandMark = z.infer<typeof brandMarkSchema>;
