import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "HEARING",
  "TEXT_REVIEW",
  "IMAGE_RUNNING",
  "IMAGE_ERROR",
  "ART_REVIEW",
  "PDF_RUNNING",
  "PDF_ERROR",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED"
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const draftSchema = z.object({
  title: z.string().min(1).max(40),
  contents: z.string().min(1).max(300),
  image_brief: z.string().min(1).max(500)
});

export const sessionViewSchema = z.object({
  session_id: z.string(),
  version: z.number().int().nonnegative(),
  status: sessionStatusSchema,
  question_count: z.number().int().min(0).max(5),
  question: z.object({ id: z.string(), text: z.string() }).nullable(),
  draft: z.object({
    revision_id: z.string(),
    title: z.string(),
    contents: z.string(),
    image_brief: z.string(),
    approved: z.boolean()
  }).nullable(),
  artwork: z.object({
    artifact_id: z.string(),
    preview_url: z.literal("/api/image/current")
  }).nullable(),
  artwork_choice: z.enum(["pending", "generated", "none"]),
  job: z.null(),
  pdf_ready: z.boolean(),
  last_error: z.null(),
  expires_at: z.string()
});

export type SessionView = z.infer<typeof sessionViewSchema>;
