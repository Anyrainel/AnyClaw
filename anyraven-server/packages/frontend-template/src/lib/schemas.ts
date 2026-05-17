import { z } from "zod";

export const TaskCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
});

export const PreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  language: z.string().default("en"),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
