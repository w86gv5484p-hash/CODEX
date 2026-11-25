// 安値世界一 — 画面。設定と手入力した価格は、この端末のブラウザー（localStorage）だけに保存します。
// 価格の取得はローカルサーバー（scripts/price_server.py）が各社の公式APIで行います。
// GitHub Pages など、サーバーが無い場所で開いたときはサンプルデータ（mock.json）で動きます。
import { STORES, DEFAULT_SETTINGS, DEFAULT_STORE_SETTINGS, rankOffers, matchOffers, normalizeJan, isActive, storeSettings } from "./pricing.js";

const KEY = "price-compare-v1";
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = n => `${Math.round(n).toLocaleString("ja-JP")}円`;
const uid = () => Math.random().toString(36).slice(2, 10);
const safeUrl = u => (/^https?:\/\//i.test(u || "") ? u : "");

let S = load();
let view = { result: null, loading: false, error: "" };

function load() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY)); } catch { /* 保存なし */ }
  v = v && typeof v === "object" ? v : {};
  return {
    settings: {
      ...DEFAULT_SETTINGS, ...(v.settings || {}),
      stores: { ...structuredClone(DEFAULT_STORE_SETTINGS), ...((v.settings || {}).stores || {}) },
      campaigns: (v.settings || {}).campaigns || [],
      coupons: (v.settings || {}).coupons || [],
    },
    manual: v.manual || {},      // 検索ごとの手入力価格 { [検索キー]: offer[] }
    toggles: v.toggles || {},    // 比較に含める/外すの手動切り替え { [検索キー]: { [offerキー]: boolean } }
    last: v.last || { q: "", jan: "" },
  };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast("この端末に保存できませんでした"); } }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

const searchKey = (q, jan) => (normalizeJan(jan) || String(q || "").trim().toLowerCase());
const offerKey = o => [o.store, o.shop, o.title, o.itemCode || o.asin || o.url || ""].join("|");

// ---------- 取得 ----------
async function fetchOffers(q, jan) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (jan) params.set("jan", jan);
  try {
    const res = await fetch(`../api/price/search?${params}`, { cache: "no-store" });
    if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) return await res.json();
    if (res.status === 400) throw new Error((await res.json()).error);
  } catch (e) { if (e.message && !/fetch|JSON|Load failed|NetworkError/i.test(e.message)) throw e; }
  // ローカルサーバーが無い（GitHub Pages など）→ サンプルデータ
  const data = await (await fetch("./mock.json", { cache: "no-store" })).json();
  const stamp = new Date().toISOString();
  return {
    mode: "demo", fetchedAt: stamp,
    offers: data.offers.map(o => ({ ...o, fetchedAt: stamp, source: "mock" })),
    providers: Object.fromEntries(["rakuten", "yahoo", "amazon"].map(k => [k, { state: "mock", message: "サンプルデータ" }])),
  };
}

async function runSearch(q, jan) {
  S.last = { q, jan }; save();
  view = { result: null, loading: true, error: "" }; render();
  try { view.result = await fetchOffers(q, jan); }
  catch (e) { view.error = e.message || "取得できませんでした"; }
  view.loading = false; render();
}

// ---------- 画面 ----------
function setTab() {
  const tab = (location.hash || "#compare").slice(1);
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  return tab;
}

function render() {
  const tab = setTab();
  const main = $("#main");
  if (tab === "settings") main.innerHTML = settingsView();
  else if (tab === "help") main.innerHTML = helpView();
  else main.innerHTML = compareView();
}

function providerChips(providers = {}) {
  const label = { ok: "取得", error: "エラー", not_configured: "未設定", mock: "サンプル" };
  return `<div class="chips">${["rakuten", "amazon", "yahoo"].map(k => {
    const p = providers[k] || { state: "not_configured", message: "" };
    return `<span class="chip st-${esc(p.state)}" title="${esc(p.message)}"><b>${STORES[k].short}</b> ${label[p.state] || esc(p.state)}${p.state === "error" ? `：${esc(p.message)}` : ""}</span>`;
  }).join("")}</div>`;
}

function compareView() {
  const { q, jan } = S.last;
  const r = view.result;
  let body = "";
  if (view.loading) body = `<div class="card"><p class="muted">各ストアの価格を取得しています…</p></div>`;
  else if (view.error) body = `<div class="card warn"><p>${esc(view.error)}</p></div>`;
  else if (r) body = resultsView(r);
  else body = `<div class="card"><p class="muted">製品名かJANコード（バーコードの13桁の数字）を入れて比較します。JANコードで探すと、色違い・型番違いを取り違えにくくなります。</p></div>`;
  return `
  <section class="hero"><h1>実質価格で最安値を判定</h1>
    <p class="muted">表示価格ではなく、<b>送料・クーポン・ポイント還元</b>を差し引いた「実質価格」で比べます。</p></section>
  <form class="card form" id="search-form">
    <div class="row-search">
      <label>製品名・型番<input type="search" name="q" value="${esc(q)}" placeholder="例：ワイヤレスイヤホン X100" maxlength="128" autocomplete="off"></label>
      <label>JANコード（任意）<input name="jan" value="${esc(jan)}" inputmode="numeric" placeholder="13桁の数字" maxlength="16" autocomplete="off"></label>
      <button class="btn primary" type="submit">比較する</button>
    </div>
  </form>
  ${body}`;
}

function resultsView(r) {
  const { q, jan } = S.last;
  const key = searchKey(q, jan);
  const manual = (S.manual[key] || []).map(o => ({ ...o, source: "manual" }));
  const all = [...r.offers, ...manual];
  const toggles = S.toggles[key] || {};
  const matched = matchOffers(all, jan).map(m => {
    const k = offerKey(m.offer);
    return { ...m, key: k, include: k in toggles ? toggles[k] : m.include };
  });
  const included = matched.filter(m => m.include).map(m => m.offer);
  const excluded = matched.filter(m => !m.include);
  const now = new Date();
  const ranked = rankOffers(included, S.settings, now);
  const inStock = ranked.filter(x => x.offer.inStock !== false);
  const [best, second] = inStock;
  const activeCampaigns = S.settings.campaigns.filter(c => isActive(c, now)).length;
  const activeCoupons = S.settings.coupons.filter(c => isActive(c, now)).length;

  const banner = r.mode !== "live"
    ? `<div class="card demo"><b>サンプルデータで表示しています。</b> 架空の製品の価格です。実際の価格を取るには、このパソコンでローカルサーバーを起動し、各社のAPIキーを設定します（<a href="#help">使い方</a>）。</div>` : "";

  const summary = best ? `
    <div class="card best">
      <div class="best-label">いちばん安い（実質）</div>
      <div class="best-main"><span class="store-badge s-${esc(best.offer.store)}">${esc(STORES[best.offer.store]?.label || best.offer.store)}</span>
        <strong class="best-price">${yen(best.calc.effective)}</strong></div>
      <div class="muted small">${esc(best.offer.shop)} ／ 支払額 ${yen(best.calc.pay)} − ポイント ${best.calc.totalPoints.toLocaleString("ja-JP")}pt（${yen(best.calc.pointValue)}相当）</div>
      ${second ? `<div class="small">2番目（${esc(STORES[second.offer.store]?.short || "")}）との差：${yen(second.calc.effective - best.calc.effective)}</div>` : ""}
      ${best.calc.warnings.length ? `<div class="chips mt">${best.calc.warnings.map(w => `<span class="chip caution">${esc(w)}</span>`).join("")}</div>` : ""}
    </div>` : `<div class="card"><p class="muted">比較できる商品がありません。下の「比較から外した候補」を確認するか、価格を手入力してください。</p></div>`;

  return `${banner}
  <div class="row-between status-row">${providerChips(r.providers)}
    <span class="muted small">取得 ${new Date(r.fetchedAt).toLocaleString("ja-JP")} ／ 有効なキャンペーン ${activeCampaigns}件・クーポン ${activeCoupons}件 <a href="#settings">設定</a></span></div>
  ${summary}
  <div class="row-between"><h2>実質価格の順位（${ranked.length}件）</h2><button class="btn small-btn" type="button" data-act="add-manual">＋ 公式ショップなどの価格を入力</button></div>
  <ol class="ranking">${ranked.map((x, i) => offerCard(x, i, matched.find(m => m.offer === x.offer))).join("")}</ol>
  ${excluded.length ? `<details class="card"><summary>比較から外した候補（${excluded.length}件）</summary>
    <ul class="excluded">${excluded.map(m => `<li><label class="check"><input type="checkbox" data-toggle="${esc(m.key)}"> <span><span class="store-badge s-${esc(m.offer.store)}">${esc(STORES[m.offer.store]?.short || "")}</span> ${esc(m.offer.title)} <em class="muted">${esc(m.offer.shop)} ・ ${yen(m.offer.price)} ・ ${esc(m.reason)}</em></span></label></li>`).join("")}</ul></details>` : ""}
  <p class="muted small note">実質価格は、取得時点の価格と、還元設定に入れたキャンペーン・クーポンから計算した目安です。会員ランクや支払方法、エントリーの有無で実際の還元は変わります。購入前に各ストアの画面で確認してください。</p>`;
}

function offerCard({ offer, calc }, i, m) {
  const st = STORES[offer.store] || STORES.other;
  const url = safeUrl(offer.url);
  const pts = calc.points.map(p => `<li>${esc(p.label)}：${p.points.toLocaleString("ja-JP")}pt${p.capped ? "（上限）" : ""}<span class="muted">${p.basis === "taxExcluded" ? "・税抜基準" : p.basis === "taxIncluded" ? "・税込基準" : ""}</span></li>`).join("");
  return `<li class="card offer ${i === 0 && offer.inStock !== false ? "is-best" : ""}">
    <div class="offer-head">
      <span class="rank">${i + 1}</span>
      <span class="store-badge s-${esc(offer.store)}">${esc(st.label)}</span>
      ${offer.source === "manual" ? `<span class="chip">手入力</span>` : ""}
      ${m?.reason ? `<span class="chip ${m.reason.includes("一致") ? "ok" : "caution"}">${esc(m.reason)}</span>` : ""}
      <label class="check right"><input type="checkbox" checked data-toggle="${esc(m?.key || "")}"> 比較に含める</label>
    </div>
    <div class="offer-body">
      ${safeUrl(offer.image) ? `<img src="${esc(offer.image)}" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <div class="offer-title"><div>${esc(offer.title)}</div><div class="muted small">${esc(offer.shop)}</div></div>
      <div class="offer-price"><div class="eff">${yen(calc.effective)}</div><div class="muted small">表示 ${yen(calc.price)}</div></div>
    </div>
    <details class="breakdown"><summary>内訳</summary>
      <table>
        <tr><th>表示価格（税込）</th><td>${yen(calc.price)}</td></tr>
        <tr><th>クーポン${calc.coupon ? `（${esc(calc.coupon.label)}）` : ""}</th><td>${calc.couponDiscount ? `−${yen(calc.couponDiscount)}` : "なし"}</td></tr>
        <tr><th>送料</th><td>${calc.shippingAssumed ? "無料（プライム会員設定）" : calc.shippingKnown ? (calc.shipping ? `＋${yen(calc.shipping)}` : "無料") : "不明（0円で計算）"}</td></tr>
        <tr class="sum"><th>支払額</th><td>${yen(calc.pay)}</td></tr>
        <tr><th>ポイント</th><td>${calc.totalPoints.toLocaleString("ja-JP")}pt × ${calc.pointYen}円 ＝ −${yen(calc.pointValue)}</td></tr>
        <tr class="sum"><th>実質価格</th><td>${yen(calc.effective)}</td></tr>
      </table>
      ${pts ? `<ul class="pts">${pts}</ul>` : ""}
      ${offer.priceNote ? `<p class="muted small">${esc(offer.priceNote)}</p>` : ""}
      ${offer.shippingNote && !calc.shippingKnown ? `<p class="muted small">送料の表示：${esc(offer.shippingNote)}</p>` : ""}
      ${offer.pointRateEnd ? `<p class="muted small">ポイント倍率の終了：${esc(offer.pointRateEnd)}</p>` : ""}
      ${offer.source === "manual" ? `<button class="link" type="button" data-act="del-manual" data-key="${esc(m?.key || "")}">この手入力を削除</button>` : ""}
    </details>
    <div class="offer-foot">
      ${calc.warnings.map(w => `<span class="chip caution">${esc(w)}</span>`).join("")}
      ${url ? `<a class="btn small-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">ストアで見る</a>` : ""}
    </div>
  </li>`;
}

function manualForm() {
  const opts = Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${k === "official" ? "selected" : ""}>${v.label}</option>`).join("");
  return `<form class="form" id="manual-form"><h2>価格を手入力</h2>
    <p class="muted small">公式ショップなど API で取れないお店の価格を、画面に表示されている内容のとおり入力します。</p>
    <label>ストア<select name="store">${opts}</select></label>
    <label>店名<input name="shop" required maxlength="80" placeholder="例：メーカー公式オンラインストア"></label>
    <label>商品名<input name="title" required maxlength="160" value="${esc(S.last.q)}"></label>
    <div class="row2"><label>価格（税込・円）<input type="number" name="price" required min="1" step="1"></label>
      <label>送料（円・空欄は不明）<input type="number" name="shippingFee" min="0" step="1"></label></div>
    <div class="row2"><label>ポイント還元率（%）<input type="number" name="pointRate" min="0" max="100" step="0.1"></label>
      <label>または獲得ポイント（pt）<input type="number" name="points" min="0" step="1"></label></div>
    <label>JANコード（任意）<input name="janCode" inputmode="numeric" value="${esc(S.last.jan)}"></label>
    <label>URL（任意）<input name="url" type="url" placeholder="https://"></label>
    <button class="btn primary" type="submit">追加する</button></form>`;
}

function storeOptions(sel) {
  return Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v.label}</option>`).join("");
}

function settingsView() {
  const s = S.settings;
  const now = new Date();
  const stores = Object.entries(STORES).map(([k, v]) => {
    const st = storeSettings(s, k);
    return `<tr><th>${v.label}</th>
      <td><input type="number" step="0.01" min="0" max="5" value="${esc(st.pointYen)}" data-store="${k}" data-field="pointYen" aria-label="${v.label} 1ポイントの価値"></td>
      <td><select data-store="${k}" data-field="basis" aria-label="${v.label} ポイント計算の基準">
        <option value="taxExcluded" ${st.basis === "taxExcluded" ? "selected" : ""}>税抜</option>
        <option value="taxIncluded" ${st.basis === "taxIncluded" ? "selected" : ""}>税込</option></select></td></tr>`;
  }).join("");
  const period = c => `${c.start || "—"} 〜 ${c.end || "—"}`;
  const camp = s.campaigns.map(c => `<li class="${isActive(c, now) ? "" : "inactive"}">
    <label class="check"><input type="checkbox" ${c.enabled !== false ? "checked" : ""} data-enable="campaigns" data-id="${esc(c.id)}"></label>
    <div><b>${esc(STORES[c.store]?.short)}</b> ${esc(c.label)} <span class="muted">+${esc(c.rate)}%${c.cap ? `・上限${Number(c.cap).toLocaleString("ja-JP")}pt` : ""}・${esc(period(c))}${isActive(c, now) ? "" : "・期間外"}</span>
      ${safeUrl(c.sourceUrl) ? `<a class="small" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">出典</a>` : ""}</div>
    <button class="link" type="button" data-del="campaigns" data-id="${esc(c.id)}">削除</button></li>`).join("");
  const coup = s.coupons.map(c => `<li class="${isActive(c, now) ? "" : "inactive"}">
    <label class="check"><input type="checkbox" ${c.enabled !== false ? "checked" : ""} data-enable="coupons" data-id="${esc(c.id)}"></label>
    <div><b>${esc(STORES[c.store]?.short)}</b> ${esc(c.label)} <span class="muted">${c.type === "percent" ? `${esc(c.value)}%OFF` : `${Number(c.value).toLocaleString("ja-JP")}円OFF`}${c.minSpend ? `・${Number(c.minSpend).toLocaleString("ja-JP")}円以上` : ""}${c.maxDiscount ? `・最大${Number(c.maxDiscount).toLocaleString("ja-JP")}円` : ""}${c.shop ? `・店名に「${esc(c.shop)}」` : ""}・${esc(period(c))}${isActive(c, now) ? "" : "・期間外"}</span></div>
    <button class="link" type="button" data-del="coupons" data-id="${esc(c.id)}">削除</button></li>`).join("");
  return `
  <section class="hero"><h1>還元設定</h1>
    <p class="muted">あなたが今使えるキャンペーン・ポイントアップ・クーポンを入れると、実質価格に反映します。期間外のものは自動で計算から外れます。</p></section>
  <div class="card"><h2>ポイントの価値と計算の基準</h2>
    <p class="muted small">1ポイント＝1円が基本です。期間限定ポイントを使い切れない場合などは低めにできます。計算の基準は各ストアの案内に合わせて変えてください。</p>
    <div class="table-wrap"><table class="settings-table"><tr><th>ストア</th><th>1pt＝円</th><th>計算の基準</th></tr>${stores}</table></div>
    <label class="check mt"><input type="checkbox" data-store="amazon" data-field="prime" ${storeSettings(s, "amazon").prime ? "checked" : ""}> Amazon プライム会員（Amazon の送料を 0 円として計算）</label>
    <p class="muted small">Amazon の API は送料を返しません。オンにすると送料 0 円で計算します。出品者が Amazon.co.jp 以外（マーケットプレイス）の商品は送料がかかる場合があるため、注意を表示します。</p></div>
  <div class="grid2">
    <div class="card"><h2>キャンペーン・ポイントアップ</h2>
      <p class="muted small">例：楽天のSPU、お買い物マラソン、Yahoo!の日曜日キャンペーンなど。倍率は「上乗せ分の%」で入れます（例：+4倍なら 4）。</p>
      <ul class="list">${camp || `<li class="muted small">まだありません</li>`}</ul>
      <form class="form" id="campaign-form">
        <div class="row2"><label>ストア<select name="store">${storeOptions("rakuten")}</select></label><label>名前<input name="label" required maxlength="60" placeholder="例：SPU"></label></div>
        <div class="row2"><label>上乗せ（%）<input type="number" name="rate" required min="0" max="100" step="0.1"></label><label>上限（pt・任意）<input type="number" name="cap" min="0" step="1"></label></div>
        <div class="row2"><label>開始日（任意）<input type="date" name="start"></label><label>終了日（任意）<input type="date" name="end"></label></div>
        <label>計算の基準<select name="basis"><option value="">ストアの設定に合わせる</option><option value="taxExcluded">税抜</option><option value="taxIncluded">税込</option></select></label>
        <label>出典URL（任意）<input type="url" name="sourceUrl" placeholder="キャンペーンページのURL"></label>
        <button class="btn primary" type="submit">追加</button></form></div>
    <div class="card"><h2>クーポン</h2>
      <p class="muted small">取得済みのクーポンを入れます。1回の注文に1枚、値引き額がいちばん大きいものを使う計算です。</p>
      <ul class="list">${coup || `<li class="muted small">まだありません</li>`}</ul>
      <form class="form" id="coupon-form">
        <div class="row2"><label>ストア<select name="store">${storeOptions("yahoo")}</select></label><label>名前<input name="label" required maxlength="60" placeholder="例：5%OFFクーポン"></label></div>
        <div class="row2"><label>種類<select name="type"><option value="yen">円引き</option><option value="percent">%引き</option></select></label><label>値<input type="number" name="value" required min="0" step="1"></label></div>
        <div class="row2"><label>最低購入額（円・任意）<input type="number" name="minSpend" min="0" step="1"></label><label>値引き上限（円・任意）<input type="number" name="maxDiscount" min="0" step="1"></label></div>
        <div class="row2"><label>開始日（任意）<input type="date" name="start"></label><label>終了日（任意）<input type="date" name="end"></label></div>
        <label>対象の店名（任意・含む文字）<input name="shop" maxlength="60" placeholder="空欄ならストア全体"></label>
        <button class="btn primary" type="submit">追加</button></form></div>
  </div>
  <div class="card"><h2>その他</h2>
    <label class="inline">取得から何分たったら「古い」と表示するか <input type="number" min="1" max="1440" value="${esc(s.staleMinutes)}" data-field="staleMinutes"> 分</label>
    <div class="actions"><button class="btn" type="button" data-act="export">設定を書き出す</button><button class="btn" type="button" data-act="import">設定を読み込む</button></div></div>`;
}

function helpView() {
  return `<section class="hero"><h1>使い方</h1></section>
  <div class="card prose">
    <h2>実質価格の計算</h2>
    <p><b>実質価格 ＝ 表示価格 − クーポン ＋ 送料 − ポイント（円換算）</b></p>
    <ul>
      <li>ポイントは商品代金（クーポン値引き後・送料を除く）に倍率を掛け、1pt未満を切り捨てます。</li>
      <li>楽天は API の「ポイント倍率」（例：5倍＝5%）、Yahoo!は API の PayPay ポイント（期間限定）の付与数、Amazon は API のポイント数を使います。</li>
      <li>SPU・お買い物マラソン・クーポンなど人によって違う還元は API では取れないため、「還元設定」に入れます。</li>
      <li>楽天の API は「24時間以内に終わるポイント倍率」を返しません。Amazon の API は送料を返しません。こうした不明点は「送料不明」などと表示します。</li>
      <li>Amazon は「還元設定」のプライム会員をオン（初期値）にすると送料 0 円で計算します。出品者が Amazon.co.jp 以外の商品には注意を表示します。</li>
    </ul>
    <h2>実際の価格で使う（ローカルサーバー）</h2>
    <ol>
      <li>このリポジトリをパソコンに置き、<code>python3 scripts/price_server.py --open</code> を実行します（Windows は <code>py -3</code>）。</li>
      <li>APIキーは環境変数か、リポジトリ直下の <code>price.keys.json</code> に書きます（公開されないよう .gitignore 済み）。キーが無いストアは「未設定」と表示し、残りのストアだけで比べます。</li>
    </ol>
    <h2>公式ショップ</h2>
    <p>公式ショップには共通の API が無く、サイトの自動取得（スクレイピング）は利用規約で禁止されていることが多いため、行いません。「＋ 公式ショップなどの価格を入力」から手で入れてください。</p>
    <h2>保存場所</h2>
    <p>還元設定と手入力した価格は、この端末のブラウザーだけに保存されます。</p>
  </div>`;
}

// ---------- 操作 ----------
document.addEventListener("submit", e => {
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));
  const n = v => (v === "" || v === undefined ? null : Number(v));
  if (f.id === "search-form") {
    e.preventDefault();
    const q = (data.q || "").trim();
    const janRaw = (data.jan || "").replace(/\D/g, "");
    if (janRaw && !normalizeJan(janRaw)) { toast("JANコードの桁数かチェックディジットが合いません"); return; }
    if (!q && !janRaw) { toast("製品名かJANコードを入力してください"); return; }
    runSearch(q, janRaw);
  } else if (f.id === "manual-form") {
    e.preventDefault();
    const key = searchKey(S.last.q, S.last.jan);
    (S.manual[key] ||= []).push({
      id: uid(), store: data.store, shop: data.shop.trim(), title: data.title.trim(), price: n(data.price),
      shippingFee: n(data.shippingFee), pointRate: n(data.pointRate), points: n(data.points),
      janCode: (data.janCode || "").replace(/\D/g, "") || null, url: safeUrl(data.url) || null,
      inStock: true, fetchedAt: new Date().toISOString(),
    });
    save(); $("#dlg").close(); render(); toast("追加しました");
  } else if (f.id === "campaign-form") {
    e.preventDefault();
    S.settings.campaigns.push({ id: uid(), store: data.store, label: data.label.trim(), rate: n(data.rate), cap: n(data.cap),
      start: data.start || null, end: data.end || null, basis: data.basis || null, sourceUrl: safeUrl(data.sourceUrl) || null, enabled: true });
    save(); render(); toast("キャンペーンを追加しました");
  } else if (f.id === "coupon-form") {
    e.preventDefault();
    S.settings.coupons.push({ id: uid(), store: data.store, label: data.label.trim(), type: data.type, value: n(data.value),
      minSpend: n(data.minSpend), maxDiscount: n(data.maxDiscount), shop: (data.shop || "").trim() || null,
      start: data.start || null, end: data.end || null, enabled: true });
    save(); render(); toast("クーポンを追加しました");
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.toggle !== undefined && t.dataset.toggle !== "") {
    const key = searchKey(S.last.q, S.last.jan);
    (S.toggles[key] ||= {})[t.dataset.toggle] = t.checked;
    save(); render();
  } else if (t.dataset.store) {
    const v = t.dataset.field === "pointYen" ? Math.max(0, Number(t.value) || 0) : t.type === "checkbox" ? t.checked : t.value;
    S.settings.stores[t.dataset.store] = { ...storeSettings(S.settings, t.dataset.store), [t.dataset.field]: v };
    save(); toast("保存しました");
  } else if (t.dataset.field === "staleMinutes") {
    S.settings.staleMinutes = Math.max(1, Number(t.value) || 60); save(); toast("保存しました");
  } else if (t.dataset.enable) {
    const item = S.settings[t.dataset.enable].find(x => x.id === t.dataset.id);
    if (item) { item.enabled = t.checked; save(); render(); }
  } else if (t.id === "file-import" && t.files[0]) {
    t.files[0].text().then(txt => {
      const v = JSON.parse(txt);
      if (!v || typeof v !== "object" || !v.settings) throw new Error();
      localStorage.setItem(KEY, JSON.stringify(v)); S = load(); render(); toast("読み込みました");
    }).catch(() => toast("このファイルは読み込めません")).finally(() => { t.value = ""; });
  }
});

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act],[data-del],.x");
  if (!t) return;
  if (t.classList.contains("x")) { $("#dlg").close(); return; }
  if (t.dataset.del) {
    S.settings[t.dataset.del] = S.settings[t.dataset.del].filter(x => x.id !== t.dataset.id); save(); render(); return;
  }
  const act = t.dataset.act;
  if (act === "add-manual") { $("#dlg-body").innerHTML = manualForm(); $("#dlg").showModal(); }
  else if (act === "del-manual") {
    const key = searchKey(S.last.q, S.last.jan);
    S.manual[key] = (S.manual[key] || []).filter(o => offerKey({ ...o, source: "manual" }) !== t.dataset.key);
    save(); render();
  } else if (act === "export") {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `price-settings-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (act === "import") $("#file-import").click();
});

window.addEventListener("hashchange", render);
render();
if (S.last.q || S.last.jan) runSearch(S.last.q, S.last.jan);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
