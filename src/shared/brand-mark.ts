import { z } from "zod";

export const brandMarkSchema = z.enum(["hermes", "mitspiel"]);

export type BrandMark = z.infer<typeof brandMarkSchema>;
