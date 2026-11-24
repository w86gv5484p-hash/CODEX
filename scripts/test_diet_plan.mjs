// 減量プラン（diet/）の計算ロジックのテスト。実行：node --test scripts/test_diet_plan.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../diet/plan.js";
import * as M from "../diet/meals.js";

const profile = { sex: "male", age: 40, height: 172, weight: 78, activity: "light" };
const cap = { exerciseType: "walk", exerciseDays: 3, exerciseMinutes: 30, stepsNow: 5000, stepsMax: 9000, sleepHours: 6, habits: ["stairs", "sleep"] };
const START = "2026-11-24";

test("必要な赤字は 減量kg × 7,200kcal を日数で割った量", () => {
  const t = P.computeTarget(profile, { weight: 72, date: "2027-03-24" }, START);
  assert.equal(t.days, 120);
  assert.equal(t.totalDeficit, 6 * 7200);
  assert.equal(t.daily, 360);
});

test("配分の合計は必要量と一致し、各要素は上限を超えない", () => {
  const caps = P.capacities(profile, cap);
  const a = P.allocate(360, caps, P.DEFAULT_SHARES);
  assert.ok(Math.abs(a.total - 360) < 1e-6);
  for (const k of P.LEVERS) assert.ok(a.values[k] <= caps[k] + 1e-6);
});

test("運動ができないと、その分を食事とその他が補う", () => {
  const caps0 = P.capacities(profile, { ...cap, exerciseDays: 0 });
  const withEx = P.allocate(360, P.capacities(profile, cap), P.DEFAULT_SHARES);
  const noEx = P.allocate(360, caps0, P.DEFAULT_SHARES);
  assert.equal(noEx.values.exercise, 0);
  assert.ok(Math.abs(noEx.total - 360) < 1e-6);
  assert.ok(noEx.values.diet > withEx.values.diet && noEx.values.other > withEx.values.other);
});

test("ある要素を減らすと残りが増え、固定した要素は動かない", () => {
  const caps = P.capacities(profile, cap);
  const a = P.allocate(360, caps, P.DEFAULT_SHARES, { exercise: 40 }, { key: "diet", value: 100 });
  assert.equal(a.values.exercise, 40);
  assert.equal(a.values.diet, 100);
  assert.ok(Math.abs(a.values.other - 220) < 1e-6);
});

test("上限の合計で足りないときは不足分と届く目標日を示す", () => {
  const t = P.computeTarget(profile, { weight: 68, date: "2026-12-24" }, START);
  const caps = P.capacities(profile, cap);
  const a = P.allocate(t.daily, caps, P.DEFAULT_SHARES);
  assert.ok(a.shortfall > 0);
  const w = P.warnings(profile, { weight: 68, date: "2026-12-24" }, t, a, caps, START);
  assert.ok(w.some(x => x.fix === "feasible"));
  assert.ok(P.feasibleDate(t, caps, START) > "2026-12-24");
});

test("月に体重の5%を超えるペースは危険として警告する", () => {
  const goal = { weight: 70, date: "2027-01-24" }; // 2か月で8kg（月約5%超）
  const t = P.computeTarget(profile, goal, START);
  const w = P.warnings(profile, goal, t, null, null, START);
  assert.ok(t.monthlyRate > P.MAX_MONTHLY_RATE);
  assert.ok(w.some(x => x.level === "danger" && x.fix === "safe"));
});

test("食事の上限は摂取量が基礎代謝を下回らない範囲", () => {
  const caps = P.capacities(profile, cap);
  assert.ok(caps.tdee - caps.diet >= P.minIntake(profile) - 1e-6);
});

test("朝が魚なら、次の食事は魚以外のたんぱく質をすすめる", () => {
  const t = P.computeTarget(profile, { weight: 72, date: "2027-03-24" }, START);
  const target = P.dietTarget(200, t, profile, { weight: 72 });
  const day = { breakfast: ["rice", "miso", "salmon"] };
  day.__items = { breakfast: M.resolveItems(day.breakfast) };
  for (const mode of ["home", "conv", "out"]) {
    const { picks } = M.suggest(mode, "lunch", day, target, "male");
    assert.equal(picks.length, 3);
    for (const p of picks) assert.ok(!p.t.src.includes("fish"), `${mode}: ${M.itemLabel(p)}`);
    assert.ok(picks.some(p => p.t.g.side >= 1), `${mode} で野菜を補う候補がある`);
  }
});
