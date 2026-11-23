import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Emotion = "joy" | "anger" | "sadness" | "fun";
const emotions: Emotion[] = ["joy", "anger", "sadness", "fun"];
const labels: Record<Emotion, string> = { joy: "喜", anger: "怒", sadness: "哀", fun: "楽" };
type Entry = { emotion: Emotion; note: string; scene: string; wish: string };
type Card = { emotion: Emotion; title: string; contents: string; image_brief: string };
type View = {
  schema_version: 2;
  session_id: string;
  version: number;
  status: string;
  inputs: Entry[];
  card_set: { revision_id: string; approved: boolean; cards: Card[] } | null;
  images: { emotion: Emotion; status: string; preview_url: string | null }[];
  pdf_ready: boolean;
  last_error: { code: string } | null;
  expires_at: string;
};
const empty = (): Entry[] =>
  emotions.map((emotion) => ({ emotion, note: "", scene: "", wish: "" }));

async function request(path: string, init?: RequestInit): Promise<View> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "処理に失敗しました。");
  return body as View;
}

function App() {
  const [view, setView] = useState<View | null>(null);
  const [entries, setEntries] = useState(empty);
  const [cards, setCards] = useState<Card[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void fetch("/api/sessions/current").then(async (r) => r.ok && setView(await r.json()));
  }, []);
  useEffect(() => {
    if (view?.inputs) setEntries(view.inputs);
    if (view?.card_set) setCards(view.card_set.cards);
  }, [view]);
  const run = async (action: () => Promise<View>) => {
    setLoading(true);
    setError("");
    try {
      setView(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました。");
    } finally {
      setLoading(false);
    }
  };
  const updateEntry = (emotion: Emotion, field: keyof Entry, value: string) =>
    setEntries((current) =>
      current.map((entry) => (entry.emotion === emotion ? { ...entry, [field]: value } : entry)),
    );
  const start = () =>
    run(() =>
      request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ consent_to_ai: true, entries }),
      }),
    );
  const generate = () =>
    run(() =>
      request("/api/cards/generate", {
        method: "POST",
        body: JSON.stringify({
          expected_version: view!.version,
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    );
  const saveCards = () =>
    run(() =>
      request("/api/cards", {
        method: "PATCH",
        body: JSON.stringify({ cards, expected_version: view!.version }),
      }),
    );
  const approve = () =>
    run(() =>
      request("/api/cards/approve", {
        method: "POST",
        body: JSON.stringify({
          expected_version: view!.version,
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    );
  const regenerate = (emotion: Emotion) =>
    run(() =>
      request(`/api/cards/${emotion}/regenerate`, {
        method: "POST",
        body: JSON.stringify({
          expected_version: view!.version,
          idempotency_key: crypto.randomUUID(),
        }),
      }),
    );
  return (
    <main>
      <header>
        <h1>喜怒哀楽 本音カード</h1>
        <p>専門スタッフが入力した4つの気持ちをカードにします。</p>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loading && <p aria-live="polite">処理しています...</p>}
      {!view && !loading && (
        <section className="card">
          <h2>4つの気持ちを入力</h2>
          {entries.map((entry) => (
            <fieldset key={entry.emotion}>
              <legend>{labels[entry.emotion]}</legend>
              <textarea
                aria-label={`${labels[entry.emotion]} 本音`}
                value={entry.note}
                maxLength={1000}
                onChange={(e) => updateEntry(entry.emotion, "note", e.target.value)}
                placeholder="本人の本音"
              />
            </fieldset>
          ))}
          <button
            // disabled={!consent || entries.some((entry) => !entry.note.trim())}
            onClick={() => void start()}
          >
            入力を保存
          </button>
        </section>
      )}
      {view?.status === "INPUT" && (
        <section className="card">
          <h2>入力を確認</h2>
          <button
            onClick={() =>
              void run(() =>
                request("/api/inputs", {
                  method: "PATCH",
                  body: JSON.stringify({
                    consent_to_ai: true,
                    entries,
                    expected_version: view.version,
                  }),
                }),
              )
            }
          >
            入力を更新
          </button>
          <button onClick={() => void generate()}>4文章を生成</button>
        </section>
      )}
      {view?.status === "TEXT_REVIEW" && (
        <section className="card">
          <h2>文章を確認・編集</h2>
          {cards.map((card, i) => (
            <fieldset key={card.emotion}>
              <legend>{labels[card.emotion]}</legend>
              <input
                value={card.title}
                maxLength={24}
                onChange={(e) =>
                  setCards((all) =>
                    all.map((item, index) =>
                      index === i ? { ...item, title: e.target.value } : item,
                    ),
                  )
                }
              />
              <textarea
                value={card.contents}
                maxLength={60}
                onChange={(e) =>
                  setCards((all) =>
                    all.map((item, index) =>
                      index === i ? { ...item, contents: e.target.value } : item,
                    ),
                  )
                }
              />
              <button onClick={() => void regenerate(card.emotion)}>この感情を再生成</button>
            </fieldset>
          ))}
          <button onClick={() => void saveCards()}>編集を保存</button>
          <button onClick={() => void approve()}>4件すべてを承認して画像生成</button>
        </section>
      )}
      {(view?.status === "IMAGE_RUNNING" || view?.status === "PDF_RUNNING") && (
        <section className="card">
          <h2>生成中</h2>
          <p>
            {view.status === "IMAGE_RUNNING"
              ? "4画像を生成しています。"
              : "4ページPDFを作成しています。"}
          </p>
        </section>
      )}
      {view?.status === "IMAGE_ERROR" && (
        <section className="card">
          <h2>画像生成エラー</h2>
          {view.images
            .filter((image) => image.status === "failed")
            .map((image) => (
              <button
                key={image.emotion}
                onClick={() =>
                  void run(() =>
                    request(`/api/images/${image.emotion}/retry`, {
                      method: "POST",
                      body: JSON.stringify({
                        expected_version: view.version,
                        idempotency_key: crypto.randomUUID(),
                      }),
                    }),
                  )
                }
              >
                {labels[image.emotion]}を再試行
              </button>
            ))}
        </section>
      )}
      {view?.status === "PDF_ERROR" && (
        <section className="card">
          <h2>PDF生成エラー</h2>
          <button
            onClick={() =>
              void run(() =>
                request("/api/pdf/retry", {
                  method: "POST",
                  body: JSON.stringify({
                    expected_version: view.version,
                    idempotency_key: crypto.randomUUID(),
                  }),
                }),
              )
            }
          >
            PDFを再試行
          </button>
        </section>
      )}
      {(view?.status === "READY" || view?.status === "COMPLETED") && (
        <section className="card success">
          <h2>PDFの準備ができました</h2>
          <a className="button" href="/api/download">
            4ページPDFをダウンロード
          </a>
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
