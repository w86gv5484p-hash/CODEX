// 安値世界一（price/）の実質価格計算のテスト。実行：node --test scripts/test_price_calc.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../price/pricing.js";

const NOW = new Date("2026-11-25T12:00:00+09:00");
const S = (over = {}) => ({ ...P.DEFAULT_SETTINGS, ...over });

test("楽天：倍率は税抜・クーポン後の商品代金に掛け、送料は対象外", () => {
  const offer = { store: "rakuten", price: 11000, shippingFee: 500, pointRate: 5 };
  const c = P.effectivePrice(offer, S(), NOW);
  // 税抜 10,000円 × 5% = 500pt、支払 11,500円
  assert.equal(c.totalPoints, 500);
  assert.equal(c.pay, 11500);
  assert.equal(c.effective, 11000);
});

test("クーポンは期間内で条件を満たすもののうち最大の1枚だけ", () => {
  const coupons = [
    { id: "a", store: "yahoo", label: "500円引き", type: "yen", value: 500, minSpend: 3000 },
    { id: "b", store: "yahoo", label: "10%OFF", type: "percent", value: 10, maxDiscount: 800 },
    { id: "c", store: "yahoo", label: "期限切れ", type: "yen", value: 5000, end: "2026-11-24" },
    { id: "d", store: "rakuten", label: "別ストア", type: "yen", value: 3000 },
  ];
  const c = P.effectivePrice({ store: "yahoo", price: 12000, shippingFee: 0 }, S({ coupons }), NOW);
  assert.equal(c.couponDiscount, 800);
  assert.equal(c.coupon.id, "b");
});

test("最低購入額に届かないクーポンは使わない", () => {
  const coupons = [{ id: "a", store: "amazon", type: "yen", value: 1000, minSpend: 20000 }];
  const c = P.effectivePrice({ store: "amazon", price: 12000, shippingFee: 0 }, S({ coupons }), NOW);
  assert.equal(c.couponDiscount, 0);
});

test("キャンペーンは上限と期間を守る。終了日はその日の終わりまで有効", () => {
  const campaigns = [
    { id: "x", store: "rakuten", label: "SPU", rate: 10, cap: 300 },
    { id: "y", store: "rakuten", label: "今日まで", rate: 2, end: "2026-11-25" },
    { id: "z", store: "rakuten", label: "明日から", rate: 50, start: "2026-11-26" },
    { id: "w", store: "rakuten", label: "無効", rate: 50, enabled: false },
  ];
  const c = P.effectivePrice({ store: "rakuten", price: 11000, shippingFee: 0, pointRate: 1 }, S({ campaigns }), NOW);
  const byLabel = Object.fromEntries(c.points.map(p => [p.label, p.points]));
  assert.equal(byLabel["SPU"], 300); // 1,000pt を上限 300pt に
  assert.equal(byLabel["今日まで"], 200);
  assert.equal(byLabel["明日から"], undefined);
  assert.equal(byLabel["無効"], undefined);
  assert.equal(c.totalPoints, 100 + 300 + 200);
});

test("固定ポイント（Yahoo!/Amazon）はそのまま加算し、1pt の価値を変えられる", () => {
  const settings = S({ stores: { ...P.DEFAULT_STORE_SETTINGS, yahoo: { pointYen: 0.8, basis: "taxExcluded" } } });
  const c = P.effectivePrice({ store: "yahoo", price: 10000, shippingFee: 0, points: 500 }, settings, NOW);
  assert.equal(c.pointValue, 400);
  assert.equal(c.effective, 9600);
});

test("送料不明は 0 円で計算して警告を出す", () => {
  const c = P.effectivePrice({ store: "amazon", price: 5000, shippingFee: null }, S(), NOW);
  assert.equal(c.pay, 5000);
  assert.ok(c.warnings.some(w => w.includes("送料不明")));
});

test("古い取得データには経過時間の警告を出す", () => {
  const c = P.effectivePrice({ store: "amazon", price: 5000, shippingFee: 0, fetchedAt: "2026-11-25T09:00:00+09:00" }, S(), NOW);
  assert.ok(c.warnings.some(w => w.includes("分経過")));
});

test("順位は実質価格の安い順、在庫なしは最後", () => {
  const offers = [
    { store: "amazon", price: 10000, shippingFee: 0, points: 0 },
    { store: "rakuten", price: 11000, shippingFee: 0, pointRate: 20 }, // 11,000 − 2,000 = 9,000
    { store: "yahoo", price: 5000, shippingFee: 0, inStock: false },
  ];
  const r = P.rankOffers(offers, S(), NOW);
  assert.deepEqual(r.map(x => x.offer.store), ["rakuten", "amazon", "yahoo"]);
  assert.equal(r[0].calc.effective, 9000);
});

test("サンプルデータの最安は楽天（ポイント10倍）になる", async () => {
  const { readFile } = await import("node:fs/promises");
  const mock = JSON.parse(await readFile(new URL("../price/mock.json", import.meta.url), "utf8"));
  const matched = P.matchOffers(mock.offers, "2001234000017").filter(m => m.include).map(m => m.offer);
  assert.equal(matched.length, 5); // ホワイト（JAN 違い）は外れる
  const r = P.rankOffers(matched, S(), NOW);
  assert.equal(r[0].offer.store, "rakuten");
  assert.equal(r[0].calc.effective, 12980 - 1180);
});

test("JAN のチェックディジットを確かめる", () => {
  assert.equal(P.normalizeJan("4901234567894"), "4901234567894");
  assert.equal(P.normalizeJan("4901234567890"), null);
  assert.equal(P.normalizeJan("49-01234-56789-4"), "4901234567894");
  assert.equal(P.normalizeJan("12345"), null);
  assert.equal(P.normalizeJan("49123456"), "49123456"); // 8桁（短縮JAN）
  assert.equal(P.normalizeJan("49123454"), null);
});

test("JAN 指定時：一致は採用、不一致と不明は外す", () => {
  const offers = [{ janCode: "2001234000017" }, { janCode: "2001234000024" }, { janCode: null }];
  const m = P.matchOffers(offers, "2001234000017");
  assert.deepEqual(m.map(x => x.include), [true, false, false]);
  assert.deepEqual(m.map(x => x.reason), ["JAN一致", "JAN不一致", "JAN不明（要確認）"]);
});
