import { describe, expect, it } from "vitest";
import { sessionViewSchema } from "../src/shared/schemas";
import { parseHearingResult, parseContentResult } from "../src/worker/openai";
import { LETTER_LAYOUT_LIMITS, renderLetterHtml, validateLetterLayout } from "../src/worker/render";
import { HEARING_PROMPT_V2, WRITING_PROMPT_V2, IMAGE_PROMPT_V2 } from "../src/worker/prompts";

describe("SessionView contract", () => {
  it("accepts a hearing snapshot", () => {
    const result = sessionViewSchema.safeParse({
      session_id: "s_test",
      version: 1,
      status: "HEARING",
      question_count: 0,
      question: null,
      draft: null,
      artwork: null,
      artwork_choice: "pending",
      job: null,
      pdf_ready: false,
      last_error: null,
      expires_at: "2026-11-23T00:00:00.000Z"
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown states", () => {
    const result = sessionViewSchema.safeParse({
      session_id: "s_test",
      version: 1,
      status: "UNKNOWN",
      question_count: 0,
      question: null,
      draft: null,
      artwork: null,
      artwork_choice: "pending",
      job: null,
      pdf_ready: false,
      last_error: null,
      expires_at: "2026-11-23T00:00:00.000Z"
    });
    expect(result.success).toBe(false);
  });
});

describe("OpenAI structured output", () => {
  it("accepts a valid hearing result", () => {
    expect(parseHearingResult(JSON.stringify({
      next_action: "ask",
      question: "何を一番伝えたいですか？",
      summary: "感謝",
      key_facts: ["いつも話を聞いてくれる"],
      tone: "やさしい"
    })).next_action).toBe("ask");
  });

  it("rejects invalid JSON and incomplete content", () => {
    expect(() => parseHearingResult("{")).toThrow();
    expect(() => parseContentResult(JSON.stringify({
      title: "",
      contents: "本文",
      image_brief: "花"
    }))).toThrow();
  });
});

describe("Letter A4 renderer", () => {
  it("uses title and body limits that preserve the fixed layout", () => {
    expect(LETTER_LAYOUT_LIMITS.title).toBe(24);
    expect(LETTER_LAYOUT_LIMITS.contents).toBe(60);
    expect(validateLetterLayout("ありがとう", "いつも話を聞いてくれてありがとう。")).toBe(true);
  });

  it("rejects oversized text and renders HTML overlay classes", () => {
    expect(validateLetterLayout("a".repeat(25), "本文")).toBe(false);
    expect(validateLetterLayout("タイトル", "a".repeat(61))).toBe(false);
    const html = renderLetterHtml("ありがとう", "いつも話を聞いてくれてありがとう。", null, "minimal");
    expect(html).toContain("class=\"letter-title\"");
    expect(html).toContain("class=\"letter-body\"");
    expect(html).toContain("class=\"letter-artwork letter-artwork-empty\"");
    expect(html).toContain("@page { size: A4 portrait; margin: 0; }");
  });
});

describe("Prompt versions", () => {
  it("uses the v2 service prompts", () => {
    expect(HEARING_PROMPT_V2).toContain("hearing-v2");
    expect(WRITING_PROMPT_V2).toContain("writing-v2");
    expect(IMAGE_PROMPT_V2).toContain("image-v2");
  });
});
