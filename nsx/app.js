// NSX CARE — 1991年式 Honda NSX（NA1）の整備・部品・車両情報アプリ。
// 入力した交換日・チェック・部品メモは端末のブラウザー（localStorage）に保存します。
// データファイルは1日1回（日付が変わったとき）取り直し、アラートも日付ごとに再計算します。

// 共有用の閲覧専用ページ（share/index.html）は <html data-readonly> を付けて同じ app.js を読み込む。
// 閲覧専用では data/shared-records.json の記録を表示し、端末（localStorage）には何も読み書きしない。
const READONLY = document.documentElement.hasAttribute("data-readonly");
const asset = path => new URL(path, import.meta.url).href; // app.js と同じフォルダー基準（share/ から読んでも同じ場所を指す）

const $main = document.getElementById("main");
const $dlg = document.getElementById("dlg");
const $dlgBody = document.getElementById("dlg-body");

const STATUS = {
  supply: { label: "販売中", cls: "st-ok" },
  repro: { label: "復刻あり", cls: "st-repro" },
  discontinued: { label: "廃番", cls: "st-over" },
  check: { label: "要確認", cls: "st-unset" },
};
const MAINT_STATE = {
  ok: { label: "良好", cls: "st-ok", color: "var(--ok)" },
  soon: { label: "交換時期が近い", cls: "st-soon", color: "var(--soon)" },
  over: { label: "交換時期超過", cls: "st-over", color: "var(--over)" },
  unset: { label: "未入力", cls: "st-unset", color: "var(--unset)" },
};

// ---------- 保存 ----------
const memory = new Map(); // 閲覧専用：表示の切り替えだけをページを開いている間だけ覚える
const store = READONLY ? {
  get(key, fallback) { return memory.has(key) ? memory.get(key) : fallback; },
  set(key, value) { memory.set(key, value); },
} : {
  get(key, fallback) {
    try { const v = localStorage.getItem("nsx." + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("nsx." + key, JSON.stringify(value)); } catch { alert("端末に保存できませんでした（プライベートブラウズや容量不足の可能性）。"); }
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
let supply = { partNumbers: [], sources: [], changes: [] };
let photos = {};
let loadedFor = "";
let sharedAt = ""; // 閲覧専用：記録を書き出した日時

async function loadData() {
  const day = iso(today());
  const get = async name => {
    const res = await fetch(asset(`data/${name}?d=${day}`), { cache: "no-cache" });
    if (!res.ok) throw new Error(name);
    return res.json();
  };
  data = await get("vehicle.json");
  try { supply = await get("supply.json"); } catch { /* 供給データがなくても他の画面は使える */ }
  try { photos = await get("photos.json"); } catch { photos = {}; }
  if (READONLY) {
    try {
      const r = await get("shared-records.json");
      ({ maint = {}, custom = [], checks = {}, parts = {} } = r);
      sharedAt = r.exported || "";
    } catch { maint = {}; custom = []; checks = {}; parts = {}; }
  }
  loadedFor = day;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const maintItems = () => [...data.maintenance, ...custom];


// ---------- 写真 ----------
const pic = (key, attrs = "") => photos[key]
  ? `<img src="${asset(`img/${photos[key].file}`)}" alt="${esc(photos[key].caption)}" loading="lazy" decoding="async" ${attrs}>` : "";
const shortCredit = key => photos[key] ? `Photo: ${esc(photos[key].author)} / ${esc(photos[key].license)}` : "";
const banner = (key, eyebrow, title, text, num = "") => `
  <section class="banner" data-photo="${key}">${pic(key, 'loading="eager"')}
    ${num ? `<span class="num">${num}</span>` : ""}
    <div class="banner-body"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p></div>
    <span class="credit">${shortCredit(key)}</span>
  </section>`;
const GALLERY = ["museum-red", "front-1991", "countryside", "engine", "cockpit", "rear-1991", "road-red", "profile", "black", "silver-front", "tail", "countryside-rear"];

// ---------- 画面 ----------
const views = { home, alerts, parts: partsView, faults, info };
let infoTab = "specs";
let partFilter = "all";
let partQuery = "";
let officialRows = null; // 継続供給中リスト [元の品番, 現在の品番, 部品名]（必要になったときに読み込む）

async function loadOfficial() {
  if (officialRows) return officialRows;
  try {
    const res = await fetch(asset(`data/supply-list.json?d=${loadedFor}`), { cache: "no-cache" });
    officialRows = res.ok ? (await res.json()).rows || [] : [];
  } catch { officialRows = []; }
  return officialRows;
}

async function searchOfficial(q) {
  const box = $main.querySelector("#oresults"); if (!box) return;
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = ""; return; }
  const rows = await loadOfficial();
  if (!rows.length) { box.innerHTML = `<p class="small muted">公式リストのデータはまだありません（次回の自動確認で作成されます）。</p>`; return; }
  const hits = rows.filter(r => words.every(w => (r[0] + " " + r[1] + " " + r[2]).includes(w)));
  box.innerHTML = hits.length ? `<p class="small muted">${hits.length.toLocaleString()}件${hits.length > 60 ? "（先頭60件を表示）" : ""}</p><div class="list">${hits.slice(0, 60).map(([o, c, n]) => `
    <div class="part" style="cursor:default"><div><div class="name">${esc(n)}</div><div class="sub">現在の品番 <b style="color:var(--text)">${esc(c)}</b>${o !== c ? ` ・ 元の品番 ${esc(o)}` : ""}</div></div><span class="pill st-ok">供給中</span></div>`).join("")}</div>`
    : `<p class="small muted">見つかりませんでした。英語の部品名（例：FILTER OIL、PAD BRAKE、BELT TIMING）で検索してください。</p>`;
}

function render() {
  const tab = (location.hash.slice(1) || "home").split("/")[0];
  const view = views[tab] ? tab : "home";
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === view));
  $main.innerHTML = (READONLY ? readonlyNote() : "") + views[view]();
  updateBadge();
}

function readonlyNote() {
  const when = sharedAt ? `${jp(new Date(sharedAt))}時点の記録です` : "記録はまだ共有されていません";
  return `<div class="ro-note" role="note"><b>閲覧専用</b><span>${when}。画面は自由に操作できますが、記録の追加・変更・保存はできません。</span></div>`;
}

function updateBadge() {
  const n = maintItems().filter(i => ["soon", "over"].includes(maintStatus(i).state)).length;
  const link = document.querySelector('.tabs a[data-tab="alerts"]');
  link.querySelector(".badge")?.remove();
  if (n) link.insertAdjacentHTML("beforeend", `<span class="badge">${n}</span>`);
  if (!READONLY && navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
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
  if (unset.length === items.length && READONLY) return `<div class="alert-banner soon"><span class="ico">i</span><div><strong>交換日の記録はまだありません</strong></div></div>`;
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
    ${READONLY ? "" : `<button class="btn ghost small photo-btn" data-act="photo">${photo ? "写真を変更" : "📷 愛車の写真にする"}</button>`}
    <div class="hero-body">
      <p class="hero-mark"><span>NSX</span></p>
      <p class="hero-sub">NEW SPORTSCAR e<b>X</b>PERIMENTAL</p>
      <div class="hero-tags"><span class="tag red">1991</span><span class="tag">NA1</span><span class="tag">C30A V6 DOHC VTEC</span><span class="tag">280PS</span><span class="tag">ALL ALUMINUM</span></div>
    </div>
    ${photo ? "" : `<span class="credit">${shortCredit("hero")}</span>`}
  </section>
  ${alertBanner()}
  <div class="stats">
    <div class="stat" style="--c:var(--over)"><b style="color:var(--over)">${count("over")}</b><span>超過</span></div>
    <div class="stat" style="--c:var(--soon)"><b style="color:var(--soon)">${count("soon")}</b><span>まもなく</span></div>
    <div class="stat" style="--c:var(--ok)"><b style="color:var(--ok)">${count("ok")}</b><span>良好</span></div>
    <div class="stat" style="--c:var(--silver)"><b>${done}<small class="muted" style="font-size:14px">/${chk}</small></b><span>点検済</span></div>
  </div>

  <div class="section"><div class="eyebrow">Gallery</div><h2 class="section-title">初代NSX フォトギャラリー</h2>
    <div class="gallery">${GALLERY.map(k => `<figure data-photo="${k}">${pic(k)}<figcaption>${esc(photos[k]?.caption)}</figcaption></figure>`).join("")}</div>
  </div>

  <div class="section"><div class="eyebrow">Menu</div><h2 class="section-title">メンテナンスと車両情報</h2>
  <div class="grid two" style="margin-top:12px">
    <a class="feature" href="#alerts">${pic("road-red")}<span class="go">→</span><div class="body"><div class="eyebrow">Maintenance</div><h3>交換タイミングアラート</h3><p>オイル・フルード・タイヤの交換日を記録し、1か月半前にお知らせ。</p></div></a>
    <a class="feature" href="#parts">${pic("tail")}<span class="go">→</span><div class="body"><div class="eyebrow">Parts</div><h3>パーツ・部品供給状況</h3><p>${supply.checkedAt ? `公式ページ確認 ${esc(supply.checkedAt.slice(0, 10))}` : "ホンダ公式ページを毎日確認"}${latest ? ` ・ 最新の変化 ${esc(latest.date)}` : ""}</p></div></a>
    <a class="feature" href="#faults">${pic("engine")}<span class="go">→</span><div class="body"><div class="eyebrow">Troubles</div><h3>典型的な不具合と整備</h3><p>NA1初期型で知られる${data.faults.length}件と、${chk}項目の点検チェック。</p></div></a>
    <a class="feature" href="#info">${pic("countryside")}<span class="go">→</span><div class="body"><div class="eyebrow">History</div><h3>スペック・歴史・開発秘話</h3><p>C30Aの数値から、セナが関わった開発の経緯まで。</p></div></a>
  </div></div>

  <div class="section"><div class="eyebrow">Details</div><h2 class="section-title">ディテール</h2>
    <div class="mosaic" style="margin-top:12px">
      <figure class="tile wide" data-photo="front-1991">${pic("front-1991")}<figcaption>${esc(photos["front-1991"]?.caption)}</figcaption></figure>
      <figure class="tile" data-photo="interior">${pic("interior")}<figcaption>インテリア</figcaption></figure>
      <figure class="tile" data-photo="front-trunk">${pic("front-trunk")}<figcaption>フロントフード内</figcaption></figure>
      <figure class="tile" data-photo="museum-rear">${pic("museum-rear")}<figcaption>リアクォーター</figcaption></figure>
      <figure class="tile" data-photo="black-front">${pic("black-front")}<figcaption>ブラック</figcaption></figure>
      <figure class="tile wide" data-photo="silver-side">${pic("silver-side")}<figcaption>${esc(photos["silver-side"]?.caption)}</figcaption></figure>
    </div>
  </div>
  <p class="updates">データ更新日 ${esc(data.updated)} ・ 1日1回最新データを取得します（最終取得 ${esc(loadedFor)}）。写真は Wikimedia Commons の自由ライセンス画像です（車両情報 → 写真クレジット）。</p>`;
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
      <dl class="kv"><dt>前回交換</dt><dd>${jp(s.last)}</dd><dt>次回交換</dt><dd>${jp(s.due)}（${s.daysLeft >= 0 ? `あと${s.daysLeft}日` : `${-s.daysLeft}日超過`}）</dd><dt>アラート開始</dt><dd>${jp(s.alertFrom)}（1か月半前）</dd></dl>` : `<p class="small muted" style="margin:8px 0 0">${READONLY ? "交換日の記録はありません。" : "前回の交換日を入力してください。"}</p>`}
      <p class="small muted" style="margin:8px 0 0">${esc(item.note || "")}</p>
      ${READONLY ? "" : `<div class="maint-row">
        <label class="field">交換日を記録<input type="date" max="${iso(today())}" value="${iso(today())}" data-date="${item.id}"></label>
        <button class="btn primary" data-act="record" data-id="${item.id}">記録する</button>
        ${hist.length ? `<button class="btn small" data-act="undo" data-id="${item.id}">直前の記録を取り消す</button>` : ""}
        ${isCustom ? `<button class="btn small" data-act="del-custom" data-id="${item.id}">項目を削除</button>` : ""}
      </div>`}
      ${hist.length > 1 ? `<details style="margin-top:8px"><summary class="small muted">交換履歴（${hist.length}回）</summary><ol class="history">${[...hist].reverse().map(d => `<li>${jp(parse(d))}</li>`).join("")}</ol></details>` : ""}
    </article>`;
  }).join("");
  const notif = !READONLY && "Notification" in window && Notification.permission === "default"
    ? `<button class="btn small" data-act="notify">アプリを開いたときに通知する</button>` : "";
  return `${banner("road-red", "Maintenance", "交換タイミングアラート", "交換した日を入力すると次回交換日を計算し、<b>その1か月半前</b>からお知らせします。", "05")}
  ${alertBanner()}
  <div class="maint">${cards}</div>
  ${READONLY ? "" : `<div class="toolbar" style="margin-top:16px"><button class="btn" data-act="add-custom">＋ 交換項目を追加（タイミングベルトなど）</button>${notif}
  <button class="btn small" data-act="export">データを書き出す</button><button class="btn small" data-act="import">読み込む</button></div>
  <p class="small muted">記録はこの端末のブラウザーに保存されます。機種変更の前に「データを書き出す」で保存してください。</p>`}`;
}

function partState(p) {
  const mine = parts[p.id] || {};
  const status = mine.status || p.status;
  const no = (mine.partNo || "").trim().toUpperCase();
  const listed = !!no && supply.partNumbers?.includes(no);
  const cataloged = !!no && !listed && supply.catalogNumbers?.includes(no);
  const official = (p.numbers || []).map(n => ({ ...n, listed: !!supply.partNumbers?.includes(n.no) }));
  return { status, partNo: mine.partNo || "", memo: mine.memo || "", listed, cataloged, official };
}

// 公式品番の表（ダイアログ用）
const numberRows = (list, title) => list?.length ? `<div><div class="small muted" style="margin-bottom:4px">${title}</div><div class="list">${list.map(n => `
  <div class="part" style="cursor:default;align-items:flex-start"><div>${n.label ? `<div class="small" style="color:var(--red);font-weight:700">${esc(n.label)}</div>` : ""}
    <div class="name" style="font-family:var(--display);letter-spacing:.06em;font-size:17px">${esc(n.no)}</div>
    <div class="sub">${esc(n.name)}${n.orig ? ` ・ 元の品番 ${esc(n.orig)}` : ""}</div></div>
    ${supply.partNumbers?.includes(n.no) ? `<span class="pill st-ok">供給中</span>` : ""}</div>`).join("")}</div></div>` : "";

// ---------- 公式パーツ一覧（3階層） ----------
// ホンダ品番の先頭2桁は部品の系統を表す（例：19 = 冷却、45 = フロントブレーキ）。これで大分類 → 中分類 → 部品に整理する。
const TAXONOMY = [
  { id: "engine", name: "エンジン本体", en: "Engine", img: "engine", subs: { "11": "シリンダーブロック・カバー", "12": "シリンダーヘッド・バルブ", "13": "クランク・ピストン・コンロッド", "14": "カムシャフト・タイミング", "15": "潤滑（オイル）" } },
  { id: "intake", name: "吸排気・燃料", en: "Intake / Exhaust", img: "front-trunk", subs: { "16": "燃料噴射・スロットル", "17": "吸気・燃料タンク・ポンプ", "18": "排気・排ガス浄化" } },
  { id: "cooling", name: "冷却", en: "Cooling", img: "museum-rear", subs: { "19": "ラジエーター・ウォーターポンプ・ホース" } },
  { id: "drive", name: "クラッチ・ミッション・駆動", en: "Drivetrain", img: "road-red", subs: { "21": "ミッションケース", "22": "クラッチ", "23": "ギア・シャフト", "24": "シフト・セレクト機構", "41": "デファレンシャル", "42": "ドライブシャフト・ハブ", "44": "ホイール・タイヤ" } },
  { id: "electrical", name: "電装", en: "Electrical", img: "front-1991", subs: { "30": "点火", "31": "充電・始動・バッテリー", "32": "ワイヤーハーネス", "33": "ヘッドライト・フロント灯火", "34": "リア灯火・室内灯", "35": "スイッチ", "36": "センサー・制御バルブ", "37": "ECU・メーター・センサー", "38": "リレー・コントロールユニット・ホーン", "39": "オーディオ・アンテナ" } },
  { id: "brake", name: "ブレーキ・ペダル", en: "Brakes", img: "profile", subs: { "43": "リアブレーキ", "45": "フロントブレーキ", "46": "マスターシリンダー・ペダル・クラッチ油圧", "47": "パーキングブレーキ", "57": "ABS" } },
  { id: "chassis", name: "サスペンション・ステアリング", en: "Chassis", img: "silver-side", subs: { "50": "エンジンマウント・サブフレーム", "51": "フロントサスペンション", "52": "リアサスペンション", "53": "ステアリング", "54": "シフトレバー・ケーブル" } },
  { id: "body", name: "ボディ・外装", en: "Body", img: "black-front", subs: { "60": "ボディ フロント", "61": "ボディ", "63": "ボディ サイド", "64": "ボディ", "66": "ボディ リア", "67": "ドアパネル", "68": "フード・トランク", "69": "ボディ", "70": "ルーフ", "71": "バンパー・フロント外装", "72": "ドア機構・ウェザーストリップ", "73": "ガラス", "74": "外装部品・アンダーカバー", "75": "エンブレム・モール", "76": "ライト周り・ワイパー・ミラー" } },
  { id: "interior", name: "内装・空調", en: "Interior / A/C", img: "interior", subs: { "77": "ダッシュボード", "78": "メーター", "79": "ヒーター", "80": "エアコン", "81": "シート", "82": "シート", "83": "内装トリム", "84": "内装トリム・マット", "85": "その他内装", "87": "マーク・ラベル", "89": "工具・ジャッキ" } },
  { id: "hardware", name: "ボルト・ナット・汎用小物", en: "Hardware", img: "tail", subs: { "90": "ボルト・ナット・ワッシャー・クリップ", "91": "ベアリング・オイルシール・Oリング", "92": "汎用部品", "93": "汎用部品", "94": "汎用部品", "95": "汎用部品", "96": "汎用部品" } },
  { id: "kits", name: "キット・セット品・その他", en: "Kits / Others", img: "museum-red", subs: { "01": "セット品", "04": "セット品", "06": "整備キット", "08": "アクセサリー・ケミカル" } },
  { id: "at", name: "AT（オートマチック）関連", en: "Automatic", img: "cockpit", at: true, subs: { "25": "AT ケース", "26": "AT ケース", "27": "AT 油圧・バルブボディ", "28": "AT 制御", "29": "AT その他" } },
];
const SUB_INDEX = {};
TAXONOMY.forEach(g => Object.entries(g.subs).forEach(([k, v]) => { SUB_INDEX[k] = { group: g, name: v }; }));

const JP = { BOLT: "ボルト", COVER: "カバー", BRACKET: "ブラケット", SPRING: "スプリング", CLIP: "クリップ", PLATE: "プレート", NUT: "ナット", PIPE: "パイプ", STAY: "ステー", HARNESS: "ハーネス", SHIM: "シム", WASHER: "ワッシャー", "O-RING": "Oリング", CLAMP: "クランプ", BEARING: "ベアリング", HOSE: "ホース", CAP: "キャップ", PACKING: "パッキン", SCREW: "スクリュー", GROMMET: "グロメット", VALVE: "バルブ", COLLAR: "カラー", SEAL: "シール", RUBBER: "ラバー", HOLDER: "ホルダー", TIRE: "タイヤ", GEAR: "ギア", DISK: "ディスク", SENSOR: "センサー", WEIGHT: "ウェイト", TUBE: "チューブ", ABSORBER: "ショックアブソーバー", SWITCH: "スイッチ", LABEL: "ラベル", "BOLT-WASHER": "ボルト（ワッシャー付）", ARM: "アーム", JOINT: "ジョイント", PISTON: "ピストン", RING: "リング", ROD: "ロッド", SHAFT: "シャフト", CYLINDER: "シリンダー", GLASS: "ガラス", BUSH: "ブッシュ", BULB: "電球", PIN: "ピン", LOCK: "ロック", BAND: "バンド", WEATHERSTRIP: "ウェザーストリップ", CALIPER: "キャリパー", GUIDE: "ガイド", DUCT: "ダクト", STOPPER: "ストッパー", CONTROL: "コントロール", RELAY: "リレー", GASKET: "ガスケット", FILTER: "フィルター", CUSHION: "クッション", BOOT: "ブーツ", SPACER: "スペーサー", BOX: "ボックス", CABLE: "ケーブル", HINGE: "ヒンジ", INSULATOR: "インシュレーター", KNOB: "ノブ", PAD: "パッド", COTTER: "コッター", SLEEVE: "スリーブ", "SCREW-WASHER": "スクリュー（ワッシャー付）", CASE: "ケース", RETAINER: "リテーナー", SOCKET: "ソケット", GARNISH: "ガーニッシュ", BODY: "ボディ", MOTOR: "モーター", LIGHT: "ライト", FENDER: "フェンダー", PANEL: "パネル", GUARD: "ガード", SOLENOID: "ソレノイド", FRAME: "フレーム", LAMP: "ランプ", CIRCLIP: "サークリップ", HOOK: "フック", OIL: "オイル", PUMP: "ポンプ", BASE: "ベース", MANIFOLD: "マニホールド", CLUTCH: "クラッチ", LEVER: "レバー", PROTECTOR: "プロテクター", BEAM: "ビーム", WIRE: "ワイヤー", CONVERTER: "コンバーター", PLUG: "プラグ", CARRIER: "キャリア", VISOR: "バイザー", BELT: "ベルト", HEAD: "ヘッド", TANK: "タンク", HORN: "ホーン", TAPE: "テープ", LENS: "レンズ", KNUCKLE: "ナックル", BLOCK: "ブロック", PULLEY: "プーリー", CAMSHAFT: "カムシャフト", SEAT: "シート", STRAINER: "ストレーナー", HANGER: "ハンガー", FORK: "フォーク", HEADLIGHT: "ヘッドライト", FUSE: "ヒューズ", BAR: "バー", MOLDING: "モール", EMBLEM: "エンブレム", ADJUSTER: "アジャスター", ALTERNATOR: "オルタネーター", THERMOSTAT: "サーモスタット", ELEMENT: "エレメント", REGULATOR: "レギュレーター", CARTRIDGE: "カートリッジ", MODULATOR: "モジュレーター", RETRACTABLE: "リトラクタブル", BATTERY: "バッテリー", END: "エンド", PIVOT: "ピボット", MOTION: "モーション", DOWEL: "ダウエル", NEEDLE: "ニードル", INJECTOR: "インジェクター", CONNECTOR: "コネクター", MIRROR: "ミラー", HANDLE: "ハンドル", COIL: "コイル", UNIT: "ユニット", MODULE: "モジュール", "OIL SEAL": "オイルシール", TERMINAL: "ターミナル", GRILLE: "グリル", BUMPER: "バンパー", SPOILER: "スポイラー", MAT: "マット", TRAY: "トレイ", LINER: "ライナー", CHAIN: "チェーン", WHEEL: "ホイール", HUB: "ハブ", BALL: "ボール", ASSY: "ASSY", MARK: "マーク", RESISTOR: "抵抗", THERMOSENSOR: "温度センサー", SUPPORT: "サポート", LID: "リッド", MAINSHAFT: "メインシャフト", COUNTERSHAFT: "カウンターシャフト", SYNCHRO: "シンクロ", FLANGE: "フランジ", FLOAT: "フロート", TANK: "タンク", RESERVOIR: "リザーバー", PEDAL: "ペダル", SPEEDOMETER: "スピードメーター", METER: "メーター", BLADE: "ブレード", MOTOR: "モーター", CORD: "コード", ANTENNA: "アンテナ", SPEAKER: "スピーカー", HEATER: "ヒーター", CONDENSER: "コンデンサー", EVAPORATOR: "エバポレーター", COMPRESSOR: "コンプレッサー", BLOWER: "ブロワー", BOARD: "ボード", LINING: "ライニング", CARPET: "カーペット", BELT: "ベルト", GRIP: "グリップ", STRIKER: "ストライカー", LATCH: "ラッチ", ORNAMENT: "オーナメント", SHIELD: "シールド", DAMPER: "ダンパー", STABILIZER: "スタビライザー", SPRING: "スプリング", LINK: "リンク", RACK: "ラック", GEARBOX: "ギアボックス", COLUMN: "コラム", WHEEL: "ホイール", "SEAT BELT": "シートベルト" };
const jpType = name => JP[name.split(" ")[0]] || JP[name.split(/[ .]/)[0]] || "";

let catalogQuery = "";
let showAT = store.get("showAT", false);
const isAT = r => /-(PR9|PX4)-/.test(r[0] + r[1]) || /(^|\s)AT(\s|-|$)/.test(r[2]) || ["25", "26", "27", "28", "29"].includes(r[1].slice(0, 2));
const isNA2 = r => /-PBY-/.test(r[1]) || /TYPE R/.test(r[2]);
const subOf = r => SUB_INDEX[r[1].slice(0, 2)] || { group: TAXONOMY[TAXONOMY.length - 2], name: "その他" };
const MAIN_NUMBERS = () => new Set(data.parts.flatMap(c => c.items.flatMap(i => (i.numbers || []).map(n => n.no))));

function catalogRows() {
  return (officialRows || []).filter(r => showAT || !isAT(r));
}

function catalogItem(r, main) {
  const t = jpType(r[2]);
  return `<div class="part" data-act="opart" data-no="${esc(r[1])}" data-orig="${esc(r[0])}" role="button" tabindex="0">
    <div><div class="name">${t ? `<span class="jp">${esc(t)}</span>` : ""}${esc(r[2])}</div>
    <div class="sub"><b class="pn">${esc(r[1])}</b>${r[0] !== r[1] ? ` ・ 元 ${esc(r[0])}` : ""}${main.has(r[1]) ? ` ・ <span style="color:var(--gold)">★主要パーツ</span>` : ""}${isNA2(r) ? ` ・ <span class="muted">NA2/タイプR系</span>` : ""}${isAT(r) ? ` ・ <span style="color:var(--soon)">AT</span>` : ""}</div></div>
    <span class="pill st-ok">供給中</span></div>`;
}

function catalogView(path) {
  const head = `${banner("tail", "Parts Catalog", "公式パーツ一覧", "ホンダ公式の継続供給中リストを、品番の系統ごとに3階層で整理しています。", "01")}
    ${partsTabs("all")}`;
  if (!officialRows) { loadOfficial().then(() => { if (location.hash.startsWith("#parts/all")) render(); }); return head + `<p class="muted">公式リストを読み込み中…</p>`; }
  if (!officialRows.length) return head + `<p class="muted">公式リストのデータがまだありません。毎朝の自動確認で作成されます。</p>`;
  const rows = catalogRows();
  const main = MAIN_NUMBERS();
  const [gid, sid] = path;
  const tools = `<div class="toolbar"><input type="text" id="csearch" placeholder="全体から検索（例：PAD、HOSE WATER、ベアリング、19200）" value="${esc(catalogQuery)}" aria-label="公式パーツを検索">
    <label class="chip ${showAT ? "on" : ""}" style="display:flex;align-items:center;gap:6px"><input type="checkbox" data-act="showat" ${showAT ? "checked" : ""} style="accent-color:var(--red)">AT用も表示</label></div>
    <div id="cresults"></div>`;
  const crumbs = [`<a href="#parts/all">すべて</a>`];
  let body = "";
  if (!gid) {
    const groups = TAXONOMY.filter(g => showAT || !g.at).map(g => ({ g, n: rows.filter(r => subOf(r).group === g).length })).filter(x => x.n);
    body = `<p class="small muted">${rows.length.toLocaleString()}点（${showAT ? "AT用を含む" : "MT車向け・AT専用部品を除く"}）／ 公式リスト ${esc(supply.checkedAt?.slice(0, 10) || "")} 時点</p>
      <div class="cat-grid">${groups.map(({ g, n }) => `<a class="cat-card" href="#parts/all/${g.id}">${pic(g.img)}<div class="body"><div class="eyebrow">${esc(g.en)}</div><h3>${esc(g.name)}</h3><p>${n.toLocaleString()}点 ・ ${Object.keys(g.subs).filter(k => rows.some(r => r[1].startsWith(k))).length}分類</p></div></a>`).join("")}</div>`;
  } else {
    const g = TAXONOMY.find(x => x.id === gid);
    if (!g) return head + `<p>分類が見つかりません。<a href="#parts/all">一覧へ戻る</a></p>`;
    crumbs.push(`<a href="#parts/all/${g.id}">${esc(g.name)}</a>`);
    const inGroup = rows.filter(r => subOf(r).group === g);
    if (!sid) {
      const subs = [...new Set(inGroup.map(r => r[1].slice(0, 2)))].sort();
      body = `<div class="list">${subs.map(k => {
        const items = inGroup.filter(r => r[1].startsWith(k));
        const mains = items.filter(r => main.has(r[1])).length;
        return `<a class="part" href="#parts/all/${g.id}/${k}" style="text-decoration:none"><div><div class="name"><span class="code">${k}</span>${esc(SUB_INDEX[k]?.name || "その他")}</div><div class="sub">${items.length.toLocaleString()}点${mains ? ` ・ ★主要パーツ ${mains}点` : ""} ・ 例：${esc([...new Set(items.map(r => jpType(r[2]) || r[2].split(" ")[0]))].slice(0, 4).join("、"))}</div></div><span class="go-sm">›</span></a>`;
      }).join("")}</div>`;
    } else {
      crumbs.push(`<span>${esc(SUB_INDEX[sid]?.name || sid)}</span>`);
      const items = inGroup.filter(r => r[1].startsWith(sid)).sort((a, b) => (main.has(b[1]) - main.has(a[1])) || a[2].localeCompare(b[2]));
      // 部品の種類（先頭の単語）ごとにまとめる
      const byType = {};
      items.forEach(r => { const t = jpType(r[2]) || r[2].split(" ")[0]; (byType[t] ||= []).push(r); });
      const types = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
      body = `<p class="small muted">${items.length.toLocaleString()}点 ・ ${types.length}種類</p>
        ${types.map(([t, list]) => `<details class="type-group" ${types.length <= 4 || list.some(r => main.has(r[1])) ? "open" : ""}><summary><span>${esc(t)}</span><span class="muted small">${list.length}点</span></summary><div class="list">${list.map(r => catalogItem(r, main)).join("")}</div></details>`).join("")}`;
    }
  }
  return head + tools + `<nav class="crumbs">${crumbs.join(`<span class="sep">›</span>`)}</nav>` + body;
}

function searchCatalog(q) {
  const box = $main.querySelector("#cresults"); if (!box) return;
  catalogQuery = q;
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = ""; return; }
  const main = MAIN_NUMBERS();
  const hits = catalogRows().filter(r => { const hay = `${r[0]} ${r[1]} ${r[2]} ${jpType(r[2])} ${subOf(r).name}`.toUpperCase(); return words.every(w => hay.includes(w)); });
  box.innerHTML = hits.length ? `<p class="small muted">${hits.length.toLocaleString()}件${hits.length > 80 ? "（先頭80件）" : ""}</p><div class="list" style="margin-bottom:18px">${hits.slice(0, 80).map(r => catalogItem(r, main)).join("")}</div>`
    : `<p class="small muted">見つかりませんでした。</p>`;
}

function openOfficialPart(no, orig) {
  const r = (officialRows || []).find(x => x[1] === no && x[0] === orig) || [orig, no, ""];
  const sub = subOf(r);
  const alts = (officialRows || []).filter(x => x[1] === no && x[0] !== orig).map(x => x[0]);
  $dlgBody.innerHTML = `<div class="eyebrow">${esc(sub.group.name)} › ${esc(sub.name)}</div>
    <h3 style="margin-top:6px">${esc(jpType(r[2]) || "部品")}</h3>
    <div class="form">${numberRows([{ no: r[1], name: r[2], orig: r[0] !== r[1] ? r[0] : undefined }], "ホンダ純正品番（現在の品番）")}
    ${alts.length ? `<p class="small muted" style="margin:0">この品番に統合された元の品番：${alts.map(esc).join("、")}</p>` : ""}
    ${isAT(r) ? `<p class="small" style="margin:0;color:var(--soon)">AT車用の部品です。</p>` : ""}${isNA2(r) ? `<p class="small muted" style="margin:0">NA2（3.2L）・タイプR系の部品の可能性があります。</p>` : ""}
    <p class="small muted" style="margin:0">NA1・NA2共通のリストです。1991年式への適合はパーツカタログまたは販売店で確認してください。</p>
    <div class="toolbar"><button class="btn" data-copy="${esc(r[1])}">品番をコピー</button></div></div>`;
  $dlgBody.querySelector("[data-copy]").onclick = e => { navigator.clipboard?.writeText(e.target.dataset.copy).then(() => { e.target.textContent = "コピーしました"; }).catch(() => {}); };
  $dlg.showModal();
}

const partsTabs = active => `<div class="subtabs"><a class="chip ${active === "main" ? "on" : ""}" href="#parts">主要パーツ（${data.parts.reduce((n, c) => n + c.items.length, 0)}点）</a><a class="chip ${active === "all" ? "on" : ""}" href="#parts/all">公式パーツ一覧（${officialRows ? `${catalogRows().length.toLocaleString()}点` : "4,000点超"}）</a></div>`;

function partsView() {
  const path = location.hash.slice(1).split("/");
  if (path[1] === "all") return catalogView(path.slice(2));
  const q = partQuery.trim().toLowerCase();
  const counts = { all: 0, supply: 0, repro: 0, discontinued: 0, check: 0 };
  const cats = data.parts.map(cat => {
    const rows = cat.items.map(p => ({ p, s: partState(p) })).filter(({ p, s }) => {
      counts.all++; counts[s.status]++;
      if (partFilter !== "all" && s.status !== partFilter) return false;
      return !q || (p.name + s.partNo + s.memo + (p.numbers || []).map(n => n.no + n.name).join(" ")).toLowerCase().includes(q);
    });
    if (!rows.length) return "";
    return `<div class="part-cat"><h3>${esc(cat.category)}</h3><div class="list">${rows.map(({ p, s }) => `
      <div class="part" data-act="part" data-id="${p.id}" role="button" tabindex="0">
        <div><div class="name">${esc(p.name)}</div><div class="sub">${s.partNo ? `品番 ${esc(s.partNo)}` : s.official.length ? `品番 <b style="color:var(--text);font-family:var(--display);letter-spacing:.05em">${esc(s.official[0].no)}</b>${s.official.length > 1 ? ` ほか${s.official.length - 1}件` : ""}` : p.candidates?.length ? `品番候補 ${p.candidates.length}件` : "品番なし"}${s.listed ? " ・ <span style='color:var(--ok)'>公式の継続供給リストに掲載</span>" : s.cataloged ? " ・ <span style='color:var(--soon)'>カタログ記載・継続供給リスト外</span>" : ""}${s.memo ? ` ・ ${esc(s.memo)}` : ""}</div></div>
        <span class="pill ${STATUS[s.status].cls}">${STATUS[s.status].label}</span>
      </div>`).join("")}</div></div>`;
  }).join("");
  const chips = ["all", "supply", "repro", "discontinued", "check"].map(k =>
    `<button class="chip ${partFilter === k ? "on" : ""}" data-act="filter" data-k="${k}">${k === "all" ? "すべて" : STATUS[k].label} ${counts[k]}</button>`).join("");
  const sources = (supply.sources || []).map(s => `<div class="source"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a><br>
    <span class="muted">${s.ok ? "取得成功" : "取得失敗（前回の内容を保持）"} ・ 内容の最終変化 ${esc(s.changedAt || "—")}${s.documents?.length ? ` ・ 添付資料 ${s.documents.length}件` : ""}</span></div>`).join("");
  const changes = (supply.changes || []).slice(0, 8).map(c => `<li><b>${esc(c.date)}</b> ${esc(c.source)}：${esc(c.summary)}</li>`).join("");
  return `${banner("tail", "Parts &amp; Supply", "パーツリスト・部品供給状況", "項目ごとの主要パーツと、ホンダ公式の供給状況（毎日確認）。", "01-02")}
  ${partsTabs("main")}
  <p class="lead">項目ごとに整理した主要パーツです。タップすると、品番・販売状況（販売中／復刻あり／廃番／要確認）・メモを登録できます。品番を登録すると、毎日確認しているホンダ公式「継続供給中部品番号リスト」と自動で照合します。</p>
  ${data.partsNote ? `<p class="small muted" style="margin-top:-6px">※ ${esc(data.partsNote)}</p>` : ""}
  <div class="toolbar"><input type="text" placeholder="部品名・品番で検索" value="${esc(partQuery)}" data-act="search" aria-label="部品を検索"></div>
  <div class="chips">${chips}</div>
  ${cats || `<p class="muted">該当する部品はありません。</p>`}
  <div class="section"><div class="eyebrow">Official</div><h2 class="section-title">メーカーの供給状況（毎日自動確認）</h2></div>
  <div class="card">
    <p class="small" style="margin-top:0">ホンダは2025年に初代NSX向けの「Honda Heritage Parts」（復刻純正部品）と「Honda Restoration Service」を開始しています。以下の公式ページを1日1回確認し、内容が変わると記録します。
    ${supply.partNumbers?.length ? `<br>継続供給中リストの品番：<b>${supply.partNumbers.length.toLocaleString()}件</b>${supply.catalogNumbers?.length ? ` ・ パーツカタログ記載：${supply.catalogNumbers.length.toLocaleString()}件` : ""}` : ""}</p>
    ${sources || `<p class="small muted">自動確認はまだ実行されていません（GitHub Actions の「Refresh NSX parts supply」が毎朝実行します）。</p>`}
    ${changes ? `<h3 style="margin-top:14px">最近の変化</h3><ul class="small" style="padding-left:18px;margin:0">${changes}</ul>` : ""}
    <p class="small muted" style="margin-bottom:0">最終確認：${esc(supply.checkedAt?.replace("T", " ") || "—")}。最終的な在庫・価格・廃番はホンダ販売店でご確認ください。</p>
  </div>
  <div class="section"><div class="eyebrow">Search</div><h2 class="section-title">公式部品検索（継続供給中リスト）</h2>
    <p class="lead">ホンダ公式「NSX 継続供給中の部品番号リスト」から、英語の部品名や品番で探せます。NA1・NA2共通のリストのため、年式への適合は販売店で確認してください。</p>
    <div class="toolbar"><input type="text" id="osearch" placeholder="例：PAD BRAKE / BELT TIMING / 15400" aria-label="公式部品を検索"></div>
    <div id="oresults"></div>
  </div>`;
}

function faults() {
  return `${banner("engine", "Troubles &amp; Service", "典型的な不具合と整備リスト", "1991年式NA1で知られる不具合。点検した項目にチェックすると日付が記録されます。", "03-04")}
  ${data.faults.map(f => {
    const done = f.checks.filter((_, i) => checks[`${f.id}:${i}`]).length;
    return `<article class="card fault">
      <div class="fault-head"><h3>${esc(f.title)}</h3><span class="sev sev-${f.severity}">重要度 ${f.severity}</span></div>
      <p><b>症状</b>${esc(f.symptom)}</p><p><b>原因</b>${esc(f.cause)}</p>
      <div class="progress">整備チェック ${done}/${f.checks.length}<div class="bar"><span style="width:${done / f.checks.length * 100}%;background:var(--ok)"></span></div></div>
      <ul class="checks">${f.checks.map((c, i) => {
        const key = `${f.id}:${i}`, when = checks[key];
        return `<li><label><input type="checkbox" data-act="check" data-key="${key}" ${when ? "checked" : ""} ${READONLY ? "disabled" : ""}><span class="${when ? "done" : ""}">${esc(c)}${when ? `<span class="when">✓ ${jp(parse(when))} 実施</span>` : ""}</span></label></li>`;
      }).join("")}</ul>
    </article>`;
  }).join("")}
  ${READONLY ? "" : `<button class="btn small" data-act="reset-checks">チェックをすべて外す</button>`}`;
}

function info() {
  const sub = [["specs", "基本スペック"], ["history", "車両の歴史"], ["dev", "開発経緯・開発者"], ["credits", "写真クレジット"]];
  const figure = (key, cls = "") => key && photos[key] ? `<figure class="${cls}" data-photo="${key}">${pic(key)}</figure>` : "";
  let body = "";
  const heads = { specs: ["engine", "Specifications", "車両の基本スペック", "1991年式 NA1 のカタログ値。", "06"], history: ["countryside", "History", "車両の歴史", "1984年の開発開始から、現在のヘリテージ活動まで。", "07"], dev: ["cockpit", "Development", "開発経緯・開発者来歴", "「人間中心のスーパースポーツ」が生まれるまで。", "08"], credits: ["museum-red", "Credits", "写真クレジット", "このアプリの写真は Wikimedia Commons の自由ライセンス画像です。", ""] };
  if (infoTab === "specs") {
    body = `<div class="big-numbers"><div><b>280<small>PS</small></b><span>最高出力（MT）</span></div><div><b>2,977<small>cc</small></b><span>C30A V6</span></div><div><b>1,350<small>kg</small></b><span>車両重量（MT）</span></div></div>
      <div class="grid two">${data.specs.map(g => `<div class="card spec-card">${data.specImages?.[g.group] ? `<div class="spec-img" data-photo="${data.specImages[g.group]}">${pic(data.specImages[g.group])}<h3>${esc(g.group)}</h3></div>` : `<h3 style="padding:16px 16px 0">${esc(g.group)}</h3>`}<table class="spec-table">${g.items.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`).join("")}</div>
      <p class="small muted">${esc(data.specsNote)}</p>`;
  } else if (infoTab === "history") {
    body = `<div class="card"><ol class="timeline">${data.history.map(h => `<li class="${h.title === "あなたの年式" ? "mine" : ""}"><div class="date">${esc(h.date)}</div><strong>${esc(h.title)}</strong><p>${esc(h.text)}</p>${figure(h.img)}</li>`).join("")}</ol></div>`;
  } else if (infoTab === "dev") {
    const d = data.development;
    body = `<div class="grid two">${d.concept.map(c => `<div class="card concept">${figure(c.img)}<div class="txt"><h3>${esc(c.title)}</h3><p class="small" style="margin:0">${esc(c.text)}</p></div></div>`).join("")}</div>
      <div class="section"><div class="eyebrow">People</div><h2 class="section-title">開発者・関係者の来歴</h2></div>
      <div class="grid">${d.people.map(p => `<div class="card person"><div class="avatar">${esc(p.name.slice(0, 1))}</div><div><h3 style="margin:0">${esc(p.name)}</h3><div class="small" style="color:var(--red)">${esc(p.role)}</div><p class="small" style="margin:4px 0 0">${esc(p.text)}</p></div></div>`).join("")}</div>
      <p class="small muted">${esc(d.note)}</p>`;
  } else {
    body = `<div class="mosaic">${Object.keys(photos).map(k => `<figure class="tile" data-photo="${k}">${pic(k)}<figcaption>${esc(photos[k].caption)}</figcaption></figure>`).join("")}</div>
      <ul class="credits" style="margin-top:16px;padding-left:18px">${Object.values(photos).map(p => `<li>${esc(p.caption)} — ${esc(p.author)}、<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.title)}</a>（${esc(p.license)}）</li>`).join("")}</ul>
      <p class="small muted">いずれも Wikimedia Commons で公開されている CC0 / CC BY / CC BY-SA の画像を縮小して使用しています。ホンダの公式画像ではありません。</p>`;
  }
  return `${banner(...heads[infoTab])}<div class="subtabs">${sub.map(([k, l]) => `<button class="chip ${infoTab === k ? "on" : ""}" data-act="info" data-k="${k}">${l}</button>`).join("")}</div>${body}`;
}

// ---------- 操作 ----------
function openPhoto(key) {
  const p = photos[key]; if (!p) return;
  $dlg.classList.add("photo");
  $dlgBody.innerHTML = `<img src="${asset(`img/${p.file}`)}" alt="${esc(p.caption)}"><div class="cap"><b>${esc(p.caption)}</b>Photo: ${esc(p.author)} ・ ${esc(p.license)} ・ <a href="${esc(p.source)}" target="_blank" rel="noopener">Wikimedia Commons</a></div>`;
  $dlg.showModal();
}
$dlg.addEventListener("close", () => $dlg.classList.remove("photo"));

function openPart(id) {
  const p = data.parts.flatMap(c => c.items).find(x => x.id === id);
  const s = partState(p);
  if (READONLY) {
    $dlgBody.innerHTML = `<h3>${esc(p.name)}</h3><div class="form">
      ${numberRows(s.official, "ホンダ純正品番（1991年式MT向けの推定・現在の品番）")}
      ${numberRows(p.candidates, "品番の候補（適合を確認してください）")}
      ${p.note ? `<p class="small" style="margin:0;color:var(--muted)">${esc(p.note)}</p>` : ""}
      <dl class="kv"><dt>販売状況</dt><dd><span class="pill ${STATUS[s.status].cls}">${STATUS[s.status].label}</span></dd>
      ${s.partNo ? `<dt>使用する品番</dt><dd>${esc(s.partNo)}${s.listed ? "（継続供給中リストに掲載）" : ""}</dd>` : ""}
      ${s.memo ? `<dt>メモ</dt><dd style="white-space:pre-wrap">${esc(s.memo)}</dd>` : ""}</dl>
    </div>`;
    $dlg.showModal();
    return;
  }
  $dlgBody.innerHTML = `<h3>${esc(p.name)}</h3>
    <div class="form">
      ${numberRows(s.official, "ホンダ純正品番（1991年式MT向けの推定・現在の品番）")}
      ${numberRows(p.candidates, "品番の候補（適合を確認してください）")}
      ${p.note ? `<p class="small" style="margin:0;color:var(--muted)">${esc(p.note)}</p>` : ""}
      <label class="field">販売状況<select id="f-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      <label class="field">自分で使う品番（上と違う品番を使う場合に入力）<input type="text" id="f-no" value="${esc(s.partNo)}" autocapitalize="characters"></label>
      ${s.partNo ? `<p class="small" style="margin:0">${s.listed ? "✓ 公式の継続供給中部品番号リストに掲載されています。" : s.cataloged ? "パーツカタログには載っていますが、継続供給中部品番号リストにはありません（販売終了の可能性。販売店で確認してください）。" : supply.partNumbers?.length ? "公式の継続供給中部品番号リストにもパーツカタログにも見つかりませんでした（表記違いの可能性）。" : "公式リストのデータがまだありません。"}</p>` : ""}
      <label class="field">メモ（価格・購入先・交換日など）<textarea id="f-memo" rows="3">${esc(s.memo)}</textarea></label>
      <div class="toolbar"><button class="btn primary" id="f-save">保存</button>${parts[id] ? `<button class="btn" id="f-reset">初期値に戻す</button>` : ""}</div>
    </div>`;
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
    <label class="field">項目名<input type="text" id="c-name" placeholder="例：タイミングベルト"></label>
    <label class="field">交換周期（月）<input type="number" id="c-months" min="1" max="240" value="12"></label>
    <label class="field">メモ<input type="text" id="c-note"></label>
    <button class="btn primary" id="c-save">追加</button></div>`;
  $dlgBody.querySelector("#c-save").onclick = () => {
    const name = $dlgBody.querySelector("#c-name").value.trim();
    const months = parseInt($dlgBody.querySelector("#c-months").value, 10);
    if (!name || !(months > 0)) return;
    custom.push({ id: "c" + Date.now(), name, months, note: $dlgBody.querySelector("#c-note").value.trim() });
    store.set("custom", custom); $dlg.close(); render();
  };
  $dlg.showModal();
}

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
  const blob = new Blob([JSON.stringify({ app: "nsx-care", exported: new Date().toISOString(), maint, custom, checks, parts }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `nsx-care-${iso(today())}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json,.json" });
  input.onchange = async () => {
    try {
      const d = JSON.parse(await input.files[0].text());
      if (d.app !== "nsx-care") throw new Error();
      ({ maint = {}, custom = [], checks = {}, parts = {} } = d);
      Object.entries({ maint, custom, checks, parts }).forEach(([k, v]) => store.set(k, v));
      render(); alert("読み込みました。");
    } catch { alert("NSX CARE の書き出しファイルではありません。"); }
  };
  input.click();
}

function notifyDue() {
  if (READONLY || !("Notification" in window) || Notification.permission !== "granted") return;
  const due = maintItems().filter(i => ["soon", "over"].includes(maintStatus(i).state));
  const key = "notified";
  if (!due.length || store.get(key, "") === iso(today())) return;
  store.set(key, iso(today()));
  new Notification("NSX CARE 交換時期のお知らせ", { body: due.map(i => i.name).join("、") + " の交換時期です。", icon: asset("icon-192.png") });
}

const WRITE_ACTS = new Set(["record", "undo", "del-custom", "add-custom", "notify", "export", "import", "photo", "reset-checks"]);
$main.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) { const ph = e.target.closest("[data-photo]"); if (ph && !e.target.closest("a")) openPhoto(ph.dataset.photo); return; }
  const { act, id, k } = el.dataset;
  if (READONLY && WRITE_ACTS.has(act)) return;
  if (act === "record") {
    const v = $main.querySelector(`[data-date="${id}"]`).value;
    if (!v) return;
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
  else if (act === "photo") setPhoto();
  else if (act === "part") openPart(id);
  else if (act === "opart") openOfficialPart(el.dataset.no, el.dataset.orig);
  else if (act === "filter") { partFilter = k; render(); }
  else if (act === "info") { infoTab = k; render(); scrollTo(0, 0); }
  else if (act === "reset-checks") { if (confirm("整備チェックをすべて外しますか？")) { checks = {}; store.set("checks", checks); render(); } }
});
$main.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "showat") { showAT = el.checked; store.set("showAT", showAT); render(); return; }
  if (el.dataset.act === "check") {
    if (READONLY) { el.checked = !el.checked; return; }
    if (el.checked) checks[el.dataset.key] = iso(today()); else delete checks[el.dataset.key];
    store.set("checks", checks); render();
  }
});
$main.addEventListener("input", e => {
  if (e.target.id === "osearch") { searchOfficial(e.target.value); return; }
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
  if (e.key === "Enter" && e.target.dataset?.act === "opart") openOfficialPart(e.target.dataset.no, e.target.dataset.orig);
});
window.addEventListener("hashchange", () => { render(); scrollTo(0, 0); });

// 日付が変わったら（アプリを開き直したとき・画面に戻ったとき・1時間ごと）データを取り直す
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
  render(); notifyDue();
  if (!READONLY && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
