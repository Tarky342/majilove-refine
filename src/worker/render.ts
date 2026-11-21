export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderLetterHtml(
  title: string,
  contents: string,
  illustrationDataUrl: string | null,
  styleId: string
): string {
  const illustration = illustrationDataUrl
    ? `<img class="illustration" src="${illustrationDataUrl}" alt="" />`
    : "";
  const accent = styleId === "minimal"
    ? "#9e9a93"
    : styleId === "stars"
      ? "#9b91b8"
      : "#b89a8a";

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    html, body { width: 210mm; min-height: 297mm; margin: 0; }
    body { font-family: "Noto Sans CJK JP", "Yu Gothic", "Hiragino Sans", sans-serif; color: #493f3d; background: #fffdf9; }
    .page { box-sizing: border-box; width: 186mm; min-height: 273mm; padding: 18mm 16mm; border: 1px solid ${accent}; page-break-after: avoid; }
    .illustration { display: block; width: 48mm; height: 64mm; object-fit: cover; margin: 0 auto 12mm; }
    h1 { font-size: 24pt; line-height: 1.35; margin: 0 0 10mm; text-align: center; overflow-wrap: anywhere; }
    .contents { font-size: 12pt; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <article class="page">
    ${illustration}
    <h1>${escapeHtml(title)}</h1>
    <div class="contents">${escapeHtml(contents)}</div>
  </article>
</body>
</html>`;
}
