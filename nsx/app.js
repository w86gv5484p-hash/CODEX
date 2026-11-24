// NSX CARE — 1991年式 Honda NSX（NA1）の整備・部品・車両情報アプリ。
// 入力した交換日・チェック・部品メモは端末のブラウザー（localStorage）に保存します。
// データファイルは1日1回（日付が変わったとき）取り直し、アラートも日付ごとに再計算します。

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
const store = {
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
let loadedFor = "";

async function loadData() {
  const day = iso(today());
  const get = async name => {
    const res = await fetch(`./data/${name}?d=${day}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(name);
    return res.json();
  };
  data = await get("vehicle.json");
  try { supply = await get("supply.json"); } catch { /* 供給データがなくても他の画面は使える */ }
  loadedFor = day;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const maintItems = () => [...data.maintenance, ...custom];

// ---------- 画面 ----------
const views = { home, alerts, parts: partsView, faults, info };
let infoTab = "specs";
let partFilter = "all";
let partQuery = "";

function render() {
  const tab = (location.hash.slice(1) || "home").split("/")[0];
  const view = views[tab] ? tab : "home";
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === view));
  $main.innerHTML = views[view]();
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
    return `<div class="alert-banner ${over.length ? "over" : "soon"}" role="alert"><div><strong>交換時期のお知らせ</strong><ul>${list}</ul></div></div>`;
  }
  if (unset.length === items.length) return `<div class="alert-banner soon"><div><strong>まず交換日を入力してください</strong>「交換時期」タブで前回の交換日を入れると、期限の1か月半前からここにお知らせします。</div></div>`;
  return `<div class="alert-banner ok"><div><strong>交換時期が近い項目はありません</strong>${unset.length ? `<span class="small muted">未入力：${unset.map(x => esc(x.i.name)).join("、")}</span>` : ""}</div></div>`;
}

const SILHOUETTE = `<svg class="silhouette" viewBox="0 0 400 150" aria-hidden="true"><path d="M10 112c22-3 40-20 70-33 30-13 75-27 120-27 50 0 105 12 150 38 14 8 30 14 40 22v16H10z" fill="#1d5a45"/><path d="M118 74c26-14 60-22 96-22l-40 24z" fill="#9fd8c0" opacity=".75"/><path d="M175 76l40-24c30 2 56 10 76 22z" fill="#9fd8c0" opacity=".55"/><rect x="312" y="96" width="34" height="5" rx="2" fill="#e9f0ec" opacity=".7"/><circle cx="95" cy="118" r="22" fill="#08130f" stroke="#cfd8d3" stroke-width="5"/><circle cx="315" cy="118" r="22" fill="#08130f" stroke="#cfd8d3" stroke-width="5"/></svg>`;

function home() {
  const photo = store.get("photo", null);
  const items = maintItems().map(i => maintStatus(i));
  const count = st => items.filter(s => s.state === st).length;
  const chk = data.faults.reduce((n, f) => n + f.checks.length, 0);
  const done = Object.keys(checks).length;
  const latest = supply.changes?.[0];
  return `
  <section class="hero">
    ${photo ? `<img class="photo" src="${photo}" alt="愛車の写真">` : SILHOUETTE}
    <div class="shade"></div>
    <button class="btn ghost small photo-btn" data-act="photo">${photo ? "写真を変更" : "愛車の写真を設定"}</button>
    <div class="meta"><h1>HONDA NSX</h1><p>${esc(data.vehicle.code)} ・ ${esc(data.vehicle.modelYear)}</p></div>
  </section>
  ${alertBanner()}
  <div class="stats">
    <div class="stat"><b style="color:var(--over)">${count("over")}</b><span>超過</span></div>
    <div class="stat"><b style="color:var(--soon)">${count("soon")}</b><span>まもなく</span></div>
    <div class="stat"><b style="color:var(--ok)">${count("ok")}</b><span>良好</span></div>
    <div class="stat"><b>${done}<small class="muted" style="font-size:13px">/${chk}</small></b><span>点検済</span></div>
  </div>
  <div class="grid two">
    <a class="card" href="#parts" style="text-decoration:none;color:inherit"><h3>部品供給状況</h3>
      <p class="small muted" style="margin:0">${supply.checkedAt ? `公式ページ確認：${esc(supply.checkedAt.replace("T", " "))}` : "公式ページの自動確認はまだ実行されていません。"}<br>
      ${latest ? `最新の変化：${esc(latest.date)} ${esc(latest.source)} — ${esc(latest.summary)}` : "変化の記録はまだありません。"}</p></a>
    <a class="card" href="#faults" style="text-decoration:none;color:inherit"><h3>典型的な不具合と整備</h3>
      <p class="small muted" style="margin:0">NA1初期型でよく知られる${data.faults.length}件の不具合と、${chk}項目の点検チェックリスト。</p></a>
  </div>
  <p class="updates">データ更新日 ${esc(data.updated)} ・ この画面は1日1回最新データを取得します（最終取得 ${esc(loadedFor)}）。</p>`;
}

function alerts() {
  const cards = maintItems().map(item => {
    const s = maintStatus(item);
    const st = MAINT_STATE[s.state];
    const hist = maint[item.id]?.history || [];
    const isCustom = custom.some(c => c.id === item.id);
    return `<article class="card">
      <div class="maint-head"><h3 style="margin:0">${esc(item.name)} <span class="muted small">${intervalText(item.months)}</span></h3><span class="pill ${st.cls}">${st.label}</span></div>
      ${s.state !== "unset" ? `<div class="bar"><span style="width:${Math.round(s.ratio * 100)}%;background:${st.color}"></span></div>
      <dl class="kv"><dt>前回交換</dt><dd>${jp(s.last)}</dd><dt>次回交換</dt><dd>${jp(s.due)}（${s.daysLeft >= 0 ? `あと${s.daysLeft}日` : `${-s.daysLeft}日超過`}）</dd><dt>アラート開始</dt><dd>${jp(s.alertFrom)}（1か月半前）</dd></dl>` : `<p class="small muted" style="margin:8px 0 0">前回の交換日を入力してください。</p>`}
      <p class="small muted" style="margin:8px 0 0">${esc(item.note || "")}</p>
      <div class="maint-row">
        <label class="field">交換日を記録<input type="date" max="${iso(today())}" value="${iso(today())}" data-date="${item.id}"></label>
        <button class="btn primary" data-act="record" data-id="${item.id}">記録する</button>
        ${hist.length ? `<button class="btn small" data-act="undo" data-id="${item.id}">直前の記録を取り消す</button>` : ""}
        ${isCustom ? `<button class="btn small" data-act="del-custom" data-id="${item.id}">項目を削除</button>` : ""}
      </div>
      ${hist.length > 1 ? `<details style="margin-top:8px"><summary class="small muted">交換履歴（${hist.length}回）</summary><ol class="history">${[...hist].reverse().map(d => `<li>${jp(parse(d))}</li>`).join("")}</ol></details>` : ""}
    </article>`;
  }).join("");
  const notif = "Notification" in window && Notification.permission === "default"
    ? `<button class="btn small" data-act="notify">アプリを開いたときに通知する</button>` : "";
  return `<h1>交換タイミングアラート</h1>
  <p class="lead">交換した日を入力すると、そこを基準日に次回交換日を計算し、<b>その1か月半前</b>からアラートを表示します。</p>
  ${alertBanner()}
  <div class="maint">${cards}</div>
  <div class="toolbar" style="margin-top:16px"><button class="btn" data-act="add-custom">＋ 交換項目を追加（タイミングベルトなど）</button>${notif}
  <button class="btn small" data-act="export">データを書き出す</button><button class="btn small" data-act="import">読み込む</button></div>
  <p class="small muted">記録はこの端末のブラウザーに保存されます。機種変更の前に「データを書き出す」で保存してください。</p>`;
}

function partState(p) {
  const mine = parts[p.id] || {};
  const status = mine.status || p.status;
  const listed = mine.partNo && supply.partNumbers?.includes(mine.partNo.trim().toUpperCase());
  return { status, partNo: mine.partNo || "", memo: mine.memo || "", listed };
}

function partsView() {
  const q = partQuery.trim().toLowerCase();
  const counts = { all: 0, supply: 0, repro: 0, discontinued: 0, check: 0 };
  const cats = data.parts.map(cat => {
    const rows = cat.items.map(p => ({ p, s: partState(p) })).filter(({ p, s }) => {
      counts.all++; counts[s.status]++;
      if (partFilter !== "all" && s.status !== partFilter) return false;
      return !q || (p.name + s.partNo + s.memo).toLowerCase().includes(q);
    });
    if (!rows.length) return "";
    return `<div class="part-cat"><h3>${esc(cat.category)}</h3><div class="list">${rows.map(({ p, s }) => `
      <div class="part" data-act="part" data-id="${p.id}" role="button" tabindex="0">
        <div><div class="name">${esc(p.name)}</div><div class="sub">${s.partNo ? `品番 ${esc(s.partNo)}` : "品番未登録"}${s.listed ? " ・ <span style='color:var(--ok)'>公式の継続供給リストに掲載</span>" : ""}${s.memo ? ` ・ ${esc(s.memo)}` : ""}</div></div>
        <span class="pill ${STATUS[s.status].cls}">${STATUS[s.status].label}</span>
      </div>`).join("")}</div></div>`;
  }).join("");
  const chips = ["all", "supply", "repro", "discontinued", "check"].map(k =>
    `<button class="chip ${partFilter === k ? "on" : ""}" data-act="filter" data-k="${k}">${k === "all" ? "すべて" : STATUS[k].label} ${counts[k]}</button>`).join("");
  const sources = (supply.sources || []).map(s => `<div class="source"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a><br>
    <span class="muted">${s.ok ? "取得成功" : "取得失敗（前回の内容を保持）"} ・ 内容の最終変化 ${esc(s.changedAt || "—")}${s.documents?.length ? ` ・ 添付資料 ${s.documents.length}件` : ""}</span></div>`).join("");
  const changes = (supply.changes || []).slice(0, 8).map(c => `<li><b>${esc(c.date)}</b> ${esc(c.source)}：${esc(c.summary)}</li>`).join("");
  return `<h1>パーツリスト・部品供給状況</h1>
  <p class="lead">項目ごとに整理した主要パーツです。タップすると、品番・販売状況（販売中／復刻あり／廃番／要確認）・メモを登録できます。品番を登録すると、毎日確認しているホンダ公式「継続供給中部品番号リスト」と自動で照合します。</p>
  <div class="toolbar"><input type="text" placeholder="部品名・品番で検索" value="${esc(partQuery)}" data-act="search" aria-label="部品を検索"></div>
  <div class="chips">${chips}</div>
  ${cats || `<p class="muted">該当する部品はありません。</p>`}
  <h2>メーカーの供給状況（毎日自動確認）</h2>
  <div class="card">
    <p class="small" style="margin-top:0">ホンダは2025年に初代NSX向けの「Honda Heritage Parts」（復刻純正部品）と「Honda Restoration Service」を開始しています。以下の公式ページを1日1回確認し、内容が変わると記録します。
    ${supply.partNumbers?.length ? `<br>公式リストから取得した品番：<b>${supply.partNumbers.length}件</b>` : ""}</p>
    ${sources || `<p class="small muted">自動確認はまだ実行されていません（GitHub Actions の「Refresh NSX parts supply」が毎朝実行します）。</p>`}
    ${changes ? `<h3 style="margin-top:14px">最近の変化</h3><ul class="small" style="padding-left:18px;margin:0">${changes}</ul>` : ""}
    <p class="small muted" style="margin-bottom:0">最終確認：${esc(supply.checkedAt?.replace("T", " ") || "—")}。最終的な在庫・価格・廃番はホンダ販売店でご確認ください。</p>
  </div>`;
}

function faults() {
  return `<h1>典型的な不具合と整備リスト</h1>
  <p class="lead">1991年式NA1でよく知られる不具合です。点検・整備した項目にチェックを入れると、日付とともに記録されます。</p>
  ${data.faults.map(f => {
    const done = f.checks.filter((_, i) => checks[`${f.id}:${i}`]).length;
    return `<article class="card fault">
      <div class="fault-head"><h3>${esc(f.title)}</h3><span class="sev sev-${f.severity}">重要度 ${f.severity}</span></div>
      <p><b>症状</b>${esc(f.symptom)}</p><p><b>原因</b>${esc(f.cause)}</p>
      <div class="progress">整備チェック ${done}/${f.checks.length}</div>
      <ul class="checks">${f.checks.map((c, i) => {
        const key = `${f.id}:${i}`, when = checks[key];
        return `<li><label><input type="checkbox" data-act="check" data-key="${key}" ${when ? "checked" : ""}><span class="${when ? "done" : ""}">${esc(c)}${when ? `<span class="when">✓ ${jp(parse(when))} 実施</span>` : ""}</span></label></li>`;
      }).join("")}</ul>
    </article>`;
  }).join("")}
  <button class="btn small" data-act="reset-checks">チェックをすべて外す</button>`;
}

function info() {
  const sub = [["specs", "基本スペック"], ["history", "車両の歴史"], ["dev", "開発経緯・開発者"]];
  let body = "";
  if (infoTab === "specs") {
    body = data.specs.map(g => `<div class="card" style="margin-bottom:12px"><h3>${esc(g.group)}</h3><table class="spec-table">${g.items.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`).join("")
      + `<p class="small muted">${esc(data.specsNote)}</p>`;
  } else if (infoTab === "history") {
    body = `<div class="card"><ol class="timeline">${data.history.map(h => `<li class="${h.title === "あなたの年式" ? "mine" : ""}"><div class="date">${esc(h.date)}</div><strong>${esc(h.title)}</strong><p>${esc(h.text)}</p></li>`).join("")}</ol></div>`;
  } else {
    const d = data.development;
    body = `<h2 style="margin-top:0">開発経緯</h2><div class="grid two">${d.concept.map(c => `<div class="card"><h3>${esc(c.title)}</h3><p class="small" style="margin:0">${esc(c.text)}</p></div>`).join("")}</div>
      <h2>開発者・関係者の来歴</h2><div class="grid">${d.people.map(p => `<div class="card person"><div class="avatar">${esc(p.name.slice(0, 1))}</div><div><h3 style="margin:0">${esc(p.name)}</h3><div class="small" style="color:var(--gold)">${esc(p.role)}</div><p class="small" style="margin:4px 0 0">${esc(p.text)}</p></div></div>`).join("")}</div>
      <p class="small muted">${esc(d.note)}</p>`;
  }
  return `<h1>車両情報</h1><div class="subtabs">${sub.map(([k, l]) => `<button class="chip ${infoTab === k ? "on" : ""}" data-act="info" data-k="${k}">${l}</button>`).join("")}</div>${body}`;
}

// ---------- 操作 ----------
function openPart(id) {
  const p = data.parts.flatMap(c => c.items).find(x => x.id === id);
  const s = partState(p);
  $dlgBody.innerHTML = `<h3>${esc(p.name)}</h3>
    <div class="form">
      <label class="field">販売状況<select id="f-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      <label class="field">ホンダ純正品番（例：15400-PLM-A01）<input type="text" id="f-no" value="${esc(s.partNo)}" autocapitalize="characters"></label>
      ${s.partNo ? `<p class="small" style="margin:0">${s.listed ? "✓ 公式の継続供給中部品番号リストに掲載されています。" : supply.partNumbers?.length ? "公式の継続供給中部品番号リストには見つかりませんでした（廃番または表記違いの可能性）。" : "公式リストのデータがまだありません。"}</p>` : ""}
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
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const due = maintItems().filter(i => ["soon", "over"].includes(maintStatus(i).state));
  const key = "notified";
  if (!due.length || store.get(key, "") === iso(today())) return;
  store.set(key, iso(today()));
  new Notification("NSX CARE 交換時期のお知らせ", { body: due.map(i => i.name).join("、") + " の交換時期です。", icon: "./icon-192.png" });
}

$main.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const { act, id, k } = el.dataset;
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
  else if (act === "filter") { partFilter = k; render(); }
  else if (act === "info") { infoTab = k; render(); }
  else if (act === "reset-checks") { if (confirm("整備チェックをすべて外しますか？")) { checks = {}; store.set("checks", checks); render(); } }
});
$main.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "check") {
    if (el.checked) checks[el.dataset.key] = iso(today()); else delete checks[el.dataset.key];
    store.set("checks", checks); render();
  }
});
$main.addEventListener("input", e => {
  if (e.target.dataset.act !== "search") return;
  partQuery = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const box = $main.querySelector('[data-act="search"]');
  box.focus(); box.setSelectionRange(pos, pos);
});
$main.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.dataset?.act === "part") openPart(e.target.dataset.id);
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
