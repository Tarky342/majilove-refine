import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { SessionStatus, SessionView } from "../shared/schemas";
import { askHearing, createContent, createOpenAI, generateDecoration } from "./openai";

type Bindings = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: D1Database;
  R2?: R2Bucket;
  MOCK_MODE?: string;
  OPENAI_API_KEY?: string;
  API_KEY?: string;
  MODEL_TEXT?: string;
  MODEL_IMAGE?: string;
};

type Draft = {
  revision_id: string;
  title: string;
  contents: string;
  image_brief: string;
  approved: boolean;
};

type Session = {
  id: string;
  token_hash: string;
  version: number;
  status: SessionStatus;
  question_count: number;
  question: { id: string; text: string } | null;
  draft: Draft | null;
  artwork_choice: "pending" | "generated" | "none";
  artifact_id: string | null;
  pdf_ready: boolean;
  pdf: Uint8Array | null;
  expires_at: string;
  initial_message: string;
  questions: string[];
  style_id: "soft_watercolor" | "minimal" | "stars";
  artifact_bytes: Uint8Array | null;
};

const sessions = new Map<string, Session>();
const app = new Hono<{ Bindings: Bindings }>();

const initialSchema = z.object({
  initial_message: z.string().trim().min(1).max(1000),
  consent_to_ai: z.literal(true),
  style_id: z.enum(["soft_watercolor", "minimal", "stars"]).optional()
});

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function expiresAt(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionForCookie(c: Context<{ Bindings: Bindings }>): Promise<Session | null> {
  const cookie = c.req.header("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)letter_session=([^;]+)/);
  if (!match) return null;
  const hash = await sha256(decodeURIComponent(match[1]));
  for (const session of sessions.values()) {
    if (session.token_hash === hash) return session;
  }
  return null;
}

function expireIfNeeded(session: Session): boolean {
  if (Date.now() >= Date.parse(session.expires_at)) {
    session.status = "EXPIRED";
    return true;
  }
  return false;
}

function toView(session: Session): SessionView {
  return {
    session_id: session.id,
    version: session.version,
    status: session.status,
    question_count: session.question_count,
    question: session.question,
    draft: session.draft,
    artwork: session.artifact_id
      ? { artifact_id: session.artifact_id, preview_url: "/api/image/current" }
      : null,
    artwork_choice: session.artwork_choice,
    job: null,
    pdf_ready: session.pdf_ready,
    last_error: null,
    expires_at: session.expires_at
  };
}

function bump(session: Session): void {
  session.version += 1;
}

app.post("/api/sessions", zValidator("json", initialSchema), async (c) => {
  const existing = await sessionForCookie(c);
  if (existing) {
    return c.json({ error: { code: "SESSION_EXISTS", message: "既存セッションがあります。", retryable: false } }, 409);
  }
  const body = c.req.valid("json");
  const token = randomId("token");
  const session: Session = {
    id: randomId("s"),
    token_hash: await sha256(token),
    version: 1,
    status: "HEARING",
    question_count: 0,
    question: null,
    draft: null,
    artwork_choice: "pending",
    artifact_id: null,
    pdf_ready: false,
    pdf: null,
    expires_at: expiresAt(),
    initial_message: body.initial_message,
    questions: [],
    style_id: body.style_id ?? "soft_watercolor",
    artifact_bytes: null
  };
  sessions.set(session.id, session);
  c.header("Set-Cookie", `letter_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`);
  c.header("Cache-Control", "no-store");
  return c.json(toView(session), 201);
});

app.get("/api/sessions/current", async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  if (expireIfNeeded(session)) return c.json({ error: { code: "SESSION_EXPIRED", message: "セッションの期限が切れました。", retryable: false } }, 410);
  c.header("Cache-Control", "no-store");
  return c.json(toView(session));
});

app.post("/api/hearing/advance", zValidator("json", z.object({ expected_version: z.number().int(), idempotency_key: z.string().optional() })), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  if (expireIfNeeded(session)) return c.json({ error: { code: "SESSION_EXPIRED", message: "セッションの期限が切れました。", retryable: false } }, 410);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false }, status: session.status, current_version: session.version }, 409);
  if (session.status !== "HEARING") return c.json({ error: { code: "STATE_CONFLICT", message: "ヒアリング中ではありません。", retryable: false }, status: session.status, current_version: session.version }, 409);
  if (session.question) return c.json(toView(session));

  if (session.question_count >= 5) return generateDraft(c, session);

  if (c.env.MOCK_MODE !== "false") {
    session.question = {
      id: randomId("q"),
      text: session.question_count === 0
        ? "どんな気持ちを一番伝えたいですか？"
        : "伝えるうえで大切にしたい具体的な出来事や言葉はありますか？"
    };
    session.question_count += 1;
    bump(session);
    return c.json(toView(session));
  }

  const client = createOpenAI(c.env);
  if (!client) return c.json({ error: { code: "AI_NOT_CONFIGURED", message: "OpenAI APIキーが設定されていません。", retryable: false } }, 503);
  try {
    const result = await askHearing(
      client,
      c.env.MODEL_TEXT ?? "gpt-6.1-terra",
      session.initial_message,
      session.questions,
      session.question_count
    );
    if (result.next_action === "draft_ready") return generateDraft(c, session);
    if (session.question_count >= 5) return generateDraft(c, session);
    session.question = { id: randomId("q"), text: result.question };
    session.question_count += 1;
    bump(session);
    return c.json(toView(session));
  } catch {
    return c.json({ error: { code: "AI_PROVIDER_UNAVAILABLE", message: "AIから回答を取得できませんでした。再試行できます。", retryable: true }, status: session.status, current_version: session.version }, 502);
  }
});

app.post("/api/hearing/answer", zValidator("json", z.object({
  question_id: z.string(),
  answer: z.string().trim().min(1).max(1500),
  expected_version: z.number().int(),
  idempotency_key: z.string().optional()
})), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  if (expireIfNeeded(session)) return c.json({ error: { code: "SESSION_EXPIRED", message: "セッションの期限が切れました。", retryable: false } }, 410);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (!session.question || session.question.id !== body.question_id) return c.json({ error: { code: "QUESTION_CONFLICT", message: "保留中の質問と一致しません。", retryable: false } }, 409);
  session.questions.push(body.answer);
  session.question = null;
  bump(session);
  return c.json(toView(session));
});

app.post("/api/draft/generate", zValidator("json", z.object({ expected_version: z.number().int(), idempotency_key: z.string().optional() })), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  if (expireIfNeeded(session)) return c.json({ error: { code: "SESSION_EXPIRED", message: "セッションの期限が切れました。", retryable: false } }, 410);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (!["HEARING", "TEXT_REVIEW"].includes(session.status)) return c.json({ error: { code: "STATE_CONFLICT", message: "文章化できない状態です。", retryable: false } }, 409);
  return generateDraft(c, session);
});

async function generateDraft(c: Context<{ Bindings: Bindings }>, session: Session) {
  if (c.env.MOCK_MODE !== "false") {
    return generateMockDraft(c, session);
  }
  const client = createOpenAI(c.env);
  if (!client) return c.json({ error: { code: "AI_NOT_CONFIGURED", message: "OpenAI APIキーが設定されていません。", retryable: false } }, 503);
  try {
    const result = await createContent(
      client,
      c.env.MODEL_TEXT ?? "gpt-6.1-terra",
      session.initial_message,
      session.questions
    );
    session.draft = {
      revision_id: randomId("rev"),
      title: result.title,
      contents: result.contents,
      image_brief: result.image_brief,
      approved: false
    };
    session.status = "TEXT_REVIEW";
    bump(session);
    return c.json(toView(session));
  } catch {
    return c.json({ error: { code: "AI_PROVIDER_UNAVAILABLE", message: "文章案を作成できませんでした。再試行できます。", retryable: true }, status: session.status, current_version: session.version }, 502);
  }
}

function generateMockDraft(c: Context<{ Bindings: Bindings }>, session: Session) {
  const base = [session.initial_message, ...session.questions].filter(Boolean).join("\n");
  session.draft = {
    revision_id: randomId("rev"),
    title: "あなたへ伝えたいこと",
    contents: base.slice(0, 300),
    image_brief: "柔らかな淡色の花と余白。文字は描かない。",
    approved: false
  };
  session.status = "TEXT_REVIEW";
  bump(session);
  c.header("Cache-Control", "no-store");
  return c.json(toView(session));
}

app.patch("/api/draft", zValidator("json", z.object({
  title: z.string().trim().min(1).max(40),
  contents: z.string().trim().min(1).max(300),
  expected_version: z.number().int()
})), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (session.status !== "TEXT_REVIEW" || !session.draft) return c.json({ error: { code: "STATE_CONFLICT", message: "文章を編集できる状態ではありません。", retryable: false } }, 409);
  session.draft = { revision_id: randomId("rev"), title: body.title, contents: body.contents, image_brief: session.draft.image_brief, approved: false };
  session.artifact_id = null;
  session.artwork_choice = "pending";
  session.pdf_ready = false;
  bump(session);
  return c.json(toView(session));
});

app.post("/api/draft/approve", zValidator("json", z.object({
  content_revision_id: z.string(),
  expected_version: z.number().int(),
  idempotency_key: z.string().optional()
})), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (session.status !== "TEXT_REVIEW" || !session.draft || body.content_revision_id !== session.draft.revision_id) {
    return c.json({ error: { code: "REVISION_CONFLICT", message: "承認する文章と一致しません。", retryable: false } }, 409);
  }
  session.draft.approved = true;
  session.artifact_bytes = null;
  session.artifact_id = randomId("art");
  session.artwork_choice = "generated";

  if (c.env.MOCK_MODE !== "false") {
    session.status = "ART_REVIEW";
  } else {
    const client = createOpenAI(c.env);
    if (!client) {
      session.status = "IMAGE_ERROR";
      bump(session);
      return c.json({ error: { code: "AI_NOT_CONFIGURED", message: "画像生成用APIキーが設定されていません。画像なしで進めます。", retryable: false }, status: session.status, current_version: session.version }, 503);
    }
    try {
      const image = await generateDecoration(
        client,
        c.env.MODEL_IMAGE ?? "gpt-image-2.6-flare",
        session.draft.image_brief,
        session.style_id
      );
      session.artifact_bytes = image.bytes;
      session.status = "ART_REVIEW";
    } catch {
      session.status = "IMAGE_ERROR";
      session.artifact_id = null;
      session.artwork_choice = "pending";
    }
  }
  bump(session);
  return c.json(toView(session));
});

app.get("/api/image/current", async (c) => {
  const session = await sessionForCookie(c);
  if (!session || !session.artifact_id) return c.json({ error: { code: "NOT_FOUND", message: "画像はありません。", retryable: false } }, 404);
  c.header("Cache-Control", "no-store");
  if (session.artifact_bytes) {
    c.header("Content-Type", "image/png");
    const buffer = session.artifact_bytes.buffer.slice(session.artifact_bytes.byteOffset, session.artifact_bytes.byteOffset + session.artifact_bytes.byteLength) as ArrayBuffer;
    return c.body(buffer);
  }
  c.header("Content-Type", "image/svg+xml");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#f8f4ea"/><circle cx="150" cy="180" r="80" fill="#e7b7bd" opacity=".55"/><circle cx="430" cy="620" r="120" fill="#b8d4c8" opacity=".45"/><path d="M300 180 C370 300 370 470 300 620" fill="none" stroke="#8a6f64" stroke-width="3" opacity=".5"/></svg>`;
  return c.body(svg);
});

app.post("/api/image/approve", zValidator("json", z.object({
  artifact_id: z.string().nullable(),
  expected_version: z.number().int(),
  idempotency_key: z.string().optional()
})), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (session.status !== "ART_REVIEW" || !session.draft?.approved) return c.json({ error: { code: "STATE_CONFLICT", message: "見た目を承認できる状態ではありません。", retryable: false } }, 409);
  if (body.artifact_id && body.artifact_id !== session.artifact_id) return c.json({ error: { code: "REVISION_CONFLICT", message: "承認する画像と原稿が一致しません。", retryable: false } }, 409);
  if (body.artifact_id) session.artwork_choice = "generated";
  else {
    session.artwork_choice = "none";
    session.artifact_id = null;
  }
  session.status = "PDF_RUNNING";
  bump(session);
  await createMockPdf(session);
  session.status = "READY";
  session.pdf_ready = true;
  bump(session);
  return c.json(toView(session));
});

app.post("/api/image/skip", zValidator("json", z.object({ expected_version: z.number().int(), idempotency_key: z.string().optional() })), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (!["ART_REVIEW", "IMAGE_ERROR"].includes(session.status)) return c.json({ error: { code: "STATE_CONFLICT", message: "画像なしを選択できる状態ではありません。", retryable: false } }, 409);
  session.artifact_id = null;
  session.artwork_choice = "none";
  session.status = "ART_REVIEW";
  bump(session);
  return c.json(toView(session));
});

async function createMockPdf(session: Session): Promise<void> {
  const title = session.draft?.title ?? "手紙";
  const text = title.replace(/[^\x20-\x7E]/g, "?");
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  session.pdf = new TextEncoder().encode(pdf);
}

app.get("/api/download", async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  if (!["READY", "COMPLETED"].includes(session.status) || !session.pdf_ready || !session.pdf) {
    return c.json({ error: { code: "PDF_NOT_READY", message: "PDFはまだ完成していません。", retryable: false } }, 409);
  }
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", 'attachment; filename="letter.pdf"');
  c.header("Cache-Control", "no-store");
  const buffer = session.pdf.buffer.slice(session.pdf.byteOffset, session.pdf.byteOffset + session.pdf.byteLength) as ArrayBuffer;
  return c.body(buffer);
});

app.post("/api/complete", zValidator("json", z.object({ expected_version: z.number().int() })), async (c) => {
  const session = await sessionForCookie(c);
  if (!session) return c.json({ error: { code: "UNAUTHORIZED", message: "セッションがありません。", retryable: false } }, 403);
  const body = c.req.valid("json");
  if (body.expected_version !== session.version) return c.json({ error: { code: "VERSION_CONFLICT", message: "画面状態が更新されています。", retryable: false } }, 409);
  if (session.status !== "READY") return c.json({ error: { code: "STATE_CONFLICT", message: "完了できる状態ではありません。", retryable: false } }, 409);
  session.status = "COMPLETED";
  bump(session);
  return c.json(toView(session));
});

app.delete("/api/sessions/current", async (c) => {
  const session = await sessionForCookie(c);
  if (session) sessions.delete(session.id);
  c.header("Set-Cookie", "letter_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
});

app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "NOT_FOUND", message: "APIが見つかりません。", retryable: false } }, 404);
  return c.env.ASSETS?.fetch(c.req.raw) ?? c.text("ASSETS binding is not configured", 503);
});

export default app;
