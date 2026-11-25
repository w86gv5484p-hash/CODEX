// 実質価格の計算（画面やAPIに依存しない純粋な関数）。テスト：node --test scripts/test_price_calc.mjs
//
// 実質価格 = 表示価格（税込） − クーポン値引き + 送料 − 獲得ポイントの円換算
//
// ・ポイントは「商品代金（クーポン値引き後、送料は含めない）」に倍率を掛け、1円未満を切り捨てます。
// ・税抜を基準にする店舗は、税込価格を (1 + 税率) で割り、1円未満を切り捨てた額を基準にします。
// ・キャンペーンとクーポンは期間（start〜end）内のものだけを使います。「その時点」の実質価格です。
// ・送料が分からない（API が返さない）商品は 0 円として計算し、warnings に「送料不明」を入れます。

export const STORES = {
  rakuten: { label: "楽天市場", short: "楽天" },
  amazon: { label: "Amazon", short: "Amazon" },
  yahoo: { label: "Yahoo!ショッピング", short: "Yahoo!" },
  official: { label: "公式ショップ", short: "公式" },
  other: { label: "その他", short: "他" },
};

// 店舗ごとの初期設定。ポイント計算の基準は各社の案内で変わることがあるため、設定画面で変更できます。
// 楽天・Yahoo!は「税抜価格に対してポイントを付与」と案内されてきた（要確認）ため税抜を初期値にしています。
export const DEFAULT_STORE_SETTINGS = {
  rakuten: { pointYen: 1, basis: "taxExcluded" },
  amazon: { pointYen: 1, basis: "taxIncluded" },
  yahoo: { pointYen: 1, basis: "taxExcluded" },
  official: { pointYen: 1, basis: "taxIncluded" },
  other: { pointYen: 1, basis: "taxIncluded" },
};

export const DEFAULT_SETTINGS = {
  stores: DEFAULT_STORE_SETTINGS,
  campaigns: [], // { id, store, label, rate(%), cap(pt|null), basis(null=店舗設定), start, end, enabled, sourceUrl, note }
  coupons: [],   // { id, store, label, type:"yen"|"percent", value, minSpend, maxDiscount, shop, start, end, enabled }
  staleMinutes: 60,
};

const floor = n => Math.floor(n + 1e-9);
const num = v => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** 期間内か（start/end は ISO 文字列か "YYYY-MM-DD"。end の日付だけ指定はその日の終わりまで有効） */
export function isActive(item, now = new Date()) {
  if (!item || item.enabled === false) return false;
  const t = now.getTime();
  if (item.start) {
    const s = new Date(item.start.length === 10 ? `${item.start}T00:00:00+09:00` : item.start).getTime();
    if (!Number.isNaN(s) && t < s) return false;
  }
  if (item.end) {
    const e = new Date(item.end.length === 10 ? `${item.end}T23:59:59.999+09:00` : item.end).getTime();
    if (!Number.isNaN(e) && t > e) return false;
  }
  return true;
}

export function storeSettings(settings, store) {
  return { ...DEFAULT_STORE_SETTINGS.other, ...(DEFAULT_STORE_SETTINGS[store] || {}), ...((settings?.stores || {})[store] || {}) };
}

/** その時点で使えるクーポンのうち、値引き額が最大のもの（1注文1枚を想定） */
export function bestCoupon(offer, coupons = [], now = new Date()) {
  let best = null;
  for (const c of coupons) {
    if (c.store !== offer.store || !isActive(c, now)) continue;
    if (c.shop && !(offer.shop || "").includes(c.shop)) continue;
    if (num(c.minSpend) !== null && offer.price < Number(c.minSpend)) continue;
    let d = c.type === "percent" ? floor(offer.price * Number(c.value) / 100) : Number(c.value);
    if (num(c.maxDiscount) !== null) d = Math.min(d, Number(c.maxDiscount));
    d = Math.max(0, Math.min(d, offer.price));
    if (!best || d > best.discount) best = { coupon: c, discount: d };
  }
  return best;
}

function base(amountTaxIncluded, basis, taxRate) {
  return basis === "taxExcluded" ? floor(amountTaxIncluded / (1 + taxRate / 100)) : amountTaxIncluded;
}

/**
 * 1件の実質価格と内訳を計算する。
 * offer: { store, price(税込), shippingFee(null=不明), pointRate(%|null), points(pt|null), taxRate(既定10), janCode, fetchedAt, source }
 */
export function effectivePrice(offer, settings = DEFAULT_SETTINGS, now = new Date()) {
  const st = storeSettings(settings, offer.store);
  const taxRate = num(offer.taxRate) ?? 10;
  const price = Number(offer.price) || 0;
  const warnings = [];

  const coupon = bestCoupon({ ...offer, price }, settings.coupons, now);
  const couponDiscount = coupon ? coupon.discount : 0;

  const shippingKnown = num(offer.shippingFee) !== null;
  const shipping = shippingKnown ? Number(offer.shippingFee) : 0;
  if (!shippingKnown) warnings.push("送料不明（0円で計算）");

  const goods = price - couponDiscount; // ポイントの対象（送料は含めない）
  const points = [];
  if (num(offer.pointRate) !== null && Number(offer.pointRate) > 0) {
    const b = base(goods, st.basis, taxRate);
    points.push({ label: `商品ポイント ${offer.pointRate}%`, points: floor(b * Number(offer.pointRate) / 100), basis: st.basis });
  }
  if (num(offer.points) !== null && Number(offer.points) > 0) {
    points.push({ label: offer.pointsLabel || "ストア・商品ポイント", points: floor(Number(offer.points)), basis: "fixed" });
  }
  for (const c of settings.campaigns || []) {
    if (c.store !== offer.store || !isActive(c, now)) continue;
    const basis = c.basis || st.basis;
    let p = floor(base(goods, basis, taxRate) * Number(c.rate || 0) / 100);
    const cap = num(c.cap);
    let capped = false;
    if (cap !== null && p > cap) { p = cap; capped = true; }
    if (p > 0) points.push({ label: c.label || "キャンペーン", points: p, basis, capped, campaignId: c.id });
  }
  const totalPoints = points.reduce((s, p) => s + p.points, 0);
  const pointValue = floor(totalPoints * Number(st.pointYen ?? 1));
  const pay = price - couponDiscount + shipping;

  if (offer.source === "mock") warnings.push("サンプルデータ");
  if (offer.fetchedAt) {
    const ageMin = (now.getTime() - new Date(offer.fetchedAt).getTime()) / 60000;
    if (ageMin > (settings.staleMinutes ?? 60)) warnings.push(`取得から${Math.round(ageMin)}分経過`);
  }
  if (offer.inStock === false) warnings.push("在庫なし");

  return {
    price, couponDiscount, coupon: coupon?.coupon || null, shipping, shippingKnown,
    pay, points, totalPoints, pointYen: Number(st.pointYen ?? 1), pointValue,
    effective: pay - pointValue, warnings,
  };
}

/** 比較対象の商品を実質価格の安い順に並べる。在庫なしは最後。同額なら支払額の安い順。 */
export function rankOffers(offers, settings = DEFAULT_SETTINGS, now = new Date()) {
  return offers
    .map(offer => ({ offer, calc: effectivePrice(offer, settings, now) }))
    .sort((a, b) => (a.offer.inStock === false) - (b.offer.inStock === false)
      || a.calc.effective - b.calc.effective || a.calc.pay - b.calc.pay);
}

/** JAN コードを正規化（数字以外を除去）。8桁か13桁でチェックディジットが合えば返す。 */
export function normalizeJan(value) {
  const d = String(value || "").replace(/\D/g, "");
  if (d.length !== 8 && d.length !== 13) return null;
  const digits = d.split("").map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : null;
}

/**
 * 同一製品の候補を選ぶ。JAN を指定した検索では、JAN が一致するものを採用し、JAN が無いものは「要確認」にします。
 * 返り値: { offer, include: boolean, reason }
 */
export function matchOffers(offers, jan) {
  const target = normalizeJan(jan);
  return offers.map(offer => {
    const j = normalizeJan(offer.janCode);
    if (!target) return { offer, include: true, reason: j ? "" : "JAN不明" };
    if (j === target) return { offer, include: true, reason: "JAN一致" };
    if (!j) return { offer, include: false, reason: "JAN不明（要確認）" };
    return { offer, include: false, reason: "JAN不一致" };
  });
}
