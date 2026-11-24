// 減量プラン：画面と保存。計算は plan.js（赤字の算出・配分）と meals.js（食事のおすすめ）。
// 入力した内容と記録は、この端末のブラウザー（localStorage）だけに保存します。
import * as P from "./plan.js";
import * as M from "./meals.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r10 = v => Math.round(v / 10) * 10;
const fmt = v => Math.round(v).toLocaleString("ja-JP");
const localISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localISO();
const addMonths = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + n); return localISO(d); };

const KEY = "diet.state.v1";
const COLORS = { exercise: "var(--ex)", diet: "var(--diet)", other: "var(--other)" };

function defaults() {
  const t = today();
  return {
    profile: { sex: "male", age: 40, height: 170, weight: 75, activity: "light" },
    goal: { weight: 70, date: addMonths(t, 4) },
    start: t,
    cap: { exerciseType: "walk", exerciseDays: 3, exerciseMinutes: 30, stepsNow: 5000, stepsMax: 9000, sleepHours: 6.5, habits: ["stairs", "stand", "sleep", "nightsnack"] },
    shares: { ...P.DEFAULT_SHARES },
    locks: {},
    meals: {},
    custom: [],
    weights: [],
  };
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.profile) { const d = defaults(); return { ...d, ...v, cap: { ...d.cap, ...v.cap }, profile: { ...d.profile, ...v.profile } }; }
  } catch { /* 保存がない・壊れている */ }
  return defaults();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast("この端末に保存できませんでした"); } }

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2400);
}

// ---------- 計算をまとめる ----------
function model(override = null) {
  const t = P.computeTarget(S.profile, S.goal, S.start);
  const caps = P.capacities(S.profile, S.cap);
  const required = Math.max(0, t.daily);
  const alloc = P.allocate(required, caps, S.shares, S.locks, override);
  const warn = P.warnings(S.profile, S.goal, t, alloc, caps, S.start);
  const ok = !warn.some(w => w.level === "error");
  const diet = P.dietTarget(ok ? alloc.values.diet : 0, t, S.profile, S.goal);
  return { t, caps, required, alloc, warn, ok, diet };
}

// ---------- タブ ----------
const VIEWS = { goal: viewGoal, plan: viewPlan, meals: viewMeals, log: viewLog };
function route() {
  const tab = (location.hash.slice(1) || "goal").split("/")[0];
  const name = VIEWS[tab] ? tab : "goal";
  $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
  const main = $("#main"); main.oninput = main.onchange = main.onclick = null;
  VIEWS[name]();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------- 目標 ----------
function viewGoal() {
  const p = S.profile, g = S.goal;
  $("#main").innerHTML = `
    <section class="hero"><h1>目標を決める</h1><p class="muted">目標体重・現在の体重・目標日から、必要なカロリーの赤字を計算します。</p></section>
    <div class="grid2">
      <form class="card form" id="goal-form" autocomplete="off">
        <h2>あなたについて</h2>
        <div class="seg" role="radiogroup" aria-label="性別">
          <label><input type="radio" name="sex" value="male" ${p.sex === "male" ? "checked" : ""}><span>男性</span></label>
          <label><input type="radio" name="sex" value="female" ${p.sex === "female" ? "checked" : ""}><span>女性</span></label>
        </div>
        <div class="row3">
          <label>年齢<span class="unit"><input type="number" name="age" inputmode="numeric" min="10" max="100" value="${p.age}">歳</span></label>
          <label>身長<span class="unit"><input type="number" name="height" inputmode="decimal" min="100" max="230" step="0.1" value="${p.height}">cm</span></label>
          <label>現在の体重<span class="unit"><input type="number" name="weight" inputmode="decimal" min="25" max="300" step="0.1" value="${p.weight}">kg</span></label>
        </div>
        <label>ふだんの活動量
          <select name="activity">${P.ACTIVITY_LEVELS.map(a => `<option value="${a.id}" ${a.id === p.activity ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select>
        </label>
        <h2>目標</h2>
        <div class="row2">
          <label>目標体重<span class="unit"><input type="number" name="gweight" inputmode="decimal" min="25" max="300" step="0.1" value="${g.weight}">kg</span></label>
          <label>目標日<input type="date" name="gdate" value="${g.date}" min="${P.addDays(S.start, 1)}"></label>
        </div>
        <div class="chips" aria-label="期間をすばやく選ぶ">
          ${[1, 2, 3, 6].map(n => `<button type="button" class="chip" data-months="${n}">${n}か月後</button>`).join("")}
          <button type="button" class="chip accent" data-fix="safe">推奨ペース（月3%）</button>
        </div>
        <p class="small muted">開始日：${P.fmtDate(S.start)}（現在の体重を変えると今日から数え直します）</p>
      </form>
      <div id="summary"></div>
    </div>`;
  paintSummary();
  const form = $("#goal-form");
  form.addEventListener("input", e => {
    const f = new FormData(form);
    const num = k => Number(f.get(k));
    const prevWeight = S.profile.weight;
    S.profile = { sex: f.get("sex"), age: num("age"), height: num("height"), weight: num("weight"), activity: f.get("activity") };
    S.goal = { weight: num("gweight"), date: f.get("gdate") || S.goal.date };
    if (e.target.name === "weight" && prevWeight !== S.profile.weight) S.start = today();
    save(); paintSummary();
  });
  form.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.months) S.goal.date = addMonths(S.start, Number(b.dataset.months));
    if (b.dataset.fix) applyFix(b.dataset.fix);
    save(); form.gdate.value = S.goal.date; paintSummary();
  });
}

function applyFix(kind) {
  const m = model();
  if (kind === "safe") S.goal.date = m.t.safeDate;
  if (kind === "feasible") { const d = P.feasibleDate(m.t, m.caps, S.start); if (d) S.goal.date = d; }
  save();
}

function paceClass(rate) { return rate > P.MAX_MONTHLY_RATE ? "danger" : rate > P.SAFE_MONTHLY_RATE ? "caution" : "ok"; }

function warnHTML(list) {
  if (!list.length) return "";
  return `<ul class="warns">${list.map(w => `<li class="warn ${w.level}"><span>${esc(w.text)}</span>${w.fix ? `<button type="button" class="btn small-btn" data-fix="${w.fix}">${w.fix === "safe" ? "推奨ペースの目標日にする" : "届く目標日にする"}</button>` : ""}</li>`).join("")}</ul>`;
}

function paintSummary() {
  const el = $("#summary"); if (!el) return;
  const m = model(), t = m.t;
  if (!m.ok) { el.innerHTML = `<div class="card">${warnHTML(m.warn)}</div>`; return; }
  const pace = paceClass(t.monthlyRate);
  const meter = Math.min(100, t.monthlyRate / 0.07 * 100);
  el.innerHTML = `
    <div class="card summary">
      <h2>必要なカロリー赤字</h2>
      <div class="big"><b>${fmt(t.daily)}</b><span>kcal / 日</span></div>
      <p class="muted small">合計 ${fmt(t.totalDeficit)}kcal（${t.lossKg.toFixed(1)}kg × 7,200kcal）を ${t.days}日（約${(t.days / P.DAYS_PER_MONTH).toFixed(1)}か月）で</p>
      <div class="pace ${pace}">
        <div class="pace-head"><span>ペース</span><b>月 ${t.monthlyKg.toFixed(1)}kg（体重の${(t.monthlyRate * 100).toFixed(1)}%）</b></div>
        <div class="meter"><i style="width:${meter}%"></i><em style="left:${P.SAFE_MONTHLY_RATE / 0.07 * 100}%">3%</em><em style="left:${P.MAX_MONTHLY_RATE / 0.07 * 100}%">5%</em></div>
        <p class="small">${pace === "ok" ? "無理のないペースです。" : pace === "caution" ? "やや速いペースです。" : "無理なペースです。期間を延ばしてください。"}</p>
      </div>
      <dl class="facts">
        <div><dt>1日の消費（目安）</dt><dd>${fmt(t.tdee)}kcal</dd></div>
        <div><dt>基礎代謝</dt><dd>${fmt(t.bmr)}kcal</dd></div>
        <div><dt>BMI</dt><dd>${t.bmiNow.toFixed(1)} → ${t.bmiGoal.toFixed(1)}</dd></div>
        <div><dt>食事の目標</dt><dd>${fmt(m.diet.intake)}kcal / 日</dd></div>
      </dl>
      ${warnHTML(m.warn)}
      <div class="split">${splitBar(m)}</div>
      <a class="btn primary block" href="#plan">運動・食事・その他の配分を見る</a>
    </div>`;
  el.querySelectorAll("[data-fix]").forEach(b => b.addEventListener("click", () => { applyFix(b.dataset.fix); route(); }));
}

function splitBar(m) {
  const req = Math.max(1, m.required);
  const seg = P.LEVERS.map(k => `<i data-seg="${k}" style="width:${m.alloc.values[k] / req * 100}%;background:${COLORS[k]}"></i>`).join("");
  const legend = P.LEVERS.map(k => `<span><b style="background:${COLORS[k]}"></b>${P.LEVER_LABELS[k]} <span data-legend="${k}">${fmt(m.alloc.values[k])}</span>kcal</span>`).join("");
  return `<div class="bar">${seg}${m.alloc.shortfall > 1 ? `<i class="gap" data-seg="gap" style="width:${m.alloc.shortfall / req * 100}%"></i>` : `<i class="gap" data-seg="gap" style="width:0"></i>`}</div><div class="legend">${legend}</div>`;
}

// ---------- 配分（運動・食事・その他を連動） ----------
function viewPlan() {
  const m = model();
  if (!m.ok) { $("#main").innerHTML = `<section class="hero"><h1>配分</h1></section><div class="card">${warnHTML(m.warn)}<a class="btn" href="#goal">目標を入力する</a></div>`; return; }
  const c = S.cap;
  const opt = (vals, cur, fmtv = v => v) => vals.map(v => `<option value="${v}" ${Number(cur) === v ? "selected" : ""}>${fmtv(v)}</option>`).join("");
  $("#main").innerHTML = `
    <section class="hero">
      <h1>運動・食事・その他の配分</h1>
      <p class="muted">1日に必要な赤字 <b class="ink">${fmt(m.required)}kcal</b> を3つに分けます。どれかを減らすと、残りの2つが自動で補います。固定（🔒）した項目は動きません。</p>
    </section>
    <div class="card sticky-bar"><div id="split">${splitBar(m)}</div></div>
    <div id="plan-warn"></div>
    <div class="levers">
      ${lever("exercise", m, `
        <div class="row3">
          <label>種類<select data-cap="exerciseType">${P.EXERCISES.map(e => `<option value="${e.id}" ${e.id === c.exerciseType ? "selected" : ""}>${esc(e.label)}</option>`).join("")}</select></label>
          <label>週に使える日数<select data-cap="exerciseDays" data-num>${opt([0, 1, 2, 3, 4, 5, 6, 7], c.exerciseDays, v => v ? `週${v}日` : "できない")}</select></label>
          <label>1回に使える時間<select data-cap="exerciseMinutes" data-num>${opt([0, 10, 15, 20, 30, 40, 45, 60, 75, 90], c.exerciseMinutes, v => v ? `${v}分まで` : "なし")}</select></label>
        </div>`)}
      ${lever("diet", m, `<p class="small muted">減らせる上限は、1日の摂取量が基礎代謝（${fmt(P.minIntake(S.profile))}kcal）を下回らず、消費の30%以内になる量です。</p>`)}
      ${lever("other", m, `
        <div class="row3">
          <label>いまの歩数<select data-cap="stepsNow" data-num>${opt([2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000], c.stepsNow, v => `${fmt(v)}歩`)}</select></label>
          <label>増やせる上限<select data-cap="stepsMax" data-num>${opt([3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000], c.stepsMax, v => `${fmt(v)}歩`)}</select></label>
          <label>いまの睡眠<select data-cap="sleepHours" data-num>${opt([4, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9], c.sleepHours, v => `${v}時間`)}</select></label>
        </div>
        <fieldset class="habits"><legend class="small muted">取り入れられる習慣</legend>
          ${P.HABITS.map(h => `<label class="check"><input type="checkbox" data-habit="${h.id}" ${c.habits.includes(h.id) ? "checked" : ""}><span>${esc(h.label)} <em class="muted">約${h.kcal}kcal${h.id === "sleep" && c.sleepHours >= 7 ? "（すでに7時間以上のため見込みません）" : ""}</em></span></label>`).join("")}
        </fieldset>`)}
    </div>
    <div class="actions"><button type="button" class="btn" id="reset-shares">おまかせ配分に戻す</button><a class="btn primary" href="#meals">今日の食事を考える</a></div>
    <p class="small muted note">カロリーは目安です。持病がある方・服薬中の方・妊娠中や授乳中の方は、医師に相談してから始めてください。</p>`;
  paintPlan(m);

  const main = $("#main");
  main.oninput = e => {
    const sl = e.target.closest("input[type=range]");
    if (sl) paintPlan(model({ key: sl.dataset.lever, value: Number(sl.value) }), sl.dataset.lever);
  };
  main.onchange = e => {
    const el = e.target;
    if (el.matches("input[type=range]")) {
      const k = el.dataset.lever;
      const mm = model({ key: k, value: Number(el.value) });
      if (S.locks[k] != null) S.locks[k] = mm.alloc.values[k];
      S.shares = P.sharesFrom(mm.alloc.values);
      save(); paintPlan(model()); return;
    }
    if (el.dataset.cap) { S.cap[el.dataset.cap] = el.dataset.num != null ? Number(el.value) : el.value; save(); viewPlanKeepScroll(); return; }
    if (el.dataset.habit) {
      const set = new Set(S.cap.habits); el.checked ? set.add(el.dataset.habit) : set.delete(el.dataset.habit);
      S.cap.habits = [...set]; save(); viewPlanKeepScroll();
    }
  };
  main.onclick = e => {
    const lk = e.target.closest("[data-lock]");
    if (lk) {
      const k = lk.dataset.lock;
      if (S.locks[k] != null) delete S.locks[k]; else S.locks[k] = model().alloc.values[k];
      save(); viewPlanKeepScroll(); return;
    }
    if (e.target.id === "reset-shares") { S.shares = { ...P.DEFAULT_SHARES }; S.locks = {}; save(); viewPlanKeepScroll(); toast("おまかせ配分に戻しました"); }
    const fx = e.target.closest("[data-fix]");
    if (fx) { applyFix(fx.dataset.fix); viewPlanKeepScroll(); toast(`目標日を ${P.fmtDate(S.goal.date)} にしました`); }
  };
}
function viewPlanKeepScroll() { const y = window.scrollY; viewPlan(); window.scrollTo(0, y); }

function lever(k, m, inner) {
  const locked = S.locks[k] != null;
  return `<section class="card lever" data-k="${k}" style="--c:${COLORS[k]}">
    <header class="lever-head">
      <h2>${esc(P.LEVER_LABELS[k])}<small>${esc(P.LEVER_NOTES[k])}</small></h2>
      <button type="button" class="lock ${locked ? "on" : ""}" data-lock="${k}" aria-pressed="${locked}" title="この量で固定する">${locked ? "🔒 固定中" : "🔓 固定する"}</button>
    </header>
    <div class="lever-val"><b data-val="${k}">0</b><span>kcal / 日</span><em data-pct="${k}"></em></div>
    <input type="range" min="0" max="${Math.max(1, Math.floor(m.caps[k]))}" step="5" value="0" data-lever="${k}" aria-label="${esc(P.LEVER_LABELS[k])}の量" ${m.caps[k] < 1 ? "disabled" : ""}>
    <div class="range-foot small muted"><span>0</span><span>できる上限 ${fmt(m.caps[k])}kcal</span></div>
    <div class="menu-out" data-menu="${k}"></div>
    <details class="cap" ${k === "diet" ? "" : "open"}><summary>できること</summary>${inner}</details>
  </section>`;
}

function paintPlan(m, active = null) {
  const req = Math.max(1, m.required);
  for (const k of P.LEVERS) {
    const v = m.alloc.values[k];
    const sl = $(`input[data-lever="${k}"]`);
    if (sl && k !== active) sl.value = Math.round(v);
    $(`[data-val="${k}"]`).textContent = fmt(v);
    $(`[data-pct="${k}"]`).textContent = `${Math.round(v / req * 100)}%`;
    const seg = $(`#split [data-seg="${k}"]`); if (seg) seg.style.width = `${v / req * 100}%`;
    const lg = $(`#split [data-legend="${k}"]`); if (lg) lg.textContent = fmt(v);
    $(`[data-menu="${k}"]`).innerHTML = menuHTML(k, v, m);
  }
  const gap = $(`#split [data-seg="gap"]`); if (gap) gap.style.width = `${m.alloc.shortfall / req * 100}%`;
  const pw = $("#plan-warn"); if (pw) pw.innerHTML = warnHTML(m.warn.filter(w => w.fix === "feasible" || w.level === "danger"));
}

function menuHTML(k, v, m) {
  if (k === "exercise") {
    const e = P.exerciseMenu(v, S.profile, S.cap);
    if (v < 1) return `<p class="menu-line">${S.cap.exerciseDays && S.cap.exerciseMinutes ? "運動の分は食事・その他でまかないます。" : "運動ができない分は、食事とその他で自動的に補っています。"}</p><p class="small muted">体力・筋肉を保つため、できる日は軽いスクワットや腕立てを10分でも入れるのがおすすめです。</p>`;
    return `<p class="menu-line"><b>${esc(e.type.label)}</b>を <b>週${e.days}回・1回${e.minutes}分</b></p>
      <p class="small muted">1回 約${fmt(e.perSession)}kcal・週 約${fmt(e.weeklyKcal)}kcal。筋肉を保つため、週2回は筋トレ（スクワット・腕立て・プランクなど）を組み合わせましょう。</p>`;
  }
  if (k === "diet") {
    const d = m.diet;
    return `<p class="menu-line">1日 <b>${fmt(d.intake)}kcal</b> を目安に食べる（いまより −${fmt(v)}kcal）</p>
      <p class="small muted">たんぱく質 ${d.protein}g・脂質 ${d.fat}g・炭水化物 ${d.carb}g。朝 ${fmt(d.meals.breakfast.kcal)}／昼 ${fmt(d.meals.lunch.kcal)}／夜 ${fmt(d.meals.dinner.kcal)}／間食 ${fmt(d.meals.snack.kcal)}kcal。</p>
      <p class="small muted">${dietTips(v)}</p>`;
  }
  const o = P.otherMenu(v, S.profile, S.cap);
  if (v < 1) return `<p class="menu-line">その他の分は運動・食事でまかないます。</p>`;
  const lines = [];
  if (o.addSteps > 0) lines.push(`1日の歩数を <b>${fmt(o.stepsNow)}歩 → ${fmt(o.stepsTarget)}歩</b>（＋${fmt(o.addSteps)}歩・約${Math.round(o.addSteps / 100)}分の歩き）`);
  o.habits.forEach(h => lines.push(esc(h.label)));
  return `<ul class="menu-list">${lines.map(l => `<li>${l}</li>`).join("")}</ul>`;
}

// 減らす量に応じた、置き換えの例
function dietTips(v) {
  const tips = [["甘い飲み物をお茶・水にする", 140], ["ご飯を茶碗1杯から小盛りにする", 80], ["間食のお菓子をヨーグルトや果物にする", 120], ["揚げ物を焼き・蒸し料理にする", 150], ["夜のお酒を1杯減らす", 150], ["ドレッシングをノンオイルにする", 50]];
  let left = v; const use = [];
  for (const [t, k] of tips) { if (left <= 0) break; use.push(`${t}（−${k}）`); left -= k; }
  return use.length ? "例：" + use.join("、") : "";
}

// ---------- 食事 ----------
let mealDate = null, mealSlot = null;
function dayOf(date) {
  const d = S.meals[date] || { breakfast: [], lunch: [], dinner: [], snack: [] };
  const items = {};
  for (const s of M.MEAL_SLOTS) items[s.id] = M.resolveItems(d[s.id] || [], S.custom);
  return { ...d, __items: items };
}
function nextSlot(day) {
  const hour = new Date().getHours();
  const empty = ["breakfast", "lunch", "dinner"].filter(s => !(day[s] || []).length);
  if (!empty.length) return "snack";
  if (mealDate === today()) {
    if (hour >= 16 && empty.includes("dinner")) return "dinner";
    if (hour >= 10 && empty.includes("lunch")) return "lunch";
  }
  return empty[0];
}

function viewMeals() {
  const m = model();
  if (!m.ok) { $("#main").innerHTML = `<section class="hero"><h1>食事</h1></section><div class="card">${warnHTML(m.warn)}<a class="btn" href="#goal">目標を入力する</a></div>`; return; }
  mealDate = mealDate || today();
  const day = dayOf(mealDate);
  if (!mealSlot || (day[mealSlot] || []).length) mealSlot = nextSlot(day);
  const all = M.MEAL_SLOTS.flatMap(s => day.__items[s.id]);
  const tot = M.totals(all);
  const gT = M.dayGroupTargets(m.diet.intake);
  const pct = v => Math.min(100, v * 100);
  $("#main").innerHTML = `
    <section class="hero row-between">
      <div><h1>食事</h1><p class="muted">食べたものを記録すると、栄養のバランスを見て次の食事をおすすめします。</p></div>
      <label class="date-pick">日付<input type="date" id="meal-date" value="${mealDate}"></label>
    </section>
    <div class="card day">
      <div class="day-kcal">
        <div><span class="muted small">食べた量</span><b>${fmt(tot.kcal)}</b><span class="muted">/ ${fmt(m.diet.intake)}kcal</span></div>
        <div class="muted small">残り <b class="ink">${fmt(Math.max(0, m.diet.intake - tot.kcal))}kcal</b>・たんぱく質 ${Math.round(tot.p)} / ${m.diet.protein}g・塩分 ${tot.salt.toFixed(1)} / ${M.saltLimit(S.profile.sex)}g</div>
      </div>
      <div class="kbar"><i style="width:${pct(tot.kcal / m.diet.intake)}%" class="${tot.kcal > m.diet.intake * 1.05 ? "over" : ""}"></i></div>
      <div class="groups">${Object.entries(gT).map(([k, n]) => `<div class="grp"><span>${M.GROUP_LABELS[k].replace(/（.*）/, "")}</span><div class="dots">${dots(tot.g[k], n)}</div></div>`).join("")}</div>
    </div>
    <div class="slots">
      ${M.MEAL_SLOTS.map(s => `<section class="card slot ${s.id === mealSlot ? "focus" : ""}">
        <header><h3>${s.label}</h3><span class="muted small">${day.__items[s.id].length ? `${fmt(M.totals(day.__items[s.id]).kcal)}kcal` : `目安 ${fmt(m.diet.meals[s.id].kcal)}kcal`}</span></header>
        <ul class="eaten">${day.__items[s.id].map((it, i) => `<li><span>${esc(it.name)}</span><em>${fmt(it.kcal)}</em><button type="button" class="del" data-del="${s.id}:${i}" aria-label="${esc(it.name)}を消す">×</button></li>`).join("") || `<li class="muted small">まだ記録がありません</li>`}</ul>
        <div class="slot-actions"><button type="button" class="btn small-btn" data-add="${s.id}">＋ 記録する</button>${s.id !== mealSlot ? `<button type="button" class="link" data-suggest="${s.id}">この食事のおすすめ</button>` : ""}</div>
      </section>`).join("")}
    </div>
    <section id="suggest"></section>`;
  paintSuggest(m, day);

  $("#meal-date").addEventListener("change", e => { mealDate = e.target.value || today(); mealSlot = null; viewMeals(); });
  $("#main").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.add) openAdd(b.dataset.add);
    if (b.dataset.suggest) { mealSlot = b.dataset.suggest; keepScroll(viewMeals); $("#suggest").scrollIntoView({ behavior: "smooth" }); }
    if (b.dataset.del) { const [s, i] = b.dataset.del.split(":"); const d = S.meals[mealDate]; d[s].splice(Number(i), 1); save(); keepScroll(viewMeals); }
    if (b.dataset.eat) {
      const pick = JSON.parse(b.dataset.eat);
      const d = S.meals[mealDate] ||= { breakfast: [], lunch: [], dinner: [], snack: [] };
      d[pick.slot] = [...(d[pick.slot] || []), ...pick.ids];
      if (pick.less) S.custom.find(c => c.id === "less-rice") || S.custom.push({ id: "less-rice", name: "（ご飯少なめ）", kcal: M.LESS_RICE.kcal, p: M.LESS_RICE.p, f: 0, c: M.LESS_RICE.c, salt: 0, g: { staple: M.LESS_RICE.staple } });
      if (pick.less) d[pick.slot].push("less-rice");
      save(); mealSlot = null; keepScroll(viewMeals); toast("記録しました");
    }
  };
}
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

function dots(have, need) {
  const n = Math.max(need, Math.ceil(have));
  return Array.from({ length: n }, (_, i) => `<i class="${have >= i + 1 ? "on" : have > i ? "half" : ""} ${i >= need ? "extra" : ""}"></i>`).join("");
}

let suggestMode = "all";
function paintSuggest(m, day) {
  const slotName = M.MEAL_SLOTS.find(s => s.id === mealSlot).label;
  const modes = ["home", "conv", "out"];
  const results = Object.fromEntries(modes.map(md => [md, M.suggest(md, mealSlot, day, m.diet, S.profile.sex, 3)]));
  const b = results.home.budget;
  const before = b.eatenSlots.map(s => M.MEAL_SLOTS.find(x => x.id === s.id).label);
  const shown = suggestMode === "all" ? modes : [suggestMode];
  $("#suggest").innerHTML = `
    <div class="suggest-head">
      <h2>${slotName}のおすすめ</h2>
      <p class="muted small">${before.length ? `${before.join("・")}の内容を踏まえて、` : ""}目安 約${r10(b.kcal)}kcal・たんぱく質 ${Math.round(b.protein)}g${b.needG.side >= 1 ? "・野菜を多めに" : ""}</p>
      <div class="seg mode" role="tablist">${[["all", "すべて"], ...modes.map(md => [md, M.CATALOG[md].label])].map(([id, l]) => `<button type="button" role="tab" aria-selected="${suggestMode === id}" data-mode="${id}">${l}</button>`).join("")}</div>
    </div>
    <div class="sugg-cols ${shown.length === 1 ? "one" : ""}">
      ${shown.map(md => `<div class="sugg-col"><h3>${M.CATALOG[md].label}なら</h3>${results[md].picks.map(p => `
        <article class="pick">
          <p class="pick-name">${p.items.map(it => `<span>${esc(it.name.replace("を追加", ""))}</span>`).join("")}${p.less ? `<span class="tag">ご飯少なめ</span>` : ""}</p>
          <p class="pick-n"><b>${fmt(p.t.kcal)}kcal</b>・たんぱく質 ${Math.round(p.t.p)}g・塩分 ${p.t.salt.toFixed(1)}g</p>
          <ul class="why">${p.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
          <button type="button" class="btn small-btn" data-eat='${esc(JSON.stringify({ slot: mealSlot, ids: p.items.map(i => i.id), less: p.less }))}'>これを${slotName}に記録</button>
        </article>`).join("")}</div>`).join("")}
    </div>
    <p class="small muted note">栄養価は一般的な目安です。商品・お店によって変わります。</p>`;
  $$("#suggest [data-mode]").forEach(btn => btn.addEventListener("click", () => { suggestMode = btn.dataset.mode; paintSuggest(m, day); }));
}

// 記録ダイアログ
function openAdd(slot) {
  const groups = [
    ["よく食べる組み合わせ", null],
    ["自炊・主食", M.CATALOG.home.staple], ["自炊・主菜", M.CATALOG.home.main], ["自炊・副菜", M.CATALOG.home.side], ["汁物", M.CATALOG.home.soup], ["乳製品・果物", M.CATALOG.home.extra],
    ["コンビニ", [...M.CATALOG.conv.staple, ...M.CATALOG.conv.main, ...M.CATALOG.conv.side, ...M.CATALOG.conv.soup, ...M.CATALOG.conv.extra]],
    ["外食", M.CATALOG.out.set],
    ["自分で追加した食べ物", S.custom.filter(c => c.id !== "less-rice")],
  ];
  const label = M.MEAL_SLOTS.find(s => s.id === slot).label;
  const picked = [];
  $("#dlg-body").innerHTML = `
    <h2>${label}を記録</h2>
    <input type="search" id="food-q" placeholder="食べ物を探す（例：鮭、サラダ）" aria-label="食べ物を探す">
    <div class="food-list">
      ${groups.map(([title, list]) => title === "よく食べる組み合わせ"
        ? `<h3>${title}</h3><div class="chips">${M.PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.name)}</button>`).join("")}</div>`
        : list.length ? `<h3>${title}</h3><div class="chips">${list.map(it => `<button type="button" class="chip food" data-food="${it.id}" data-name="${esc(it.name)}">${esc(it.name)} <em>${fmt(it.kcal)}</em></button>`).join("")}</div>` : "").join("")}
    </div>
    <details class="custom"><summary>リストにない食べ物を追加</summary>
      <form id="custom-form" class="form">
        <label>名前<input name="name" required maxlength="40" placeholder="例：カツ丼"></label>
        <div class="row3">
          <label>カロリー<span class="unit"><input type="number" name="kcal" inputmode="numeric" required min="0" max="3000">kcal</span></label>
          <label>たんぱく質<span class="unit"><input type="number" name="p" inputmode="decimal" min="0" max="200" step="0.1" value="0">g</span></label>
          <label>種類<select name="kind"><option value="staple">主食</option><option value="main">主菜</option><option value="side">副菜（野菜）</option><option value="set">主食＋主菜（丼・定食）</option><option value="snack">お菓子・飲み物</option></select></label>
        </div>
        <button class="btn">追加して選ぶ</button>
      </form>
    </details>
    <div class="dlg-foot"><span id="picked" class="small muted">選んだもの：なし</span><button type="button" class="btn primary" id="save-meal">記録する</button></div>`;
  const dlg = $("#dlg"); dlg.showModal();
  const paintPicked = () => { $("#picked").textContent = "選んだもの：" + (picked.length ? picked.map(id => (M.ALL_ITEMS.get(id) || S.custom.find(c => c.id === id)).name).join("、") : "なし"); };
  $("#dlg-body").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.preset) { M.PRESETS[b.dataset.preset].items.forEach(id => picked.push(id)); paintPicked(); }
    if (b.dataset.food) { picked.push(b.dataset.food); b.classList.add("sel"); paintPicked(); }
    if (b.id === "save-meal") {
      if (!picked.length) { toast("食べたものを選んでください"); return; }
      const d = S.meals[mealDate] ||= { breakfast: [], lunch: [], dinner: [], snack: [] };
      d[slot] = [...(d[slot] || []), ...picked];
      save(); dlg.close(); mealSlot = null; keepScroll(viewMeals); toast(`${label}を記録しました`);
    }
  };
  $("#food-q").oninput = e => {
    const q = e.target.value.trim();
    $$(".food-list .chip.food").forEach(c => { c.hidden = q && !c.dataset.name.includes(q); });
  };
  $("#custom-form").onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const kind = f.get("kind");
    const g = { staple: { staple: 1 }, main: { main: 2 }, side: { side: 1 }, set: { staple: 2, main: 2 }, snack: {} }[kind];
    const item = { id: "c-" + Date.now().toString(36), name: f.get("name").trim(), kcal: Number(f.get("kcal")), p: Number(f.get("p")) || 0, f: 0, c: 0, salt: kind === "set" ? 3 : 0.5, g };
    S.custom.push(item); save(); picked.push(item.id); paintPicked(); e.target.reset(); toast("追加しました");
  };
}

// ---------- 記録（体重） ----------
function viewLog() {
  const t = P.computeTarget(S.profile, S.goal, S.start);
  const ws = [...S.weights].sort((a, b) => a.date.localeCompare(b.date));
  const last = ws.at(-1);
  const plan = last ? P.planWeightOn(S.profile, S.goal, S.start, last.date) : null;
  $("#main").innerHTML = `
    <section class="hero"><h1>体重の記録</h1><p class="muted">予定の線と実際の体重を比べます。</p></section>
    <div class="grid2">
      <div class="card">
        <form id="w-form" class="form row-form">
          <label>日付<input type="date" name="date" value="${today()}" required></label>
          <label>体重<span class="unit"><input type="number" name="kg" inputmode="decimal" step="0.1" min="25" max="300" required value="${last ? last.kg : S.profile.weight}">kg</span></label>
          <button class="btn primary">記録</button>
        </form>
        ${last ? `<p class="status ${last.kg - plan > 0.5 ? "behind" : "ahead"}">${P.fmtDate(last.date)}：${last.kg}kg（予定 ${plan.toFixed(1)}kg、${last.kg - plan > 0 ? `+${(last.kg - plan).toFixed(1)}kg 遅れ` : `${(plan - last.kg).toFixed(1)}kg 先行`}）</p>
          ${last.kg - plan > 1 ? `<p class="small muted">予定より遅れています。配分画面で歩数や運動を少し増やすか、目標日を延ばすことを検討してください。急に食事を減らしすぎないでください。</p>` : ""}` : `<p class="muted small">まだ記録がありません。</p>`}
        ${chart(ws, t)}
      </div>
      <div class="card">
        <h2>記録一覧</h2>
        <ul class="wlist">${ws.slice().reverse().map(w => `<li><span>${P.fmtDate(w.date)}</span><b>${w.kg}kg</b><button type="button" class="del" data-wdel="${w.date}" aria-label="削除">×</button></li>`).join("") || `<li class="muted small">なし</li>`}</ul>
        <h2>データの保存</h2>
        <p class="small muted">記録はこの端末のブラウザーだけに保存されます。機種変更の前に書き出してください。</p>
        <div class="actions"><button type="button" class="btn" id="export">書き出す</button><button type="button" class="btn" id="import">読み込む</button></div>
      </div>
    </div>`;
  $("#w-form").onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    S.weights = S.weights.filter(w => w.date !== f.get("date")).concat({ date: f.get("date"), kg: Number(f.get("kg")) });
    save(); viewLog(); toast("記録しました");
  };
  $("#main").onclick = e => {
    const d = e.target.closest("[data-wdel]");
    if (d) { S.weights = S.weights.filter(w => w.date !== d.dataset.wdel); save(); viewLog(); }
    if (e.target.id === "export") {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `diet-plan-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (e.target.id === "import") $("#file-backup").click();
  };
}

function chart(ws, t) {
  const W = 640, H = 240, pad = { l: 40, r: 12, t: 12, b: 26 };
  const start = S.start, end = S.goal.date;
  const dEnd = Math.max(1, P.daysBetween(start, end), ...ws.map(w => P.daysBetween(start, w.date)));
  const dMin = Math.min(0, ...ws.map(w => P.daysBetween(start, w.date)));
  const kgs = [S.profile.weight, S.goal.weight, ...ws.map(w => w.kg)];
  const lo = Math.floor(Math.min(...kgs) - 1), hi = Math.ceil(Math.max(...kgs) + 1);
  const x = d => pad.l + (d - dMin) / (dEnd - dMin) * (W - pad.l - pad.r);
  const y = kg => pad.t + (hi - kg) / (hi - lo) * (H - pad.t - pad.b);
  const ticks = []; for (let k = lo; k <= hi; k += Math.max(1, Math.round((hi - lo) / 5))) ticks.push(k);
  const pts = ws.map(w => [x(P.daysBetween(start, w.date)), y(w.kg)]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="体重の予定と記録">
    ${ticks.map(k => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(k)}" y2="${y(k)}" class="grid"/><text x="${pad.l - 6}" y="${y(k) + 4}" text-anchor="end">${k}</text>`).join("")}
    <line x1="${x(0)}" y1="${y(S.profile.weight)}" x2="${x(P.daysBetween(start, end))}" y2="${y(S.goal.weight)}" class="plan"/>
    <text x="${x(0)}" y="${H - 6}">${start.slice(5).replace("-", "/")}</text><text x="${x(P.daysBetween(start, end))}" y="${H - 6}" text-anchor="end">${end.slice(5).replace("-", "/")} 目標</text>
    ${pts.length > 1 ? `<polyline points="${pts.map(p => p.join(",")).join(" ")}" class="actual"/>` : ""}
    ${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="dot"/>`).join("")}
  </svg><p class="small muted legend-line"><span class="lg plan"></span>予定（${t.lossKg.toFixed(1)}kg減）<span class="lg actual"></span>実際</p>`;
}

$("#file-backup").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const v = JSON.parse(await file.text());
    if (!v.profile || !v.goal) throw new Error();
    S = { ...defaults(), ...v }; save(); route(); toast("読み込みました");
  } catch { toast("読み込めないファイルです"); }
  e.target.value = "";
});
$("#dlg .x").addEventListener("click", () => $("#dlg").close());

route();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
