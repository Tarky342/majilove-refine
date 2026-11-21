import { NOTO_SANS_JP_BASE64 } from "./noto-sans-jp-base64";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const LETTER_LAYOUT_LIMITS = {
  title: 24,
  contents: 60
} as const;

export function validateLetterLayout(title: string, contents: string): boolean {
  return title.length >= 1 &&
    title.length <= LETTER_LAYOUT_LIMITS.title &&
    contents.length >= 1 &&
    contents.length <= LETTER_LAYOUT_LIMITS.contents;
}

const cardTemplateSvg = `
<svg class="letter-template" xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 179.58 252.94" preserveAspectRatio="none" aria-hidden="true">
  <rect x="-34.93" y="38.43" width="249.45" height="178.58"
        rx="8.74" ry="8.74"
        transform="translate(217.51 37.93) rotate(90)"
        fill="#fff" stroke="#db184e" stroke-miterlimit="10"/>
  <rect x="18.92" y="12.06" width="141.73" height="85.04"
        fill="none" stroke="#edb2c7" stroke-miterlimit="10"/>
  <line x1="28.14" y1="134.39" x2="147.37" y2="134.39"
        fill="none" stroke="#db184e" stroke-miterlimit="10"/>
  <line x1="28.14" y1="220.06" x2="147.37" y2="220.06"
        fill="none" stroke="#db184e" stroke-miterlimit="10"/>
  <text x="137.45" y="233.97" fill="#231815"
        font-family="Yu Gothic,Hiragino Sans,MS Gothic,sans-serif"
        font-size="8">AP:00</text>
</svg>`;

export function renderLetterHtml(
  title: string,
  contents: string,
  illustrationDataUrl: string | null,
  styleId: string
): string {
  const illustration = illustrationDataUrl
    ? `<img class="letter-artwork" src="${illustrationDataUrl}" alt="" />`
    : `<div class="letter-artwork letter-artwork-empty" aria-hidden="true"></div>`;
  void styleId;

  if (!validateLetterLayout(title, contents)) {
    throw new Error("LETTER_LAYOUT_OVER_LIMIT");
  }

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script>
    window.addEventListener("DOMContentLoaded", () => {
      Promise.all(Array.from(document.images).map((image) =>
        image.complete ? (image.naturalWidth ? Promise.resolve() : Promise.resolve()) : image.decode().catch(() => {})
      )).finally(() => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => { document.documentElement.dataset.assetsReady = "true"; });
        } else {
          document.documentElement.dataset.assetsReady = "true";
        }
      });
    });
  </script>
  <style>
    @font-face {
      font-family: "Letter Noto Sans JP";
      src: url("data:font/woff2;base64,${NOTO_SANS_JP_BASE64}") format("woff2");
      font-style: normal;
      font-weight: 400 700;
      font-display: block;
    }
    @page { size: A4 portrait; margin: 0; }
    html, body { width: 210mm; height: 297mm; margin: 0; overflow: hidden; }
    body {
      font-family: "Letter Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "MS Gothic", sans-serif;
      color: #231815;
      background: #fff;
    }
    .letter-page {
      position: relative;
      width: 210mm;
      height: 297mm;
      margin: 0;
      overflow: hidden;
      background: #fff;
      page-break-after: avoid;
    }
    .letter-template {
      position: absolute;
      inset: 0;
      width: 210mm;
      height: 297mm;
      object-fit: fill;
      pointer-events: none;
    }
    .letter-artwork {
      position: absolute;
      left: 22.13mm;
      top: 14.16mm;
      width: 166mm;
      height: 99.87mm;
      object-fit: cover;
      object-position: center;
      overflow: hidden;
      z-index: 2;
    }
    .letter-artwork-empty { background: #fff; }
    .letter-title {
      position: absolute;
      left: 32.99mm;
      top: 137.8mm;
      width: 140.25mm;
      min-height: 17mm;
      max-height: 17mm;
      z-index: 3;
      font-size: 13pt;
      font-weight: 600;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      overflow: hidden;
    }
    .letter-body {
      position: absolute;
      left: 32.16mm;
      top: 168mm;
      width: 140.25mm;
      height: 77mm;
      z-index: 3;
      font-size: 10.5pt;
      line-height: 17.5pt;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <article class="letter-page">
    ${cardTemplateSvg}
    ${illustration}
    <h1 class="letter-title">${escapeHtml(title)}</h1>
    <div class="letter-body">${escapeHtml(contents)}</div>
  </article>
</body>
</html>`;
}
