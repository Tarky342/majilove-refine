import { z } from "zod";

export const emotions = ["joy", "anger", "sadness", "fun"] as const;
export const emotionSchema = z.enum(emotions);
export type Emotion = z.infer<typeof emotionSchema>;

export const sessionStatusSchema = z.enum([
  "INPUT", "TEXT_RUNNING", "TEXT_ERROR", "TEXT_REVIEW", "IMAGE_RUNNING",
  "IMAGE_ERROR", "PDF_RUNNING", "PDF_ERROR", "READY", "COMPLETED",
  "CANCELLED", "EXPIRED"
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const inputEntrySchema = z.object({
  emotion: emotionSchema,
  note: z.string().trim().min(1).max(1000),
  scene: z.string().trim().max(500).default(""),
  wish: z.string().trim().max(500).default("")
});

export const inputSetSchema = z.object({
  consent_to_ai: z.literal(true),
  entries: z.array(inputEntrySchema).length(4).superRefine((entries, ctx) => {
    const seen = new Set(entries.map((entry) => entry.emotion));
    if (seen.size !== 4 || emotions.some((emotion) => !seen.has(emotion))) {
      ctx.addIssue({ code: "custom", message: "喜怒哀楽の4感情を一度ずつ指定してください。" });
    }
  })
});
export type InputEntry = z.infer<typeof inputEntrySchema>;

export const cardSchema = z.object({
  emotion: emotionSchema,
  title: z.string().min(1).max(24),
  contents: z.string().min(1).max(60),
  image_brief: z.string().min(1).max(400)
});
export const cardSetSchema = z.object({
  cards: z.array(cardSchema).length(4).superRefine((cards, ctx) => {
    const actual = cards.map((card) => card.emotion);
    if (new Set(actual).size !== 4 || emotions.some((emotion, i) => actual[i] !== emotion)) {
      ctx.addIssue({ code: "custom", message: "カードは喜怒哀楽の順で4件必要です。" });
    }
  })
});
export type Card = z.infer<typeof cardSchema>;

export const imageViewSchema = z.object({
  emotion: emotionSchema,
  status: z.enum(["pending", "running", "ready", "failed"]),
  preview_url: z.string().nullable()
});

export const sessionViewSchema = z.object({
  schema_version: z.literal(2),
  session_id: z.string(),
  version: z.number().int().nonnegative(),
  status: sessionStatusSchema,
  inputs: z.array(inputEntrySchema).length(4),
  card_set: cardSetSchema.extend({ revision_id: z.string(), approved: z.boolean() }).nullable(),
  images: z.array(imageViewSchema).length(4),
  pdf_ready: z.boolean(),
  jobs: z.array(z.object({ id: z.string(), kind: z.enum(["text", "image", "pdf"]), emotion: emotionSchema.nullable(), status: z.string() })),
  last_error: z.object({ code: z.string(), emotion: emotionSchema.nullable(), retryable: z.boolean() }).nullable(),
  expires_at: z.string()
});
export type SessionView = z.infer<typeof sessionViewSchema>;
