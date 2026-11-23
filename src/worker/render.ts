import { NOTO_SANS_JP_BASE64 } from "./noto-sans-jp-base64";
import { emotions, type Card, type Emotion } from "../shared/schemas";

export const LETTER_LAYOUT_LIMITS = { title: 24, contents: 60 } as const;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function validateLetterLayout(title: string, contents: string): boolean {
  return title.length >= 1 && title.length <= LETTER_LAYOUT_LIMITS.title &&
    contents.length >= 1 && contents.length <= LETTER_LAYOUT_LIMITS.contents;
}

const template = `<svg class="letter-template" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 179.58 252.94" preserveAspectRatio="none" aria-hidden="true">
<rect x="-34.93" y="38.43" width="249.45" height="178.58" rx="8.74" ry="8.74" transform="translate(217.51 37.93) rotate(90)" fill="#fff" stroke="#db184e"/>
<rect x="18.92" y="12.06" width="141.73" height="85.04" fill="none" stroke="#edb2c7"/>
<line x1="28.14" y1="134.39" x2="147.37" y2="134.39" stroke="#db184e"/><line x1="28.14" y1="220.06" x2="147.37" y2="220.06" stroke="#db184e"/>
<text x="137.45" y="233.97" fill="#231815" font-size="8">AP:00</text></svg>`;

function page(card: Card, imageDataUrl: string): string {
  if (!validateLetterLayout(card.title, card.contents)) throw new Error("LETTER_LAYOUT_OVER_LIMIT");
  return `<article class="letter-page" data-emotion="${card.emotion}">${template}<img class="letter-artwork" src="${imageDataUrl}" alt=""/><h1 class="letter-title">${escapeHtml(card.title)}</h1><div class="letter-body">${escapeHtml(card.contents)}</div></article>`;
}

export function renderCardSetHtml(cards: Card[], images: Record<Emotion, string>): string {
  if (cards.length !== 4 || emotions.some((emotion, index) => cards[index]?.emotion !== emotion)) {
    throw new Error("CARD_SET_ORDER_INVALID");
  }
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"/><style>
@font-face{font-family:LetterNoto;src:url("data:font/woff2;base64,${NOTO_SANS_JP_BASE64}") format("woff2");font-display:block}
@page{size:A4 portrait;margin:0}html,body{margin:0;width:210mm;font-family:LetterNoto,"Yu Gothic",sans-serif;color:#231815}
.letter-page{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;background:#fff}.letter-page:last-child{page-break-after:auto}
.letter-template{position:absolute;inset:0;width:210mm;height:297mm}.letter-artwork{position:absolute;left:22.13mm;top:14.16mm;width:166mm;height:99.87mm;object-fit:cover;z-index:2}
.letter-title{position:absolute;left:32.99mm;top:137.8mm;width:140.25mm;height:17mm;margin:0;font-size:13pt;line-height:1.35;overflow:hidden;z-index:3}
.letter-body{position:absolute;left:32.16mm;top:168mm;width:140.25mm;height:77mm;font-size:10.5pt;line-height:17.5pt;white-space:pre-wrap;overflow:hidden;z-index:3}
</style></head><body>${cards.map((card) => page(card, images[card.emotion])).join("")}</body></html>`;
}

export function renderLetterHtml(title: string, contents: string, illustrationDataUrl: string | null, _styleId: string): string {
  const cards = emotions.map((emotion): Card => ({ emotion, title, contents, image_brief: "image" }));
  return renderCardSetHtml(cards, {
    joy: illustrationDataUrl ?? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
    anger: illustrationDataUrl ?? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
    sadness: illustrationDataUrl ?? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
    fun: illustrationDataUrl ?? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E"
  });
}
