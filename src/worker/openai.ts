import OpenAI from "openai";
import { z } from "zod";
import { cardSchema, cardSetSchema, type Card, type Emotion, type InputEntry } from "../shared/schemas";
import { WRITING_PROMPT_V3, IMAGE_PROMPT_V3 } from "./prompts";

const singleCardSchema = z.object({ card: cardSchema });
export type CardSet = z.infer<typeof cardSetSchema>;

export function parseCardSet(text: string): CardSet {
  return cardSetSchema.parse(JSON.parse(text));
}

export function parseCard(text: string): Card {
  return singleCardSchema.parse(JSON.parse(text)).card;
}

export function createOpenAI(env: { OPENAI_API_KEY?: string }): OpenAI | null {
  return env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
}

const cardJsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    cards: {
      type: "array", minItems: 4, maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          emotion: { type: "string", enum: ["joy", "anger", "sadness", "fun"] },
          title: { type: "string", minLength: 1, maxLength: 24 },
          contents: { type: "string", minLength: 1, maxLength: 60 },
          image_brief: { type: "string", minLength: 1, maxLength: 400 }
        },
        required: ["emotion", "title", "contents", "image_brief"]
      }
    }
  },
  required: ["cards"]
} as const;

export async function createCardSet(client: OpenAI, model: string, entries: InputEntry[]): Promise<CardSet> {
  const response = await client.responses.create({
    model,
    instructions: WRITING_PROMPT_V3,
    input: JSON.stringify({ mode: "all", entries }),
    text: { format: { type: "json_schema", name: "card_set", strict: true, schema: cardJsonSchema } }
  });
  return parseCardSet(response.output_text);
}

export async function regenerateCard(client: OpenAI, model: string, entry: InputEntry): Promise<Card> {
  const response = await client.responses.create({
    model,
    instructions: WRITING_PROMPT_V3,
    input: JSON.stringify({ mode: "single", emotion: entry.emotion, entries: [entry] }),
    text: { format: { type: "json_schema", name: "card", strict: true, schema: {
      type: "object", additionalProperties: false,
      properties: { card: cardJsonSchema.properties.cards.items },
      required: ["card"]
    } } }
  });
  const card = parseCard(response.output_text);
  if (card.emotion !== entry.emotion) throw new Error("EMOTION_MISMATCH");
  return card;
}

export async function generateImage(
  client: OpenAI, model: string, emotion: Emotion, imageBrief: string
): Promise<{ bytes: Uint8Array; mimeType: "image/png" }> {
  const response = await client.images.generate({
    model,
    prompt: `${IMAGE_PROMPT_V3}\n対象感情: ${emotion}\nイメージ指示: ${imageBrief}`,
    size: "1536x1024", output_format: "png", n: 1
  });
  const base64 = response.data?.[0]?.b64_json;
  if (!base64) throw new Error("IMAGE_RESPONSE_MISSING");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a ||
      bytes[6] !== 0x1a || bytes[7] !== 0x0a || bytes.length > 6 * 1024 * 1024) {
    throw new Error("INVALID_PNG");
  }
  return { bytes, mimeType: "image/png" };
}
