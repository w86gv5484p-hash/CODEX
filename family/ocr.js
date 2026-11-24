// 写真（学校のおたより、予定表、手書きメモなど）から文字を読み取り、予定の候補を作る。
// 文字認識は Tesseract.js を使い、端末の中で処理します（写真は外部に送信しません）。
const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TESS_URL;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error("文字認識の部品を読み込めませんでした")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// 写真を読み取りやすい大きさ・白黒に整える
export async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("画像を開けませんでした"));
      i.src = url;
    });
    const max = 2200;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h);
    const p = d.data;
    for (let k = 0; k < p.length; k += 4) {
      const y = 0.299 * p[k] + 0.587 * p[k + 1] + 0.114 * p[k + 2];
      const v = y > 200 ? 255 : y < 60 ? 0 : Math.round((y - 60) * 255 / 140);
      p[k] = p[k + 1] = p[k + 2] = v;
    }
    g.putImageData(d, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function recognize(file, onProgress) {
  const T = await loadTesseract();
  onProgress && onProgress(0.02, "準備中…");
  const canvas = await prepareImage(file);
  const res = await T.recognize(canvas, "jpn+eng", {
    logger: m => {
      if (!onProgress) return;
      if (m.status === "recognizing text") onProgress(0.3 + m.progress * 0.7, "文字を読み取り中…");
      else if (/load|initializ/.test(m.status)) onProgress(0.05 + (m.progress || 0) * 0.25, "文字認識の準備中（初回は少し時間がかかります）…");
    },
  });
  return res.data.text || "";
}

// ---------- 文字列から予定候補を作る ----------
const pad = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function normalize(text) {
  return text
    .normalize("NFKC")
    // Tesseract は日本語の文字の間に空白を入れるので取り除く
    .replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, "$1")
    .replace(/(\d)[ \t]+(?=\d[ \t]*[月日時\/:])/g, "$1") // 「1 2 月」→「12月」
    .replace(/[〜～]/g, "~")
    .replace(/(\d{1,2}:\d{2})\s*(?=\d{1,2}:\d{2})/g, "$1~") // 「13:3016:00」のように～が消えた時刻範囲
    .replace(/[|｜]/g, " ");
}

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1;
}

function inferYear(m, today) {
  const y = today.getFullYear();
  const cur = today.getMonth() + 1;
  if (m < cur - 3) return y + 1;   // 11月に見た「1月」は翌年
  if (m > cur + 8) return y - 1;
  return y;
}

function parseTime(h, min, ampm) {
  h = Number(h); min = Number(min || 0);
  if (ampm && /午後|PM/i.test(ampm) && h < 12) h += 12;
  if (ampm && /午前|AM/i.test(ampm) && h === 12) h = 0;
  if (h > 24 || min > 59) return "";
  return `${pad(h % 24)}:${pad(min)}`;
}

const TIME_RE = /(午前|午後|AM|PM)?\s*(\d{1,2})\s*(?::|時)\s*(\d{2})?\s*分?(?:\s*(?:~|-|ー|から)\s*(午前|午後|AM|PM)?\s*(\d{1,2})\s*(?::|時)\s*(\d{2})?\s*分?(?:まで)?)?/i;
const FULL_RE = /(20\d{2})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})\s*日?/;
const MD_RE = /(?<!\d)(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})(?!\d)\s*日?/;
const DAY_RE = /(?<!\d)(\d{1,2})\s*日\s*(?:[(（]\s*[月火水木金土日祝]\s*[)）])?/;
const DAY_WD_RE = /^(?<!\d)(\d{1,2})\s*[(（]\s*[月火水木金土日祝]\s*[)）]/;
const MONTH_RE = /(?<!\d)(\d{1,2})\s*月(?!\s*\d)/;

export function parseSchedule(raw, today = new Date()) {
  const lines = normalize(raw).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let ctxYear = null, ctxMonth = null, ctxDate = null, header = null;
  const out = [];
  for (let line of lines) {
    // 「12/24」の「/」が「7」「1」と読まれた行頭の日付を直す（例：12724 → 12/24）
    line = line.replace(/^(1[0-2]|[1-9])[71lI|](\d{1,2})(?=\s|[^\d\x00-\x7F]|$)/, (m, a, b) => (+b >= 1 && +b <= 31 ? `${a}/${b}` : m));
    let date = null;
    let m;
    if ((m = line.match(FULL_RE)) && validDate(+m[1], +m[2], +m[3])) {
      ctxYear = +m[1]; ctxMonth = +m[2];
      date = ymd(+m[1], +m[2], +m[3]);
      line = line.replace(m[0], " ");
    } else if ((m = line.match(MD_RE)) && !/^\s*\d{1,2}\s*:\s*\d{2}/.test(line.slice(m.index)) && validDate(2024, +m[1], +m[2])) {
      ctxMonth = +m[1];
      const y = inferYear(ctxMonth, today);
      date = ymd(y, +m[1], +m[2]);
      line = line.replace(m[0], " ");
    } else {
      const mm = line.match(MONTH_RE);
      if (mm && +mm[1] >= 1 && +mm[1] <= 12) {
        ctxMonth = +mm[1];
        line = line.replace(mm[0], " ");
      }
      const dm = line.match(DAY_WD_RE) || line.match(DAY_RE);
      if (dm && ctxMonth) {
        const y = ctxYear || inferYear(ctxMonth, today);
        if (validDate(y, ctxMonth, +dm[1])) {
          date = ymd(y, ctxMonth, +dm[1]);
          line = line.replace(dm[0], " ");
        }
      }
    }
    if (date) ctxDate = date;

    let start = "", end = "";
    const t = line.match(TIME_RE);
    if (t && (t[3] !== undefined || /時/.test(t[0]))) {
      start = parseTime(t[2], t[3], t[1]);
      if (t[5]) end = parseTime(t[5], t[6], t[4] || t[1]);
      line = line.replace(t[0], " ");
    }
    const title = line
      .replace(/[(（]\s*[月火水木金土日祝・]+\s*[)）]/g, " ")
      .replace(/^[\s・●○◎◆◇■□▶▷★☆※\-:：,、。.]+/, "")
      .replace(/[\s:：,、]+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const cleaned = title.replace(/^(から|より|~)\s*/, "").replace(/\s*(から|より|まで|~)$/, "").trim();
    if (date || start) {
      if (!ctxDate) continue;
      if (date) header = cleaned ? null : ctxDate;
      if (!cleaned && date) continue; // 日付だけの行：次の行から内容を拾う
      out.push({ date: ctxDate, start, end, title: cleaned });
    } else if (cleaned && header) {
      // 日付だけの行の下に続く予定
      out.push({ date: header, start: "", end: "", title: cleaned });
    }
  }
  return out.filter(c => c.title && /[ぁ-んァ-ン一-龯a-zA-Z]/.test(c.title)).slice(0, 60);
}
