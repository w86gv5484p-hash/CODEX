const main = document.querySelector("#main");
const dialog = document.querySelector("#detail-dialog");
const dialogContent = document.querySelector("#dialog-content");
const statusButton = document.querySelector("#data-status");
let localUpdateMessage = "";
let localUpdateRunning = false;

const sources = {
  jfa: { label: "JFA 男子日本代表", url: "https://www.jfa.jp/samuraiblue/" },
  schedule: { label: "JFA 試合日程・結果", url: "https://www.jfa.jp/samuraiblue/schedule_result/" },
  fifa: { label: "FIFA 公式ランキング", url: "https://inside.fifa.com/fifa-world-ranking/men" },
};

const sections = new Set(["overview", "matches", "players", "clubs", "health"]);
const positionNames = { GK: "ゴールキーパー", DF: "ディフェンダー", MF: "ミッドフィールダー", FW: "フォワード" };
const typeNames = { callup: "代表招集", club: "クラブ活動", injury: "負傷", return: "復帰・見込み", health: "負傷・復帰" };
const translations = {
  Brazil: "ブラジル", Paraguay: "パラグアイ", Spain: "スペイン", Morocco: "モロッコ",
  Sweden: "スウェーデン", Netherlands: "オランダ", Tunisia: "チュニジア", Scotland: "スコットランド",
  England: "イングランド", Mexico: "メキシコ", "United States": "アメリカ", Ghana: "ガーナ",
  Bolivia: "ボリビア", "South Korea": "韓国", Australia: "オーストラリア", Germany: "ドイツ",
  "Cape Verde": "カーボベルデ", Belgium: "ベルギー", "Costa Rica": "コスタリカ", Colombia: "コロンビア",
  Friendly: "国際親善試合", "FIFA World Cup": "FIFA ワールドカップ",
  "EAFF Championship": "EAFF E-1 サッカー選手権", "FIFA World Cup qualification": "FIFA ワールドカップ予選",
};
const countryCodes = {
  Brazil: "BR", ブラジル: "BR", Paraguay: "PY", パラグアイ: "PY",
  Spain: "ES", スペイン: "ES", Morocco: "MA", モロッコ: "MA",
  Sweden: "SE", スウェーデン: "SE", Netherlands: "NL", オランダ: "NL",
  Tunisia: "TN", チュニジア: "TN", Scotland: "GB-SCT", スコットランド: "GB-SCT",
  England: "GB-ENG", イングランド: "GB-ENG", Mexico: "MX", メキシコ: "MX",
  "United States": "US", アメリカ: "US", Ghana: "GH", ガーナ: "GH", Bolivia: "BO", ボリビア: "BO",
  "South Korea": "KR", 韓国: "KR", Australia: "AU", オーストラリア: "AU",
  Germany: "DE", ドイツ: "DE", Belgium: "BE", ベルギー: "BE", Colombia: "CO", コロンビア: "CO",
};

const iconPaths = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-4-12a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  pin: '<path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  external: '<path d="M13 5h6v6m0-6-8 8m5-1v6H6V8h6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="m12 8 4 3-1.5 4.5h-5L8 11l4-3Zm0 0V3m4 8 4.5-2m-6 6.5 3 3.5m-8-3.5L6.5 19M8 11 3.5 9"/>',
  chart: '<path d="M4 4v16h16M8 15l4-5 3 2 5-6"/>',
};
const icon = (name, size = 17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const local = value => Object.hasOwn(translations, value) ? translations[value] : value;
const dayFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" });
const timeFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" });
const tokyoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const timeLabel = value => Number.isFinite(Date.parse(value)) ? timeFormatter.format(new Date(value)) + " JST" : "未確認";
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  ? dayFormatter.format(new Date(value + "T12:00:00+09:00"))
  : "日付未定";
const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replaceAll("-", ".") : "日付未定";
const byLatest = (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""));
const blank = { fixtures: [], callups: [], players: [], checkedAt: null };
const feedFiles = {
  jfa: "jfa", roster: "players", clubs: "clubs", ranking: "ranking", lineups: "lineups", profiles: "profiles",
  portraits: "portraits", squad: "current-squad", clubReports: "current-clubs", healthReports: "current-health", fpl: "fpl",
  biographies: "player-biographies",
};
const feeds = Object.fromEntries(Object.keys(feedFiles).map(key => [key, blank]));
let failedFeeds = new Set();
let shownPage = "";
let reportFilter = "all";
let rosterSelection = "current";

function externalLink(source) {
  if (!source?.url || !/^https:\/\//i.test(source.url)) return "";
  return `<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label || "出典")}${icon("external", 13)}</a>`;
}

function sectionHeading(title, target, label) {
  return `<div class="section-heading"><h2>${esc(title)}</h2>${target ? `<a href="#${target}">${esc(label)}${icon("arrow", 14)}</a>` : ""}</div>`;
}

function viewHeading(title, description) {
  return `<div class="view-heading"><h1>${title}</h1><p>${description}</p></div>`;
}

function emptyState(text, source) {
  return `<div class="panel empty"><p>${esc(text)}</p>${source ? `<p>${externalLink(source)}</p>` : ""}</div>`;
}

function tag(type, label = typeNames[type]) {
  return `<span class="tag ${esc(type)}">${esc(label)}</span>`;
}

function route() {
  if (location.hash === "#main") return [shownPage || "overview", ""];
  const [tab, id = "", participant = ""] = location.hash.slice(1).split("/");
  const decoded = value => {
    try { return decodeURIComponent(value); } catch { return ""; }
  };
  return [sections.has(tab) ? tab : "overview", decoded(id), decoded(participant)];
}

function fixtures() {
  const data = Array.isArray(feeds.jfa.fixtures) ? feeds.jfa.fixtures : [];
  return {
    upcoming: data.filter(f => f.status === "scheduled" && f.date >= tokyoDay()).sort((a, b) => byLatest(b, a)),
    recent: data.filter(f => f.status === "completed").sort(byLatest),
  };
}

function callups() {
  const automated = Array.isArray(feeds.jfa.callups) ? feeds.jfa.callups : [];
  const confirmed = Array.isArray(feeds.roster.callups) ? feeds.roster.callups : [];
  return [...new Map([...automated, ...confirmed].map(item => [item.id, item])).values()].sort(byLatest);
}

function playerReports(player) {
  const tracked = feeds.clubs.players?.find(item => item.id === player.id);
  const liveFpl = feeds.fpl.reports ?? [];
  const researched = [...(feeds.clubReports.reports ?? []), ...(feeds.healthReports.reports ?? [])]
    .filter(report => report.playerId === player.id && !liveFpl.some(live => live.playerId === report.playerId && live.date >= report.date
      && (report.scope === "season" && live.scope === "season"
        || report.type === "injury" && report.source?.label.startsWith("Fantasy Premier League") && live.type === "injury")));
  researched.push(...liveFpl.filter(report => report.playerId === player.id));
  const reports = [...(player.reports ?? []), ...(tracked?.reports ?? []), ...researched];
  return [...new Map(reports.map(report => [`${report.date}:${report.type}:${report.title}`, report])).values()].sort(byLatest);
}

function portraitFor(player) {
  const portrait = feeds.portraits.portraits?.find(item => item.id === player.id);
  if (portrait?.verification?.method !== "commons-single-person-v1") return null;
  const path = portrait?.path ?? "";
  if (/^assets\/portraits\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)
    || /^data:image\/(?:jpeg|png|webp);base64,[\w+/=]+$/.test(path)) return portrait;
  return null;
}

function portraitMarkup(player, portrait, lazy = false) {
  return `<span class="portrait-frame">
    ${portrait ? `<img src="${esc(portrait.path)}" alt="${lazy ? "" : esc(player.name + "の写真")}" ${lazy ? 'loading="lazy"' : ""}>` : ""}
    <span class="portrait-placeholder" aria-hidden="true">${icon("people", 21)}</span>
  </span>`;
}

function currentSquad() {
  const saved = feeds.squad;
  const confirmed = callups().find(item => item.players?.length && item.date >= (feeds.roster.rosterDate ?? ""));
  if (confirmed && (!saved.publishedAt || confirmed.date > saved.publishedAt)) {
    return { ...confirmed, publishedAt: confirmed.date, coach: confirmed.coach ?? saved.coach };
  }
  return saved;
}

function squadPlayers() {
  const squad = currentSquad();
  const { upcoming, recent } = fixtures();
  const matches = [...upcoming, ...recent];
  return (squad.players ?? []).map(player => {
    const withdrawal = squad.withdrawals?.find(item => item.playerId === player.id);
    const match = withdrawal && matches.find(item => item.id === withdrawal.matchId);
    const matchLabel = match ? local(match.opponent) + "戦" : withdrawal?.matchDate ? shortDate(withdrawal.matchDate) + "の試合" : "対象試合";
    return { ...player, callup: player.callup || squad.title, source: player.source ?? squad.source, clubAsOf: squad.publishedAt,
      status: withdrawal ? `${matchLabel}のみ不参加（${withdrawal.reason}）` : player.status, statusSource: withdrawal?.source };
  });
}

function players() {
  const playersById = new Map((feeds.roster.players ?? []).map(player => [player.id, player]));
  for (const player of squadPlayers()) playersById.set(player.id, player);
  for (const player of feeds.clubReports.players ?? []) {
    const existing = playersById.get(player.id);
    if (!existing || (player.clubAsOf && player.clubAsOf >= (currentSquad().publishedAt ?? ""))) {
      playersById.set(player.id, { ...existing, ...player, source: existing?.source ?? player.source });
    }
  }
  const reportedClubs = [...(feeds.clubReports.reports ?? []), ...(feeds.fpl.reports ?? [])].sort(byLatest);
  for (const report of reportedClubs) {
    if (report.type !== "club" || !report.club) continue;
    const existing = playersById.get(report.playerId);
    if (existing?.clubAsOf && existing.clubAsOf > report.date) continue;
    if (!existing && !report.playerName) continue;
    playersById.set(report.playerId, {
      id: report.playerId, name: report.playerName, ...existing, club: report.club, league: report.league,
      clubAsOf: report.date, clubSource: report.archive ?? report.source,
    });
  }
  return [...playersById.values()];
}

function displayedRoster() {
  return rosterSelection === "archive" ? feeds.roster.players ?? [] : squadPlayers();
}

function allReports() {
  const known = players();
  const reports = known.flatMap(player => playerReports(player).map(report => ({
    ...report, playerId: player.id, playerName: player.name,
  })));
  const knownIds = new Set(known.map(player => player.id));
  return [...reports, ...[...(feeds.clubReports.reports ?? []), ...(feeds.healthReports.reports ?? []), ...(feeds.fpl.reports ?? [])]
    .filter(report => !knownIds.has(report.playerId))].sort(byLatest);
}

function matchId(match) {
  return encodeURIComponent(match.id);
}

function findLineup(match) {
  return feeds.lineups.lineups?.find(lineup => lineup.matchId === match.id
    || (lineup.date === match.date && local(lineup.opponent) === local(match.opponent)));
}

function lineupPitch(match, lineup) {
  const lines = [...new Set(lineup.players.map(player => player.line))].sort((a, b) => b - a);
  return `<div class="match-lineup">
    <div class="lineup-title"><h3>先発フォーメーション</h3><strong>${esc(lineup.formation)}</strong></div>
    <div class="lineup-pitch" aria-label="先発選手。ゴールキーパーを下に表示">
      ${lines.map(line => `<div class="lineup-row">
        ${lineup.players.filter(player => player.line === line).sort((a, b) => a.slot - b.slot).map(player => `
          <a class="lineup-player" href="#matches/${matchId(match)}/${encodeURIComponent(player.id)}" aria-label="${esc(player.name)}の選手詳細">
            <span class="shirt-number" aria-hidden="true">${esc(player.number ?? (line === 0 ? "GK" : "•"))}</span>
            <span>${esc(player.name)}</span>
          </a>`).join("")}
      </div>`).join("")}
    </div>
    <p class="lineup-source">${externalLink(lineup.source)}</p>
  </div>`;
}

function rankingPanel() {
  const { rank, previousRank, points, publishedAt, source, archived } = feeds.ranking;
  const valid = Number.isInteger(rank) && rank > 0;
  const change = valid && Number.isInteger(previousRank) ? previousRank - rank : null;
  const changeText = change === null ? "" : change === 0 ? "前回と同じ" : `前回比 ${change > 0 ? "↑" : "↓"} ${Math.abs(change)}位`;
  return `<section class="panel ranking-panel" aria-labelledby="fifa-rank-title">
    <h2 class="panel-kicker" id="fifa-rank-title">${icon("chart", 16)} FIFA 男子世界ランキング</h2>
    ${valid ? `<div class="ranking-value"><strong>${rank}<span>位</span></strong>
      ${changeText ? `<span class="ranking-change ${change > 0 ? "rank-up" : change < 0 ? "rank-down" : ""}">${changeText}</span>` : ""}</div>
      <p>${esc(publishedAt ? dateLabel(publishedAt) + " 発表" : "発表日未確認")}${Number.isFinite(points) ? ` · ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(points)} pt` : ""}</p>
      ${archived ? '<p>保存された発表時点の順位です。</p>' : ""}`
      : "<p class=\"ranking-missing\">順位を確認できていません。</p>"}
    ${externalLink(source ?? sources.fifa)}
  </section>`;
}

function coachPanel() {
  const { coach, previousCoach } = currentSquad();
  if (!coach?.name && !previousCoach?.name) return "";
  return `<section class="panel coach-panel" aria-labelledby="coach-title">
    <h2 class="panel-kicker" id="coach-title">${icon("people", 16)} 代表監督</h2>
    ${[coach, previousCoach].filter(person => person?.name).map(person => `
      <div class="coach-row"><div><span>${esc(person.role ?? "監督")}</span><strong>${esc(person.name)}</strong></div>
        <p>${person.lastMatchDate ? `最終指揮 ${dateLabel(person.lastMatchDate)} ` : person.asOf ? `${dateLabel(person.asOf)}報道 ` : ""}${externalLink(person.source)}</p></div>`).join("")}
  </section>`;
}

function matchForm(score) {
  const result = /^(\d+)\s*[–—:−-]\s*(\d+)$/.exec(score ?? "");
  if (!result) return null;
  const japan = Number(result[1]);
  const other = Number(result[2]);
  return japan > other ? "win" : japan < other ? "loss" : "draw";
}

function matchList(matches) {
  return `<div class="panel match-list">${matches.map(match => `
    <a class="match-item" href="#matches/${matchId(match)}">
      <time class="item-date" datetime="${esc(match.date)}">${shortDate(match.date)}</time>
      <span class="item-opponent">日本 vs ${esc(local(match.opponent))}<small>${esc(local(match.competition))}</small></span>
      <span class="item-score">${esc(match.status === "completed" ? match.score || "結果" : match.time || "詳細")}${icon("arrow", 14)}</span>
    </a>`).join("")}</div>`;
}

function flag(opponent) {
  const code = Object.hasOwn(countryCodes, opponent) ? countryCodes[opponent] : "";
  if (!code) return icon("ball", 24);
  if (code.includes("-")) {
    const tag = code.toLowerCase().replace("-", "");
    return String.fromCodePoint(0x1f3f4, ...Array.from(tag, letter => 0xe0000 + letter.charCodeAt(0)), 0xe007f);
  }
  return String.fromCodePoint(...Array.from(code, letter => letter.charCodeAt(0) + 127397));
}

function featureMatch(match) {
  const upcoming = match?.status === "scheduled";
  return `<aside class="panel next-panel" aria-labelledby="feature-match-title">
      <div class="panel-kicker"><span class="icon-tile">${icon("calendar")}</span>${upcoming ? "NEXT MATCH" : match ? "LATEST RESULT" : "MATCH SCHEDULE"}</div>
      <h2 id="feature-match-title">${upcoming ? "次の試合" : match ? "最新の試合結果" : "次の試合"}</h2>
      <p class="next-date">${match ? dateLabel(match.date) : "アプリで確認できる日程はありません"}</p>
      <div class="matchup">
        <div class="team"><span class="flag flag-japan" aria-hidden="true"></span>日本</div>
        <div class="versus ${match?.score ? "scored" : ""}">${esc(match?.score || "VS")}</div>
        <div class="team"><span class="flag" aria-hidden="true">${flag(match?.opponent)}</span>${esc(match ? local(match.opponent) : "未確認")}</div>
      </div>
      <div class="next-details">
        <span>${icon("ball", 14)}${esc(match ? local(match.competition) : "男子日本代表 Aチーム")}</span>
        <span>${icon(match?.venue ? "pin" : "clock", 14)}${esc(match?.venue || (upcoming && match.time ? match.time + " JST" : match?.source?.label || "公式発表はJFAで確認できます"))}</span>
      </div>
      <a class="panel-link" href="#matches${match ? "/" + matchId(match) : ""}">${match ? "試合詳細を見る" : "試合日程を見る"}${icon("arrow", 16)}</a>
    </aside>`;
}

function story(type, routeName, title, date, fallback) {
  return `<a class="panel story" href="#${routeName}">
    <div class="story-image ${type}" aria-hidden="true"><span class="image-credit">AIイメージ</span></div>
    <div class="story-content">${tag(type)}<h3>${esc(title || fallback)}</h3>
      <div class="story-meta"><span>${date ? shortDate(date) : "情報を確認"} </span>${icon("arrow", 15)}</div>
    </div>
  </a>`;
}

function formChart(matches) {
  const outcomes = {
    win: { title: "勝ち", marker: "勝", count: 0 },
    draw: { title: "引き分け", marker: "分", count: 0 },
    loss: { title: "負け", marker: "負", count: 0 },
  };
  const results = matches.map(match => ({ match, result: matchForm(match.score) })).filter(item => item.result).slice(0, 5);
  for (const item of results) outcomes[item.result].count++;
  const entries = Object.entries(outcomes);
  return `<div class="panel form-panel">
    <div class="panel-kicker">${icon("chart", 17)}試合結果の内訳</div>
    ${results.length ? `<p>直近 ${results.length} 試合 / 左から最新</p>
      <div class="form-bar" aria-hidden="true">${entries.map(([key, item]) => `<span class="${key}" style="flex-grow:${item.count}"></span>`).join("")}</div>
      <div class="form-key">${entries.map(([key, item]) => `<span class="${key}">${item.count} ${item.title}</span>`).join("")}</div>
      <div class="form-matches">${results.map(({ match, result }) => `<a class="${result}" href="#matches/${matchId(match)}" title="${esc(local(match.opponent) + " " + match.score)}" aria-label="${esc(local(match.opponent) + "戦 " + outcomes[result].title + " " + match.score)}">${outcomes[result].marker}</a>`).join("")}</div>`
      : '<p class="form-empty">確認できた試合結果がここに表示されます。</p>'}
  </div>`;
}

function overview() {
  const { upcoming, recent } = fixtures();
  const lineupMatch = recent.find(match => findLineup(match));
  const squad = currentSquad();
  const [latestCallup] = callups();
  const reports = allReports();
  const club = reports.find(item => item.type === "club");
  const medical = reports.find(item => item.type === "injury" || item.type === "return");
  return `<div class="hero-grid">
    <section class="hero">
      <div class="hero-content">
        <span class="eyebrow">男子 A代表</span>
        <h1>サッカー<br>日本代表</h1>
        <p>試合日程、代表招集、所属クラブの活動をひと目で。</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#matches">${icon("calendar")}試合日程</a>
          <a class="button button-ghost" href="#players">${icon("people")}代表選手</a>
        </div>
      </div>
      <span class="image-credit">AI生成イメージ</span>
    </section>
    <div class="hero-side">${featureMatch(upcoming[0] || recent[0])}${rankingPanel()}</div>
  </div>
  <div class="dashboard-grid">
    <section>
      ${sectionHeading("代表の最新情報")}
      <div class="story-grid">
        ${story("callup", "players", squad.title || latestCallup?.title, squad.publishedAt || latestCallup?.date, "日本代表の招集・登録メンバー")}
        ${story("club", "clubs", club ? club.playerName + "｜" + club.title : "", club?.date, "所属クラブでの活動")}
        ${story("health", "health", medical ? medical.playerName + "｜" + medical.title : "", medical?.date, "選手の負傷・復帰見込み")}
      </div>
    </section>
    <div class="stack">
      <section>${sectionHeading("直近の成績", "matches", "全日程")}${formChart(recent)}</section>
      ${coachPanel()}
    </div>
  </div>
  <div class="dashboard-grid">
    <section>${sectionHeading("試合結果", "matches", "一覧を見る")}${recent.length ? matchList(recent.slice(0, 3)) : emptyState("表示できる結果はありません。", sources.schedule)}</section>
    <section>${sectionHeading("フォーメーション")}
      ${lineupMatch ? `<div class="panel featured-lineup">
        <a class="panel-link" href="#matches/${matchId(lineupMatch)}">${shortDate(lineupMatch.date)} vs ${esc(local(lineupMatch.opponent))}${icon("arrow", 15)}</a>
        ${lineupPitch(lineupMatch, findLineup(lineupMatch))}
      </div>` : emptyState("出典で確認できた先発布陣を掲載します。", sources.jfa)}
    </section>
  </div>`;
}

function matchesPage() {
  const { upcoming, recent } = fixtures();
  return `${viewHeading("試合日程・結果", "男子日本代表の今後の試合と、終了した試合の結果を確認できます。")}
  <div class="view-columns">
    <div class="stack">
      <section>${sectionHeading("今後の試合")}${upcoming.length ? matchList(upcoming) : emptyState("このアプリで確認できる今後の試合はありません。", sources.schedule)}</section>
      <section>${sectionHeading("試合結果")}${recent.length ? matchList(recent) : emptyState("結果データを取得できていません。", sources.schedule)}</section>
    </div>
    <section>${sectionHeading("直近の成績")}${formChart(recent)}</section>
  </div>`;
}

function playerCards(query = "", position = "all") {
  const simplify = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s/g, "");
  const key = simplify(query);
  const roster = displayedRoster();
  const visible = roster.filter(player => (position === "all" || player.position === position || player.position?.split("/").includes(position))
    && [player.name, player.latin, player.club].some(field => simplify(field).includes(key)));
  if (!visible.length) return emptyState(roster.length ? "条件に一致する選手がいません。" : "この一覧で確認できる選手情報はありません。", roster.length ? undefined : sources.jfa);
  return `<div class="player-grid">${visible.map(player => `
    <a class="panel player-card" href="#players/${encodeURIComponent(player.id)}">
      ${tag("callup", player.position || "選手")}${Number.isInteger(player.number) ? `<span class="player-number" aria-label="登録番号 ${player.number}">#${player.number}</span>` : ""}
      <div class="player-card-identity">${portraitMarkup(player, portraitFor(player), true)}<div><strong>${esc(player.name)}</strong>
      ${player.latin ? `<small>${esc(player.latin)}</small>` : ""}
      <small>${esc(player.club || "所属情報未確認")}</small>
      ${player.status ? `<small>${esc(player.status)}</small>` : ""}</div></div>
    </a>`).join("")}</div>`;
}

function reportsMarkup(reports) {
  return `<div class="panel report-list">${reports.map(report => `
    <article class="report">
      ${tag(report.type)}<time class="item-date" datetime="${esc(report.date)}">${shortDate(report.date)}</time>
      <h3>${esc(report.playerName ? report.playerName + "｜" + report.title : report.title)}</h3>
      ${report.summary ? `<p>${esc(report.summary)}</p>` : ""}
      ${externalLink(report.source)}
      ${externalLink(report.archive)}
      ${report.source?.archiveUrl ? externalLink({ label: "照合資料", url: report.source.archiveUrl }) : ""}
    </article>`).join("")}</div>`;
}

function playersPage() {
  const bulletins = callups();
  const roster = feeds.roster;
  const squad = currentSquad();
  const archive = rosterSelection === "archive";
  return `${viewHeading("代表選手", "招集発表と登録メンバーを確認できます。選手を開くと、所属クラブや活動の出典を表示します。")}
  <div class="view-columns roster-layout">
    <section class="roster-members">
      ${sectionHeading(archive ? "過去の大会登録メンバー" : "確認できた直近の招集")}
      ${archive && roster.rosterDate ? `<p class="roster-note">${dateLabel(roster.rosterDate)} 時点。${externalLink(roster.officialRosterSource || roster.rosterSource)}</p>` : ""}
      ${!archive && squad.publishedAt ? `<p class="roster-note">${esc(squad.title)} · ${dateLabel(squad.publishedAt)}発表 ${squadPlayers().length}人。${externalLink(squad.officialSource ?? squad.source)} ${squad.officialSource ? externalLink(squad.source) : ""}</p>` : ""}
      <div class="controls">
        <select id="roster-filter" aria-label="招集一覧を選択"><option value="current" ${!archive ? "selected" : ""}>直近の招集</option><option value="archive" ${archive ? "selected" : ""}>2026年W杯の登録</option></select>
        <input type="search" id="player-search" aria-label="選手名またはクラブ名で検索" placeholder="選手名・クラブ名を検索">
        <select id="position-filter" aria-label="ポジションで絞り込む"><option value="all">全ポジション</option>${Object.entries(positionNames).map(([position, name]) => `<option value="${position}">${position} · ${name}</option>`).join("")}${!archive ? '<option value="MF/FW">MF/FW（JFA発表の区分）</option>' : ""}</select>
      </div>
      <div id="player-results" aria-live="polite">${playerCards()}</div>
    </section>
    <div class="stack">
      ${coachPanel()}
      <section class="roster-bulletins">${sectionHeading("招集発表")}${bulletins.length ? reportsMarkup(bulletins.map(item => ({ ...item, type: "callup" }))) : emptyState("最新の招集発表はアプリで未確認です。", sources.jfa)}</section>
      ${displayedRoster().length ? `<section class="roster-pitch">${sectionHeading("ポジション別の人数")}${positionPitch()}</section>` : ""}
    </div>
  </div>`;
}

function positionPitch() {
  const roster = displayedRoster();
  const positions = [...new Set(roster.map(player => player.position))].filter(Boolean);
  return `<div class="panel pitch-panel">
    <p>選ぶと登録メンバーを絞り込めます。</p>
    <div class="pitch">
      ${["FW", "MF", "MF/FW", "DF", "GK"].filter(position => positions.includes(position)).map(position => {
        const count = roster.filter(player => player.position === position).length;
        return `<button class="pitch-position" data-position="${position}" aria-pressed="false" aria-label="${positionNames[position] ?? position} ${count}人"><span>${position}</span><strong>${count}</strong></button>`;
      }).join("")}
    </div>
  </div>`;
}

function clubsPage() {
  const reports = allReports().filter(report => report.type === "club");
  return `${viewHeading("クラブでの活動", "代表登録選手の所属クラブでの出場記録を、確認できたものから掲載します。")}
    <div class="view-columns">
      <section>${sectionHeading("出場・成績レポート")}${reports.length ? reportsMarkup(reports) : emptyState("出典付きの出場記録を取得できていません。")}</section>
      <section>${sectionHeading("選手別の情報")}<div class="panel empty"><p>所属クラブや活動履歴は選手詳細で確認できます。</p><p><a class="source-link" href="#players">代表選手を探す ${icon("arrow", 14)}</a></p></div></section>
    </div>`;
}

function healthResults() {
  const reports = allReports().filter(report => (report.type === "injury" || report.type === "return")
    && (reportFilter === "all" || report.type === reportFilter));
  return reports.length ? reportsMarkup(reports) : emptyState("この条件で確認できた報告はありません。掲載がなくても、選手の状態は判断できません。", sources.jfa);
}

function healthPage() {
  return `${viewHeading("負傷・復帰", "公表された負傷や復帰に関する情報を掲載します。復帰時期は、出典に明記された場合に表示します。")}
    <div class="controls"><select id="health-filter" aria-label="報告の種類で絞り込む">
      <option value="all">すべての報告</option><option value="injury">負傷</option><option value="return">復帰・見込み</option>
    </select></div>
    <p class="roster-note">日付は発表または確認の日付です。復帰見込みは予定で、実戦復帰を確認できた場合は別に表示します。</p>
    <div id="health-results" aria-live="polite">${healthResults()}</div>`;
}

function updateStatus() {
  const officialFeeds = [feeds.jfa.feeds?.schedule, feeds.jfa.feeds?.callups];
  const verified = officialFeeds.every(feed => {
    const ageHours = (Date.now() - Date.parse(feed?.checkedAt)) / 3_600_000;
    return feed?.status === "ok" && ageHours >= 0 && ageHours <= 48;
  });
  statusButton.dataset.fresh = String(verified && !failedFeeds.size);
}

function showDialog(content) {
  dialogContent.innerHTML = content;
  if (!dialog.open) dialog.showModal();
}

function biographySection(player, profile) {
  const biography = feeds.biographies.players?.find(item => item.id === player.id);
  const birthDate = biography?.birthDate ?? profile?.birthDate;
  const debut = biography?.debutDate ? dateLabel(biography.debutDate) : biography?.debutStatus;
  const facts = [
    ["生年月日", birthDate ? dateLabel(birthDate) : ""],
    ["出身地", biography?.birthplace],
    ["出身高校", biography?.highSchool],
    ["A代表デビュー", debut, biography?.debutDetails],
  ];
  if (!debut && biography?.firstRecordedDate) {
    facts.push(["照合できた最初のA代表出場", dateLabel(biography.firstRecordedDate),
      biography.firstRecordedOpponent ? local(biography.firstRecordedOpponent) + "戦" : ""]);
  }
  if (biography?.development) facts.push(["育成年代の所属", biography.development]);
  if (Number.isFinite(profile?.heightCm)) facts.push(["身長", profile.heightCm + " cm"]);
  if (Number.isInteger(profile?.caps)) facts.push(["A代表出場", profile.caps + " 試合"]);
  if (Number.isInteger(profile?.goals)) facts.push(["A代表得点", profile.goals + " 得点"]);
  const citations = [...new Map([...(biography?.sources ?? []), profile?.source].filter(Boolean).map(source => [source.url, source])).values()];
  const record = (title, items) => `<div><h4>${title}</h4>${items?.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : '<p>確認できた資料なし</p>'}</div>`;
  return `<section class="dialog-section biography" aria-label="プロフィール">
    <h3>プロフィール</h3>
    <dl class="player-facts">${facts.map(([label, value, detail]) => `<div><dt>${label}</dt>
      <dd${value ? "" : ' class="bio-unverified"'}>${esc(value || "資料未確認")}${detail ? `<small>${esc(detail)}</small>` : ""}</dd></div>`).join("")}</dl>
    <div class="bio-records">${record("大会・チーム実績", biography?.honours)}${record("個人受賞歴", biography?.awards)}</div>
    ${citations.length ? `<div class="bio-sources"><h4>プロフィールの出典</h4><ul>${citations.map(source => `<li>${externalLink(source)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}

function showPlayerDetails(player, context) {
  const profile = feeds.profiles.profiles?.find(item => item.id === player.id);
  const portrait = portraitFor(player);
  const reports = playerReports(player);
  const clubReports = reports.filter(report => report.type === "club");
  const medicalReports = reports.filter(report => report.type === "injury" || report.type === "return");
  showDialog(`<div class="player-detail-identity">${portraitMarkup(player, portrait)}
    <div><h2 id="dialog-title">${esc(player.name)}</h2>
      ${player.latin ? `<p>${esc(player.latin)}</p>` : ""}
      <p>${esc([positionNames[player.position] ?? player.position, player.club, player.league].filter(Boolean).join(" · "))}</p>
      ${player.clubAsOf ? `<p>所属確認 ${dateLabel(player.clubAsOf)} ${externalLink(player.clubSource)}</p>` : ""}
      ${player.callup ? `<p>${esc(player.callup)}</p>` : ""}
      ${player.status ? `<p>${esc(player.status)} ${externalLink(player.statusSource)}</p>` : ""}
      ${player.source ? `<p>${externalLink(player.source)}</p>` : ""}</div></div>
    ${portrait ? `<p class="portrait-credit">写真 ${esc(portrait.attribution)} · ${externalLink(portrait.source)} · ${externalLink({ label: portrait.license, url: portrait.licenseUrl })}</p>` : '<p class="portrait-credit">確認できた写真はありません。</p>'}
    ${context ? `<div class="dialog-section lineup-context"><h3>日本 vs ${esc(local(context.match.opponent))} の先発</h3>
      <p>${esc(dateLabel(context.match.date))}${context.participant.number ? ` · 背番号 ${esc(context.participant.number)}` : ""}${context.participant.role ? ` · ${esc(context.participant.role)}` : ""}</p>
      <p>${externalLink(context.lineup.source)}</p>
      <a class="panel-link" href="#matches/${matchId(context.match)}">フォーメーションに戻る ${icon("arrow", 14)}</a></div>` : ""}
    ${biographySection(player, profile)}
    <div class="dialog-section"><h3>クラブ活動</h3>${clubReports.length ? reportsMarkup(clubReports) : "<p>掲載できるクラブ活動の報告はありません。</p>"}</div>
    <div class="dialog-section"><h3>負傷・復帰</h3>${medicalReports.length ? reportsMarkup(medicalReports) : "<p>掲載できる負傷・復帰の報告はありません。</p>"}</div>`);
}

function showDetails(page, id, participantId) {
  if (page === "matches") {
    const { upcoming, recent } = fixtures();
    const match = [...upcoming, ...recent].find(item => item.id === id);
    if (!match) return false;
    const lineup = findLineup(match);
    const participant = lineup?.players.find(player => player.id === participantId);
    if (participant) {
      showPlayerDetails(players().find(player => player.id === participantId) ?? participant, { match, lineup, participant });
      return true;
    }
    showDialog(`<h2 id="dialog-title">日本 vs ${esc(local(match.opponent))}</h2>
      <p>${dateLabel(match.date)}${match.time ? " · " + esc(match.time) + " JST" : ""}</p>
      <p>${esc([local(match.competition), match.venue].filter(Boolean).join(" · "))}</p>
      ${match.score ? `<p class="dialog-score">${esc(match.score)}</p>` : ""}
      <p class="dialog-section">${externalLink(match.source)}</p>
      <div class="dialog-section">${lineup ? lineupPitch(match, lineup) : "<p>先発フォーメーションを確認できていません。</p>"}</div>`);
    return true;
  }
  if (page === "players") {
    const player = players().find(item => item.id === id);
    if (!player) return false;
    showPlayerDetails(player);
    return true;
  }
  return false;
}

function render({ fromNavigation = false } = {}) {
  const [page, id, participantId] = route();
  const previous = shownPage;
  const search = document.querySelector("#player-search")?.value ?? "";
  const pos = document.querySelector("#position-filter")?.value ?? "all";
  if (page !== previous || !fromNavigation) {
    const views = { overview, matches: matchesPage, players: playersPage, clubs: clubsPage, health: healthPage };
    main.innerHTML = views[page]();
    main.setAttribute("aria-busy", "false");
    if (previous === page && page === "players") {
      document.querySelector("#player-search").value = search;
      const positionFilter = document.querySelector("#position-filter");
      positionFilter.value = [...positionFilter.options].some(option => option.value === pos) ? pos : "all";
      filterPlayers();
    }
    if (page === "health") document.querySelector("#health-filter").value = reportFilter;
    for (const link of document.querySelectorAll("[data-tab]")) {
      if (link.dataset.tab === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    shownPage = page;
    if (fromNavigation) {
      window.scrollTo(0, 0);
      if (!id) main.focus({ preventScroll: true });
    }
  }
  if (id && showDetails(page, id, participantId)) {
    if (fromNavigation) {
      dialog.scrollTop = 0;
      dialog.querySelector(".close-button").focus();
    }
    return;
  }
  if (dialog.open && dialog.dataset.kind === "detail") dialog.close();
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await Promise.all(Object.entries(feedFiles).map(async ([key, file]) => {
      try {
        const response = await fetch(`./data/${file}.json`, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid data");
        feeds[key] = { ...blank, ...payload };
        failedFeeds.delete(key);
      } catch {
        failedFeeds.add(key);
      }
    }));
    updateStatus();
    render();
    if (dialog.open && dialog.dataset.kind === "status") statusDetails();
  } finally {
    refreshing = false;
  }
}

function statusDetails() {
  dialog.dataset.kind = "status";
  const labels = { jfa: "試合・招集の取得処理", squad: "直近の招集名簿", biographies: "選手プロフィール", clubReports: "出典付きクラブ記録", healthReports: "出典付き負傷・復帰情報", clubs: "クラブ・負傷の自動取得", ranking: "FIFA ランキング", lineups: "フォーメーション", portraits: "選手写真" };
  const rows = Object.entries(labels).map(([key, label]) => {
    const when = key === "roster" && feeds.roster.rosterDate ? dateLabel(feeds.roster.rosterDate) + " 時点" : timeLabel(feeds[key].checkedAt);
    const coverage = key === "clubs" && feeds.clubs.coverage;
    const countLabel = coverage ? `（${esc(coverage.checked)} / ${esc(coverage.total)} 人を確認）` : "";
    return `<li><strong>${label}</strong>　${when}${countLabel}${failedFeeds.has(key) ? "（読み込み失敗）" : ""}</li>`;
  });
  const officialFeeds = { schedule: "JFA 試合日程", callups: "JFA 招集発表", results: "公開試合結果" };
  const sourceRows = Object.entries(officialFeeds).map(([key, label]) => {
    const feed = feeds.jfa.feeds?.[key];
    return `<li><strong>${label}</strong>　${timeLabel(feed?.checkedAt)}${feed?.status === "unavailable" ? "（直近の取得は失敗）" : ""}</li>`;
  });
  showDialog(`<h2 id="dialog-title">データの更新情報</h2>
    <ul>${rows.join("")}${sourceRows.join("")}</ul>
    <p>情報ごとに出典と発表日を表示します。更新時刻はデータを確認した日時です。</p>
    <p class="dialog-section">${externalLink(sources.jfa)}</p>
    ${window.samuraiLocal ? `<div class="dialog-section local-update">
      <button class="button button-primary" type="button" id="refresh-local" ${localUpdateRunning ? "disabled" : ""}>今すぐ取得</button>
      <p role="status">${esc(localUpdateMessage)}</p></div>` : ""}`);
}

dialog.addEventListener("click", async event => {
  if (event.target.id !== "refresh-local" || localUpdateRunning) return;
  const updateMessage = message => {
    localUpdateMessage = message;
    if (!dialog.open || dialog.dataset.kind !== "status") return;
    const button = document.querySelector("#refresh-local");
    button.disabled = localUpdateRunning;
    button.nextElementSibling.textContent = message;
  };
  localUpdateRunning = true;
  updateMessage("出典を確認しています…");
  try {
    const request = await fetch("./__local/refresh", {
      method: "POST",
      headers: { "X-Samurai-Local": "1" },
    });
    if (!request.ok) throw new Error("Update request failed");
    let state;
    do {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await fetch("./__local/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Update status unavailable");
      ({ state } = await response.json());
    } while (state === "running");
    await refresh();
    localUpdateRunning = false;
    updateMessage(state === "finished" ? "取得処理が完了しました。出典ごとの結果は上の一覧で確認できます。" : "一部の更新処理が完了しませんでした。保存済みのデータを表示しています。");
  } catch {
    localUpdateRunning = false;
    updateMessage("更新処理の状態を確認できませんでした。");
  }
});

window.addEventListener("hashchange", () => {
  dialog.dataset.kind = "detail";
  render({ fromNavigation: true });
});
function filterPlayers() {
  const query = document.querySelector("#player-search").value;
  const position = document.querySelector("#position-filter").value;
  document.querySelector("#player-results").innerHTML = playerCards(query, position);
  for (const button of main.querySelectorAll(".pitch-position")) {
    button.setAttribute("aria-pressed", String(button.dataset.position === position));
  }
}
main.addEventListener("input", event => {
  if (event.target.id === "player-search" || event.target.id === "position-filter") filterPlayers();
});
main.addEventListener("click", event => {
  const button = event.target.closest(".pitch-position");
  if (!button) return;
  document.querySelector("#position-filter").value = button.getAttribute("aria-pressed") === "true" ? "all" : button.dataset.position;
  filterPlayers();
});
main.addEventListener("change", event => {
  if (event.target.id === "roster-filter") {
    rosterSelection = event.target.value;
    render();
    document.querySelector("#roster-filter").focus();
    return;
  }
  if (event.target.id !== "health-filter") return;
  reportFilter = event.target.value;
  document.querySelector("#health-results").innerHTML = healthResults();
});
statusButton.addEventListener("click", statusDetails);
document.addEventListener("error", event => {
  if (event.target.matches?.(".portrait-frame img")) event.target.hidden = true;
}, true);
function resetDetailRoute() {
  const [page, id] = route();
  if (dialog.dataset.kind === "detail" && id) history.replaceState(null, "", `#${page}`);
}
dialog.querySelector('form[method="dialog"]').addEventListener("submit", resetDetailRoute);
dialog.addEventListener("cancel", resetDetailRoute);
dialog.addEventListener("close", resetDetailRoute);
dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      resetDetailRoute();
      dialog.close();
    }
  }
});
dialog.dataset.kind = "detail";
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 15 * 60 * 1000);

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
