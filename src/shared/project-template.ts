import { z } from "zod";

export const projectTemplateIds = ["lan_party", "table_tennis"] as const;
export type ProjectTemplateId = (typeof projectTemplateIds)[number];

export const projectTemplateSchema = z.enum(projectTemplateIds);
