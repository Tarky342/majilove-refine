import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { emotions, emotionSchema, inputSetSchema, cardSetSchema, type Card, type Emotion, type SessionStatus, type SessionView, type InputEntry } from "../shared/schemas";
import { createCardSet, createOpenAI, generateImage, regenerateCard } from "./openai";
import { renderCardSetHtml } from "./render";

type Bindings = { ASSETS: { fetch(request: Request): Promise<Response> }; DB?: D1Database; R2?: R2Bucket; BROWSER?: BrowserRun; MOCK_MODE?: string; OPENAI_API_KEY?: string; MODEL_TEXT?: string; MODEL_IMAGE?: string };
type ImageState = { emotion: Emotion; status: "pending" | "running" | "ready" | "failed"; bytes: Uint8Array | null; key: string | null };
type Session = {
  id: string; tokenHash: string; version: number; status: SessionStatus; inputs: InputEntry[];
  cards: Card[] | null; revisionId: string | null; approved: boolean; images: ImageState[];
  pdf: Uint8Array | null; pdfKey: string | null; lastError: { code: string; emotion: Emotion | null; retryable: boolean } | null; expiresAt: string;
};
const sessions = new Map<string, Session>();
const app = new Hono<{ Bindings: Bindings }>();
const mutationSchema = z.object({ expected_version: z.number().int(), idempotency_key: z.string().optional() });

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
function expiry() { return new Date(Date.now() + 86400000).toISOString(); }
async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function ordered<T extends { emotion: Emotion }>(items: T[]) { return emotions.map((emotion) => items.find((item) => item.emotion === emotion)!); }
function freshImages(): ImageState[] { return emotions.map((emotion) => ({ emotion, status: "pending", bytes: null, key: null })); }
async function current(c: Context<{ Bindings: Bindings }>) {
  const raw = c.req.header("Cookie")?.match(/(?:^|;\s*)letter_session=([^;]+)/)?.[1];
  if (!raw) return null;
  const tokenHash = await hash(decodeURIComponent(raw));
  const memory = [...sessions.values()].find((session) => session.tokenHash === tokenHash);
  if (memory) return memory;
  if (!c.env.DB) return null;
  const row = await c.env.DB.prepare("SELECT state_json FROM sessions WHERE token_hash = ? AND schema_version = 2").bind(tokenHash).first<{ state_json: string | null }>();
  if (!row?.state_json) return null;
  const restored = JSON.parse(row.state_json) as Session;
  restored.images = restored.images.map((image) => ({ ...image, bytes: null }));
  sessions.set(restored.id, restored);
  return restored;
}
async function persist(c: Context<{ Bindings: Bindings }>, session: Session) {
  if (!c.env.DB) return;
  const state = JSON.stringify({ ...session, pdf: null, images: session.images.map((image) => ({ ...image, bytes: null })) });
  await c.env.DB.prepare("UPDATE sessions SET status = ?, version = ?, updated_at = ?, schema_version = 2, state_json = ?, last_error_code = ? WHERE id = ?")
    .bind(session.status, session.version, new Date().toISOString(), state, session.lastError?.code ?? null, session.id).run();
}
function view(session: Session): SessionView {
  return {
    schema_version: 2, session_id: session.id, version: session.version, status: session.status,
    inputs: session.inputs, card_set: session.cards && session.revisionId ? { revision_id: session.revisionId, approved: session.approved, cards: session.cards } : null,
    images: session.images.map((image) => ({ emotion: image.emotion, status: image.status, preview_url: image.status === "ready" ? `/api/images/${image.emotion}` : null })),
    pdf_ready: Boolean(session.pdf || session.pdfKey), jobs: [], last_error: session.lastError, expires_at: session.expiresAt
  };
}
function error(c: Context, status: 400 | 403 | 404 | 409 | 410 | 502 | 503, code: string, message: string, retryable = false) {
  return c.json({ error: { code, message, retryable } }, status);
}
function guard(session: Session | null, c: Context) {
  if (!session) return error(c, 403, "UNAUTHORIZED", "セッションがありません。");
  if (Date.now() >= Date.parse(session.expiresAt)) { session.status = "EXPIRED"; return error(c, 410, "SESSION_EXPIRED", "セッションの期限が切れました。"); }
  return null;
}
function conflict(session: Session, body: { expected_version: number }, c: Context) {
  return body.expected_version !== session.version ? error(c, 409, "VERSION_CONFLICT", "画面状態が更新されています。") : null;
}
function mockCard(entry: InputEntry): Card {
  const labels: Record<Emotion, string> = { joy: "うれしかったこと", anger: "ひとこと欲しい", sadness: "聞いてほしい気持ち", fun: "笑い合う時間" };
  return { emotion: entry.emotion, title: labels[entry.emotion], contents: entry.note.slice(0, 60), image_brief: `${entry.emotion}の気持ちを表す、文字のない動物イラスト。` };
}
function mockPng(emotion: Emotion) {
  const colors: Record<Emotion, string> = { joy: "#f6c6d0", anger: "#e5a56d", sadness: "#b9d8e8", fun: "#c5e1a5" };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="430"><rect width="100%" height="100%" fill="#fffdf8"/><circle cx="300" cy="210" r="120" fill="${colors[emotion]}"/></svg>`;
  return new TextEncoder().encode(svg);
}
function mockPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R 9 0 R 12 0 R] /Count 4 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R >>", "<< /Length 0 >>\nstream\n\nendstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 10 0 R >>", "<< /Length 0 >>\nstream\n\nendstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 13 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"
  ];
  let text = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length; text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) text += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(text);
}
async function saveImage(c: Context<{ Bindings: Bindings }>, session: Session, image: ImageState, bytes: Uint8Array) {
  image.bytes = bytes; image.status = "ready";
  if (c.env.R2) { image.key = `sessions/${session.id}/images/${image.emotion}-${session.revisionId}.png`; await c.env.R2.put(image.key, bytes, { httpMetadata: { contentType: "image/png" } }); }
}
async function generateImages(c: Context<{ Bindings: Bindings }>, session: Session) {
  if (!session.cards || !session.approved) throw new Error("CARDS_NOT_APPROVED");
  session.status = "IMAGE_RUNNING"; session.lastError = null; session.version++;
  for (const image of session.images) {
    if (image.status === "ready") continue;
    image.status = "running";
    try {
      const bytes = c.env.MOCK_MODE !== "false" ? mockPng(image.emotion) : await (async () => {
        const client = createOpenAI(c.env); if (!client) throw new Error("AI_NOT_CONFIGURED");
        return (await generateImage(client, c.env.MODEL_IMAGE ?? "gpt-image-2.6-flare", image.emotion, session.cards!.find((card) => card.emotion === image.emotion)!.image_brief)).bytes;
      })();
      await saveImage(c, session, image, bytes);
    } catch { image.status = "failed"; session.status = "IMAGE_ERROR"; session.lastError = { code: "IMAGE_GENERATION_FAILED", emotion: image.emotion, retryable: true }; session.version++; return; }
  }
  session.status = "PDF_RUNNING"; session.version++;
}
async function generatePdf(c: Context<{ Bindings: Bindings }>, session: Session) {
  if (session.images.some((image) => image.status !== "ready")) throw new Error("IMAGES_NOT_READY");
  try {
    if (c.env.MOCK_MODE !== "false") session.pdf = mockPdf();
    else {
      if (!c.env.BROWSER) throw new Error("BROWSER_NOT_CONFIGURED");
      const data: Record<Emotion, string> = { joy: "", anger: "", sadness: "", fun: "" };
      for (const image of session.images) data[image.emotion] = `data:image/png;base64,${btoa(String.fromCharCode(...(image.bytes ?? new Uint8Array())))}`;
      const response = await c.env.BROWSER.quickAction("pdf", { html: renderCardSetHtml(session.cards!, data), pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true } });
      if (!response.ok) throw new Error(`BROWSER_HTTP_${response.status}`);
      session.pdf = new Uint8Array(await response.arrayBuffer());
      if (new TextDecoder().decode(session.pdf.slice(0, 5)) !== "%PDF-") throw new Error("INVALID_PDF");
    }
    if (c.env.R2 && session.pdf) { session.pdfKey = `sessions/${session.id}/pdf/${session.revisionId}.pdf`; await c.env.R2.put(session.pdfKey, session.pdf, { httpMetadata: { contentType: "application/pdf" } }); }
    session.status = "READY"; session.version++; session.lastError = null;
  } catch { session.status = "PDF_ERROR"; session.lastError = { code: "PDF_GENERATION_FAILED", emotion: null, retryable: true }; session.version++; }
}

app.post("/api/sessions", zValidator("json", inputSetSchema), async (c) => {
  if (await current(c)) return error(c, 409, "SESSION_EXISTS", "既存セッションがあります。");
  const body = c.req.valid("json"); const token = id("token");
  const session: Session = { id: id("s"), tokenHash: await hash(token), version: 1, status: "INPUT", inputs: ordered(body.entries), cards: null, revisionId: null, approved: false, images: freshImages(), pdf: null, pdfKey: null, lastError: null, expiresAt: expiry() };
  sessions.set(session.id, session);
  if (c.env.DB) await c.env.DB.prepare("INSERT INTO sessions (id, token_hash, status, created_at, updated_at, expires_at, version, consent_at, schema_version, state_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?)")
    .bind(session.id, session.tokenHash, session.status, new Date().toISOString(), new Date().toISOString(), session.expiresAt, session.version, new Date().toISOString(), JSON.stringify({ ...session, pdf: null, images: session.images.map((image) => ({ ...image, bytes: null })) })).run();
  c.header("Set-Cookie", `letter_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`); c.header("Cache-Control", "no-store"); return c.json(view(session), 201);
});
app.get("/api/sessions/current", async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; c.header("Cache-Control", "no-store"); return c.json(view(session!)); });
app.patch("/api/inputs", zValidator("json", inputSetSchema.extend({ expected_version: z.number().int() })), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse;
  session!.inputs = ordered(body.entries); session!.cards = null; session!.approved = false; session!.images = freshImages(); session!.status = "INPUT"; session!.version++; await persist(c, session!); return c.json(view(session!));
});
app.post("/api/cards/generate", zValidator("json", mutationSchema), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse;
  session!.status = "TEXT_RUNNING"; session!.version++;
  try { session!.cards = c.env.MOCK_MODE !== "false" ? ordered(session!.inputs.map(mockCard)) : ordered((await createCardSet(createOpenAI(c.env)!, c.env.MODEL_TEXT ?? "gpt-6.1-terra", session!.inputs)).cards); cardSetSchema.parse({ cards: session!.cards }); session!.revisionId = id("rev"); session!.approved = false; session!.status = "TEXT_REVIEW"; session!.version++; await persist(c, session!); return c.json(view(session!)); }
  catch { session!.status = "TEXT_ERROR"; session!.lastError = { code: "TEXT_GENERATION_FAILED", emotion: null, retryable: true }; session!.version++; await persist(c, session!); return error(c, 502, "TEXT_GENERATION_FAILED", "文章を生成できませんでした。", true); }
});
app.post("/api/cards/:emotion/regenerate", zValidator("json", mutationSchema), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const emotion = emotionSchema.parse(c.req.param("emotion")); const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse;
  if (session!.status !== "TEXT_REVIEW" || !session!.cards) return error(c, 409, "STATE_CONFLICT", "再生成できる状態ではありません。");
  try { const entry = session!.inputs.find((item) => item.emotion === emotion)!; const card = c.env.MOCK_MODE !== "false" ? mockCard(entry) : await regenerateCard(createOpenAI(c.env)!, c.env.MODEL_TEXT ?? "gpt-6.1-terra", entry); session!.cards = ordered(session!.cards.map((item) => item.emotion === emotion ? card : item)); session!.revisionId = id("rev"); session!.version++; await persist(c, session!); return c.json(view(session!)); } catch { return error(c, 502, "TEXT_GENERATION_FAILED", "文章を再生成できませんでした。", true); }
});
app.patch("/api/cards", zValidator("json", cardSetSchema.extend({ expected_version: z.number().int() })), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse; if (session!.status !== "TEXT_REVIEW") return error(c, 409, "STATE_CONFLICT", "文章を編集できる状態ではありません。");
  session!.cards = body.cards; session!.revisionId = id("rev"); session!.approved = false; session!.images = freshImages(); session!.pdf = null; session!.pdfKey = null; session!.version++; await persist(c, session!); return c.json(view(session!));
});
app.post("/api/cards/approve", zValidator("json", mutationSchema), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse; if (session!.status !== "TEXT_REVIEW" || !session!.cards) return error(c, 409, "STATE_CONFLICT", "承認できる文章がありません。");
  session!.approved = true; session!.images = freshImages(); session!.version++; await generateImages(c, session!); if (["PDF_RUNNING"].includes(session!.status)) await generatePdf(c, session!); await persist(c, session!); return c.json(view(session!));
});
app.post("/api/images/:emotion/retry", zValidator("json", mutationSchema), async (c) => {
  const session = await current(c); const denied = guard(session, c); if (denied) return denied; const emotion = emotionSchema.parse(c.req.param("emotion")); const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse; const image = session!.images.find((item) => item.emotion === emotion)!; image.status = "pending"; await generateImages(c, session!); if (["PDF_RUNNING"].includes(session!.status)) await generatePdf(c, session!); await persist(c, session!); return c.json(view(session!));
});
app.post("/api/pdf/retry", zValidator("json", mutationSchema), async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse; if (!session!.approved) return error(c, 409, "STATE_CONFLICT", "PDFを再試行できません。"); session!.status = "PDF_RUNNING"; await generatePdf(c, session!); await persist(c, session!); return c.json(view(session!)); });
app.get("/api/images/:emotion", async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; const image = session!.images.find((item) => item.emotion === c.req.param("emotion")); if (!image?.bytes && !(c.env.R2 && image?.key)) return error(c, 404, "NOT_FOUND", "画像がありません。"); if (image.bytes) { c.header("Content-Type", "image/png"); return c.body(image.bytes.buffer as ArrayBuffer); } const object = await c.env.R2!.get(image.key!); if (!object) return error(c, 404, "NOT_FOUND", "画像がありません。"); c.header("Content-Type", "image/png"); return c.body(await object.arrayBuffer()); });
app.get("/api/preview", async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; if (!session!.pdf && !session!.pdfKey) return error(c, 409, "PDF_NOT_READY", "PDFはまだ完成していません。"); return c.redirect("/api/download"); });
app.get("/api/download", async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; if (!["READY", "COMPLETED"].includes(session!.status)) return error(c, 409, "PDF_NOT_READY", "PDFはまだ完成していません。"); let bytes = session!.pdf; if (!bytes && c.env.R2 && session!.pdfKey) { const object = await c.env.R2.get(session!.pdfKey); if (object) bytes = new Uint8Array(await object.arrayBuffer()); } if (!bytes) return error(c, 503, "PDF_OBJECT_MISSING", "保存されたPDFが見つかりません。", true); c.header("Content-Type", "application/pdf"); c.header("Content-Disposition", 'attachment; filename="emotion-cards.pdf"'); c.header("Cache-Control", "no-store"); return c.body(bytes.buffer as ArrayBuffer); });
app.post("/api/complete", zValidator("json", z.object({ expected_version: z.number().int() })), async (c) => { const session = await current(c); const denied = guard(session, c); if (denied) return denied; const body = c.req.valid("json"); const conflictResponse = conflict(session!, body, c); if (conflictResponse) return conflictResponse; if (session!.status !== "READY") return error(c, 409, "STATE_CONFLICT", "完了できる状態ではありません。"); session!.status = "COMPLETED"; session!.version++; await persist(c, session!); return c.json(view(session!)); });
app.delete("/api/sessions/current", async (c) => { const session = await current(c); if (session) sessions.delete(session.id); c.header("Set-Cookie", "letter_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"); return c.body(null, 204); });
app.all("*", async (c) => c.req.path.startsWith("/api/") ? error(c, 404, "NOT_FOUND", "APIが見つかりません。") : c.env.ASSETS.fetch(c.req.raw));
export default app;
