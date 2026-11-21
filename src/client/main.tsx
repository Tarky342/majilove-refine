import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SessionView = {
  session_id: string;
  version: number;
  status: string;
  question_count: number;
  question: { id: string; text: string } | null;
  draft: { revision_id: string; title: string; contents: string; image_brief: string; approved: boolean } | null;
  artwork: { artifact_id: string; preview_url: string } | null;
  artwork_choice: "pending" | "generated" | "none";
  pdf_ready: boolean;
  expires_at: string;
};

async function api(path: string, init?: RequestInit): Promise<{ view?: SessionView; response: Response }> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (response.status === 204) return { response };
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? "処理に失敗しました。"), data);
  return { view: data as SessionView, response };
}

function App() {
  const [view, setView] = useState<SessionView | null>(null);
  const [initial, setInitial] = useState("");
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState("");
  const [title, setTitle] = useState("");
  const [contents, setContents] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/sessions/current");
      if (response.status === 403) return;
      if (!response.ok) throw new Error("セッションを復元できませんでした。");
      setView(await response.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました。");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (view?.draft) {
      setTitle(view.draft.title);
      setContents(view.draft.contents);
    }
  }, [view?.draft?.revision_id]);

  async function start() {
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ initial_message: initial, consent_to_ai: consent })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function advance() {
    if (!view) return;
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/hearing/advance", {
        method: "POST",
        body: JSON.stringify({ expected_version: view.version, idempotency_key: crypto.randomUUID() })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function submitAnswer() {
    if (!view?.question) return;
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/hearing/answer", {
        method: "POST",
        body: JSON.stringify({
          question_id: view.question.id,
          answer,
          expected_version: view.version,
          idempotency_key: crypto.randomUUID()
        })
      });
      setAnswer("");
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "回答を保存できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function generateDraft() {
    if (!view) return;
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/draft/generate", {
        method: "POST",
        body: JSON.stringify({ expected_version: view.version, idempotency_key: crypto.randomUUID() })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文章を作成できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    if (!view) return;
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/draft", {
        method: "PATCH",
        body: JSON.stringify({ title, contents, expected_version: view.version })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文章を保存できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function approveDraft() {
    if (!view?.draft) return;
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/draft/approve", {
        method: "POST",
        body: JSON.stringify({
          content_revision_id: view.draft.revision_id,
          expected_version: view.version,
          idempotency_key: crypto.randomUUID()
        })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function approveArtwork() {
    if (!view) return;
    setLoading(true);
    setError("");
    try {
      const artifactId = view.artwork?.artifact_id ?? null;
      const result = await api("/api/image/approve", {
        method: "POST",
        body: JSON.stringify({ artifact_id: artifactId, expected_version: view.version, idempotency_key: crypto.randomUUID() })
      });
      setView(result.view ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDFを作成できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    await api("/api/sessions/current", { method: "DELETE" });
    setView(null);
  }

  async function complete() {
    if (!view) return;
    setLoading(true);
    try {
      const result = await api("/api/complete", {
        method: "POST",
        body: JSON.stringify({ expected_version: view.version })
      });
      setView(result.view ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">LOVE LETTER PDF</p>
        <h1>彼氏に伝えたいことは？</h1>
      </header>
      {error && <div className="error" role="alert">{error}</div>}

      {!view && (
        <section className="card">
          <label htmlFor="initial">伝えたいこと</label>
          <textarea id="initial" value={initial} onChange={(e) => setInitial(e.target.value)} maxLength={1000} placeholder="自然な言葉で書いてください" />
          <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />この内容をAIで処理することに同意します</label>
          <button disabled={loading || !consent || !initial.trim()} onClick={() => void start()}>ヒアリングを始める</button>
        </section>
      )}

      {view?.status === "HEARING" && (
        <section className="card">
          <p className="step">質問 {view.question_count}/5</p>
          {view.question ? (
            <>
              <h2>{view.question.text}</h2>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1500} />
              <div className="actions">
                <button disabled={loading || !answer.trim()} onClick={() => void submitAnswer()}>回答する</button>
                <button className="secondary" disabled={loading} onClick={() => void generateDraft()}>この内容で文章化</button>
              </div>
            </>
          ) : (
            <button disabled={loading} onClick={() => void advance()}>次へ</button>
          )}
        </section>
      )}

      {view?.status === "TEXT_REVIEW" && view.draft && (
        <section className="card">
          <p className="step">文章の確認</p>
          <label htmlFor="title">タイトル</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
          <label htmlFor="contents">本文</label>
          <textarea id="contents" value={contents} onChange={(e) => setContents(e.target.value)} maxLength={300} />
          <div className="actions">
            <button className="secondary" disabled={loading} onClick={() => void saveDraft()}>編集を新しい文章として保存</button>
            <button disabled={loading} onClick={() => void approveDraft()}>この文章を承認</button>
          </div>
        </section>
      )}

      {view?.status === "ART_REVIEW" && (
        <section className="card">
          <p className="step">仕上がり見本</p>
          {view.artwork && <img className="preview" src="/api/image/current" alt="装飾画像の見本" />}
          <article className="letter">
            <h2>{view.draft?.title}</h2>
            <p>{view.draft?.contents}</p>
          </article>
          <div className="actions">
            <button disabled={loading} onClick={() => void approveArtwork()}>見た目を承認してPDF作成</button>
          </div>
        </section>
      )}

      {view?.status === "READY" && (
        <section className="card success">
          <p className="step">PDFの準備ができました</p>
          <a className="button" href="/api/download">PDFをダウンロード</a>
          <button disabled={loading} onClick={() => void complete()}>完了</button>
        </section>
      )}

      {view?.status === "COMPLETED" && (
        <section className="card success">
          <p className="step">完了</p>
          <a className="button" href="/api/download">PDFをもう一度ダウンロード</a>
        </section>
      )}

      {view && <button className="cancel" disabled={loading} onClick={() => void cancel()}>中止して削除</button>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
