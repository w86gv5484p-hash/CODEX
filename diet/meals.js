// 食事のおすすめ：その日に食べたものを踏まえて、次の食事を「自炊・コンビニ・外食」から提案する。
// 栄養価は日本食品標準成分表や一般的な市販品をもとにした1食分の目安（商品・店によって異なる）。
// 料理のグループは「食事バランスガイド」の考え方（主食・主菜・副菜・牛乳乳製品・果物）。

// g: { staple, main, side, milk, fruit } は「つ（SV）」の目安。src はたんぱく質源の種類
const I = (id, name, kcal, p, f, c, salt, g = {}, src = null, extra = {}) => ({ id, name, kcal, p, f, c, salt, g, src, ...extra });

export const SOURCES = { fish: "魚", meat: "肉", egg: "卵", soy: "大豆製品", dairy: "乳製品" };
export const GROUP_LABELS = { staple: "主食", main: "主菜", side: "副菜（野菜・きのこ・海藻）", milk: "牛乳・乳製品", fruit: "果物" };

export const CATALOG = {
  home: {
    label: "自炊",
    staple: [
      I("rice", "ご飯 茶碗1杯（150g）", 234, 3.8, 0.5, 53, 0, { staple: 1.5 }),
      I("rice-s", "ご飯 小盛り（100g）", 156, 2.5, 0.3, 36, 0, { staple: 1 }),
      I("genmai", "玄米ご飯 茶碗1杯（150g）", 228, 4.2, 1.5, 51, 0, { staple: 1.5 }, null, { fiber: true }),
      I("bread", "食パン 6枚切り1枚", 149, 5.3, 2.5, 27, 0.7, { staple: 1 }),
      I("soba", "そば（ゆで1玉）", 260, 9.6, 2, 52, 0, { staple: 1.5 }),
      I("oats", "オートミール（30g）＋牛乳", 220, 10, 6, 30, 0.1, { staple: 1, milk: 1 }, "dairy", { fiber: true }),
    ],
    main: [
      I("salmon", "焼き鮭 1切れ", 140, 18, 6, 0, 1.0, { main: 2 }, "fish"),
      I("saba", "さばの塩焼き 半身", 230, 17, 17, 0, 1.2, { main: 2 }, "fish"),
      I("sashimi", "刺身（まぐろ・いか）", 120, 22, 2, 1, 0.3, { main: 2 }, "fish"),
      I("chicken", "鶏むね肉のソテー（100g）", 160, 23, 5, 2, 0.8, { main: 2 }, "meat"),
      I("ginger-pork", "豚のしょうが焼き", 300, 18, 20, 9, 1.5, { main: 2 }, "meat"),
      I("teriyaki", "鶏ももの照り焼き", 230, 17, 15, 6, 1.3, { main: 2 }, "meat"),
      I("tamagoyaki", "卵焼き（卵2個）", 180, 12, 12, 4, 0.8, { main: 1 }, "egg"),
      I("medama", "目玉焼き（卵1個）", 100, 6, 8, 0, 0.3, { main: 1 }, "egg"),
      I("natto", "納豆 1パック", 90, 7.4, 5, 6, 0.6, { main: 1 }, "soy"),
      I("tofu", "冷奴（豆腐半丁）", 85, 7, 5, 2, 0.5, { main: 1 }, "soy"),
    ],
    side: [
      I("ohitashi", "ほうれん草のおひたし", 25, 2, 0.3, 3, 0.6, { side: 1 }),
      I("salad", "野菜サラダ（ノンオイル）", 40, 1.5, 0.3, 8, 0.4, { side: 1 }),
      I("hijiki", "ひじきの煮物", 70, 3, 3, 8, 0.9, { side: 1 }),
      I("yasai-itame", "具だくさん野菜炒め", 150, 4, 10, 10, 1.2, { side: 2 }),
      I("broccoli", "ブロッコリーとトマト", 40, 3, 0.5, 6, 0.2, { side: 1 }),
      I("kinpira", "きんぴらごぼう", 90, 1.5, 4, 12, 0.8, { side: 1 }, null, { fiber: true }),
    ],
    soup: [
      I("miso", "味噌汁（豆腐とわかめ）", 40, 3, 1.5, 3, 1.5, { side: 0 }, null, { soup: true }),
      I("tonjiru", "具だくさん豚汁", 120, 7, 6, 8, 1.6, { side: 1 }, "meat", { soup: true }),
      I("veg-soup", "野菜スープ（コンソメ）", 60, 2, 1, 10, 1.0, { side: 1 }, null, { soup: true }),
    ],
    extra: [
      I("yogurt", "ヨーグルト（無糖）100g", 60, 3.6, 3, 5, 0.1, { milk: 1 }, "dairy"),
      I("milk", "牛乳 コップ1杯（200ml）", 130, 6.6, 7.6, 9.6, 0.2, { milk: 2 }, "dairy"),
      I("banana", "バナナ 1本", 86, 1.1, 0.2, 22, 0, { fruit: 1 }),
      I("mikan", "みかん 2個", 70, 1, 0.2, 18, 0, { fruit: 1 }),
      I("apple", "りんご 半分", 70, 0.2, 0.2, 19, 0, { fruit: 1 }),
    ],
  },
  conv: {
    label: "コンビニ",
    staple: [
      I("onigiri-sake", "おにぎり（鮭）", 180, 4.5, 1.5, 38, 1.1, { staple: 1 }),
      I("onigiri-ume", "おにぎり（梅）", 170, 3.5, 0.6, 38, 1.4, { staple: 1 }),
      I("onigiri-mochimugi", "もち麦おにぎり", 170, 4, 1, 37, 1.0, { staple: 1 }, null, { fiber: true }),
      I("bran-bread", "ブランパン 2個", 130, 12, 6, 12, 0.8, { staple: 1 }, null, { fiber: true }),
      I("zaru-soba", "ざるそば", 300, 12, 2, 58, 2.5, { staple: 2 }),
      I("egg-sand", "たまごサンド", 300, 11, 18, 24, 1.4, { staple: 1, main: 1 }, "egg"),
    ],
    main: [
      I("salad-chicken", "サラダチキン", 110, 24, 1.5, 1, 1.2, { main: 3 }, "meat"),
      I("boiled-egg", "ゆで卵 2個", 150, 12, 10, 0.5, 0.8, { main: 2 }, "egg"),
      I("grilled-saba", "焼きさば（パック）", 200, 15, 15, 0, 1.0, { main: 2 }, "fish"),
      I("tofu-bar", "豆腐バー", 120, 10, 7, 3, 0.8, { main: 1 }, "soy"),
      I("natto-c", "納豆（カップ）", 90, 7.4, 5, 6, 0.6, { main: 1 }, "soy"),
      I("karaage", "からあげ（5個）", 300, 18, 20, 10, 1.6, { main: 2 }, "meat"),
      I("chicken-bar", "チキンバー", 90, 12, 3, 3, 1.1, { main: 1 }, "meat"),
    ],
    side: [
      I("cup-salad", "カップサラダ", 30, 1.5, 0.3, 5, 0.3, { side: 1 }),
      I("seaweed-salad", "海藻サラダ", 50, 1.5, 2, 6, 0.8, { side: 1 }),
      I("gomaae", "ほうれん草のごま和え", 70, 3, 4, 5, 0.7, { side: 1 }),
      I("broccoli-salad", "ブロッコリーと卵のサラダ", 120, 7, 8, 5, 0.6, { side: 1 }, "egg"),
      I("gobo-salad", "ごぼうサラダ", 130, 1.5, 9, 10, 0.8, { side: 1 }, null, { fiber: true }),
      I("veg-soup-cup", "具だくさん野菜スープ（レンジ）", 120, 5, 4, 15, 2.0, { side: 2 }, null, { soup: true }),
    ],
    soup: [
      I("cup-miso", "カップ味噌汁", 35, 2, 1, 4, 1.8, {}, null, { soup: true }),
      I("harusame", "春雨スープ", 70, 1.5, 1.5, 13, 2.0, {}, null, { soup: true }),
      I("tonjiru-cup", "豚汁（カップ）", 100, 5, 5, 8, 2.2, { side: 1 }, "meat", { soup: true }),
    ],
    extra: [
      I("yogurt-c", "ヨーグルト（無糖・小）", 70, 4, 3, 6, 0.1, { milk: 1 }, "dairy"),
      I("milk-c", "牛乳 200ml", 134, 6.8, 7.8, 9.9, 0.2, { milk: 2 }, "dairy"),
      I("cut-fruit", "カットフルーツ", 60, 0.6, 0.1, 15, 0, { fruit: 1 }),
      I("banana-c", "バナナ 1本", 86, 1.1, 0.2, 22, 0, { fruit: 1 }),
    ],
  },
  out: {
    label: "外食",
    set: [
      I("o-saba", "焼き魚定食（さば）", 760, 33, 28, 88, 4.5, { staple: 1.5, main: 2, side: 1 }, "fish", { rice: true, soup: true }),
      I("o-sashimi", "刺身定食", 620, 35, 8, 92, 3.5, { staple: 1.5, main: 2, side: 1 }, "fish", { rice: true, soup: true }),
      I("o-kaisen", "海鮮丼", 650, 32, 8, 105, 3.0, { staple: 2, main: 2 }, "fish", { rice: true }),
      I("o-sushi", "回転寿司 8皿", 640, 30, 10, 100, 4.0, { staple: 2, main: 2 }, "fish"),
      I("o-teriyaki", "鶏の照り焼き定食", 750, 32, 22, 95, 4.0, { staple: 1.5, main: 2, side: 1 }, "meat", { rice: true, soup: true }),
      I("o-ginger", "しょうが焼き定食", 850, 30, 35, 95, 4.5, { staple: 1.5, main: 2, side: 1 }, "meat", { rice: true, soup: true }),
      I("o-yasai", "肉野菜炒め定食", 720, 24, 28, 90, 4.5, { staple: 1.5, main: 1, side: 2 }, "meat", { rice: true, soup: true }),
      I("o-reba", "レバニラ炒め定食", 730, 28, 24, 92, 4.3, { staple: 1.5, main: 2, side: 1 }, "meat", { rice: true, soup: true }),
      I("o-oyako", "親子丼", 700, 30, 18, 100, 3.8, { staple: 2, main: 2 }, "egg", { rice: true }),
      I("o-champuru", "豆腐チャンプルー定食", 700, 28, 26, 88, 4.0, { staple: 1.5, main: 2, side: 1.5 }, "soy", { rice: true, soup: true }),
      I("o-zaru", "ざるそば", 350, 13, 2.5, 68, 3.0, { staple: 2 }),
      I("o-tororo-soba", "とろろそば（温）", 450, 15, 3, 88, 4.5, { staple: 2 }),
      I("o-salad-udon", "サラダうどん", 480, 17, 12, 72, 3.5, { staple: 2, main: 1, side: 1 }, "egg"),
      I("o-pasta", "魚介のトマトパスタ", 620, 24, 18, 85, 3.0, { staple: 2, main: 1, side: 1 }, "fish"),
      I("o-gyudon", "牛丼（並）", 650, 20, 22, 92, 2.7, { staple: 2, main: 2 }, "meat", { rice: true }),
      I("o-hamburg", "ハンバーグ定食", 900, 30, 42, 95, 4.0, { staple: 1.5, main: 2, side: 1 }, "meat", { rice: true, soup: true }),
      I("o-ramen", "ラーメン（醤油）", 600, 22, 18, 85, 6.5, { staple: 2, main: 1 }, "meat", { soup: true }),
    ],
    addon: [
      I("o-addsalad", "小鉢サラダを追加", 50, 1.5, 2, 6, 0.4, { side: 1 }),
      I("o-addohitashi", "おひたしの小鉢を追加", 30, 2, 0.3, 3, 0.6, { side: 1 }),
      I("o-addnatto", "納豆を追加", 90, 7.4, 5, 6, 0.6, { main: 1 }, "soy"),
    ],
  },
};

// 「ご飯少なめ」：ご飯を約半分にする（外食の定食・丼）
export const LESS_RICE = { kcal: -120, c: -27, p: -2, staple: -0.75 };

// よく食べる組み合わせ（記録のショートカット）
export const PRESETS = [
  { name: "ご飯・味噌汁・焼き鮭", items: ["rice", "miso", "salmon"] },
  { name: "ご飯・味噌汁・納豆・卵焼き", items: ["rice", "miso", "natto", "tamagoyaki"] },
  { name: "トースト・目玉焼き・サラダ", items: ["bread", "medama", "salad"] },
  { name: "トーストとコーヒーだけ", items: ["bread"] },
  { name: "おにぎり2個", items: ["onigiri-sake", "onigiri-ume"] },
  { name: "ヨーグルト・バナナ", items: ["yogurt", "banana"] },
];

export const ALL_ITEMS = (() => {
  const map = new Map();
  for (const mode of Object.values(CATALOG)) for (const [k, list] of Object.entries(mode)) if (Array.isArray(list)) list.forEach(it => map.set(it.id, it));
  return map;
})();

export const MEAL_SLOTS = [
  { id: "breakfast", label: "朝食" },
  { id: "lunch", label: "昼食" },
  { id: "dinner", label: "夕食" },
  { id: "snack", label: "間食" },
];
const SLOT_RATIO = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };

// その日の合計
export function totals(items) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, salt: 0, g: { staple: 0, main: 0, side: 0, milk: 0, fruit: 0 }, src: [], fiber: false, soup: 0 };
  for (const it of items) {
    if (!it) continue;
    t.kcal += it.kcal; t.p += it.p; t.f += it.f; t.c += it.c; t.salt += it.salt || 0;
    for (const k in t.g) t.g[k] += it.g?.[k] || 0;
    if (it.src) t.src.push(it.src);
    if (it.fiber) t.fiber = true;
    if (it.soup) t.soup++;
  }
  return t;
}

export function resolveItems(ids, custom = []) {
  return ids.map(id => ALL_ITEMS.get(id) || custom.find(c => c.id === id)).filter(Boolean);
}

// 1日の目安（摂取カロリーが少ないほど主食を控えめに）
export function dayGroupTargets(intake) {
  return { staple: intake < 1500 ? 4 : intake < 2000 ? 5 : 6, main: 4, side: 6, milk: 2, fruit: 2 };
}
export const saltLimit = sex => (sex === "female" ? 6.5 : 7.5);

// 候補を組み立てる
function combos(mode) {
  const c = CATALOG[mode];
  const out = [];
  if (mode === "out") {
    for (const s of c.set) for (const a of [null, ...c.addon]) for (const less of s.rice ? [false, true] : [false]) {
      out.push({ items: a ? [s, a] : [s], less });
    }
    return out;
  }
  for (const st of c.staple) for (const m of c.main) for (const sd of c.side) for (const sp of [null, ...c.soup]) for (const ex of [null, ...c.extra]) {
    if (st.g.main && m.g.main >= 2) continue; // たまごサンド＋主菜の重ねすぎ
    if (sd.soup && sp) continue;               // 汁物は1つまで
    out.push({ items: [st, m, sd, sp, ex].filter(Boolean), less: false });
  }
  return out;
}

function comboTotals(cb) {
  const t = totals(cb.items);
  if (cb.less) { t.kcal += LESS_RICE.kcal; t.c += LESS_RICE.c; t.p += LESS_RICE.p; t.g.staple += LESS_RICE.staple; }
  return t;
}

// 次の食事の目安量（残りの食事の比率で残りカロリーを割る）
export function mealBudget(slot, day, target, sex) {
  const eatenSlots = MEAL_SLOTS.filter(s => s.id !== slot && (day[s.id] || []).length);
  const restSlots = MEAL_SLOTS.filter(s => s.id === slot || !(day[s.id] || []).length);
  const share = SLOT_RATIO[slot] / restSlots.reduce((s, x) => s + SLOT_RATIO[x.id], 0);
  const eaten = totals(eatenSlots.flatMap(s => day.__items[s.id] || []));
  const groups = dayGroupTargets(target.intake);
  const needG = {};
  for (const k in groups) needG[k] = Math.max(0, groups[k] - eaten.g[k]) * share;
  const kcal = Math.max(200, (target.intake - eaten.kcal) * share);
  const protein = Math.max(10, (target.protein - eaten.p) * share);
  const salt = Math.max(1, (saltLimit(sex) - eaten.salt) * share);
  return { kcal, protein, needG, salt, eaten, share, eatenSlots };
}

function score(t, cb, b) {
  let s = 0;
  const dk = (t.kcal - b.kcal) / b.kcal;
  s += 3 * Math.abs(dk) + (dk > 0.15 ? 2 * (dk - 0.15) : 0);
  s += 2.5 * Math.max(0, b.protein - t.p) / b.protein;
  const w = { staple: 0.5, main: 0.6, side: 1.2, milk: 0.35, fruit: 0.35 };
  for (const k in w) s += w[k] * Math.max(0, Math.min(b.needG[k], 3) - t.g[k]);
  if (t.g.staple > b.needG.staple + 1) s += 0.4 * (t.g.staple - b.needG.staple - 1);
  const repeats = t.src.filter(x => b.eaten.src.includes(x) && x !== "dairy").length;
  s += 0.9 * repeats;
  const eatenIds = new Set((b.eatenSlots || []).flatMap(sl => (b.day[sl.id] || [])));
  s += 1.0 * cb.items.filter(it => eatenIds.has(it.id)).length;
  s += 0.6 * Math.max(0, t.salt - b.salt);
  if (b.eaten.soup && t.soup) s += 0.3;
  if (t.kcal > 0 && t.f * 9 / t.kcal > 0.35) s += 0.6;
  if (t.fiber) s -= 0.1;
  s += 0.12 * cb.items.length; // 品数が多すぎない方が続けやすい
  return s;
}

// mode: home / conv / out。結果は主菜が重ならないように上位 n 件
export function suggest(mode, slot, day, target, sex, n = 3) {
  const b = mealBudget(slot, day, target, sex);
  b.day = day;
  const ranked = combos(mode).map(cb => { const t = comboTotals(cb); return { ...cb, t, s: score(t, cb, b) }; }).sort((x, y) => x.s - y.s);
  const picked = [], usedMain = new Set(), staples = {};
  for (const r of ranked) {
    const key = (r.items.find(it => it.g.main) || r.items[0]).id;
    const st = r.items[0].id;
    if (usedMain.has(key) || (staples[st] || 0) >= 2) continue; // 主菜は毎回変え、主食も同じものは2件まで
    usedMain.add(key); staples[st] = (staples[st] || 0) + 1; picked.push({ ...r, reasons: reasons(r, b, slot) });
    if (picked.length >= n) break;
  }
  return { budget: b, picks: picked };
}

function slotLabel(id) { return (MEAL_SLOTS.find(s => s.id === id) || {}).label || ""; }

function reasons(r, b, slot) {
  const out = [];
  const before = b.eatenSlots.map(s => slotLabel(s.id).replace("食", "")).join("・");
  const eatenSrc = [...new Set(b.eaten.src.filter(x => x !== "dairy"))];
  const mySrc = [...new Set(r.t.src.filter(x => x !== "dairy"))];
  if (eatenSrc.length && mySrc.length && !mySrc.some(x => eatenSrc.includes(x))) {
    out.push(`${before}は${eatenSrc.map(x => SOURCES[x]).join("・")}だったので、たんぱく質は${mySrc.map(x => SOURCES[x]).join("・")}で種類を変えています。`);
  }
  if (b.needG.side >= 1 && r.t.g.side >= 1) out.push(`野菜（副菜）が不足しやすいので、${r.items.filter(it => it.g.side).map(it => it.name.replace("を追加", "")).join("・")}で補います。`);
  if (b.eaten.soup && !r.t.soup && b.eaten.salt >= 1.5) out.push(`${before}に汁物をとったので、汁物はなしにして塩分を抑えています。`);
  if (r.less) out.push("ご飯は少なめで頼むと、カロリーを目安に収めやすくなります。");
  if (b.needG.milk >= 0.5 && r.t.g.milk) out.push("カルシウムをとるため乳製品を1品足しています。");
  if (b.needG.fruit >= 0.5 && r.t.g.fruit) out.push("ビタミン補給に果物を足しています。");
  if (r.t.salt > b.salt + 1.5) out.push(`塩分がやや多め（約${r.t.salt.toFixed(1)}g）なので、${r.t.soup ? "汁物の汁やつゆは残すと" : "つゆ・ドレッシングを控えめにすると"}調整できます。`);
  if (!out.length) out.push(`${slotLabel(slot)}の目安 ${Math.round(b.kcal / 10) * 10}kcal・たんぱく質 ${Math.round(b.protein)}g に近い組み合わせです。`);
  return out;
}

export function itemLabel(cb) {
  return cb.items.map(it => it.name).join(" ＋ ") + (cb.less ? "（ご飯少なめ）" : "");
}
