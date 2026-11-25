// BEAT CARE — 軽オープンスポーツ BEAT（PP1型・1991〜1996年）のオーナー向け非公式メモアプリ。
// NSX CARE（../nsx/）と同じ構成で、車種データだけを差し替えている。
//
// 第三者が使う前提の安全策：
// - 入力した記録・写真は利用者の端末（localStorage）だけに保存し、どこにも送信しない。
// - 外部サーバーへの通信をしない（フォント・解析・広告なし。index.html の CSP で同一オリジンに制限）。
// - 初回起動時に「利用上の注意」への同意を求める。情報は保証せず、整備は利用者の責任で行う旨を明示する。
// - 公開者の個人情報（名前・連絡先・自分の車の記録）はアプリにもデータにも含めない。

const TERMS_VERSION = "2026-11-25";
const KEY = "pp1care."; // 旧名 PP1 CARE 時代の保存データをそのまま使うため、キーは変えない

const $main = document.getElementById("main");
const $dlg = document.getElementById("dlg");
const $dlgBody = document.getElementById("dlg-body");
const $terms = document.getElementById("terms");

// 主要パーツの販売状況。CMSNL の表示から決めるか、利用者が自分で確認した結果に変える。
const STATUS = {
  supply: { label: "在庫あり", cls: "st-ok" },
  order: { label: "取り寄せ可", cls: "st-repro" },
  replaced: { label: "後継品番あり", cls: "st-soon" },
  discontinued: { label: "廃番", cls: "st-over" },
  check: { label: "要確認", cls: "st-unset" },
  repro: { label: "再販あり", cls: "st-repro" }, // 旧版で保存した自分用の状況を読めるように残す
};
// パーツリストの販売状況（CMSNL のサイト表示。ホンダ公式の供給状況ではない）
const CST = {
  S: { label: "在庫あり", cls: "st-ok", key: "supply", text: "CMSNLに在庫ありと表示" },
  O: { label: "取り寄せ可", cls: "st-repro", key: "order", text: "CMSNLで注文・取り寄せ可と表示（在庫なし）" },
  R: { label: "後継品番あり", cls: "st-soon", key: "replaced", text: "この品番は販売終了と表示。後継品番が示されています（後継品の在庫はこのリストでは不明）" },
  D: { label: "廃番", cls: "st-over", key: "discontinued", text: "CMSNLで販売終了（廃番）と表示" },
  N: { label: "要確認", cls: "st-unset", key: "check", text: "CMSNLで注文できない表示（廃番の表示はなし）" },
};
const CST_ORDER = ["S", "O", "R", "N", "D"];
const MAINT_STATE = {
  ok: { label: "良好", cls: "st-ok", color: "var(--ok)" },
  soon: { label: "交換時期が近い", cls: "st-soon", color: "var(--soon)" },
  over: { label: "交換時期超過", cls: "st-over", color: "var(--over)" },
  unset: { label: "未入力", cls: "st-unset", color: "var(--unset)" },
};

// ---------- 保存（端末内だけ） ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(KEY + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(KEY + key, JSON.stringify(value)); return true; } catch { alert("端末に保存できませんでした（プライベートブラウズや容量不足の可能性）。"); return false; }
  },
  clearAll() {
    try { Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k)); } catch { /* 何もしない */ }
  },
};
let maint = store.get("maint", {});     // { id: { history: ["YYYY-MM-DD", ...] } }
let custom = store.get("custom", []);   // 追加した交換項目
let checks = store.get("checks", {});   // { "faultId:index": "YYYY-MM-DD" }
let parts = store.get("parts", {});     // { partId: { status, partNo, memo } }

// ---------- 日付 ----------
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
function addMonths(date, months) {
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const diffDays = (a, b) => Math.round((b - a) / 86400000);
const jp = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
const intervalText = m => (m % 12 === 0 ? `${m / 12}年` : m === 6 ? "半年" : `${m}か月`) + "に1回";
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// 交換日 + 周期 = 次回交換日。その「1か月半前」からアラートを表示する。
function maintStatus(item) {
  const hist = maint[item.id]?.history || [];
  if (!hist.length) return { state: "unset" };
  const last = parse(hist[hist.length - 1]);
  const due = addMonths(last, item.months);
  const alertFrom = addDays(addMonths(due, -1), -15);
  const now = today();
  const state = now >= due ? "over" : now >= alertFrom ? "soon" : "ok";
  const total = Math.max(1, diffDays(last, due));
  const elapsed = Math.min(total, Math.max(0, diffDays(last, now)));
  return { state, last, due, alertFrom, daysLeft: diffDays(now, due), ratio: elapsed / total };
}

// ---------- データ ----------
let data = null;
let photos = {};
let supply = { sources: [], changes: [] };
let catalog = null;   // CMSNL のパーツリスト（data/parts-catalog.json）
let catIndex = {};    // 品番 → [{ r, d, c }]
let loadedFor = "";

async function loadData() {
  const day = iso(today());
  const get = async name => {
    const res = await fetch(`./data/${name}?d=${day}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(name);
    return res.json();
  };
  data = await get("vehicle.json");
  try { photos = await get("photos.json"); } catch { photos = {}; }
  try { supply = await get("supply.json"); } catch { /* 供給データがなくても他の画面は使える */ }
  try {
    catalog = await get("parts-catalog.json");
    catIndex = {};
    catalog.categories.forEach(c => c.diagrams.forEach(d => d.rows.forEach(r => (catIndex[r[1]] ||= []).push({ r, d, c }))));
  } catch { catalog = null; }
  loadedFor = day;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https:\/\//.test(u || "") ? u : "";
const ext = (url, label) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
const maintItems = () => [...data.maintenance, ...custom];

// 写真は Wikimedia Commons の自由ライセンス画像（CC0 / CC BY / CC BY-SA）を縮小して同梱している。
// メーカーの公式画像は使わない。写真が読めないときはオリジナルのイラストを出す。
const art = (cls = "") => `<img class="art ${cls}" src="./img/hero.svg" alt="" aria-hidden="true">`;
const pic = (key, attrs = "") => photos[key]
  ? `<img src="./img/${esc(photos[key].file)}" alt="${esc(photos[key].caption)}" loading="lazy" decoding="async" ${attrs}>` : art();
const shortCredit = key => photos[key] ? `Photo: ${esc(photos[key].author)} / ${esc(photos[key].license)}` : "";
const GALLERY = ["open-front", "front", "night-rear", "cockpit", "open-side", "museum-red", "meters", "rear", "silver", "seats", "version-c", "night-front"];
const banner = (key, eyebrow, title, text, num = "") => `
  <section class="banner" data-photo="${key}">${pic(key, 'loading="eager"')}
    ${num ? `<span class="num">${num}</span>` : ""}
    <div class="banner-body"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p></div>
  </section>`;

// ---------- 利用上の注意（初回に同意を求める） ----------
const TERMS = [
  ["非公式のアプリです", "このアプリ（BEAT CARE）は個人が作成した非公式のものです。アプリ名の「BEAT」は対象の車種を示すためだけに使っており、メーカーの製品・サービスではありません。本田技研工業株式会社、株式会社ホンダアクセス、ホンダ販売店ほか、いかなる企業・団体とも関係がなく、承認も受けていません。「ホンダ」「Honda」「ビート」「BEAT」等は各権利者の商標であり、車種を説明する目的でのみ記載しています。"],
  ["情報の正確性は保証しません", "諸元・歴史・部品の情報は、出典として示した公開資料・報道・百科事典をもとにまとめたもので、誤り・古い情報・個体差を含む可能性があります。「要確認」「報道」「Wikipedia記載」などの表示は、その情報の確かさを示す目安です。"],
  ["整備は自己責任で、専門家に確認してください", "交換時期は一般的な目安で、メーカー指定値ではありません。点検リストは一般的な経年点検の例です。整備・修理・部品の購入や取り付けは、必ずホンダ販売店や整備工場に確認のうえ、利用者ご自身の判断と責任で行ってください。このアプリの利用により生じたいかなる損害についても、作成者は責任を負いません。"],
  ["記録は端末の中だけに保存されます", "入力した交換日・点検・メモ・写真は、お使いのブラウザー（この端末）の中だけに保存され、作成者を含め誰にも送信されません。アプリは外部のサーバー（解析・広告・外部フォント等）と通信しません。ブラウザーのデータを消去すると記録も消えるため、必要に応じて「データを書き出す」で保存してください。"],
  ["サポートはありません", "このアプリへの問い合わせ窓口や更新の約束はありません。予告なく内容の変更や公開の終了をすることがあります。"],
];
const termsHtml = () => `<ol class="terms-list">${TERMS.map(([h, t]) => `<li><b>${esc(h)}</b><p>${esc(t)}</p></li>`).join("")}</ol>
  <p class="small muted">利用上の注意（${TERMS_VERSION} 版）</p>`;

function requireAgreement() {
  if (store.get("terms", "") === TERMS_VERSION) return Promise.resolve();
  // 古いアプリ内ブラウザー（iOS 15.3 以前など）は <dialog> に対応していない。その場合は確認ダイアログで同意を求める。
  if (typeof $terms.showModal !== "function") {
    const text = TERMS.map(([h, t], i) => `${i + 1}. ${h}\n${t}`).join("\n\n");
    while (!confirm(`ご利用の前に（利用上の注意）\n\n${text}\n\n内容に同意して使い始めますか？`)) { /* 同意するまで進めない */ }
    store.set("terms", TERMS_VERSION);
    return Promise.resolve();
  }
  return new Promise(resolve => {
    document.getElementById("terms-body").innerHTML = `<div class="eyebrow">Before you start</div><h2>ご利用の前に</h2>${termsHtml()}
      <label class="agree"><input type="checkbox" id="t-ok"> 上記を読み、内容に同意します</label>
      <button class="btn primary" id="t-go" disabled>同意して使い始める</button>`;
    const ok = $terms.querySelector("#t-ok"), go = $terms.querySelector("#t-go");
    ok.onchange = () => { go.disabled = !ok.checked; };
    go.onclick = () => { store.set("terms", TERMS_VERSION); $terms.close(); resolve(); };
    $terms.addEventListener("cancel", e => e.preventDefault()); // Esc で閉じて同意を飛ばせないようにする
    $terms.showModal();
  });
}

// ---------- 画面 ----------
const views = { home, alerts, parts: partsView, faults, info };
let infoTab = "specs";
let partFilter = "all";
let partQuery = "";

function render() {
  const [tab, ...rest] = (location.hash.slice(1) || "home").split("/").map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  const sub = rest[0];
  const view = views[tab] ? tab : "home";
  if (view === "info" && sub && ["specs", "history", "dev", "credits", "terms"].includes(sub)) infoTab = sub;
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === view));
  $main.innerHTML = views[view](rest);
  if (catQuery && view === "parts") searchCatalog(catQuery);
  updateBadge();
}

function updateBadge() {
  const n = maintItems().filter(i => ["soon", "over"].includes(maintStatus(i).state)).length;
  const link = document.querySelector('.tabs a[data-tab="alerts"]');
  link.querySelector(".badge")?.remove();
  if (n) link.insertAdjacentHTML("beforeend", `<span class="badge">${n}</span>`);
  if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function alertBanner() {
  const items = maintItems().map(i => ({ i, s: maintStatus(i) }));
  const over = items.filter(x => x.s.state === "over");
  const soon = items.filter(x => x.s.state === "soon");
  const unset = items.filter(x => x.s.state === "unset");
  if (over.length || soon.length) {
    const list = [...over, ...soon].map(({ i, s }) =>
      `<li><b>${esc(i.name)}</b>：${s.state === "over" ? `${-s.daysLeft}日超過` : `あと${s.daysLeft}日`}（期限 ${jp(s.due)}）</li>`).join("");
    return `<div class="alert-banner ${over.length ? "over" : "soon"}" role="alert"><span class="ico">!</span><div><strong>交換時期のお知らせ</strong><ul>${list}</ul></div></div>`;
  }
  if (unset.length === items.length) return `<div class="alert-banner soon"><span class="ico">i</span><div><strong>まず交換日を入力してください</strong>「交換時期」タブで前回の交換日を入れると、期限の1か月半前からここにお知らせします。</div></div>`;
  return `<div class="alert-banner ok"><span class="ico">✓</span><div><strong>交換時期が近い項目はありません</strong>${unset.length ? `<span class="small muted">未入力：${unset.map(x => esc(x.i.name)).join("、")}</span>` : ""}</div></div>`;
}

function home() {
  const photo = store.get("photo", null);
  const items = maintItems().map(i => maintStatus(i));
  const count = st => items.filter(s => s.state === st).length;
  const chk = data.faults.reduce((n, f) => n + f.checks.length, 0);
  const done = Object.keys(checks).length;
  const latest = supply.changes?.[0];
  return `
  <section class="hero">
    ${photo ? `<img src="${photo}" alt="愛車の写真">` : pic("hero", 'loading="eager" fetchpriority="high"')}
    <button class="btn ghost small photo-btn" data-act="photo">${photo ? "写真を変更" : "📷 愛車の写真にする"}</button>
    <div class="hero-body">
      <p class="hero-mark"><span>BEAT</span></p>
      <p class="hero-sub">MIDSHIP <b>AMUSEMENT</b> · OWNER'S NOTE</p>
      <div class="hero-tags"><span class="tag red">1991–1996</span><span class="tag">E-PP1</span><span class="tag">E07A MTREC</span><span class="tag">64PS / 8,100rpm</span><span class="tag">MR · 5MT</span></div>
    </div>
    ${photo ? "" : `<span class="credit">${shortCredit("hero")}</span>`}
  </section>
  <p class="small muted" style="margin:10px 2px 0">非公式のオーナー向けメモアプリです。記録はこの端末の中だけに保存されます。${photo ? "" : "写真は Wikimedia Commons の自由ライセンス画像で、メーカーの公式画像ではありません。"}</p>
  ${alertBanner()}
  <div class="stats">
    <div class="stat" style="--c:var(--over)"><b style="color:var(--over)">${count("over")}</b><span>超過</span></div>
    <div class="stat" style="--c:var(--soon)"><b style="color:var(--soon)">${count("soon")}</b><span>まもなく</span></div>
    <div class="stat" style="--c:var(--ok)"><b style="color:var(--ok)">${count("ok")}</b><span>良好</span></div>
    <div class="stat" style="--c:var(--silver)"><b>${done}<small class="muted" style="font-size:14px">/${chk}</small></b><span>点検済</span></div>
  </div>

  <div class="section"><div class="eyebrow">Gallery</div><h2 class="section-title">PP1型 BEAT</h2>
    <div class="gallery">${GALLERY.filter(k => photos[k]).map(k => `<figure data-photo="${k}">${pic(k)}<figcaption>${esc(photos[k].caption)}</figcaption></figure>`).join("")}</div>
    <p class="small muted" style="margin:6px 2px 0">タップで拡大・撮影者とライセンスを表示。<a href="#info/credits">写真クレジット一覧</a></p>
  </div>
  <div class="section"><div class="eyebrow">Detail</div><h2 class="section-title">ディテール</h2>
    <div class="mosaic" style="margin-top:12px">
      <figure class="tile wide" data-photo="open-rear">${pic("open-rear")}<figcaption>${esc(photos["open-rear"]?.caption)}</figcaption></figure>
      <figure class="tile" data-photo="trunk">${pic("trunk")}<figcaption>${esc(photos["trunk"]?.caption)}</figcaption></figure>
      <figure class="tile" data-photo="front-hood">${pic("front-hood")}<figcaption>${esc(photos["front-hood"]?.caption)}</figcaption></figure>
      <figure class="tile" data-photo="side">${pic("side")}<figcaption>${esc(photos["side"]?.caption)}</figcaption></figure>
      <figure class="tile" data-photo="museum-white">${pic("museum-white")}<figcaption>${esc(photos["museum-white"]?.caption)}</figcaption></figure>
      <figure class="tile wide" data-photo="custom">${pic("custom")}<figcaption>${esc(photos["custom"]?.caption)}</figcaption></figure>
    </div>
  </div>

  <div class="section"><div class="eyebrow">Menu</div><h2 class="section-title">メンテナンスと車両情報</h2>
  <div class="grid two" style="margin-top:12px">
    <a class="feature plain" href="#alerts"><span class="go">→</span><div class="body"><div class="eyebrow">Maintenance</div><h3>交換タイミングアラート</h3><p>オイル・フルード・冷却水・タイヤの交換日を記録し、1か月半前にお知らせ。</p></div></a>
    <a class="feature plain" href="#parts"><span class="go">→</span><div class="body"><div class="eyebrow">Parts</div><h3>パーツと再販部品</h3><p>メーカーの純正部品再販（2017年〜）の報道まとめ${latest ? ` ・ 最新 ${esc(latest.date)}` : ""}</p></div></a>
    <a class="feature plain" href="#faults"><span class="go">→</span><div class="body"><div class="eyebrow">Inspection</div><h3>経年点検チェック</h3><p>30年以上経った車で確認したい${data.faults.length}件・${chk}項目。</p></div></a>
    <a class="feature plain" href="#info"><span class="go">→</span><div class="body"><div class="eyebrow">History</div><h3>スペック・歴史</h3><p>メーカー公式資料の諸元と、発売から部品再販までの年表。</p></div></a>
  </div></div>
  <p class="updates">データ更新日 ${esc(data.updated)} ・ 1日1回データを取り直します（最終取得 ${esc(loadedFor)}）。 <a href="#info/terms">利用上の注意</a></p>`;
}

function alerts() {
  const cards = maintItems().map(item => {
    const s = maintStatus(item);
    const st = MAINT_STATE[s.state];
    const hist = maint[item.id]?.history || [];
    const isCustom = custom.some(c => c.id === item.id);
    return `<article class="card maint-card" style="--c:${st.color}">
      <div class="maint-head"><h3>${esc(item.name)} <span class="muted small">${intervalText(item.months)}</span></h3><span class="pill ${st.cls}">${st.label}</span></div>
      ${s.state !== "unset" ? `<div class="days" style="color:${st.color}">${Math.abs(s.daysLeft)}<small>${s.daysLeft >= 0 ? "日後に交換" : "日超過"}</small></div><div class="bar"><span style="width:${Math.round(s.ratio * 100)}%;background:${st.color}"></span></div>
      <dl class="kv"><dt>前回交換</dt><dd>${jp(s.last)}</dd><dt>次回交換</dt><dd>${jp(s.due)}（${s.daysLeft >= 0 ? `あと${s.daysLeft}日` : `${-s.daysLeft}日超過`}）</dd><dt>アラート開始</dt><dd>${jp(s.alertFrom)}（1か月半前）</dd></dl>` : `<p class="small muted" style="margin:8px 0 0">前回の交換日を入力してください。</p>`}
      <p class="small muted" style="margin:8px 0 0">${esc(item.note || "")}</p>
      <div class="maint-row">
        <label class="field">交換日を記録<input type="date" max="${iso(today())}" value="${iso(today())}" data-date="${esc(item.id)}"></label>
        <button class="btn primary" data-act="record" data-id="${esc(item.id)}">記録する</button>
        ${hist.length ? `<button class="btn small" data-act="undo" data-id="${esc(item.id)}">直前の記録を取り消す</button>` : ""}
        ${isCustom ? `<button class="btn small" data-act="del-custom" data-id="${esc(item.id)}">項目を削除</button>` : ""}
      </div>
      ${hist.length > 1 ? `<details style="margin-top:8px"><summary class="small muted">交換履歴（${hist.length}回）</summary><ol class="history">${[...hist].reverse().map(d => `<li>${jp(parse(d))}</li>`).join("")}</ol></details>` : ""}
    </article>`;
  }).join("");
  const notif = "Notification" in window && Notification.permission === "default"
    ? `<button class="btn small" data-act="notify">アプリを開いたときに通知する</button>` : "";
  return `${banner("open-side", "Maintenance", "交換タイミングアラート", "交換した日を入力すると次回交換日を計算し、<b>その1か月半前</b>からお知らせします。周期は一般的な目安です。", "01")}
  ${alertBanner()}
  <div class="maint">${cards}</div>
  <div class="toolbar" style="margin-top:16px"><button class="btn" data-act="add-custom">＋ 交換項目を追加（タイミングベルトなど）</button>${notif}
  <button class="btn small" data-act="export">データを書き出す</button><button class="btn small" data-act="import">読み込む</button><button class="btn small" data-act="wipe">この端末の記録をすべて消す</button></div>
  <p class="small muted">記録はこの端末のブラウザーの中だけに保存され、どこにも送信されません。機種変更の前に「データを書き出す」で保存してください。</p>`;
}

// 主要パーツの状況：自分で設定した状況 → CMSNL の表示（複数品番なら最も入手しやすいもの）→ 初期値
function partState(p) {
  const mine = parts[p.id] || {};
  const cms = (p.cms || []).map(no => catIndex[no]?.[0]).filter(Boolean);
  const best = cms.map(x => cst(x.r)).sort((a, b) => CST_ORDER.indexOf(a) - CST_ORDER.indexOf(b))[0];
  const base = best ? CST[best].key : (p.status === "repro" || p.status === "supply" ? "check" : p.status);
  return { status: STATUS[mine.status] ? mine.status : base, mine: !!STATUS[mine.status], partNo: mine.partNo || "", memo: mine.memo || "", official: p.numbers || [], cms, repro: p.status === "repro" };
}

// ---------- パーツリスト（CMSNL） ----------
const cst = r => (r[3] === "D" && r[4] ? "R" : r[3]);
// 品番の表示：ホンダの品番は 5桁-3桁-3桁（例 17220-P36-000）が基本。それ以外の形式はそのまま出す。
function fmtNo(s) {
  const m = s.match(/^(\d{5})([A-Z0-9]{3})([A-Z0-9]{3})([A-Z0-9]*)$/);
  if (m && /[A-Z]/.test(m[2])) return `${m[1]}-${m[2]}-${m[3]}${m[4]}`;
  if (/^\d{11}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5, 8)}-${s.slice(8)}`;
  if (/^\d{12}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}`;
  if (/^\d{5}[0-9A-Z]{5}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5)}`;
  return s;
}
// ボルト・ナット・ワッシャーなどの汎用締結部品（90・92・93・94・96で始まる品番）。初期状態では隠す。
const isHw = r => /^9[02346]/.test(r[1]);
const diagramUrl = d => catalog.source.diagramUrl.replace("{page}", d.page);
let catQuery = "";
let catFilter = "all";
let showHw = store.get("showHw", false);
const mainNumbers = () => new Set(data.parts.flatMap(c => c.items.flatMap(i => i.cms || [])));
const catRows = list => list.filter(r => showHw || !isHw(r));
const statusCounts = rows => rows.reduce((o, r) => { o[cst(r)]++; return o; }, { S: 0, O: 0, R: 0, D: 0, N: 0 });

function catItem(r, d, main, showDiagram = false) {
  const st = CST[cst(r)];
  return `<div class="part" data-act="cpart" data-no="${esc(r[1])}" data-page="${esc(d.page)}" role="button" tabindex="0">
    <div><div class="name">${esc(r[2])}</div>
    <div class="sub"><b class="pn">${esc(fmtNo(r[1]))}</b>${r[4] ? ` → 後継 <b class="pn">${esc(fmtNo(r[4]))}</b>` : ""}${showDiagram ? ` ・ ${esc(d.title)}` : r[0] ? ` ・ 図の番号 ${esc(r[0])}` : ""}${main.has(r[1]) ? ` ・ <span style="color:var(--gold)">★主要パーツ</span>` : ""}</div></div>
    <span class="pill ${st.cls}">${st.label}</span></div>`;
}

const partsTabs = active => `<div class="subtabs"><a class="chip ${active === "main" ? "on" : ""}" href="#parts">主要パーツ（${data.parts.reduce((n, c) => n + c.items.length, 0)}点）</a>${catalog ? `<a class="chip ${active === "all" ? "on" : ""}" href="#parts/all">カテゴリー別パーツリスト（${catalog.total.toLocaleString()}点）</a>` : ""}</div>`;

function catalogView(path) {
  const head = `${banner("open-rear", "Parts List", "カテゴリー別パーツリスト", "エンジン・足まわり・ボディなど15カテゴリー、103枚の部品図に載っている品番と販売状況。", "02")}${partsTabs("all")}`;
  if (!catalog) return head + `<p class="muted">パーツリストを読み込めませんでした。通信できる状態で開き直してください。</p>`;
  const main = mainNumbers();
  const [cid] = path;
  const cat = cid && catalog.categories.find(c => c.id === cid);
  const scope = cat ? cat.diagrams.flatMap(d => d.rows) : catalog.categories.flatMap(c => c.diagrams.flatMap(d => d.rows));
  const counts = statusCounts(catRows(scope));
  const total = catRows(scope).length;
  const pass = r => catFilter === "all" || cst(r) === catFilter;
  const chips = [["all", "すべて", total], ...CST_ORDER.map(k => [k, CST[k].label, counts[k]])]
    .map(([k, l, n]) => `<button class="chip ${catFilter === k ? "on" : ""}" data-act="cfilter" data-k="${k}">${l} ${n.toLocaleString()}</button>`).join("");
  const tools = `<div class="toolbar"><input type="text" id="csearch" placeholder="品番・部品名で検索（例：19200、PAD、ベアリング）" value="${esc(catQuery)}" aria-label="パーツリストを検索">
    <label class="chip ${showHw ? "on" : ""}" style="display:flex;align-items:center;gap:6px"><input type="checkbox" data-act="showhw" ${showHw ? "checked" : ""} style="accent-color:var(--red)">ボルト・ナット等も表示</label></div>
    <div id="cresults"></div><div class="chips">${chips}</div>`;
  const note = `<ul class="small muted" style="list-style:none;padding:0;margin:0 0 10px;display:grid;gap:6px">${CST_ORDER.map(k => `<li><span class="pill ${CST[k].cls}">${CST[k].label}</span> ${esc(CST[k].text)}</li>`).join("")}</ul>
    <p class="small muted" style="margin-top:-6px">※ ${esc(catalog.note)} 出典：${ext(catalog.source.url, catalog.source.label)}（${esc(catalog.checkedAt)} 確認）</p>`;
  let body;
  if (!cat) {
    body = `<p class="lead">BEATの部品を、エンジンなどのカテゴリー別に並べたリストです。<b>品番</b>・<b>販売状況（在庫あり・取り寄せ可）</b>・<b>廃番</b>を、海外の部品販売店 CMSNL の表示どおりに載せています。</p>${note}${tools}
      <div class="cat-grid">${catalog.categories.map(c => {
        const rows = catRows(c.diagrams.flatMap(d => d.rows)).filter(pass);
        const n = statusCounts(rows);
        return `<a class="cat-card" href="#parts/all/${c.id}">${pic(c.img)}<div class="body"><div class="eyebrow">${esc(c.en)}</div><h3>${esc(c.name)}</h3><p>${rows.length.toLocaleString()}点 ・ ${c.diagrams.length}図<br>販売中 ${(n.S + n.O).toLocaleString()} ・ 廃番 ${(n.D + n.R).toLocaleString()}</p></div></a>`;
      }).join("")}</div>`;
  } else {
    const groups = cat.diagrams.map(d => ({ d, rows: catRows(d.rows).filter(pass) })).filter(x => x.rows.length);
    body = `${tools}<nav class="crumbs"><a href="#parts/all">すべてのカテゴリー</a><span class="sep">›</span><span>${esc(cat.name)}</span></nav>
      <p class="small muted">${groups.reduce((n, g) => n + g.rows.length, 0).toLocaleString()}点 ・ ${groups.length}図${catFilter !== "all" ? `（${CST[catFilter].label}のみ）` : ""}</p>
      ${groups.map(({ d, rows }) => {
        const n = statusCounts(rows);
        return `<details class="type-group" ${groups.length <= 2 || catFilter !== "all" || rows.some(r => main.has(r[1])) ? "open" : ""}><summary><span><span class="code">${esc(d.code)}</span>${esc(d.title)}</span><span class="muted small">${rows.length}点・廃番 ${n.D + n.R}</span></summary>
          <div class="list">${rows.map(r => catItem(r, d, main)).join("")}<div class="part" style="cursor:default"><div class="sub">出典：${ext(diagramUrl(d), `CMSNL 部品図 ${d.code}`)}</div></div></div></details>`;
      }).join("") || `<p class="muted">該当する部品はありません。</p>`}
      ${note}
      <div class="toolbar"><a class="btn small" href="#parts/all">‹ カテゴリー一覧へ</a></div>`;
  }
  return head + body;
}

function searchCatalog(q) {
  const box = $main.querySelector("#cresults"); if (!box || !catalog) return;
  catQuery = q;
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = ""; return; }
  const main = mainNumbers();
  const hits = [];
  catalog.categories.forEach(c => c.diagrams.forEach(d => catRows(d.rows).forEach(r => {
    if (catFilter !== "all" && cst(r) !== catFilter) return;
    const hay = `${r[1]} ${r[4]} ${r[2]} ${d.title} ${d.code} ${c.name}`.toUpperCase();
    if (words.every(w => hay.includes(w) || hay.includes(w.replace(/[-\s]/g, "")))) hits.push([r, d]);
  })));
  box.innerHTML = hits.length ? `<p class="small muted">${hits.length.toLocaleString()}件${hits.length > 80 ? "（先頭80件）" : ""}</p><div class="list" style="margin-bottom:18px">${hits.slice(0, 80).map(([r, d]) => catItem(r, d, main, true)).join("")}</div>`
    : `<p class="small muted">見つかりませんでした。</p>`;
}

// 品番の詳細（どの図に載っているか・CMSNL の表示・後継品番）
function cmsBlock(no, label = "ホンダ純正品番（CMSNLのリストに掲載）") {
  const hits = catIndex[no] || [];
  if (!hits.length) return "";
  const { r } = hits[0];
  const st = CST[cst(r)];
  return `<div class="part" style="cursor:default"><div><div class="small muted">${esc(label)}</div><div class="name pn-big">${esc(fmtNo(no))}</div>
    <div class="sub">${esc(r[2])}</div>
    <div class="sub"><span class="pill ${st.cls}">${st.label}</span> ${esc(st.text)}</div>
    ${r[4] ? `<div class="sub">後継品番：<b class="pn">${esc(fmtNo(r[4]))}</b></div>` : ""}
    <div class="sub">掲載図：${hits.map(h => ext(diagramUrl(h.d), `${h.c.name} › ${h.d.title}（${h.d.code}）`)).join("、")}</div></div>
    <button class="btn small" data-copy="${esc(fmtNo(no))}">コピー</button></div>`;
}

function openCatalogPart(no) {
  if (!catIndex[no]) return;
  $dlgBody.innerHTML = `<h3>${esc(catIndex[no][0].r[2])}</h3><div class="form"><div class="list">${cmsBlock(no)}</div>
    <p class="small muted" style="margin:0">販売状況は CMSNL（海外の部品販売店）のサイトに ${esc(catalog.checkedAt)} 時点で出ていた表示で、ホンダの公式な供給状況ではありません。部品名は同サイトの表記のままです（機械翻訳を含みます）。注文の前にホンダ販売店で品番・適合・在庫を確認してください。</p></div>`;
  $dlgBody.querySelectorAll("[data-copy]").forEach(b => { b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "コピーしました"; }).catch(() => {}); });
  $dlg.showModal();
}

// 品番の表示（出典で確認できた品番だけ。なければ「品番未確認」）
const pn = no => `<b class="pn">${esc(no)}</b>`;
const srcLink = p => p.src ? ext(p.src, p.srcLabel || "出典") : "";

function partsView(path = []) {
  if (path[0] === "all") return catalogView(path.slice(1));
  const q = partQuery.trim().toLowerCase();
  const counts = { all: 0, supply: 0, order: 0, replaced: 0, discontinued: 0, check: 0, repro: 0 };
  const cats = data.parts.map(cat => {
    const rows = cat.items.map(p => ({ p, s: partState(p) })).filter(({ p, s }) => {
      counts.all++; counts[s.status]++;
      if (partFilter !== "all" && s.status !== partFilter) return false;
      return !q || (p.name + s.partNo + s.memo + (p.note || "") + s.official.map(n => n.no).join(" ") + (p.cms || []).map(n => n + fmtNo(n)).join(" ")).toLowerCase().includes(q);
    });
    if (!rows.length) return "";
    const withNo = cat.items.filter(p => p.numbers?.length || p.cms?.length).length;
    return `<div class="part-cat"><div class="eyebrow">${esc(cat.en || "")}</div><h3>${esc(cat.category)} <span class="muted small">${cat.items.length}点・品番確認済み ${withNo}点</span></h3><div class="list">${rows.map(({ p, s }) => `
      <div class="part" data-act="part" data-id="${esc(p.id)}" role="button" tabindex="0">
        <div><div class="name">${esc(p.name)}</div><div class="sub">${s.cms.length ? `品番 ${pn(fmtNo(s.cms[0].r[1]))}${s.cms.length > 1 ? ` ほか${s.cms.length - 1}件` : ""}${s.cms[0].r[4] ? ` → 後継 ${pn(fmtNo(s.cms[0].r[4]))}` : ""}` : s.official.length ? `品番 ${pn(s.official[0].no)}` : s.partNo ? `品番メモ ${pn(s.partNo)}` : `<span class="muted">品番未確認</span>`}${s.repro ? ` ・ <span style="color:#8fbfff">2017〜20年に再販と報道</span>` : ""}${s.mine ? " ・ 自分で設定した状況" : ""}${s.memo ? ` ・ ${esc(s.memo)}` : ""}</div></div>
        <span class="pill ${STATUS[s.status].cls}">${STATUS[s.status].label}</span>
      </div>`).join("")}</div></div>`;
  }).join("");
  const chips = ["all", "supply", "order", "replaced", "discontinued", "check", ...(counts.repro ? ["repro"] : [])].map(k =>
    `<button class="chip ${partFilter === k ? "on" : ""}" data-act="filter" data-k="${k}">${k === "all" ? "すべて" : STATUS[k].label} ${counts[k]}</button>`).join("");
  const sources = (supply.sources || []).map(s => `<div class="source">${ext(s.url, s.label)}<br><span class="muted">${esc(s.kind || "")}${s.date ? ` ・ ${esc(s.date)}` : ""}</span></div>`).join("");
  const changes = (supply.changes || []).map(c => `<li><b>${esc(c.date)}</b> ${esc(c.summary)}（${ext(c.url, c.source)}）</li>`).join("");
  return `${banner("trunk", "Parts", "パーツと品番", "よく交換・修理する主要パーツの品番と販売状況。全部品はカテゴリー別パーツリストへ。", "02")}
  ${partsTabs("main")}
  <p class="lead">カテゴリー別の主要パーツです。<b>品番</b>と<b>販売状況（在庫あり／取り寄せ可／後継品番あり／廃番）</b>は、海外の部品販売店 CMSNL のパーツリストの表示です。タップすると掲載図・後継品番・出典と、自分用のメモ（端末内だけに保存）を見られます。</p>
  <div class="legend small"><span class="pill st-ok">在庫あり</span> <span class="pill st-repro">取り寄せ可</span> <span class="pill st-soon">後継品番あり</span> 元の品番は販売終了 <span class="pill st-over">廃番</span> <span class="pill st-unset">要確認</span> 表示なし・リストにない</div>
  <p class="small muted" style="margin-top:-6px">※ ${esc(data.partsNote)}</p>
  <div class="toolbar"><input type="text" placeholder="部品名・品番・メモで検索" value="${esc(partQuery)}" data-act="search" aria-label="部品を検索"></div>
  <div class="chips">${chips}</div>
  ${cats || `<p class="muted">該当する部品はありません。</p>`}
  ${catalog ? `<a class="card" href="#parts/all" style="display:block;text-decoration:none;margin-top:16px"><div class="eyebrow">Parts List</div><h3 style="margin:4px 0">カテゴリー別パーツリスト（${catalog.total.toLocaleString()}点）›</h3><p class="small muted" style="margin:0">エンジン・吸気・冷却・ミッション・ブレーキ・足まわり・電装・ボディ・幌・内装など15カテゴリー、103図の品番と販売状況・廃番。</p></a>` : ""}
  <div class="section"><div class="eyebrow">Official &amp; News</div><h2 class="section-title">純正部品の再販について</h2></div>
  <div class="card">
    <p class="small" style="margin-top:0">${esc(supply.summary || "")}</p>
    ${changes ? `<h3 style="margin-top:14px">これまでの動き</h3><ul class="small" style="padding-left:18px;margin:0">${changes}</ul>` : ""}
    ${sources ? `<h3 style="margin-top:14px">確認先・出典</h3>${sources}` : ""}
    <p class="small muted" style="margin-bottom:0">最終確認：${esc(supply.checkedAt || "—")}。最新の在庫・価格・廃番は、必ずメーカー公式ページとホンダ販売店でご確認ください。</p>
  </div>`;
}

function faults() {
  return `${banner("front-hood", "Inspection", "経年点検チェック", "30年以上経った車で確認したい項目。点検した項目にチェックすると日付が記録されます。", "03")}
  <p class="small muted">※ ${esc(data.faultsNote)}</p>
  ${data.faults.map(f => {
    const done = f.checks.filter((_, i) => checks[`${f.id}:${i}`]).length;
    return `<article class="card fault">
      <div class="fault-head"><h3>${esc(f.title)}</h3><span class="sev sev-${esc(f.severity)}">重要度 ${esc(f.severity)}</span></div>
      <p><b>症状</b>${esc(f.symptom)}</p><p><b>原因</b>${esc(f.cause)}</p>
      <p class="small muted" style="margin:0 0 6px">根拠：${esc(f.basis)}</p>
      <div class="progress">点検チェック ${done}/${f.checks.length}<div class="bar"><span style="width:${done / f.checks.length * 100}%;background:var(--ok)"></span></div></div>
      <ul class="checks">${f.checks.map((c, i) => {
        const key = `${f.id}:${i}`, when = checks[key];
        return `<li><label><input type="checkbox" data-act="check" data-key="${esc(key)}" ${when ? "checked" : ""}><span class="${when ? "done" : ""}">${esc(c)}${when && isDate(when) ? `<span class="when">✓ ${jp(parse(when))} 実施</span>` : ""}</span></label></li>`;
      }).join("")}</ul>
    </article>`;
  }).join("")}
  <button class="btn small" data-act="reset-checks">チェックをすべて外す</button>`;
}

function info() {
  const sub = [["specs", "基本スペック"], ["history", "車両の歴史"], ["dev", "開発の特徴"], ["credits", "写真クレジット"], ["terms", "利用上の注意"]];
  const heads = { credits: ["museum-red", "Credits", "写真クレジット", "このアプリの写真は Wikimedia Commons の自由ライセンス画像です。", ""], specs: ["meters", "Specifications", "車両の基本スペック", "メーカー公式ファクトブック（1991年5月）の主要諸元。", "04"], history: ["museum-white", "History", "車両の歴史", "1991年の発売から、純正部品の再販まで。", "05"], dev: ["cockpit", "Development", "開発の特徴", "メーカー発表資料にもとづく技術の特徴と、関係者に関する情報。", "06"], terms: ["night-front", "Terms", "利用上の注意", "ご利用の前に必ずお読みください。", ""] };
  let body = "";
  if (infoTab === "specs") {
    body = `<div class="big-numbers"><div><b>64<small>PS</small></b><span>最高出力 / 8,100rpm</span></div><div><b>656<small>cc</small></b><span>E07A 直列3気筒</span></div><div><b>760<small>kg</small></b><span>車両重量</span></div></div>
      <div class="grid two">${data.specs.map(g => `<div class="card spec-card"><h3 style="padding:16px 16px 0">${esc(g.group)}</h3><table class="spec-table">${g.items.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`).join("")}</div>
      <p class="small muted">${esc(data.specsNote)}</p>
      <p class="small">出典：${data.specSources.map(s => ext(s.url, s.label)).join(" ／ ")}</p>`;
  } else if (infoTab === "history") {
    body = `<div class="card"><ol class="timeline">${data.history.map(h => `<li><div class="date">${esc(h.date)}</div><strong>${esc(h.title)}</strong><p>${esc(h.text)}</p><p class="small muted" style="margin:2px 0 0">${h.weak ? "出典（公式資料ではありません）" : "出典"}：${ext(h.src, new URL(h.src).hostname)}</p></li>`).join("")}</ol></div>`;
  } else if (infoTab === "dev") {
    const d = data.development;
    body = `<div class="grid two">${d.concept.map(c => `<div class="card concept"><div class="txt"><h3>${esc(c.title)}</h3><p class="small" style="margin:0">${esc(c.text)}</p></div></div>`).join("")}</div>
      <p class="small">出典：${data.specSources.map(s => ext(s.url, s.label)).join(" ／ ")}</p>
      <div class="section"><div class="eyebrow">People</div><h2 class="section-title">関係者について</h2></div>
      <div class="grid">${d.people.map(p => `<div class="card person"><div class="avatar">${esc(p.name.slice(0, 1))}</div><div><h3 style="margin:0">${esc(p.name)}</h3><div class="small" style="color:var(--red)">${esc(p.role)}</div><p class="small" style="margin:4px 0 0">${esc(p.text)}</p></div></div>`).join("")}</div>
      <p class="small muted">${esc(d.note)}</p>`;
  } else if (infoTab === "credits") {
    body = `<div class="mosaic">${Object.keys(photos).map(k => `<figure class="tile" data-photo="${k}">${pic(k)}<figcaption>${esc(photos[k].caption)}</figcaption></figure>`).join("")}</div>
      <ul class="credits" style="margin-top:16px;padding-left:18px">${Object.values(photos).map(p => `<li>${esc(p.caption)} — ${esc(p.author)}、${ext(p.source, p.title)}（${esc(p.license)}）</li>`).join("")}</ul>
      <p class="small muted">いずれも Wikimedia Commons で公開されている CC0 / CC BY 2.0 / CC BY-SA 4.0 の画像を、幅1280px以下に縮小・WebP変換して使用しています（変更点はこの縮小・形式変換のみ）。ライセンス本文は各リンク先をご覧ください。メーカーの公式画像ではなく、写っている車両・ナンバー・人物とこのアプリは関係ありません。</p>`;
  } else {
    body = `<div class="card">${termsHtml()}</div>
      <p class="small muted">写真は Wikimedia Commons の自由ライセンス画像です（「写真クレジット」参照）。メーカーの画像・ロゴは使用していません。</p>`;
  }
  return `${banner(...heads[infoTab])}<div class="subtabs">${sub.map(([k, l]) => `<button class="chip ${infoTab === k ? "on" : ""}" data-act="info" data-k="${k}">${l}</button>`).join("")}</div>${body}`;
}

// ---------- 操作 ----------
function openPhoto(key) {
  const p = photos[key]; if (!p) return;
  $dlg.classList.add("photo");
  $dlgBody.innerHTML = `<img src="./img/${esc(p.file)}" alt="${esc(p.caption)}"><div class="cap"><b>${esc(p.caption)}</b>Photo: ${esc(p.author)} ・ ${esc(p.license)} ・ ${ext(p.source, "Wikimedia Commons")}</div>`;
  $dlg.showModal();
}
$dlg.addEventListener("close", () => $dlg.classList.remove("photo"));

function openPart(id) {
  const p = data.parts.flatMap(c => c.items).find(x => x.id === id);
  if (!p) return;
  const s = partState(p);
  $dlgBody.innerHTML = `<h3>${esc(p.name)}</h3>
    <div class="form">
      ${s.cms.length ? `<div class="list">${(p.cms || []).map(no => cmsBlock(no)).join("")}</div>` : ""}
      ${s.repro ? `<p class="small" style="margin:0;color:#8fbfff">2017〜2020年に、メーカーの純正部品再販の対象と報道された部品です（現在の販売状況とは別の情報です）。</p>` : ""}
      ${s.official.length ? `<div class="list">${s.official.map(n => `<div class="part" style="cursor:default"><div><div class="small muted">記事に掲載された品番</div><div class="name pn-big">${esc(n.no)}</div><div class="sub">${p.price ? `価格 ${esc(p.price)}（${esc(p.priceAt)}時点・税込表記は出典による）` : "価格は出典に記載なし"}</div></div><button class="btn small" data-copy="${esc(n.no)}">コピー</button></div>`).join("")}</div>` : s.cms.length ? "" : `<p class="small" style="margin:0">品番は確認できていません。販売店で確認してください。</p>`}
      ${p.note ? `<p class="small" style="margin:0;color:var(--muted)">${esc(p.note)}</p>` : ""}
      ${p.src ? `<p class="small" style="margin:0">出典：${srcLink(p)}</p>` : ""}
      <p class="small muted" style="margin:0">販売状況はCMSNL（海外の部品販売店）のサイト表示（${esc(catalog?.checkedAt || "")}確認）で、ホンダの公式な供給状況ではありません。価格は記事掲載時点のものです。現在の在庫・価格・廃番は、ホンダ販売店で確認してください。</p>
      <label class="field">販売状況（自分で確認した結果に変更できます）<select id="f-status">${Object.entries(STATUS).filter(([k]) => k !== "repro" || s.status === "repro").map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      <label class="field">自分用の品番メモ（販売店で確認した品番など）<input type="text" id="f-no" value="${esc(s.partNo)}" autocapitalize="characters" maxlength="40"></label>
      <label class="field">メモ（価格・購入先・交換日など）<textarea id="f-memo" rows="3" maxlength="1000">${esc(s.memo)}</textarea></label>
      <p class="small muted" style="margin:0">入力内容はこの端末の中だけに保存されます。</p>
      <div class="toolbar"><button class="btn primary" id="f-save">保存</button>${parts[id] ? `<button class="btn" id="f-reset">初期値に戻す</button>` : ""}</div>
    </div>`;
  $dlgBody.querySelectorAll("[data-copy]").forEach(b => { b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "コピーしました"; }).catch(() => {}); });
  $dlgBody.querySelector("#f-save").onclick = () => {
    parts[id] = { status: $dlgBody.querySelector("#f-status").value, partNo: $dlgBody.querySelector("#f-no").value.trim().toUpperCase(), memo: $dlgBody.querySelector("#f-memo").value.trim() };
    store.set("parts", parts); $dlg.close(); render();
  };
  const reset = $dlgBody.querySelector("#f-reset");
  if (reset) reset.onclick = () => { delete parts[id]; store.set("parts", parts); $dlg.close(); render(); };
  $dlg.showModal();
}

function addCustom() {
  $dlgBody.innerHTML = `<h3>交換項目を追加</h3><div class="form">
    <label class="field">項目名<input type="text" id="c-name" placeholder="例：タイミングベルト" maxlength="40"></label>
    <label class="field">交換周期（月）<input type="number" id="c-months" min="1" max="240" value="12"></label>
    <label class="field">メモ<input type="text" id="c-note" maxlength="200"></label>
    <button class="btn primary" id="c-save">追加</button></div>`;
  $dlgBody.querySelector("#c-save").onclick = () => {
    const name = $dlgBody.querySelector("#c-name").value.trim();
    const months = parseInt($dlgBody.querySelector("#c-months").value, 10);
    if (!name || !(months > 0 && months <= 240)) return;
    custom.push({ id: "c" + Date.now(), name, months, note: $dlgBody.querySelector("#c-note").value.trim() });
    store.set("custom", custom); $dlg.close(); render();
  };
  $dlg.showModal();
}

// 写真は端末内で縮小して保存する。位置情報などのメタデータは canvas で描き直すため残らない。
function setPhoto() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
  input.onchange = () => {
    const file = input.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = Object.assign(document.createElement("canvas"), { width: img.width * scale, height: img.height * scale });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      store.set("photo", c.toDataURL("image/jpeg", 0.82));
      URL.revokeObjectURL(img.src); render();
    };
    img.src = URL.createObjectURL(file);
  };
  input.click();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "beat-care", exported: new Date().toISOString(), maint, custom, checks, parts }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `beat-care-${iso(today())}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 読み込むファイルは利用者が選んだものだけ。形を確かめてから取り込む（不正な値で画面が壊れないように）。
function sanitize(d) {
  const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
  const m = {};
  Object.entries(obj(d.maint)).forEach(([k, v]) => { const h = (obj(v).history || []).filter(isDate); if (h.length) m[str(k, 60)] = { history: h.sort() }; });
  const c = (Array.isArray(d.custom) ? d.custom : []).map(x => obj(x)).filter(x => x.id && x.name && Number(x.months) > 0)
    .map(x => ({ id: str(x.id, 60), name: str(x.name, 40), months: Math.min(240, Math.round(Number(x.months))), note: str(x.note, 200) }));
  const ch = {};
  Object.entries(obj(d.checks)).forEach(([k, v]) => { if (isDate(v)) ch[str(k, 60)] = v; });
  const p = {};
  Object.entries(obj(d.parts)).forEach(([k, v]) => { v = obj(v); p[str(k, 60)] = { status: STATUS[v.status] ? v.status : "check", partNo: str(v.partNo, 40), memo: str(v.memo, 1000) }; });
  return { maint: m, custom: c, checks: ch, parts: p };
}

function importData() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json,.json" });
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file || file.size > 2_000_000) throw new Error();
      const d = JSON.parse(await file.text());
      if (!["beat-care", "pp1-care"].includes(d.app)) throw new Error(); // 旧名 PP1 CARE の書き出しも読める
      ({ maint, custom, checks, parts } = sanitize(d));
      Object.entries({ maint, custom, checks, parts }).forEach(([k, v]) => store.set(k, v));
      render(); alert("読み込みました。");
    } catch { alert("BEAT CARE の書き出しファイルではありません。"); }
  };
  input.click();
}

function wipe() {
  if (!confirm("この端末に保存した交換日・点検・部品メモ・写真をすべて消します。元に戻せません。よろしいですか？")) return;
  store.clearAll();
  maint = {}; custom = []; checks = {}; parts = {};
  location.reload();
}

function notifyDue() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const due = maintItems().filter(i => ["soon", "over"].includes(maintStatus(i).state));
  if (!due.length || store.get("notified", "") === iso(today())) return;
  store.set("notified", iso(today()));
  new Notification("BEAT CARE 交換時期のお知らせ", { body: due.map(i => i.name).join("、") + " の交換時期です。", icon: "./icon-192.png" });
}

$main.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) { const ph = e.target.closest("[data-photo]"); if (ph && !e.target.closest("a")) openPhoto(ph.dataset.photo); return; }
  const { act, id, k } = el.dataset;
  if (act === "record") {
    const v = $main.querySelector(`[data-date="${CSS.escape(id)}"]`).value;
    if (!isDate(v)) return;
    const h = (maint[id] ||= { history: [] }).history;
    h.push(v); h.sort();
    store.set("maint", maint); render();
  } else if (act === "undo") {
    maint[id].history.pop(); store.set("maint", maint); render();
  } else if (act === "del-custom") {
    if (!confirm("この項目と記録を削除しますか？")) return;
    custom = custom.filter(c => c.id !== id); delete maint[id];
    store.set("custom", custom); store.set("maint", maint); render();
  } else if (act === "add-custom") addCustom();
  else if (act === "notify") Notification.requestPermission().then(() => { notifyDue(); render(); });
  else if (act === "export") exportData();
  else if (act === "import") importData();
  else if (act === "wipe") wipe();
  else if (act === "photo") setPhoto();
  else if (act === "part") openPart(id);
  else if (act === "filter") { partFilter = k; render(); }
  else if (act === "cfilter") { catFilter = k; render(); }
  else if (act === "cpart") openCatalogPart(el.dataset.no);
  else if (act === "info") { location.hash = `info/${k}`; }
  else if (act === "reset-checks") { if (confirm("点検チェックをすべて外しますか？")) { checks = {}; store.set("checks", checks); render(); } }
});
$main.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "showhw") { showHw = el.checked; store.set("showHw", showHw); render(); return; }
  if (el.dataset.act === "check") {
    if (el.checked) checks[el.dataset.key] = iso(today()); else delete checks[el.dataset.key];
    store.set("checks", checks); render();
  }
});
$main.addEventListener("input", e => {
  if (e.target.id === "csearch") { searchCatalog(e.target.value); return; }
  if (e.target.dataset.act !== "search") return;
  partQuery = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const box = $main.querySelector('[data-act="search"]');
  box.focus(); box.setSelectionRange(pos, pos);
});
$main.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.dataset?.act === "part") openPart(e.target.dataset.id);
  if (e.key === "Enter" && e.target.dataset?.act === "cpart") openCatalogPart(e.target.dataset.no);
});
window.addEventListener("hashchange", () => { render(); scrollTo(0, 0); });

async function refreshIfNewDay() {
  if (loadedFor === iso(today())) return;
  try { await loadData(); } catch { /* オフライン時は前回のデータで表示 */ }
  render(); notifyDue();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfNewDay(); });
setInterval(refreshIfNewDay, 3600_000);

(async () => {
  try { await loadData(); } catch {
    $main.innerHTML = `<p>データを読み込めませんでした。通信状態を確認して再読み込みしてください。</p>`; return;
  }
  render();
  await requireAgreement();
  notifyDue();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
