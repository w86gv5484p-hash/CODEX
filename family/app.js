import { createStore, newId, familyCode, setFamilyCode, newFamilyCode } from "./sync.js";
import { recognize, parseSchedule } from "./ocr.js";

// ---------- 家族と季節の設定 ----------
const MEMBERS = [
  { id: "takuro", name: "拓朗", short: "拓", color: "#2f7de1", soft: "#e2edfc" },
  { id: "satsuki", name: "五月", short: "五", color: "#e04f8c", soft: "#fce6ef" },
  { id: "kohaku", name: "琥珀", short: "琥", color: "#e08a00", soft: "#fdf0d9" },
  { id: "kinari", name: "生成", short: "生", color: "#15a083", soft: "#dcf4ee" },
];
const FAMILY = { id: "family", name: "家族みんな", short: "家", color: "#8a5cf0", soft: "#eee6fd" };
const MEMBER_BY_ID = Object.fromEntries(MEMBERS.map(m => [m.id, m]));

const THEMES = {
  1: { name: "睦月", tag: "新しい年のはじまり", motif: ["🎍", "🌅", "🎌"], a: "#c8372d", b: "#d4a017", bg1: "#fff7f1", bg2: "#fde9df" },
  2: { name: "如月", tag: "梅のつぼみと節分", motif: ["👹", "🫘", "💝"], a: "#c2477a", b: "#7a5bbf", bg1: "#fff5f8", bg2: "#f6e6f2" },
  3: { name: "弥生", tag: "ひな祭りと菜の花", motif: ["🎎", "🌼", "🍡"], a: "#de6b8b", b: "#d9a90f", bg1: "#fffaf2", bg2: "#fdeef0" },
  4: { name: "卯月", tag: "桜の季節", motif: ["🌸", "🌸", "🎒"], a: "#e0719a", b: "#8fbf5a", bg1: "#fff6f9", bg2: "#fde4ee" },
  5: { name: "皐月", tag: "こいのぼりと新緑", motif: ["🎏", "🌿", "🍃"], a: "#2c9a58", b: "#3a78d0", bg1: "#f5fcf5", bg2: "#e1f3e4" },
  6: { name: "水無月", tag: "紫陽花と梅雨", motif: ["☔", "🐌", "💠"], a: "#6a63d4", b: "#3f8cc4", bg1: "#f6f6fe", bg2: "#e5e6fa" },
  7: { name: "文月", tag: "七夕と夏のはじまり", motif: ["🎋", "⭐", "🌟"], a: "#2c4fa3", b: "#e8b52c", bg1: "#f4f7fe", bg2: "#e0e8fa" },
  8: { name: "葉月", tag: "ひまわりと花火", motif: ["🌻", "🎆", "🍉"], a: "#ea7d14", b: "#1a9fd6", bg1: "#fffaf0", bg2: "#e3f4fb" },
  9: { name: "長月", tag: "お月見の秋", motif: ["🎑", "🌕", "🐇"], a: "#4a4f92", b: "#d69c32", bg1: "#f8f7fc", bg2: "#ece8f5" },
  10: { name: "神無月", tag: "紅葉とハロウィン", motif: ["🍁", "🎃", "🌰"], a: "#cf5410", b: "#7d5233", bg1: "#fff8f2", bg2: "#fbe7d8" },
  11: { name: "霜月", tag: "いちょうと紅葉", motif: ["🍂", "🍁", "🍠"], a: "#c98f07", b: "#c0392b", bg1: "#fffaf0", bg2: "#fbefd6" },
  12: { name: "師走", tag: "雪とクリスマス", motif: ["❄️", "🎄", "⛄"], a: "#1d7a57", b: "#c8372d", bg1: "#f4f9fc", bg2: "#e2eef6" },
};

const CITIES = [
  ["札幌", 43.06, 141.35], ["仙台", 38.27, 140.87], ["東京", 35.68, 139.77], ["横浜", 35.44, 139.64],
  ["さいたま", 35.86, 139.65], ["千葉", 35.61, 140.12], ["名古屋", 35.18, 136.91], ["京都", 35.01, 135.77],
  ["大阪", 34.69, 135.5], ["神戸", 34.69, 135.2], ["広島", 34.39, 132.46], ["高松", 34.34, 134.05],
  ["福岡", 33.59, 130.4], ["鹿児島", 31.6, 130.56], ["那覇", 26.21, 127.68],
];
const WD = ["日", "月", "火", "水", "木", "金", "土"];

// ---------- 小さな道具 ----------
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const toYmd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mins = t => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- 状態 ----------
const state = {
  events: [],
  view: ls.get("famcal.view", "month"),
  cursor: new Date(),
  filter: new Set(ls.get("famcal.filter", MEMBERS.map(m => m.id))),
  me: ls.get("famcal.me", ""),
  weekStart: ls.get("famcal.weekStart", 0),
  city: ls.get("famcal.city", { name: "東京", lat: 35.68, lon: 139.77 }),
  weather: {},
  holidays: ls.get("famcal.holidays", { at: 0, data: {} }).data,
  status: { mode: "local", state: "ok", text: "" },
};
let store = null;

// ---------- 予定の取り出し ----------
function eventsOn(ymd) {
  return state.events
    .filter(e => e.date <= ymd && (e.endDate || e.date) >= ymd)
    .filter(visible)
    .sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.start || "").localeCompare(b.start || "") || a.title.localeCompare(b.title));
}
function visible(e) {
  const ms = e.members && e.members.length ? e.members : MEMBERS.map(m => m.id);
  return ms.some(id => state.filter.has(id));
}
function isFamily(e) {
  return !e.members || e.members.length === 0 || e.members.length === MEMBERS.length;
}
function mainColor(e) {
  if (isFamily(e)) return FAMILY;
  return MEMBER_BY_ID[e.members[0]] || FAMILY;
}
function timeLabel(e) {
  if (e.allDay || !e.start) return "終日";
  return e.end ? `${e.start}–${e.end}` : e.start;
}
function dots(e) {
  if (isFamily(e)) return `<span class="who fam" title="家族みんな">家</span>`;
  return e.members.map(id => MEMBER_BY_ID[id]).filter(Boolean)
    .map(m => `<span class="who" style="--c:${m.color}" title="${m.name}">${m.short}</span>`).join("");
}
function chipStyle(e) {
  const c = mainColor(e);
  const colors = isFamily(e) ? [FAMILY.color] : e.members.map(id => MEMBER_BY_ID[id]?.color).filter(Boolean);
  const stripe = colors.length > 1
    ? `linear-gradient(${colors.map((c, i) => `${c} ${i * 100 / colors.length}% ${(i + 1) * 100 / colors.length}%`).join(",")})`
    : `linear-gradient(${colors[0]}, ${colors[0]})`;
  return `--c:${c.color};--soft:${c.soft};--stripe:${stripe}`;
}

// ---------- 季節のテーマ ----------
function applyTheme() {
  const m = state.cursor.getMonth() + 1;
  const t = THEMES[m];
  const r = document.documentElement.style;
  r.setProperty("--accent", t.a);
  r.setProperty("--accent2", t.b);
  r.setProperty("--bg1", t.bg1);
  r.setProperty("--bg2", t.bg2);
  document.documentElement.dataset.month = m;
  $('meta[name="theme-color"]').setAttribute("content", t.a);
  const deco = $("#deco");
  if (deco.dataset.month !== String(m)) {
    deco.dataset.month = m;
    const items = [];
    for (let i = 0; i < 9; i++) {
      const e = t.motif[i % t.motif.length];
      const left = (i * 11 + (i % 3) * 4) % 100;
      items.push(`<span style="left:${left}%;animation-delay:${(i * 1.7) % 9}s;animation-duration:${9 + (i % 4) * 2}s;font-size:${14 + (i % 3) * 5}px">${e}</span>`);
    }
    deco.innerHTML = items.join("");
  }
}

// ---------- 画面の描画 ----------
function render() {
  applyTheme();
  const c = state.cursor;
  const t = THEMES[c.getMonth() + 1];
  $("#year").textContent = `${c.getFullYear()}年`;
  $("#month").textContent = `${c.getMonth() + 1}月`;
  $("#season").innerHTML = `<span><b>${t.name}</b></span><span>${t.tag}</span>`;
  $("#motif").textContent = t.motif[0];
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
  $("#period").textContent = periodLabel();
  renderFilters();
  const main = $("#view");
  main.className = `view-${state.view}`;
  if (state.view === "month") main.innerHTML = monthHtml();
  else if (state.view === "week") main.innerHTML = weekHtml();
  else { main.innerHTML = dayHtml(); scrollDay(); }
  renderWeather();
}

function periodLabel() {
  const c = state.cursor;
  if (state.view === "month") return `${c.getFullYear()}年${c.getMonth() + 1}月`;
  if (state.view === "week") {
    const s = weekStartOf(c), e = addDays(s, 6);
    return `${s.getMonth() + 1}/${s.getDate()}（${WD[s.getDay()]}）〜 ${e.getMonth() + 1}/${e.getDate()}（${WD[e.getDay()]}）`;
  }
  return `${c.getMonth() + 1}月${c.getDate()}日（${WD[c.getDay()]}）`;
}

function weekStartOf(d) {
  const diff = (d.getDay() - state.weekStart + 7) % 7;
  return addDays(d, -diff);
}

function renderFilters() {
  const all = MEMBERS.every(m => state.filter.has(m.id));
  $("#filters").innerHTML =
    `<button class="fchip all ${all ? "on" : ""}" data-filter="all">みんな</button>` +
    MEMBERS.map(m => `<button class="fchip ${state.filter.has(m.id) ? "on" : ""}" data-filter="${m.id}" style="--c:${m.color};--soft:${m.soft}"><span class="dot"></span>${m.name}${state.me === m.id ? '<small>わたし</small>' : ""}</button>`).join("");
}

function dayClass(d, ymd) {
  const cls = [];
  if (ymd === toYmd(new Date())) cls.push("today");
  if (d.getDay() === 0 || state.holidays[ymd]) cls.push("sun");
  if (d.getDay() === 6) cls.push("sat");
  return cls.join(" ");
}

function wxIcon(ymd, big) {
  const w = state.weather[ymd];
  if (!w) return "";
  return `<span class="wx ${big ? "big" : ""}" title="${w.label} ${w.max}°/${w.min}° 降水${w.pop ?? "-"}%">${w.icon}</span>`;
}

function monthHtml() {
  const c = state.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = weekStartOf(first);
  const weeks = Math.ceil(((first.getDay() - state.weekStart + 7) % 7 + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);
  let h = `<div class="mhead">${[0, 1, 2, 3, 4, 5, 6].map(i => { const wd = (i + state.weekStart) % 7; return `<div class="${wd === 0 ? "sun" : wd === 6 ? "sat" : ""}">${WD[wd]}</div>`; }).join("")}</div>`;
  h += `<div class="mgrid" style="--weeks:${weeks}">`;
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const ymd = toYmd(d);
    const evs = eventsOn(ymd);
    const out = d.getMonth() !== c.getMonth();
    const hol = state.holidays[ymd];
    const max = 3;
    h += `<div class="mcell ${dayClass(d, ymd)} ${out ? "out" : ""}" data-day="${ymd}">
      <div class="mtop"><span class="dnum">${d.getDate()}</span>${wxIcon(ymd)}</div>
      ${hol ? `<div class="hol">${esc(hol)}</div>` : ""}
      <div class="mevs">${evs.slice(0, max).map(e => `<button class="chip" data-ev="${e.id}" style="${chipStyle(e)}"><span class="t">${e.allDay || !e.start ? "" : e.start}</span>${esc(e.title)}</button>`).join("")}
      ${evs.length > max ? `<span class="more">+${evs.length - max}件</span>` : ""}</div>
      <div class="mdots">${evs.slice(0, 6).map(e => `<i style="background:${mainColor(e).color}"></i>`).join("")}</div>
    </div>`;
  }
  return h + "</div>";
}

function evRow(e, ymd) {
  const multi = e.endDate && e.endDate !== e.date;
  return `<button class="erow" data-ev="${e.id}" style="${chipStyle(e)}">
    <span class="etime">${timeLabel(e)}</span>
    <span class="etitle">${esc(e.title)}${multi ? `<small>（${fromYmd(e.date).getMonth() + 1}/${fromYmd(e.date).getDate()}〜${fromYmd(e.endDate).getMonth() + 1}/${fromYmd(e.endDate).getDate()}）</small>` : ""}${e.place ? `<small>📍${esc(e.place)}</small>` : ""}</span>
    <span class="whos">${dots(e)}</span>
  </button>`;
}

function weekHtml() {
  const s = weekStartOf(state.cursor);
  let h = `<div class="wgrid">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i);
    const ymd = toYmd(d);
    const evs = eventsOn(ymd);
    const w = state.weather[ymd];
    const hol = state.holidays[ymd];
    h += `<section class="wday ${dayClass(d, ymd)}">
      <header data-day="${ymd}">
        <span class="wdate"><b>${d.getDate()}</b><span>${WD[d.getDay()]}</span></span>
        ${hol ? `<span class="hol">${esc(hol)}</span>` : ""}
        ${w ? `<span class="wwx">${w.icon}<small><em class="hi">${w.max}°</em>/<em class="lo">${w.min}°</em></small></span>` : ""}
      </header>
      <div class="wevs">${evs.map(e => evRow(e, ymd)).join("") || `<button class="empty" data-add="${ymd}">＋ 予定を追加</button>`}</div>
    </section>`;
  }
  return h + "</div>";
}

const HOUR = 52;
function dayHtml() {
  const d = state.cursor;
  const ymd = toYmd(d);
  const evs = eventsOn(ymd);
  const allDay = evs.filter(e => e.allDay || !e.start);
  const timed = evs.filter(e => !e.allDay && e.start);
  const w = state.weather[ymd];
  const hol = state.holidays[ymd];
  // 重なる予定を横に並べる
  const items = timed.map(e => {
    const s = e.date < ymd ? 0 : mins(e.start);
    let en = (e.endDate || e.date) > ymd ? 24 * 60 : (mins(e.end) ?? s + 60);
    if (en <= s) en = s + 45;
    return { e, s, en, col: 0, cols: 1 };
  }).sort((a, b) => a.s - b.s || b.en - a.en);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    for (const it of cluster) {
      let c = colsEnd.findIndex(x => x <= it.s);
      if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
      colsEnd[c] = it.en; it.col = c;
    }
    for (const it of cluster) it.cols = colsEnd.length;
    cluster = [];
  };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en);
  }
  if (cluster.length) flush();

  const now = new Date();
  const nowLine = ymd === toYmd(now) ? `<div class="now" style="top:${(now.getHours() * 60 + now.getMinutes()) * HOUR / 60}px"></div>` : "";
  return `<div class="dhead ${dayClass(d, ymd)}">
      <div class="dtitle"><b>${d.getDate()}</b><span>${WD[d.getDay()]}曜日${hol ? ` · <em class="holname">${esc(hol)}</em>` : ""}</span></div>
      ${w ? `<div class="dwx">${w.icon}<div><b>${w.label}</b><span><em class="hi">${w.max}°</em> / <em class="lo">${w.min}°</em> · 降水 ${w.pop ?? "-"}%</span></div></div>` : ""}
    </div>
    <div class="dall">${allDay.map(e => evRow(e, ymd)).join("")}<button class="empty sm" data-add="${ymd}">＋ 予定を追加</button></div>
    <div class="timeline" id="timeline">
      <div class="hours">${Array.from({ length: 24 }, (_, i) => `<div class="hr" data-hour="${i}" style="top:${i * HOUR}px"><span>${i}:00</span></div>`).join("")}</div>
      <div class="lanes">${items.map(it => {
        const top = it.s * HOUR / 60, hgt = Math.max(24, (it.en - it.s) * HOUR / 60 - 2);
        const e = it.e;
        return `<button class="block" data-ev="${e.id}" style="${chipStyle(e)};top:${top}px;height:${hgt}px;left:calc(${it.col * 100 / it.cols}% + 2px);width:calc(${100 / it.cols}% - 4px)">
          <b>${esc(e.title)}</b><span>${timeLabel(e)}${e.place ? " · " + esc(e.place) : ""}</span><span class="whos">${dots(e)}</span></button>`;
      }).join("")}${nowLine}</div>
    </div>`;
}

let dayScroll = { ymd: "", top: 0 };
function scrollDay() {
  const tl = $("#timeline");
  if (!tl) return;
  const ymd = toYmd(state.cursor);
  tl.addEventListener("scroll", () => { dayScroll = { ymd, top: tl.scrollTop }; }, { passive: true });
  if (dayScroll.ymd === ymd) { tl.scrollTop = dayScroll.top; return; } // 同じ日の再描画ではスクロール位置を保つ
  const first = eventsOn(ymd).find(e => !e.allDay && e.start && e.date === ymd);
  let h = 7;
  if (ymd === toYmd(new Date())) h = Math.max(0, new Date().getHours() - 1);
  else if (first) h = Math.max(0, Math.floor(mins(first.start) / 60) - 1);
  requestAnimationFrame(() => { tl.scrollTop = h * HOUR; });
}

// ---------- 天気（Open-Meteo、APIキー不要） ----------
const WMO = code => {
  if (code === 0) return ["☀️", "快晴"];
  if (code === 1) return ["🌤️", "晴れ"];
  if (code === 2) return ["⛅", "晴れ時々くもり"];
  if (code === 3) return ["☁️", "くもり"];
  if (code === 45 || code === 48) return ["🌫️", "霧"];
  if (code >= 51 && code <= 57) return ["🌦️", "霧雨"];
  if (code >= 61 && code <= 67) return ["☔", "雨"];
  if (code >= 71 && code <= 77) return ["❄️", "雪"];
  if (code >= 80 && code <= 82) return ["🌦️", "にわか雨"];
  if (code === 85 || code === 86) return ["🌨️", "にわか雪"];
  if (code >= 95) return ["⛈️", "雷雨"];
  return ["🌡️", "—"];
};

async function loadWeather() {
  const { lat, lon } = state.city;
  const key = `famcal.wx.${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = ls.get(key, null);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) { state.weather = cached.data; renderWeather(); return; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7`;
    const r = await fetch(url);
    const j = await r.json();
    const data = {};
    j.daily.time.forEach((t, i) => {
      const [icon, label] = WMO(j.daily.weather_code[i]);
      data[t] = { icon, label, max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]), pop: j.daily.precipitation_probability_max?.[i] };
    });
    state.weather = data;
    ls.set(key, { at: Date.now(), data });
  } catch (e) {
    if (cached) state.weather = cached.data;
  }
  render();
}

function renderWeather() {
  const today = toYmd(new Date());
  const days = Object.keys(state.weather).filter(d => d >= today).sort().slice(0, 7);
  const box = $("#weather");
  if (!days.length) { box.innerHTML = `<span class="wxcity">${esc(state.city.name)}</span><span class="wxnone">天気を取得中…</span>`; return; }
  box.innerHTML = `<span class="wxcity">${esc(state.city.name)}の週間天気</span><div class="wxrow">${days.map(d => {
    const w = state.weather[d], dt = fromYmd(d);
    const cls = dt.getDay() === 0 || state.holidays[d] ? "sun" : dt.getDay() === 6 ? "sat" : "";
    return `<button class="wxd ${d === today ? "today" : ""}" data-wxday="${d}" title="${dt.getMonth() + 1}/${dt.getDate()} ${w.label} ${w.max}°/${w.min}° 降水${w.pop ?? "-"}%">
      <span class="wxwd ${cls}">${d === today ? "今日" : WD[dt.getDay()]}</span><span class="wxi">${w.icon}</span><span class="wxt"><em class="hi">${w.max}</em><em class="lo">${w.min}</em></span></button>`;
  }).join("")}</div>`;
}

// ---------- 祝日（holidays-jp） ----------
async function loadHolidays() {
  const c = ls.get("famcal.holidays", null);
  if (c && Date.now() - c.at < 7 * 864e5 && Object.keys(c.data).length) return;
  try {
    const r = await fetch("https://holidays-jp.github.io/api/v1/date.json");
    const data = await r.json();
    state.holidays = data;
    ls.set("famcal.holidays", { at: Date.now(), data });
    render();
  } catch {}
}

// ---------- 予定の編集 ----------
let editing = null;
function openEditor(ev, presetDate) {
  const today = toYmd(state.cursor);
  editing = ev ? { ...ev } : {
    id: newId(), title: "", date: presetDate || today, endDate: "", allDay: false, start: "", end: "",
    members: state.me ? [state.me] : [], place: "", note: "",
  };
  const f = $("#evform");
  f.reset();
  $("#ed-title").textContent = ev ? "予定を編集" : "予定を追加";
  f.title.value = editing.title;
  f.date.value = editing.date;
  f.endDate.value = editing.endDate && editing.endDate !== editing.date ? editing.endDate : "";
  f.allDay.checked = !!editing.allDay;
  f.start.value = editing.start || "";
  f.end.value = editing.end || "";
  f.place.value = editing.place || "";
  f.note.value = editing.note || "";
  renderWhoPick();
  toggleTimes();
  $("#ed-delete").hidden = !ev;
  const meta = $("#ed-meta");
  if (ev && ev.updatedBy) {
    const who = MEMBER_BY_ID[ev.updatedBy]?.name || "だれか";
    const t = ev.updatedAt ? new Date(ev.updatedAt) : null;
    meta.textContent = `最終更新：${who}${t ? `（${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}）` : ""}`;
  } else meta.textContent = "";
  $("#editor").showModal();
  if (!ev) setTimeout(() => f.title.focus(), 50);
}
function renderWhoPick() {
  const fam = isFamily(editing) && editing.members.length > 0;
  $("#whopick").innerHTML =
    MEMBERS.map(m => `<button type="button" class="wp ${editing.members.includes(m.id) ? "on" : ""}" data-who="${m.id}" style="--c:${m.color};--soft:${m.soft}">${m.name}</button>`).join("") +
    `<button type="button" class="wp fam ${fam ? "on" : ""}" data-who="all" style="--c:${FAMILY.color};--soft:${FAMILY.soft}">家族みんな</button>`;
}
function toggleTimes() {
  $("#times").classList.toggle("hidden", $("#evform").allDay.checked);
}

async function saveEditor(e) {
  e.preventDefault();
  const f = $("#evform");
  const title = f.title.value.trim();
  if (!title) { f.title.focus(); return; }
  let start = f.allDay.checked ? "" : f.start.value;
  let end = f.allDay.checked ? "" : f.end.value;
  const endDate = f.endDate.value && f.endDate.value > f.date.value ? f.endDate.value : "";
  if (start && end && !endDate && end < start) [start, end] = [end, start];
  const ev = {
    ...editing, title, date: f.date.value, endDate, allDay: f.allDay.checked || !start,
    start, end, place: f.place.value.trim(), note: f.note.value.trim(),
    members: editing.members.length ? editing.members : MEMBERS.map(m => m.id),
    updatedBy: state.me || "", createdBy: editing.createdBy || state.me || "",
  };
  $("#editor").close();
  await safe(() => store.save(ev), "保存できませんでした");
  toast(`「${title}」を保存しました`);
}

async function deleteEditor() {
  if (!editing) return;
  const ok = await confirmBox(`「${editing.title}」を削除しますか？`);
  if (!ok) return;
  $("#editor").close();
  await safe(() => store.remove(editing.id), "削除できませんでした");
  toast("削除しました");
}

function confirmBox(text) {
  return new Promise(resolve => {
    const d = $("#confirm");
    $("#confirm-text").textContent = text;
    d.onclose = () => resolve(d.returnValue === "yes");
    d.returnValue = "";
    d.showModal();
  });
}

async function safe(fn, msg) {
  try { await fn(); } catch (err) { console.error(err); toast(`${msg}：${err.message || err}`, true); }
}

// ---------- 写真から取り込み ----------
let candidates = [];
async function handlePhoto(file) {
  if (!file) return;
  const d = $("#photo");
  candidates = [];
  $("#ph-preview").src = URL.createObjectURL(file);
  $("#ph-step-pick").hidden = true;
  $("#ph-step-work").hidden = false;
  $("#ph-results").innerHTML = "";
  $("#ph-actions").hidden = true;
  $("#ph-raw").hidden = true;
  if (!d.open) d.showModal();
  const bar = $("#ph-bar"), label = $("#ph-label");
  $("#ph-progress").hidden = false;
  try {
    const text = await recognize(file, (p, l) => { bar.style.width = `${Math.round(p * 100)}%`; label.textContent = l; });
    $("#ph-progress").hidden = true;
    $("#ph-rawtext").value = text.trim();
    $("#ph-raw").hidden = false;
    candidates = parseSchedule(text, new Date()).map(c => ({ ...c, on: true, members: state.me ? [state.me] : [] }));
    renderCandidates();
  } catch (err) {
    $("#ph-progress").hidden = true;
    $("#ph-results").innerHTML = `<p class="warn">読み取りに失敗しました：${esc(err.message)}<br>通信状態を確認して、もう一度お試しください。</p>`;
  }
}
function renderCandidates() {
  const box = $("#ph-results");
  if (!candidates.length) {
    box.innerHTML = `<p class="warn">予定らしい日付が見つかりませんでした。下の「読み取った文字」から手入力するか、日付が大きく写るように撮り直してみてください。</p>`;
    $("#ph-actions").hidden = true;
    return;
  }
  box.innerHTML = `<p class="hint">${candidates.length}件の候補が見つかりました。内容を確認・修正して、登録する予定にチェックを入れてください。</p>` +
    candidates.map((c, i) => `<div class="cand ${c.on ? "" : "off"}" data-i="${i}">
      <label class="ck"><input type="checkbox" data-k="on" ${c.on ? "checked" : ""}></label>
      <div class="cf">
        <input type="text" data-k="title" value="${esc(c.title)}" placeholder="予定の内容">
        <div class="crow">
          <input type="date" data-k="date" value="${c.date}">
          <input type="time" data-k="start" value="${c.start}">
          <span>〜</span>
          <input type="time" data-k="end" value="${c.end}">
        </div>
        <div class="cwho">${MEMBERS.map(m => `<button type="button" class="wp xs ${c.members.includes(m.id) ? "on" : ""}" data-cwho="${m.id}" style="--c:${m.color};--soft:${m.soft}">${m.name}</button>`).join("")}</div>
      </div>
    </div>`).join("");
  $("#ph-actions").hidden = false;
  updateImportCount();
}
function updateImportCount() {
  const n = candidates.filter(c => c.on && c.title.trim()).length;
  $("#ph-import").textContent = `${n}件を登録する`;
  $("#ph-import").disabled = n === 0;
}
async function importCandidates() {
  const list = candidates.filter(c => c.on && c.title.trim());
  $("#photo").close();
  for (const c of list) {
    await safe(() => store.save({
      id: newId(), title: c.title.trim(), date: c.date, endDate: "", allDay: !c.start, start: c.start, end: c.end,
      members: c.members.length ? c.members : MEMBERS.map(m => m.id), place: "", note: "写真から取り込み",
      updatedBy: state.me || "", createdBy: state.me || "",
    }), "保存できませんでした");
  }
  toast(`${list.length}件の予定を登録しました`);
  if (list[0]) { state.cursor = fromYmd(list[0].date); render(); }
}

// ---------- 設定 ----------
function openSettings(firstRun) {
  $("#st-first").hidden = !firstRun;
  $("#st-me").innerHTML = MEMBERS.map(m => `<button type="button" class="wp ${state.me === m.id ? "on" : ""}" data-me="${m.id}" style="--c:${m.color};--soft:${m.soft}">${m.name}</button>`).join("");
  $("#st-city").innerHTML = CITIES.map(([n]) => `<option ${state.city.name === n ? "selected" : ""}>${n}</option>`).join("") +
    (CITIES.some(([n]) => n === state.city.name) ? "" : `<option selected>${esc(state.city.name)}</option>`);
  $("#st-week").value = String(state.weekStart);
  renderSyncSettings();
  $("#settings").showModal();
}
function renderSyncSettings() {
  const configured = !!(window.FAMCAL_FIREBASE && window.FAMCAL_FIREBASE.projectId);
  const code = familyCode();
  const box = $("#st-sync");
  if (!configured) {
    box.innerHTML = `<p class="hint">今は<b>お試しモード</b>です。予定はこの端末の中だけに保存されます。家族のスマホと同期するには Firebase の設定が必要です（設定は一度だけ）。</p>`;
    return;
  }
  const link = `${location.origin}${location.pathname}?family=${encodeURIComponent(code)}`;
  box.innerHTML = code ? `
    <p class="hint">状態：<b>${esc(state.status.text)}</b></p>
    <label class="lbl">家族コード</label>
    <div class="coderow"><input type="text" readonly value="${esc(code)}" id="st-code"><button type="button" class="btn sm" id="st-copy">招待リンクをコピー</button></div>
    <p class="hint small">招待リンクを LINE などで家族に送ると、開くだけで同じ予定表につながります。コードは家族以外に教えないでください。</p>
    <details><summary>別の家族コードに切り替える</summary>
      <div class="coderow"><input type="text" id="st-newcode" placeholder="fam-xxxx-xxxx-xxxx"><button type="button" class="btn sm" id="st-join">切り替え</button></div>
    </details>
    <input type="hidden" id="st-link" value="${esc(link)}">` : `
    <p class="hint">家族で同じ予定表を使うための<b>家族コード</b>を決めます。最初の1人が「新しく作る」を押し、表示される招待リンクを家族に送ってください。</p>
    <button type="button" class="btn" id="st-create">新しく作る</button>
    <div class="coderow"><input type="text" id="st-newcode" placeholder="家族からもらったコード"><button type="button" class="btn sm" id="st-join">参加する</button></div>`;
}
async function switchFamily(code) {
  code = code.trim();
  if (code.length < 12) { toast("家族コードが短すぎます", true); return; }
  setFamilyCode(code);
  location.replace(location.pathname);
}

// ---------- 通知 ----------
let toastTimer;
function toast(text, err) {
  const t = $("#toast");
  t.textContent = text;
  t.className = `show ${err ? "err" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 3200);
}
function setStatus(s) {
  state.status = s;
  const el = $("#status");
  el.textContent = s.text;
  el.className = `status ${s.state} ${s.mode}`;
  if ($("#settings").open) renderSyncSettings();
}

// ---------- 操作 ----------
function go(delta) {
  const c = state.cursor;
  if (state.view === "month") state.cursor = new Date(c.getFullYear(), c.getMonth() + delta, 1);
  else if (state.view === "week") state.cursor = addDays(c, 7 * delta);
  else state.cursor = addDays(c, delta);
  render();
}
function setView(v, date) {
  state.view = v;
  ls.set("famcal.view", v);
  if (date) state.cursor = date;
  render();
}

function bind() {
  $("#prev").onclick = () => go(-1);
  $("#next").onclick = () => go(1);
  $("#today").onclick = () => { state.cursor = new Date(); render(); };
  document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => setView(b.dataset.view)));
  $("#add").onclick = () => openEditor(null, toYmd(state.cursor));
  $("#photo-btn").onclick = () => { $("#ph-step-pick").hidden = false; $("#ph-step-work").hidden = true; $("#photo").showModal(); };
  $("#settings-btn").onclick = () => openSettings(false);
  $("#status").onclick = () => openSettings(false);

  $("#filters").onclick = e => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    const id = b.dataset.filter;
    if (id === "all") state.filter = new Set(MEMBERS.map(m => m.id));
    else if (MEMBERS.every(m => state.filter.has(m.id))) state.filter = new Set([id]); // みんな表示中に押したら、その人だけ
    else {
      state.filter.has(id) ? state.filter.delete(id) : state.filter.add(id);
      if (!state.filter.size) state.filter = new Set(MEMBERS.map(m => m.id));
    }
    ls.set("famcal.filter", [...state.filter]);
    render();
  };

  $("#view").onclick = e => {
    const ev = e.target.closest("[data-ev]");
    if (ev) { const x = state.events.find(v => v.id === ev.dataset.ev); if (x) openEditor(x); return; }
    const add = e.target.closest("[data-add]");
    if (add) { openEditor(null, add.dataset.add); return; }
    const hr = e.target.closest("[data-hour]");
    if (hr) {
      openEditor(null, toYmd(state.cursor));
      const f = $("#evform"); const h = +hr.dataset.hour;
      f.start.value = `${pad(h)}:00`; f.end.value = `${pad(Math.min(23, h + 1))}:00`;
      return;
    }
    const day = e.target.closest("[data-day]");
    if (day) setView("day", fromYmd(day.dataset.day));
  };
  $("#weather").onclick = e => {
    const d = e.target.closest("[data-wxday]");
    if (d) setView("day", fromYmd(d.dataset.wxday));
  };

  // 左右スワイプで前後へ
  let sx = 0, sy = 0, st = 0;
  const v = $("#view");
  v.addEventListener("touchstart", e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  v.addEventListener("touchend", e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // 編集画面
  $("#evform").onsubmit = saveEditor;
  $("#evform").allDay.onchange = toggleTimes;
  $("#evform").start.onchange = () => {
    const f = $("#evform");
    if (f.start.value && !f.end.value) {
      const m = Math.min(mins(f.start.value) + 60, 23 * 60 + 59);
      f.end.value = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    }
  };
  $("#ed-delete").onclick = deleteEditor;
  $("#ed-cancel").onclick = () => $("#editor").close();
  $("#whopick").onclick = e => {
    const b = e.target.closest("[data-who]");
    if (!b) return;
    const id = b.dataset.who;
    if (id === "all") editing.members = isFamily(editing) && editing.members.length ? [] : MEMBERS.map(m => m.id);
    else editing.members = editing.members.includes(id) ? editing.members.filter(x => x !== id) : [...editing.members, id];
    renderWhoPick();
  };

  // 写真
  $("#ph-camera").onchange = e => handlePhoto(e.target.files[0]);
  $("#ph-library").onchange = e => handlePhoto(e.target.files[0]);
  $("#ph-close").onclick = () => $("#photo").close();
  $("#ph-retry").onclick = () => { $("#ph-step-pick").hidden = false; $("#ph-step-work").hidden = true; $("#ph-camera").value = ""; $("#ph-library").value = ""; };
  $("#ph-import").onclick = importCandidates;
  $("#ph-results").addEventListener("input", e => {
    const row = e.target.closest(".cand"); const k = e.target.dataset.k;
    if (!row || !k) return;
    const c = candidates[+row.dataset.i];
    c[k] = k === "on" ? e.target.checked : e.target.value;
    row.classList.toggle("off", !c.on);
    updateImportCount();
  });
  $("#ph-results").addEventListener("click", e => {
    const b = e.target.closest("[data-cwho]");
    if (!b) return;
    const c = candidates[+b.closest(".cand").dataset.i];
    const id = b.dataset.cwho;
    c.members = c.members.includes(id) ? c.members.filter(x => x !== id) : [...c.members, id];
    b.classList.toggle("on");
  });
  // 写真をドラッグ＆ドロップ（パソコン）
  document.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", e => {
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith("image/")) { e.preventDefault(); handlePhoto(f); }
  });

  // 設定
  $("#st-me").onclick = e => {
    const b = e.target.closest("[data-me]");
    if (!b) return;
    state.me = b.dataset.me; ls.set("famcal.me", state.me);
    document.querySelectorAll("#st-me .wp").forEach(x => x.classList.toggle("on", x === b));
    renderFilters();
  };
  $("#st-city").onchange = e => {
    const c = CITIES.find(([n]) => n === e.target.value);
    if (!c) return;
    state.city = { name: c[0], lat: c[1], lon: c[2] }; ls.set("famcal.city", state.city);
    state.weather = {}; renderWeather(); loadWeather();
  };
  $("#st-geo").onclick = () => {
    if (!navigator.geolocation) { toast("この端末では現在地を使えません", true); return; }
    navigator.geolocation.getCurrentPosition(p => {
      state.city = { name: "現在地", lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) };
      ls.set("famcal.city", state.city);
      openSettings(false); state.weather = {}; loadWeather();
    }, () => toast("現在地を取得できませんでした", true), { timeout: 10000 });
  };
  $("#st-week").onchange = e => { state.weekStart = +e.target.value; ls.set("famcal.weekStart", state.weekStart); render(); };
  $("#st-done").onclick = () => {
    if (!state.me) { toast("あなたの名前を選んでください", true); return; }
    $("#settings").close();
  };
  $("#st-sync").onclick = async e => {
    if (e.target.id === "st-create") await switchFamily(newFamilyCode());
    if (e.target.id === "st-join") await switchFamily($("#st-newcode").value);
    if (e.target.id === "st-copy") {
      const link = $("#st-link").value;
      try {
        if (navigator.share) await navigator.share({ title: "家族のスケジュール", text: "家族のスケジュールに参加してね", url: link });
        else { await navigator.clipboard.writeText(link); toast("招待リンクをコピーしました"); }
      } catch {}
    }
  };
  $("#settings").addEventListener("cancel", e => { if (!state.me) e.preventDefault(); });
}

// ---------- 起動 ----------
async function start() {
  // 招待リンク（?family=コード）で開かれたら家族コードを保存
  const params = new URLSearchParams(location.search);
  const fam = params.get("family");
  if (fam && fam.length >= 12) {
    setFamilyCode(fam);
    history.replaceState(null, "", location.pathname);
  }
  bind();
  render();
  if (!state.me) openSettings(true);
  let firstLoad = true;
  store = await createStore({
    onEvents(list, changes) {
      state.events = list.filter(e => e && e.date && e.title);
      if (!firstLoad) {
        for (const c of changes) {
          const by = c.ev && c.ev.updatedBy;
          if (by && by !== state.me && c.type !== "removed") {
            toast(`${MEMBER_BY_ID[by]?.name || "家族"}さんが「${c.ev.title}」を${c.type === "added" ? "追加" : "更新"}しました`);
          } else if (c.type === "removed" && c.ev && c.ev.updatedBy !== state.me) {
            toast(`「${c.ev.title}」が削除されました`);
          }
        }
      }
      firstLoad = false;
      render();
    },
    onStatus: setStatus,
  });
  if (state.status.state === "needs-code" && state.me && !$("#settings").open) openSettings(false);
  loadWeather();
  loadHolidays();
  // 日付が変わったら「今日」を更新し、天気も1時間ごとに更新
  setInterval(() => { if (state.view === "day") render(); }, 5 * 60 * 1000);
  setInterval(loadWeather, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadWeather(); render(); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}
start();
