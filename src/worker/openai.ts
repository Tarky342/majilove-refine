import OpenAI from "openai";
import { z } from "zod";

const hearingSchema = z.object({
  next_action: z.enum(["ask", "draft_ready"]),
  question: z.string(),
  summary: z.string(),
  key_facts: z.array(z.string()),
  tone: z.string()
});

const contentSchema = z.object({
  title: z.string().min(1).max(40),
  contents: z.string().min(1).max(300),
  image_brief: z.string().min(1).max(500)
});

export type HearingResult = z.infer<typeof hearingSchema>;
export type ContentResult = z.infer<typeof contentSchema>;

export function getOpenAIKey(env: { OPENAI_API_KEY?: string; API_KEY?: string }): string | undefined {
  return env.OPENAI_API_KEY ?? env.API_KEY;
}

export function createOpenAI(env: { OPENAI_API_KEY?: string; API_KEY?: string }): OpenAI | null {
  const apiKey = getOpenAIKey(env);
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export async function askHearing(
  client: OpenAI,
  model: string,
  initialMessage: string,
  answers: string[],
  questionCount: number
): Promise<HearingResult> {
  const response = await client.responses.create({
    model,
    instructions: "ユーザーの発言だけを根拠に、一度に一つだけ質問するか、十分な情報があれば文章化へ進む日本語の聞き取り担当です。質問数は最大5問です。返却JSON以外を出力しません。",
    input: JSON.stringify({
      initial_message: initialMessage,
      answers,
      question_count: questionCount,
      max_questions: 5
    }),
    text: {
      format: {
        type: "json_schema",
        name: "hearing_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            next_action: { type: "string", enum: ["ask", "draft_ready"] },
            question: { type: "string" },
            summary: { type: "string" },
            key_facts: { type: "array", items: { type: "string" } },
            tone: { type: "string" }
          },
          required: ["next_action", "question", "summary", "key_facts", "tone"]
        }
      }
    }
  });
  return hearingSchema.parse(JSON.parse(response.output_text));
}

export async function createContent(
  client: OpenAI,
  model: string,
  initialMessage: string,
  answers: string[]
): Promise<ContentResult> {
  const response = await client.responses.create({
    model,
    instructions: "与えられた事実だけを使い、日本語の恋人向け手紙と文字なし装飾指示を作ります。未提供の事実や相手の心理を創作しません。",
    input: JSON.stringify({ initial_message: initialMessage, answers }),
    text: {
      format: {
        type: "json_schema",
        name: "letter_content",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            contents: { type: "string" },
            image_brief: { type: "string" }
          },
          required: ["title", "contents", "image_brief"]
        }
      }
    }
  });
  return contentSchema.parse(JSON.parse(response.output_text));
}

export async function generateDecoration(
  client: OpenAI,
  model: string,
  imageBrief: string,
  styleId: string
): Promise<{ bytes: Uint8Array; mimeType: "image/png" }> {
  const response = await client.images.generate({
    model,
    prompt: `文字・タイポグラフィ・ロゴ・サインを一切描かない装飾イラスト。スタイル: ${styleId}。${imageBrief}`,
    size: "1024x1536",
    output_format: "png",
    n: 1
  });
  const base64 = response.data?.[0]?.b64_json;
  if (!base64) throw new Error("IMAGE_RESPONSE_MISSING");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: "image/png" };
}
