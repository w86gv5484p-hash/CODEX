// 減量プランの計算（画面に依存しない純粋な関数）。
// 1. 必要なカロリー赤字の総量を出す  2. 運動・食事・その他に配分する  3. 各配分を具体的なメニューに変換する
// 配分は「できる量（上限）」の範囲で行い、ある要素の上限が下がると、残りを他の要素が自動で補う。

export const KCAL_PER_KG = 7200;           // 体脂肪1kg ≒ 7,200kcal
export const SAFE_MONTHLY_RATE = 0.03;     // 推奨ペース：1か月に体重の3%
export const MAX_MONTHLY_RATE = 0.05;      // これを超えると無理なペース：1か月に体重の5%
export const DAYS_PER_MONTH = 30.4;

export const ACTIVITY_LEVELS = [
  { id: "low", label: "ほぼ座って過ごす（デスクワーク中心）", factor: 1.2 },
  { id: "light", label: "少し動く（通勤で歩く・立ち仕事が少し）", factor: 1.375 },
  { id: "moderate", label: "よく動く（立ち仕事・軽い運動を週1〜2回）", factor: 1.55 },
  { id: "high", label: "とても活発（肉体労働・ほぼ毎日運動）", factor: 1.725 },
];

// METs は「身体活動のメッツ表」（国立健康・栄養研究所）の代表値
export const EXERCISES = [
  { id: "walk", label: "早歩きウォーキング", mets: 4.3 },
  { id: "jog", label: "ジョギング", mets: 7.0 },
  { id: "bike", label: "サイクリング・エアロバイク", mets: 6.8 },
  { id: "swim", label: "水泳（ゆっくり）", mets: 5.8 },
  { id: "strength", label: "筋トレ（自重・マシン）", mets: 5.0 },
  { id: "dance", label: "フィットネス動画・エアロビクス", mets: 6.5 },
];

// 「その他」で選べる生活習慣。kcal は1日あたりの目安
export const HABITS = [
  { id: "stairs", label: "エレベーターより階段を使う", kcal: 20 },
  { id: "stand", label: "30分ごとに立ち上がる・家事をこまめにする", kcal: 50 },
  { id: "sleep", label: "睡眠を7時間以上とる", kcal: 100, note: "睡眠不足は食欲を増やすため、間食・食べ過ぎを抑える効果の目安" },
  { id: "nightsnack", label: "寝る3時間前からは食べない", kcal: 80, note: "夜食・だらだら食べを防ぐ効果の目安" },
];

export const LEVERS = ["exercise", "diet", "other"];
export const LEVER_LABELS = { exercise: "運動", diet: "食事", other: "その他" }
export const LEVER_NOTES = { exercise: "運動で消費を増やす", diet: "食べる量を減らす", other: "歩数・睡眠・生活習慣" };;
export const DEFAULT_SHARES = { exercise: 0.3, diet: 0.55, other: 0.15 };

const round = (v, step = 1) => Math.round(v / step) * step;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z"), b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}
export function addDays(iso, days) {
  const d = new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// Mifflin-St Jeor 式
export function bmr({ sex, age, height, weight }) {
  return 10 * weight + 6.25 * height - 5 * age + (sex === "female" ? -161 : 5);
}
export const bmi = (weight, height) => weight / (height / 100) ** 2;

export function minIntake(profile) {
  return Math.max(bmr(profile), profile.sex === "female" ? 1200 : 1500);
}

// 運動で1日あたりに減らせる量（kcal）。安静時の分（1MET）は差し引く
export function exerciseKcal(mets, weight, minutes) {
  return (mets - 1) * weight * 1.05 * (minutes / 60);
}
export const kcalPer1000Steps = weight => weight * 0.5;

// 各要素の「できる量（1日あたりの上限kcal）」
export function capacities(profile, cap) {
  const tdee = bmr(profile) * factorOf(profile.activity);
  const ex = EXERCISES.find(e => e.id === cap.exerciseType) || EXERCISES[0];
  const exercise = exerciseKcal(ex.mets, profile.weight, cap.exerciseDays * cap.exerciseMinutes) / 7;
  const diet = Math.max(0, Math.min(tdee - minIntake(profile), tdee * 0.3));
  const stepsGain = Math.max(0, cap.stepsMax - cap.stepsNow);
  const steps = (stepsGain / 1000) * kcalPer1000Steps(profile.weight);
  const habits = habitList(cap).reduce((s, h) => s + h.kcal, 0);
  return { exercise, diet, other: steps + habits, parts: { steps, habits }, tdee };
}

function factorOf(id) { return (ACTIVITY_LEVELS.find(a => a.id === id) || ACTIVITY_LEVELS[0]).factor; }

// 睡眠がすでに7時間以上なら「睡眠」の効果は見込まない
export function habitList(cap) {
  return HABITS.filter(h => (cap.habits || []).includes(h.id) && !(h.id === "sleep" && cap.sleepHours >= 7));
}

// 量 amount を、重み weights に比例して上限 caps まで配る（あふれた分は余裕のある要素へ回す）
export function distribute(amount, keys, caps, weights) {
  const out = Object.fromEntries(keys.map(k => [k, 0]));
  let left = amount;
  for (let guard = 0; guard < 10 && left > 1e-6; guard++) {
    const open = keys.filter(k => caps[k] - out[k] > 1e-6);
    if (!open.length) break;
    let w = open.map(k => Math.max(0, weights[k] || 0));
    if (w.every(x => x === 0)) w = open.map(() => 1);  // 全員0なら均等に
    const total = w.reduce((a, b) => a + b, 0);
    let given = 0;
    open.forEach((k, i) => {
      if (!w[i]) return;
      const add = Math.min(left * w[i] / total, caps[k] - out[k]);
      out[k] += add; given += add;
    });
    left -= given;
    // 重みのある要素が全部上限に達したら、残りは重み0の要素にも均等に回す
    if (left > 1e-6 && open.every((k, i) => !w[i] || caps[k] - out[k] <= 1e-6)) {
      keys.forEach(k => { if (!(weights[k] > 0)) weights = { ...weights, [k]: 1 }; });
    }
  }
  return { values: out, left: Math.max(0, left) };
}

// 必要量 required を3要素に配分する。
// locks: { exercise: 300 } のように固定した要素。override: いま動かしている要素とその値
export function allocate(required, caps, shares, locks = {}, override = null) {
  const values = {};
  const fixed = new Set();
  for (const k of LEVERS) {
    if (locks[k] != null) { values[k] = clamp(locks[k], 0, caps[k]); fixed.add(k); }
  }
  if (override) { values[override.key] = clamp(override.value, 0, caps[override.key]); fixed.add(override.key); }
  const free = LEVERS.filter(k => !fixed.has(k));
  const usedFixed = [...fixed].reduce((s, k) => s + values[k], 0);
  const rest = Math.max(0, required - usedFixed);
  const { values: dv } = distribute(rest, free, caps, shares);
  free.forEach(k => { values[k] = dv[k]; });
  const total = LEVERS.reduce((s, k) => s + values[k], 0);
  return { values, total, shortfall: Math.max(0, required - total), surplus: Math.max(0, total - required) };
}

// 配分の結果から、次回以降に使う重みを作る
export function sharesFrom(values) {
  const total = LEVERS.reduce((s, k) => s + values[k], 0);
  if (total <= 0) return { ...DEFAULT_SHARES };
  return Object.fromEntries(LEVERS.map(k => [k, values[k] / total]));
}

// 目標全体の計算と安全チェック
export function computeTarget(profile, goal, today) {
  const days = daysBetween(today, goal.date);
  const lossKg = profile.weight - goal.weight;
  const totalDeficit = lossKg * KCAL_PER_KG;
  const daily = days > 0 ? totalDeficit / days : 0;
  const monthlyKg = days > 0 ? lossKg / days * DAYS_PER_MONTH : 0;
  const monthlyRate = monthlyKg / profile.weight;
  const tdee = bmr(profile) * factorOf(profile.activity);
  const safeDays = Math.ceil(lossKg / (profile.weight * SAFE_MONTHLY_RATE) * DAYS_PER_MONTH);
  const maxDays = Math.ceil(lossKg / (profile.weight * MAX_MONTHLY_RATE) * DAYS_PER_MONTH);
  return {
    days, lossKg, totalDeficit, daily, monthlyKg, monthlyRate, tdee, bmr: bmr(profile),
    safeDate: addDays(today, safeDays), minDate: addDays(today, maxDays),
    bmiNow: bmi(profile.weight, profile.height), bmiGoal: bmi(goal.weight, profile.height),
  };
}

export function warnings(profile, goal, t, alloc, caps, today) {
  const w = [];
  if (!(profile.weight > 0 && goal.weight > 0 && profile.height > 0)) return [{ level: "error", text: "身長・体重を入力してください。" }];
  if (t.lossKg <= 0) return [{ level: "error", text: "目標体重は現在の体重より軽く設定してください。" }];
  if (t.days <= 0) return [{ level: "error", text: "目標日は明日以降の日付にしてください。" }];
  if (t.monthlyRate > MAX_MONTHLY_RATE) {
    w.push({ level: "danger", text: `1か月あたり ${t.monthlyKg.toFixed(1)}kg（体重の${(t.monthlyRate * 100).toFixed(1)}%）は無理なペースです。筋肉量の低下・リバウンド・体調不良につながりやすくなります。月5%以内（目標日 ${fmtDate(t.minDate)} 以降）、できれば月3%（${fmtDate(t.safeDate)}）を目安にしてください。`, fix: "safe" });
  } else if (t.monthlyRate > SAFE_MONTHLY_RATE) {
    w.push({ level: "caution", text: `1か月あたり ${t.monthlyKg.toFixed(1)}kg（体重の${(t.monthlyRate * 100).toFixed(1)}%）はやや速いペースです。体調を見ながら進め、つらいときは期間を延ばしてください（推奨：${fmtDate(t.safeDate)}）。`, fix: "safe" });
  }
  if (t.daily > 1000) w.push({ level: "danger", text: `1日 ${round(t.daily)}kcal の赤字は大きすぎます。一般に1日500〜750kcal程度が続けやすい目安です。` });
  if (t.bmiGoal < 18.5) w.push({ level: "danger", text: `目標体重の BMI は ${t.bmiGoal.toFixed(1)} で「低体重」（18.5未満）になります。目標体重を見直してください。` });
  if (profile.age < 18) w.push({ level: "caution", text: "18歳未満は成長に必要な栄養が多いため、減量は医師や学校の先生と相談して進めてください。" });
  if (alloc && alloc.shortfall > 1) {
    w.push({ level: "danger", text: `いまの「できる量」では1日 ${round(alloc.shortfall)}kcal 足りません。運動の時間・歩数を増やすか、目標日を延ばしてください（いまの上限で届く目標日：${fmtDate(feasibleDate(t, caps, today))}）。`, fix: "feasible" });
  }
  return w;
}

// いまの「できる量」の合計で届く目標日（安全な上限ペースより早くはしない）
export function feasibleDate(t, caps, today) {
  const max = caps.exercise + caps.diet + caps.other;
  if (max <= 0) return null;
  const d = addDays(today, Math.ceil(t.totalDeficit / max));
  return d < t.minDate ? t.minDate : d; // 月5%を超える日付は勧めない
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// ---------- 配分を具体的なメニューにする ----------

export function exerciseMenu(kcal, profile, cap) {
  const ex = EXERCISES.find(e => e.id === cap.exerciseType) || EXERCISES[0];
  const perMinute = exerciseKcal(ex.mets, profile.weight, 1);
  const weekly = kcal * 7;
  const days = Math.max(1, cap.exerciseDays);
  const minutes = kcal > 0 ? Math.ceil(weekly / days / perMinute / 5) * 5 : 0;
  return { type: ex, days: kcal > 0 ? days : 0, minutes, weeklyKcal: weekly, perSession: minutes * perMinute };
}

export function otherMenu(kcal, profile, cap) {
  const habits = habitList(cap);
  let left = kcal;
  const used = [];
  for (const h of habits) {
    if (left <= 0) break;
    used.push(h); left -= h.kcal;
  }
  const per1000 = kcalPer1000Steps(profile.weight);
  const addSteps = left > 0 ? Math.ceil(left / per1000 * 1000 / 500) * 500 : 0;
  const target = Math.min(cap.stepsMax, cap.stepsNow + addSteps);
  return { habits: used, stepsNow: cap.stepsNow, stepsTarget: Math.max(cap.stepsNow, target), addSteps: Math.max(0, target - cap.stepsNow) };
}

// 食事の目標：摂取カロリーと PFC（たんぱく質は体重1kgあたり1.4g、脂質25%、残りを炭水化物）
export function dietTarget(kcal, t, profile, goal) {
  const intake = round(t.tdee - kcal, 10);
  const protein = round(Math.max(goal.weight, profile.weight * 0.9) * 1.4);
  const fat = round(intake * 0.25 / 9);
  const carb = Math.max(0, round((intake - protein * 4 - fat * 9) / 4));
  return { intake, protein, fat, carb, meals: splitMeals(intake, protein) };
}

export function splitMeals(intake, protein) {
  const ratio = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };
  return Object.fromEntries(Object.entries(ratio).map(([k, r]) => [k, { kcal: round(intake * r, 10), protein: round(protein * (k === "snack" ? 0.1 : 0.3)) }]));
}

// 体重の予定線（今日→目標日）
export function planWeightOn(profile, goal, today, iso) {
  const total = daysBetween(today, goal.date);
  const d = clamp(daysBetween(today, iso), 0, total);
  return profile.weight - (profile.weight - goal.weight) * (total ? d / total : 1);
}
