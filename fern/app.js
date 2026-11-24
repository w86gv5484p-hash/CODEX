// Laboratorio del Cervo — 育てているビカクシダの成長記録アプリ。
// 株・写真・水やり・害虫の記録はすべてこの端末のブラウザー（IndexedDB）に保存し、外部には送信しません。
// 写真は取り込み時に縮小（長辺1600px）して保存します。機種変更に備えて「保存」タブから書き出せます。

const $main = document.getElementById("main");
const $dlg = document.getElementById("dlg");
const $dlgBody = document.getElementById("dlg-body");
const $toast = document.getElementById("toast");
const $filePhoto = document.getElementById("file-photo");
const $fileBackup = document.getElementById("file-backup");

const SPECIES = [
  "ビフルカツム（P. bifurcatum）", "ネザーランド（P. bifurcatum 'Netherlands'）", "ウィリンキー（P. willinckii）",
  "ベイチー（P. veitchii）", "ヒリー（P. hillii）", "スパーバム（P. superbum）", "グランデ（P. grande）",
  "ホルタミー（P. holttumii）", "ワリチー（P. wallichii）", "リドレイ（P. ridleyi）", "コロナリウム（P. coronarium）",
  "マダガスカリエンセ（P. madagascariense）", "アルシコルネ（P. alcicorne）", "エレファントティス（P. elephantotis）",
  "ステマリア（P. stemaria）", "エリシー（P. ellisii）", "クアドリディコトマム（P. quadridichotomum）",
  "ワンダエ（P. wandae）", "アンディナム（P. andinum）", "交配種・園芸品種",
];
const LOG_KIND = {
  water: { label: "水やり", cls: "water" },
  soak: { label: "ソーキング", cls: "water" },
  fert: { label: "肥料", cls: "fert" },
  mist: { label: "葉水", cls: "mist" },
};
const PEST_STATUS = {
  active: { label: "対応中", cls: "active", card: "" },
  watching: { label: "経過観察", cls: "watch", card: "watching" },
  resolved: { label: "解決", cls: "done", card: "resolved" },
};
const METHODS = ["歯ブラシ・綿棒で除去", "シャワーで洗い流し", "殺虫剤を散布", "殺虫剤（粒剤）を施用", "殺菌剤を散布",
  "患部を切除", "捕殺", "誘引駆除剤を設置", "置き場所を変更・隔離", "風通しを改善"];
const LEAF_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44V26M24 26c0-8-6-15-15-17 0 9 6 17 15 17Zm0 4c0-7 5-13 14-14 0 8-5 14-14 14Z"/><path d="M24 30c-6 0-11 3-12 8 6 0 11-3 12-8Z"/></svg>`;

// ---------- 日付 ----------
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const jp = s => { const d = parse(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const jpShort = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const ago = s => { const n = daysBetween(s, todayIso()); return n <= 0 ? (n === 0 ? "今日" : `${-n}日後`) : n === 1 ? "昨日" : `${n}日前`; };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- 保存（IndexedDB） ----------
const STORES = ["plants", "photos", "blobs", "logs", "pests"];
let dbp;
function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open("fern-log", 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error || new Error("保存に失敗しました"));
  });
}
const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = store => tx(store, "readonly", s => req2p(s.getAll()));
const put = (store, v) => tx(store, "readwrite", s => { s.put(v); });
const del = (store, id) => tx(store, "readwrite", s => { s.delete(id); });
const getOne = (store, id) => tx(store, "readonly", s => req2p(s.get(id)));

const state = { plants: [], photos: [], logs: [], pests: [], guide: null };
const thumbURL = new Map();

async function save(store, v) {
  try { await put(store, v); }
  catch (e) { toast("保存できませんでした（容量不足やプライベートブラウズの可能性があります）"); throw e; }
  const arr = state[store];
  if (arr) { const i = arr.findIndex(x => x.id === v.id); if (i >= 0) arr[i] = v; else arr.push(v); }
}
async function remove(store, id) {
  await del(store, id);
  if (state[store]) state[store] = state[store].filter(x => x.id !== id);
}

// ---------- 写真 ----------
async function exifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < v.byteLength - 10) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
        const t = off + 10, le = v.getUint16(t) === 0x4949;
        const g16 = o => v.getUint16(t + o, le), g32 = o => v.getUint32(t + o, le);
        const find = (ifd, tag) => { const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (g16(e) === tag) return e; } return null; };
        const ifd0 = g32(4);
        let entry = null;
        const exifPtr = find(ifd0, 0x8769);
        if (exifPtr !== null) entry = find(g32(exifPtr + 8), 0x9003);
        if (entry === null) entry = find(ifd0, 0x0132);
        if (entry === null) return null;
        const p = g32(entry + 8);
        let s = ""; for (let i = 0; i < 10; i++) s += String.fromCharCode(v.getUint8(t + p + i));
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
        return m && +m[1] > 1990 ? `${m[1]}-${m[2]}-${m[3]}` : null;
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      off += 2 + len;
    }
  } catch { /* EXIF なし */ }
  return null;
}
// 画像を読み込む。iPhone の Safari では img.decode() が大きな写真で失敗することがあるため onload を使い、
// だめなら createImageBitmap を試す。
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = async () => {
      URL.revokeObjectURL(url);
      try { const bmp = await createImageBitmap(blob); resolve({ src: bmp, w: bmp.width, h: bmp.height }); }
      catch { reject(new Error("この形式の画像は開けませんでした")); }
    };
    img.src = url;
  });
}
async function resize(blob, max, quality) {
  const { src, w: iw, h: ih } = await loadImage(blob);
  if (!iw || !ih) throw new Error("画像の大きさを読み取れませんでした");
  const s = Math.min(1, max / Math.max(iw, ih));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(iw * s)); c.height = Math.max(1, Math.round(ih * s));
  try {
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("画像を変換できませんでした（メモリ不足の可能性）"))), "image/jpeg", quality));
  } finally {
    // iPhone はキャンバスの合計メモリに上限があるため、使い終わったらすぐ解放する
    c.width = 0; c.height = 0;
    src.close?.();
  }
}
// iPhone の Safari は IndexedDB に Blob をそのまま保存・表示できないことがあるため、ArrayBuffer にして保存する
const packBlob = async b => ({ type: b.type || "image/jpeg", buf: await b.arrayBuffer() });
const unpackBlob = x => (!x ? null : x instanceof Blob ? x : new Blob([x.buf], { type: x.type || "image/jpeg" }));
async function saveImage(id, full, thumb) {
  await save("blobs", { id, full: await packBlob(full), thumb: await packBlob(thumb) });
}
async function loadImageRecord(id) {
  const r = await getOne("blobs", id);
  return r ? { full: unpackBlob(r.full), thumb: unpackBlob(r.thumb) } : null;
}
async function addPhotos(files, plantId, pestId = null) {
  let n = 0;
  const failed = [];
  for (const [i, file] of files.entries()) {
    if (files.length > 1) toast(`写真を取り込んでいます（${i + 1}/${files.length}）…`);
    try {
      const date = (await exifDate(file)) || iso(new Date(file.lastModified || Date.now()));
      const full = await resize(file, 1600, 0.82);
      const thumb = await resize(full, 420, 0.72);
      const id = uid();
      await saveImage(id, full, thumb);
      await save("photos", { id, plantId, pestId, date, memo: "", created: Date.now() });
      n++;
    } catch (e) { console.error(e); failed.push(e?.message || String(e)); }
  }
  if (failed.length) toast(`${failed.length}枚の写真を取り込めませんでした：${esc(failed[0])}`);
  if (n && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return n;
}
async function thumb(photoId) {
  if (!photoId) return null;
  if (thumbURL.has(photoId)) return thumbURL.get(photoId);
  const b = await loadImageRecord(photoId);
  const url = b?.thumb ? URL.createObjectURL(b.thumb) : null;
  thumbURL.set(photoId, url);
  return url;
}
async function fullURL(photoId) {
  const b = await loadImageRecord(photoId);
  return b?.full ? URL.createObjectURL(b.full) : null;
}
// data-thumb 属性を持つ要素に、描画後にサムネイルを読み込む
async function fillThumbs(root = document) {
  for (const el of root.querySelectorAll("[data-thumb]")) {
    const url = await thumb(el.dataset.thumb);
    if (url) el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
    el.removeAttribute("data-thumb");
  }
}
const imgSlot = photoId => (photoId ? `<div class="noimg" data-thumb="${esc(photoId)}">${LEAF_SVG}</div>` : `<div class="noimg">${LEAF_SVG}</div>`);

// ---------- 計算 ----------
const plantPhotos = id => state.photos.filter(p => p.plantId === id).sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
const coverOf = plant => {
  if (plant.coverId && state.photos.some(p => p.id === plant.coverId)) return plant.coverId;
  return plantPhotos(plant.id)[0]?.id || null;
};
const plantLogs = id => state.logs.filter(l => l.plantId === id).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
const plantName = id => state.plants.find(p => p.id === id)?.name || "（削除された株）";
function waterState(plant) {
  const last = plantLogs(plant.id).find(l => l.kind === "water" || l.kind === "soak");
  const interval = Number(plant.interval) || 7;
  if (!last) return { cls: "unset", label: "水やり記録なし", days: null, last: null, interval, rank: 1 };
  const days = daysBetween(last.date, todayIso());
  const left = interval - days;
  if (left <= 0) return { cls: "due", label: left === 0 ? "今日が水やり目安" : `目安を${-left}日過ぎ`, days, last: last.date, interval, rank: 0 };
  if (left === 1) return { cls: "soon", label: "明日が目安", days, last: last.date, interval, rank: 2 };
  return { cls: "ok", label: `あと${left}日`, days, last: last.date, interval, rank: 3 };
}
const openPests = plantId => state.pests.filter(p => p.status !== "resolved" && (!plantId || p.plantId === plantId));
const pestInfo = id => state.guide?.pests.find(p => p.id === id);
const pestLabel = p => (p.pestId === "other" ? p.otherName || "その他" : pestInfo(p.pestId)?.name || p.otherName || "害虫");
const sortedPlants = () => [...state.plants].sort((a, b) => a.name.localeCompare(b.name, "ja"));
// 展示番号：登録した順に N.01, N.02 …
const plantNo = id => { const i = [...state.plants].sort((a, b) => (a.created || 0) - (b.created || 0)).findIndex(p => p.id === id); return `N.${pad(i + 1)}`; };
// 品種名の（）内の学名をイタリックで添える
const speciesHtml = s => { const m = String(s || "").match(/^(.*?)（(.+)）$/); return m ? `${esc(m[1])} <span class="lat">${esc(m[2])}</span>` : esc(s); };
const WALL_ID = "__wall";

// ---------- 共通UI ----------
let toastTimer;
function toast(html, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  if (action) $toast.querySelector("button").onclick = () => { $toast.classList.remove("show"); action.run(); };
  $toast.classList.add("show");
  toastTimer = setTimeout(() => $toast.classList.remove("show"), action ? 5000 : 2600);
}
function openDialog(html, { cls = "", onClose } = {}) {
  $dlg.className = cls;
  $dlgBody.innerHTML = html;
  $dlg.onclose = () => { $dlgBody.innerHTML = ""; onClose?.(); };
  if (!$dlg.open) $dlg.showModal();
  return $dlgBody;
}
const closeDialog = () => $dlg.open && $dlg.close();
$dlg.querySelector(".x").onclick = closeDialog;
$dlg.addEventListener("click", e => { if (e.target === $dlg) closeDialog(); });
function pickPhotos(capture = false) {
  return new Promise(resolve => {
    $filePhoto.value = "";
    if (capture) $filePhoto.setAttribute("capture", "environment"); else $filePhoto.removeAttribute("capture");
    $filePhoto.onchange = () => resolve([...$filePhoto.files]);
    $filePhoto.click();
  });
}
const formData = form => Object.fromEntries(new FormData(form).entries());
function updateBadges() {
  const due = state.plants.filter(p => waterState(p).cls === "due").length;
  const pests = openPests().length;
  for (const [tab, n] of [["water", due], ["pests", pests]]) {
    const a = document.querySelector(`.tabs a[data-tab="${tab}"]`);
    a.querySelector(".badge")?.remove();
    if (n) a.insertAdjacentHTML("beforeend", `<span class="badge">${n}</span>`);
  }
}

// ---------- 株の一覧 ----------
function renderPlants() {
  const plants = sortedPlants();
  const due = plants.filter(p => waterState(p).cls === "due").length;
  const pests = openPests().length;
  $main.innerHTML = `
    <section class="wall"><div class="wall-bg empty" id="wall-bg"></div>
      <div class="wall-txt"><p class="kicker">Galleria di Platycerium</p><h1 class="title">Laboratorio<br><i>del</i> Cervo</h1>
        <p class="sub">${plants.length}株を展示中 · 写真 ${state.photos.length}枚</p></div>
      <button class="wall-edit" id="wall-edit">背景の写真</button></section>
    <div class="head" style="margin-top:22px"><div><p class="kicker">Collezione</p><h2>展示室</h2></div>
      <button class="btn primary" id="add-plant"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>株を追加</button></div>
    ${plants.length ? `
    <div class="summary">
      <a class="stat ${due ? "due" : ""}" href="#water"><b>${due}</b><span>水やりの目安</span></a>
      <a class="stat ${pests ? "pests" : ""}" href="#pests"><b>${pests}</b><span>害虫 未解決</span></a>
      <a class="stat" href="#plants"><b>${state.photos.length}</b><span>写真</span></a>
    </div>
    <div class="grid">${plants.map(p => {
      const w = waterState(p), op = openPests(p.id).length;
      return `<a class="art" href="#plant/${esc(p.id)}"><div class="frame"><div class="ph">${imgSlot(coverOf(p))}</div></div>
        <div class="plaque"><span class="no">${plantNo(p.id)}</span><span class="name">${esc(p.name)}</span>${p.species ? `<span class="sp">${speciesHtml(p.species)}</span>` : ""}
        <div class="chips"><span class="chip ${w.cls}">${w.days === null ? w.label : `水やり ${ago(w.last)}`}</span>${op ? `<span class="chip active">害虫 ${op}件</span>` : ""}</div></div></a>`;
    }).join("")}</div>` : `
    <div class="empty"><h2>最初の一株を飾りましょう</h2><p>名前と品種を登録すると、写真・水やり・害虫の記録をつけられます。</p>
      <button class="btn primary" id="add-plant2">株を追加</button></div>`}`;
  $main.querySelector("#add-plant").onclick = () => plantForm();
  $main.querySelector("#add-plant2")?.addEventListener("click", () => plantForm());
  $main.querySelector("#wall-edit").onclick = wallForm;
  fillThumbs($main);
  (async () => {
    // 背景：設定した写真 → なければ一番新しい株の写真 → なければスポットライトの壁
    const own = await loadImageRecord(WALL_ID);
    const latest = [...state.photos].sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created))[0];
    const blob = own?.full || (latest && (await loadImageRecord(latest.id))?.full);
    const el = document.getElementById("wall-bg");
    if (blob && el) { el.classList.remove("empty"); el.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`; }
  })();
}

function wallForm() {
  (async () => {
    const own = await loadImageRecord(WALL_ID);
    const url = own?.thumb ? URL.createObjectURL(own.thumb) : null;
    const body = openDialog(`
      <div class="form"><h2>ギャラリーの背景</h2>
        <p class="muted small" style="margin:0">一覧の上に大きく表示する写真です。飾っている壁や部屋の写真がおすすめです。この端末の中だけに保存されます。</p>
        <div class="wall-preview">${url ? `<img src="${url}" alt="">` : `<div class="wall-bg empty" style="position:static;height:100%"></div>`}</div>
        <p class="hint" style="margin:0">${own ? "設定した写真を表示しています。" : "未設定のときは、いちばん新しい株の写真を表示します。"}</p>
        <div class="form-btns">${own ? `<button type="button" class="btn danger ghost" id="wdel">元に戻す</button><span class="spacer"></span>` : ""}<button type="button" class="btn primary" id="wpick">写真を選ぶ</button></div>
      </div>`, { onClose: () => url && URL.revokeObjectURL(url) });
    body.querySelector("#wpick").onclick = async () => {
      const [file] = await pickPhotos();
      if (!file) return;
      try {
        const full = await resize(file, 2000, 0.84);
        await saveImage(WALL_ID, full, await resize(full, 640, 0.75));
        closeDialog(); route(); toast("背景を設定しました");
      } catch (e) { console.error(e); toast(`この写真は読み込めませんでした：${esc(e?.message || e)}`); }
    };
    body.querySelector("#wdel")?.addEventListener("click", async () => { await del("blobs", WALL_ID); closeDialog(); route(); toast("背景を元に戻しました"); });
  })();
}

function plantForm(plant) {
  const p = plant || { name: "", species: "", acquired: todayIso(), place: "", interval: 7, memo: "" };
  const body = openDialog(`
    <form class="form" id="pf">
      <h2>${plant ? "株の情報を編集" : "株を追加"}</h2>
      <label class="f">名前<input name="name" required maxlength="60" value="${esc(p.name)}" placeholder="例：リビングのネザー"></label>
      <label class="f">品種<input name="species" list="species-list" maxlength="80" value="${esc(p.species)}" placeholder="選ぶか入力">
        <datalist id="species-list">${SPECIES.map(s => `<option value="${esc(s)}">`).join("")}</datalist></label>
      <div class="two">
        <label class="f">入手日<input type="date" name="acquired" value="${esc(p.acquired || "")}"></label>
        <label class="f">水やり間隔（日）<input type="number" name="interval" min="1" max="60" inputmode="numeric" value="${esc(p.interval || 7)}"></label>
      </div>
      <label class="f">置き場所<input name="place" maxlength="60" value="${esc(p.place || "")}" placeholder="例：南の窓辺・板付け"></label>
      <label class="f">メモ<textarea name="memo" maxlength="2000" placeholder="入手先、仕立て方など">${esc(p.memo || "")}</textarea></label>
      <p class="hint">水やり間隔は目安です。季節に合わせて変更してください（冬は長めに）。</p>
      <div class="form-btns">${plant ? `<button type="button" class="btn danger ghost" id="pdel">株を削除</button><span class="spacer"></span>` : ""}
        <button type="button" class="btn" id="pcancel">キャンセル</button><button class="btn primary">保存</button></div>
    </form>`);
  body.querySelector("#pcancel").onclick = closeDialog;
  body.querySelector("#pf").onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const v = { ...p, ...f, name: f.name.trim(), interval: Math.max(1, Math.min(60, Number(f.interval) || 7)), id: p.id || uid(), created: p.created || Date.now() };
    await save("plants", v);
    closeDialog();
    if (plant) route(); else location.hash = `#plant/${v.id}`;
    toast(plant ? "保存しました" : `「${esc(v.name)}」を追加しました`);
  };
  body.querySelector("#pdel")?.addEventListener("click", async () => {
    const n = plantPhotos(p.id).length;
    if (!confirm(`「${p.name}」と、その写真${n}枚・水やり・害虫の記録をすべて削除します。元に戻せません。`)) return;
    for (const ph of plantPhotos(p.id)) { await remove("photos", ph.id); await del("blobs", ph.id); }
    for (const l of plantLogs(p.id)) await remove("logs", l.id);
    for (const ps of state.pests.filter(x => x.plantId === p.id)) await remove("pests", ps.id);
    await remove("plants", p.id);
    closeDialog();
    location.hash = "#plants";
    toast("削除しました");
  });
}

// ---------- 株の詳細 ----------
const showAll = { logs: false };
function renderPlant(id) {
  const p = state.plants.find(x => x.id === id);
  if (!p) { location.hash = "#plants"; return; }
  const photos = plantPhotos(id);
  const cover = coverOf(p);
  const coverPhoto = photos.find(x => x.id === cover);
  const w = waterState(p);
  const logs = plantLogs(id);
  const pests = state.pests.filter(x => x.plantId === id).sort((a, b) => (a.status === "resolved") - (b.status === "resolved") || b.found.localeCompare(a.found));
  const age = p.acquired ? daysBetween(p.acquired, todayIso()) : null;
  const oldest = photos[photos.length - 1], newest = photos[0];
  const months = {};
  for (const ph of photos) (months[ph.date.slice(0, 7)] ||= []).push(ph);

  $main.innerHTML = `
    <a class="back" href="#plants">‹ 株の一覧</a>
    <div class="showcase"><div class="hero"><div class="pic" id="hero-pic">${cover ? `<div class="noimg" id="hero-img">${LEAF_SVG}</div>` : `<div class="noimg">${LEAF_SVG}</div>`}</div>
      ${coverPhoto ? `<span class="hero-date">${jp(coverPhoto.date)}</span>` : ""}</div></div>
    <div class="plant-title"><p class="kicker">${plantNo(id)}</p><h1>${esc(p.name)}</h1>${p.species ? `<div class="sp">${speciesHtml(p.species)}</div>` : ""}
      <button class="btn sm" id="edit">編集</button></div>
    <div class="chips" style="margin-top:10px"><span class="chip ${w.cls}">${w.label}</span>${openPests(id).length ? `<span class="chip active">害虫 対応中 ${openPests(id).length}件</span>` : ""}</div>
    <div class="facts">
      <div class="fact"><span>育成</span><b>${age === null ? "—" : age >= 0 ? `${age + 1}日目` : "入手前"}</b></div>
      <div class="fact"><span>前回の水やり</span><b>${w.last ? ago(w.last) : "—"}</b></div>
      <div class="fact"><span>水やり間隔</span><b>${w.interval}日</b></div>
      <div class="fact"><span>置き場所</span><b>${esc(p.place || "—")}</b></div>
    </div>
    ${p.memo ? `<div class="memo">${esc(p.memo)}</div>` : ""}
    <div class="actions">
      <button class="btn primary" id="a-photo"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>写真を追加</button>
      <button class="btn water" id="a-water"><svg viewBox="0 0 24 24"><path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"/></svg>水やりした</button>
      <button class="btn" id="a-log">肥料・葉水など</button>
      <button class="btn" id="a-pest">害虫を記録</button>
    </div>

    <section class="section"><h2>成長のアーカイブ <small>${photos.length}枚</small></h2>
      ${photos.length >= 2 ? `<div class="compare">
        <figure><div class="mat"><img data-full="${esc(oldest.id)}" alt="最初の写真"></div><figcaption><b>Prima</b>${jp(oldest.date)}</figcaption></figure>
        <figure><div class="mat"><img data-full="${esc(newest.id)}" alt="最新の写真"></div><figcaption><b>Ora</b>${jp(newest.date)}（${daysBetween(oldest.date, newest.date)}日後）</figcaption></figure>
      </div>` : ""}
      ${photos.length ? Object.entries(months).map(([m, list]) => `<div class="month"><h3>${m.slice(0, 4)}年${Number(m.slice(5))}月</h3><div class="thumbs">
        ${list.map(ph => `<button class="thumb" data-photo="${esc(ph.id)}" aria-label="${jp(ph.date)}の写真">${imgSlot(ph.id)}<span class="d">${jpShort(ph.date)}</span>${ph.pestId ? `<span class="tag">害虫</span>` : ""}</button>`).join("")}
      </div></div>`).join("") : `<div class="empty"><p>写真を追加すると、ここに日付順で並びます。定期的に同じ角度から撮ると成長を比べやすくなります。</p></div>`}
    </section>

    <section class="section"><h2>水やり・お手入れ <small>${logs.length}件</small></h2>
      ${logs.length ? `<div class="list">${(showAll.logs ? logs : logs.slice(0, 8)).map(l => `<div class="log"><span><span class="k ${LOG_KIND[l.kind]?.cls || ""}">${LOG_KIND[l.kind]?.label || "記録"}</span> <span class="muted small">${jp(l.date)}${l.memo ? ` · ${esc(l.memo)}` : ""}</span></span><button class="del" data-dellog="${esc(l.id)}" aria-label="この記録を削除">×</button></div>`).join("")}
        ${logs.length > 8 && !showAll.logs ? `<button class="more" id="more-logs">すべて表示（${logs.length}件）</button>` : ""}</div>` : `<p class="muted small">まだ記録がありません。</p>`}
    </section>

    <section class="section"><h2>害虫の記録 <small>${pests.length}件</small></h2>
      ${pests.length ? pests.map(pestCard).join("") : `<p class="muted small">記録はありません。</p>`}
    </section>`;

  const $ = s => $main.querySelector(s);
  $("#edit").onclick = () => plantForm(p);
  $("#a-photo").onclick = async () => {
    const files = await pickPhotos();
    if (!files.length) return;
    toast("写真を取り込んでいます…");
    const n = await addPhotos(files, id);
    if (n) { route(); toast(`写真を${n}枚追加しました`); }
  };
  $("#a-water").onclick = () => quickWater(p);
  $("#a-log").onclick = () => logForm(p);
  $("#a-pest").onclick = () => pestForm({ plantId: id });
  $("#more-logs")?.addEventListener("click", () => { showAll.logs = true; route(); });
  $main.querySelectorAll("[data-dellog]").forEach(b => b.onclick = async () => {
    const l = state.logs.find(x => x.id === b.dataset.dellog);
    await remove("logs", l.id); route(); updateBadges();
    toast("記録を削除しました", { label: "元に戻す", run: async () => { await save("logs", l); route(); updateBadges(); } });
  });
  $main.querySelectorAll("[data-photo]").forEach(b => b.onclick = () => photoViewer(b.dataset.photo));
  $main.querySelectorAll("[data-pest]").forEach(b => b.onclick = () => pestDetail(b.dataset.pest));
  (async () => {
    if (cover) {
      const url = await fullURL(cover);
      if (url) { $("#hero-img").outerHTML = `<img src="${url}" alt="${esc(p.name)}">`; $("#hero-pic").onclick = () => photoViewer(cover); }
    }
    for (const im of $main.querySelectorAll("img[data-full]")) { im.src = await thumb(im.dataset.full); im.onclick = () => photoViewer(im.dataset.full); }
    fillThumbs($main);
  })();
}

async function photoViewer(photoId) {
  const ph = state.photos.find(x => x.id === photoId);
  if (!ph) return;
  const plant = state.plants.find(x => x.id === ph.plantId);
  const url = await fullURL(photoId);
  const body = openDialog(`
    <div class="big"><img src="${url}" alt="${jp(ph.date)}の写真"></div>
    <form class="form" id="phf">
      <div class="two"><label class="f">撮影日<input type="date" name="date" required value="${esc(ph.date)}"></label>
        <label class="f">株<select name="plantId">${sortedPlants().map(p => `<option value="${esc(p.id)}" ${p.id === ph.plantId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>
      <label class="f">メモ<textarea name="memo" maxlength="1000" placeholder="新しい貯水葉が出てきた、など">${esc(ph.memo || "")}</textarea></label>
      <div class="form-btns"><button type="button" class="btn danger ghost" id="phdel">削除</button>
        ${plant && coverOf(plant) !== ph.id ? `<button type="button" class="btn" id="phcover">表紙にする</button>` : ""}
        <span class="spacer"></span><button class="btn primary">保存</button></div>
    </form>`, { cls: "photo", onClose: () => URL.revokeObjectURL(url) });
  body.querySelector("#phf").onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    await save("photos", { ...ph, date: f.date, memo: f.memo.trim(), plantId: f.plantId });
    closeDialog(); route(); toast("保存しました");
  };
  body.querySelector("#phcover")?.addEventListener("click", async () => {
    await save("plants", { ...plant, coverId: ph.id }); closeDialog(); route(); toast("表紙に設定しました");
  });
  body.querySelector("#phdel").onclick = async () => {
    if (!confirm("この写真を削除します。元に戻せません。")) return;
    await remove("photos", ph.id); await del("blobs", ph.id);
    thumbURL.delete(ph.id);
    closeDialog(); route(); toast("写真を削除しました");
  };
}

// ---------- 水やり ----------
async function quickWater(plant, kind = "water") {
  const today = todayIso();
  const exists = state.logs.find(l => l.plantId === plant.id && l.date === today && l.kind === kind);
  if (exists) { toast(`「${esc(plant.name)}」は今日すでに記録済みです`); return; }
  const log = { id: uid(), plantId: plant.id, date: today, kind, memo: "", created: Date.now() };
  await save("logs", log);
  route(); updateBadges();
  toast(`「${esc(plant.name)}」に${LOG_KIND[kind].label}を記録しました`, { label: "取り消す", run: async () => { await remove("logs", log.id); route(); updateBadges(); } });
}
function logForm(plant) {
  const body = openDialog(`
    <form class="form" id="lf"><h2>お手入れを記録</h2>
      <p class="muted small" style="margin:0">${esc(plant.name)}</p>
      <div class="radios">${Object.entries(LOG_KIND).map(([k, v], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 2 ? "checked" : ""}>${v.label}</label>`).join("")}</div>
      <label class="f">日付<input type="date" name="date" required value="${todayIso()}" max="${todayIso()}"></label>
      <label class="f">メモ<input name="memo" maxlength="200" placeholder="例：液肥 1000倍"></label>
      <div class="form-btns"><button type="button" class="btn" id="lc">キャンセル</button><button class="btn primary">記録</button></div>
    </form>`);
  body.querySelector("#lc").onclick = closeDialog;
  body.querySelector("#lf").onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    await save("logs", { id: uid(), plantId: plant.id, date: f.date, kind: f.kind, memo: f.memo.trim(), created: Date.now() });
    closeDialog(); route(); updateBadges(); toast(`${LOG_KIND[f.kind].label}を記録しました`);
  };
}
function renderWater() {
  const today = todayIso();
  const plants = sortedPlants().map(p => ({ p, w: waterState(p) })).sort((a, b) => a.w.rank - b.w.rank || (b.w.days ?? 0) - (a.w.days ?? 0));
  const due = plants.filter(x => x.w.cls === "due");
  $main.innerHTML = `
    <div class="head"><div><p class="kicker">Annaffiatura</p><h1>水やり</h1><p class="muted small">${due.length ? `${due.length}株が水やりの目安を迎えています` : "目安を過ぎた株はありません"}</p></div>
      ${due.length > 1 ? `<button class="btn water sm" id="all">目安の${due.length}株に記録</button>` : ""}</div>
    ${plants.length ? `<div class="list">${plants.map(({ p, w }) => {
      const doneToday = w.last === today;
      return `<div class="item ${doneToday ? "done-today" : ""}"><a class="av" href="#plant/${esc(p.id)}">${imgSlot(coverOf(p))}</a>
        <a class="main" href="#plant/${esc(p.id)}"><div class="t">${esc(p.name)}</div>
          <div class="s">${w.last ? `前回 ${jp(w.last)}（${ago(w.last)}）` : "記録なし"} · ${w.interval}日ごと</div>
          <div class="chips" style="margin-top:3px"><span class="chip ${doneToday ? "ok" : w.cls}">${doneToday ? "今日 記録済み" : w.label}</span></div></a>
        <div class="end"><button class="btn water sm" data-water="${esc(p.id)}" ${doneToday ? "disabled" : ""} aria-label="${esc(p.name)}に水やりを記録">💧 水やり</button></div></div>`;
    }).join("")}</div>
    <p class="muted small" style="margin-top:12px">水苔が乾いて株が軽くなったらたっぷり与えるのが基本です。間隔は株ごとに「編集」から変えられます。肥料・葉水は株のページの「肥料・葉水など」から記録できます。</p>`
    : `<div class="empty"><p>株を登録すると、ここで水やりを記録できます。</p><a class="btn primary" href="#plants">株の一覧へ</a></div>`}`;
  $main.querySelectorAll("[data-water]").forEach(b => b.onclick = () => quickWater(state.plants.find(p => p.id === b.dataset.water)));
  $main.querySelector("#all")?.addEventListener("click", async () => {
    const added = [];
    for (const { p } of due) { const log = { id: uid(), plantId: p.id, date: today, kind: "water", memo: "", created: Date.now() }; await save("logs", log); added.push(log); }
    route(); updateBadges();
    toast(`${added.length}株に水やりを記録しました`, { label: "取り消す", run: async () => { for (const l of added) await remove("logs", l.id); route(); updateBadges(); } });
  });
  fillThumbs($main);
}

// ---------- 害虫 ----------
function pestCard(ps) {
  const st = PEST_STATUS[ps.status] || PEST_STATUS.active;
  const last = [...(ps.treatments || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  return `<button class="pest ${st.card}" data-pest="${esc(ps.id)}">
    <div class="top-line"><span class="t">${esc(pestLabel(ps))}</span><span class="chip ${st.cls}">${st.label}</span></div>
    <div class="s">${esc(plantName(ps.plantId))} · 発見 ${jp(ps.found)}（${ago(ps.found)}）</div>
    <div class="last">${last ? `最新の対応：${esc(last.method)}（${jpShort(last.date)}）` : `<span class="muted">まだ対応の記録がありません</span>`}</div>
  </button>`;
}
let pestFilter = "open";
function renderPests() {
  const open = state.pests.filter(p => p.status !== "resolved").sort((a, b) => (a.status === "watching") - (b.status === "watching") || b.found.localeCompare(a.found));
  const done = state.pests.filter(p => p.status === "resolved").sort((a, b) => (b.resolved || b.found).localeCompare(a.resolved || a.found));
  const list = pestFilter === "open" ? open : done;
  $main.innerHTML = `
    <div class="head"><div><p class="kicker">Parassiti e Cure</p><h1>害虫・病気</h1><p class="muted small">発見から駆除までを株ごとに記録します</p></div>
      ${state.plants.length ? `<button class="btn primary" id="add-pest"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>記録</button>` : ""}</div>
    <div class="seg" role="tablist"><button data-f="open" class="${pestFilter === "open" ? "on" : ""}">対応中・経過観察 ${open.length}</button><button data-f="done" class="${pestFilter === "done" ? "on" : ""}">解決済み ${done.length}</button></div>
    ${list.length ? list.map(pestCard).join("") : `<div class="empty"><p>${pestFilter === "open" ? "対応中の害虫はありません。葉の裏・付け根・成長点まわりを定期的に確認しましょう。" : "解決済みの記録はまだありません。"}</p>
      <a class="btn" href="#guide/pests">主な病害虫と対策を見る</a></div>`}`;
  $main.querySelector("#add-pest")?.addEventListener("click", () => pestForm({}));
  $main.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { pestFilter = b.dataset.f; renderPests(); });
  $main.querySelectorAll("[data-pest]").forEach(b => b.onclick = () => pestDetail(b.dataset.pest));
}
function pestForm(init) {
  const editing = !!init.id;
  const ps = { plantId: init.plantId || sortedPlants()[0]?.id, pestId: "scale", otherName: "", found: todayIso(), status: "active", memo: "", treatments: [], ...init };
  const pests = state.guide?.pests || [];
  const body = openDialog(`
    <form class="form" id="psf"><h2>${editing ? "害虫の記録を編集" : "害虫・病気を記録"}</h2>
      <label class="f">株<select name="plantId" required>${sortedPlants().map(p => `<option value="${esc(p.id)}" ${p.id === ps.plantId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="f">種類<select name="pestId" id="pest-kind">${pests.map(x => `<option value="${esc(x.id)}" ${x.id === ps.pestId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="other" ${ps.pestId === "other" ? "selected" : ""}>その他（入力）</option></select></label>
      <label class="f" id="other-wrap" ${ps.pestId === "other" ? "" : "hidden"}>名前<input name="otherName" maxlength="40" value="${esc(ps.otherName)}" placeholder="例：コナジラミ"></label>
      <div class="two"><label class="f">発見日<input type="date" name="found" required value="${esc(ps.found)}" max="${todayIso()}"></label>
        <label class="f">状況<select name="status">${Object.entries(PEST_STATUS).map(([k, v]) => `<option value="${k}" ${k === ps.status ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
      <label class="f">症状・場所のメモ<textarea name="memo" maxlength="1000" placeholder="例：胞子葉の裏に茶色い殻が5つほど">${esc(ps.memo)}</textarea></label>
      ${editing ? "" : `<label class="f">写真（任意）<input type="file" name="photos" accept="image/*" multiple><span class="hint">株の成長記録にも「害虫」の印付きで並びます。</span></label>`}
      <p class="hint" id="pest-tip"></p>
      <div class="form-btns">${editing ? `<button type="button" class="btn danger ghost" id="psdel">削除</button><span class="spacer"></span>` : ""}<button type="button" class="btn" id="psc">キャンセル</button><button class="btn primary">保存</button></div>
    </form>`);
  const kind = body.querySelector("#pest-kind");
  const tip = () => {
    body.querySelector("#other-wrap").hidden = kind.value !== "other";
    const g = pestInfo(kind.value);
    body.querySelector("#pest-tip").innerHTML = g ? `症状の目安：${esc(g.symptoms)} <a href="#guide/${esc(g.id)}" class="linkish">対策を見る</a>` : "";
  };
  kind.onchange = tip; tip();
  body.querySelector("#pest-tip").addEventListener("click", e => { if (e.target.closest("a")) closeDialog(); });
  body.querySelector("#psc").onclick = closeDialog;
  body.querySelector("#psf").onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const files = editing ? [] : [...e.target.photos.files];
    const v = { ...ps, plantId: f.plantId, pestId: f.pestId, otherName: f.otherName?.trim() || "", found: f.found, status: f.status, memo: f.memo.trim(), id: ps.id || uid(), created: ps.created || Date.now() };
    if (v.status === "resolved" && !v.resolved) v.resolved = todayIso();
    if (v.status !== "resolved") delete v.resolved;
    await save("pests", v);
    if (files.length) { toast("写真を取り込んでいます…"); await addPhotos(files, v.plantId, v.id); }
    closeDialog(); updateBadges();
    if (editing) pestDetail(v.id); else route();
    toast("記録しました");
  };
  body.querySelector("#psdel")?.addEventListener("click", async () => {
    if (!confirm("この害虫の記録と対応履歴を削除します（写真は株の記録に残ります）。")) return;
    await remove("pests", ps.id); closeDialog(); route(); updateBadges(); toast("削除しました");
  });
}
function pestDetail(id) {
  const ps = state.pests.find(x => x.id === id);
  if (!ps) return;
  const st = PEST_STATUS[ps.status] || PEST_STATUS.active;
  const g = pestInfo(ps.pestId);
  const photos = state.photos.filter(p => p.pestId === id).sort((a, b) => a.date.localeCompare(b.date));
  const events = [
    { date: ps.found, cls: "found", html: `<b>発見</b>${ps.memo ? `<div>${esc(ps.memo)}</div>` : ""}` },
    ...(ps.treatments || []).map(t => ({ date: t.date, cls: "", html: `<b>${esc(t.method)}</b>${t.memo ? `<div>${esc(t.memo)}</div>` : ""}<button class="del" data-delt="${esc(t.id)}">削除</button>` })),
    ...(ps.resolved ? [{ date: ps.resolved, cls: "status", html: "<b>解決</b>" }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const body = openDialog(`
    <div class="form">
      <h2>${esc(pestLabel(ps))} <span class="chip ${st.cls}">${st.label}</span></h2>
      <p class="muted small" style="margin:0"><a href="#plant/${esc(ps.plantId)}" id="to-plant">${esc(plantName(ps.plantId))}</a> · 発見から${daysBetween(ps.found, ps.resolved || todayIso())}日${ps.resolved ? "で解決" : ""}</p>
      ${photos.length ? `<div class="thumbs">${photos.map(ph => `<button class="thumb" data-photo="${esc(ph.id)}">${imgSlot(ph.id)}<span class="d">${jpShort(ph.date)}</span></button>`).join("")}</div>` : ""}
      <ul class="timeline">${events.map(ev => `<li class="${ev.cls}"><div class="d">${jp(ev.date)}</div>${ev.html}</li>`).join("")}</ul>
      <form class="form card-box" id="tf" style="margin:0">
        <h3>駆除・対応を記録</h3>
        <label class="f">対応<input name="method" list="methods" required maxlength="60" placeholder="選ぶか入力"><datalist id="methods">${METHODS.map(m => `<option value="${esc(m)}">`).join("")}</datalist></label>
        <div class="two"><label class="f">日付<input type="date" name="date" required value="${todayIso()}" max="${todayIso()}"></label>
          <label class="f">状況を更新<select name="status">${Object.entries(PEST_STATUS).map(([k, v]) => `<option value="${k}" ${k === ps.status ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
        <label class="f">メモ<input name="memo" maxlength="200" placeholder="例：薬剤名、残っている数"></label>
        <div class="form-btns"><button class="btn primary">記録</button></div>
      </form>
      <div class="row-btns"><button class="btn sm" id="pe-photo">写真を追加</button><button class="btn sm" id="pe-edit">編集</button>${g ? `<a class="btn sm" href="#guide/${esc(g.id)}" id="pe-guide">対策ガイド</a>` : ""}</div>
    </div>`);
  body.querySelector("#tf").onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const v = { ...ps, treatments: [...(ps.treatments || []), { id: uid(), date: f.date, method: f.method.trim(), memo: f.memo.trim() }], status: f.status };
    if (v.status === "resolved" && !v.resolved) v.resolved = f.date;
    if (v.status !== "resolved") delete v.resolved;
    await save("pests", v); updateBadges(); route(); pestDetail(id); toast("対応を記録しました");
  };
  body.querySelectorAll("[data-delt]").forEach(b => b.onclick = async () => {
    if (!confirm("この対応の記録を削除しますか？")) return;
    await save("pests", { ...ps, treatments: ps.treatments.filter(t => t.id !== b.dataset.delt) }); route(); pestDetail(id);
  });
  body.querySelectorAll("[data-photo]").forEach(b => b.onclick = () => photoViewer(b.dataset.photo));
  body.querySelector("#pe-photo").onclick = async () => {
    const files = await pickPhotos();
    if (!files.length) return;
    toast("写真を取り込んでいます…");
    const n = await addPhotos(files, ps.plantId, id);
    if (n) { route(); pestDetail(id); toast(`写真を${n}枚追加しました`); }
  };
  body.querySelector("#pe-edit").onclick = () => pestForm(ps);
  body.querySelector("#pe-guide")?.addEventListener("click", closeDialog);
  body.querySelector("#to-plant").addEventListener("click", closeDialog);
  fillThumbs(body);
}

// ---------- ガイド ----------
function renderGuide(anchor) {
  const g = state.guide;
  if (!g) { $main.innerHTML = `<p class="muted">ガイドを読み込めませんでした。通信できる場所でもう一度開いてください。</p>`; return; }
  const list = arr => `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  $main.innerHTML = `
    <div class="head"><div><p class="kicker">Guida alla Coltivazione</p><h1>育成ガイド</h1><p class="muted small">育成のポイントと、主な病害虫の対策</p></div></div>
    <div class="note">${esc(g.note)}</div>
    <section><h2 style="margin-bottom:10px">育成のポイント</h2>
      ${g.points.map(p => `<details class="acc" id="g-${esc(p.id)}"><summary><b>${esc(p.title)}</b><span>${esc(p.summary)}</span></summary><div class="in">${list(p.body)}</div></details>`).join("")}
    </section>
    <section class="section" id="g-pests"><h2>主な病害虫と対策</h2>
      ${g.pests.map(p => `<details class="acc" id="g-${esc(p.id)}"><summary><b>${esc(p.name)}<span class="lv">${esc(p.kind)}・${esc(p.level)}</span></b><span>${esc(p.symptoms.split("。")[0])}。</span></summary>
        <div class="in"><h4>症状</h4><p>${esc(p.symptoms)}</p><h4>原因・出やすい条件</h4><p>${esc(p.cause)}</p>
          <h4>対策・駆除</h4><ol>${p.treatment.map(t => `<li>${esc(t)}</li>`).join("")}</ol><h4>予防</h4><p>${esc(p.prevention)}</p>
          ${state.plants.length ? `<div class="form-btns"><button class="btn sm" data-rec="${esc(p.id)}">この害虫を記録</button></div>` : ""}</div></details>`).join("")}
    </section>`;
  $main.querySelectorAll("[data-rec]").forEach(b => b.onclick = () => pestForm({ pestId: b.dataset.rec }));
  if (anchor) {
    const el = document.getElementById(`g-${anchor}`);
    if (el) { if (el.tagName === "DETAILS") el.open = true; requestAnimationFrame(() => el.scrollIntoView({ block: "start" })); }
  }
}

// ---------- 保存（バックアップ） ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function renderSettings() {
  let usage = "";
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) {
      const mb = est.usage / 1048576, q = est.quota / 1048576;
      usage = `<div class="meter"><i style="width:${Math.min(100, (mb / q) * 100).toFixed(1)}%"></i></div><p class="muted small">使用中 約${mb.toFixed(1)}MB${q ? ` / 使える目安 約${q >= 1024 ? (q / 1024).toFixed(1) + "GB" : q.toFixed(0) + "MB"}` : ""}</p>`;
    }
  } catch { /* 取得できない環境 */ }
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  $main.innerHTML = `
    <div class="head"><div><p class="kicker">Archivio</p><h1>データの保存</h1><p class="muted small">記録はこの端末の中だけに保存されています</p></div></div>
    <div class="card-box"><h2>バックアップを書き出す</h2>
      <p>株・写真・水やり・害虫の記録をすべて1つのファイルにまとめます。機種変更の前や、定期的（月1回など）に書き出してクラウドやパソコンに保存してください。</p>
      <p class="muted small">株 ${state.plants.length} · 写真 ${state.photos.length}枚 · お手入れ ${state.logs.length}件 · 害虫 ${state.pests.length}件</p>
      <button class="btn primary" id="export">書き出す</button></div>
    <div class="card-box"><h2>バックアップを読み込む</h2>
      <p>書き出したファイルを選ぶと、記録をこの端末に戻します。同じ記録は上書きされ、この端末にしかない記録は残ります。</p>
      <button class="btn" id="import">ファイルを選ぶ</button></div>
    <div class="card-box"><h2>ギャラリーの背景</h2><p>一覧の上に表示する写真を、飾っている壁や部屋の写真に変えられます。</p><button class="btn" id="wall">背景の写真を設定</button></div>
    <div class="card-box"><h2>保存容量</h2>${usage || `<p class="muted small">この環境では容量を確認できません。</p>`}
      <p class="small">${persisted ? "この端末では記録が自動で消されないよう保護されています。" : "空き容量が少なくなると、ブラウザーが記録を消すことがあります。ホーム画面に追加して使うと消えにくくなります。"}</p></div>
    <div class="card-box"><h2>ホーム画面に追加</h2>
      <p>iPhone は Safari の共有ボタン →「ホーム画面に追加」、Android は Chrome のメニュー →「アプリをインストール」を選ぶと、アプリとして全画面で使えます。</p>
      <p class="muted small">注意：iPhone では Safari で開いたときとホーム画面から開いたときで保存場所が別になります。どちらか一方で使い続けてください。</p></div>`;
  $main.querySelector("#export").onclick = exportBackup;
  $main.querySelector("#wall").onclick = wallForm;
  $main.querySelector("#import").onclick = () => { $fileBackup.value = ""; $fileBackup.click(); };
}
async function exportBackup() {
  toast("書き出しています…");
  const photos = [];
  for (const ph of state.photos) {
    const b = await loadImageRecord(ph.id);
    if (b) photos.push({ ...ph, full: await blobToDataURL(b.full), thumb: await blobToDataURL(b.thumb) });
  }
  const wallBlob = await loadImageRecord(WALL_ID);
  const wall = wallBlob ? { full: await blobToDataURL(wallBlob.full), thumb: await blobToDataURL(wallBlob.thumb) } : null;
  const data = { app: "fern-log", version: 1, exported: new Date().toISOString(), plants: state.plants, logs: state.logs, pests: state.pests, photos, wall };
  const name = `cervo-backup-${todayIso().replaceAll("-", "")}.json`;
  const file = new File([JSON.stringify(data)], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); toast("書き出しました"); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`${esc(name)} を保存しました`);
}
$fileBackup.onchange = async () => {
  const file = $fileBackup.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "fern-log") throw new Error("Laboratorio del Cervo のバックアップではありません");
    if (!confirm(`株 ${data.plants?.length || 0}・写真 ${data.photos?.length || 0}枚の記録を読み込みます。よろしいですか？`)) return;
    toast("読み込んでいます…");
    for (const p of data.plants || []) await save("plants", p);
    for (const l of data.logs || []) await save("logs", l);
    for (const p of data.pests || []) await save("pests", p);
    for (const { full, thumb: th, ...meta } of data.photos || []) {
      await saveImage(meta.id, await (await fetch(full)).blob(), await (await fetch(th)).blob());
      await save("photos", meta);
      thumbURL.delete(meta.id);
    }
    if (data.wall) await saveImage(WALL_ID, await (await fetch(data.wall.full)).blob(), await (await fetch(data.wall.thumb)).blob());
    route(); updateBadges(); toast("読み込みました");
  } catch (e) { console.error(e); toast(`読み込めませんでした：${esc(e.message)}`); }
};

// ---------- ルーティング ----------
function route() {
  const [tab = "plants", arg] = location.hash.replace(/^#/, "").split("/");
  const active = tab === "plant" ? "plants" : tab;
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === active));
  if (tab !== "plant") showAll.logs = false;
  ({ plants: renderPlants, plant: () => renderPlant(arg), water: renderWater, pests: renderPests, guide: () => renderGuide(arg), settings: renderSettings }[tab] || renderPlants)();
}
let lastRoute = "";
window.addEventListener("hashchange", () => {
  if (location.hash !== lastRoute) { closeDialog(); window.scrollTo(0, 0); }
  lastRoute = location.hash; route();
});
let lastDay = todayIso();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && todayIso() !== lastDay) { lastDay = todayIso(); if (!$dlg.open) route(); updateBadges(); }
});

(async function init() {
  try {
    const [plants, photos, logs, pests] = await Promise.all(["plants", "photos", "logs", "pests"].map(getAll));
    Object.assign(state, { plants, photos, logs, pests });
  } catch (e) {
    console.error(e);
    $main.innerHTML = `<p>端末の保存領域を開けませんでした。プライベートブラウズを終了するか、別のブラウザーでお試しください。</p>`;
    return;
  }
  try { state.guide = await (await fetch("./data/guide.json")).json(); } catch { state.guide = null; }
  lastRoute = location.hash;
  route(); updateBadges();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
