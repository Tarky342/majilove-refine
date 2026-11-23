import { describe, expect, it } from "vitest";
import { cardSetSchema, inputSetSchema, sessionViewSchema } from "../src/shared/schemas";
import { parseCard, parseCardSet } from "../src/worker/openai";
import { LETTER_LAYOUT_LIMITS, renderCardSetHtml, validateLetterLayout } from "../src/worker/render";
import { WRITING_PROMPT_V3, IMAGE_PROMPT_V3 } from "../src/worker/prompts";

const entries = ["joy", "anger", "sadness", "fun"].map((emotion) => ({ emotion, note: "本人の本音", scene: "", wish: "" }));
const cards = entries.map((entry) => ({ ...entry, title: "気持ち", contents: "伝えたい気持ち", image_brief: "文字のない絵" }));

describe("v2 contracts", () => {
  it("requires exactly four ordered inputs and cards", () => {
    expect(inputSetSchema.safeParse({ consent_to_ai: true, entries }).success).toBe(true);
    expect(cardSetSchema.safeParse({ cards }).success).toBe(true);
    expect(cardSetSchema.safeParse({ cards: cards.slice(0, 3) }).success).toBe(false);
  });
  it("accepts a v2 snapshot and rejects the hearing state", () => {
    const snapshot = { schema_version: 2, session_id: "s", version: 1, status: "INPUT", inputs: entries, card_set: null, images: ["joy", "anger", "sadness", "fun"].map((emotion) => ({ emotion, status: "pending", preview_url: null })), pdf_ready: false, jobs: [], last_error: null, expires_at: "2026-11-23T00:00:00.000Z" };
    expect(sessionViewSchema.safeParse(snapshot).success).toBe(true);
    expect(sessionViewSchema.safeParse({ ...snapshot, status: "HEARING" }).success).toBe(false);
  });
});

describe("structured output and renderer", () => {
  it("parses complete and single cards", () => {
    expect(parseCardSet(JSON.stringify({ cards })).cards).toHaveLength(4);
    expect(parseCard(JSON.stringify({ card: cards[0] })).emotion).toBe("joy");
  });
  it("keeps the fixed layout limits and four pages", () => {
    expect(LETTER_LAYOUT_LIMITS).toEqual({ title: 24, contents: 60 });
    expect(validateLetterLayout("気持ち", "本文")).toBe(true);
    const html = renderCardSetHtml(cards, { joy: "data:image/svg+xml,x", anger: "data:image/svg+xml,x", sadness: "data:image/svg+xml,x", fun: "data:image/svg+xml,x" });
    expect((html.match(/class="letter-page"/g) ?? []).length).toBe(4);
    expect(html).toContain("@page{size:A4 portrait");
  });
  it("does not include the retired hearing prompt", () => {
    expect(WRITING_PROMPT_V3).toContain("質問やヒアリングはしない");
    expect(IMAGE_PROMPT_V3).toContain("文字");
  });
});
