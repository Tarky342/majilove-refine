import { describe, expect, it } from "vitest";
import { sessionViewSchema } from "../src/shared/schemas";

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
