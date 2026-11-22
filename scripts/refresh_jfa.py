#!/usr/bin/env python3
"""Refresh Japan men's full international results and JFA announcements."""

import argparse
import csv
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from io import StringIO
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

JFA = "https://www.jfa.jp"
SCHEDULE = f"{JFA}/samuraiblue/schedule_result/"
NEWS = f"{JFA}/samuraiblue/news/"
RESULTS = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
RESULTS_SOURCE = {
    "label": "International football results（公開データ）",
    "url": "https://github.com/martj42/international_results/blob/master/results.csv",
}
DATA = Path(__file__).resolve().parents[1] / "data" / "jfa.json"
COUNTRIES = {
    "Australia": "オーストラリア",
    "Bahrain": "バーレーン",
    "Bolivia": "ボリビア",
    "Brazil": "ブラジル",
    "China PR": "中国",
    "Ecuador": "エクアドル",
    "England": "イングランド",
    "Ghana": "ガーナ",
    "Iceland": "アイスランド",
    "Indonesia": "インドネシア",
    "Mexico": "メキシコ",
    "Netherlands": "オランダ",
    "New Zealand": "ニュージーランド",
    "Paraguay": "パラグアイ",
    "Saudi Arabia": "サウジアラビア",
    "Scotland": "スコットランド",
    "South Korea": "韓国",
    "Sweden": "スウェーデン",
    "Tunisia": "チュニジア",
    "United States": "アメリカ",
    "Venezuela": "ベネズエラ",
}
TOURNAMENTS = {
    "EAFF Championship": "EAFF E-1 サッカー選手権",
    "FIFA World Cup": "FIFAワールドカップ",
    "FIFA World Cup qualification": "FIFAワールドカップ予選",
    "Friendly": "国際親善試合",
    "Kirin Cup": "キリンカップ",
    "The Kallang Football Series": "The Kallang Football Series",
}
JFA_ARTICLE = re.compile(r"^/(?:[^/]+/)*news/(?:\d+/)*\d+/?$")
CALLUP = re.compile(r"メンバー|招集|選手変更|不参加|離脱")
FULL_DATE = re.compile(r"(?<!\d)(20\d{2})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})(?!\d)")
SHORT_DATE = re.compile(r"(?<!\d)(\d{1,2})\s*[/月]\s*(\d{1,2})(?!\d)")
TIME = re.compile(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)")
SCORE = re.compile(r"^[○〇△●×◯\s]*(\d{1,2})\s*[-–−－]\s*(\d{1,2})(?!\d)")


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def find(self, *tags):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag in tags:
                    yield child
                yield from child.find(*tags)

    def text(self):
        parts = (child.text() if isinstance(child, Node) else child for child in self.children)
        return normalize(" ".join(parts))


class Document(HTMLParser):
    void_tags = frozenset("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node("")
        self.stack = [self.root]
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in self.void_tags:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, dict(attrs)))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if self.stack[-1].tag not in {"script", "style"}:
            self.stack[-1].children.append(data)


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def fetch(url):
    request = Request(url, headers={"User-Agent": "JapanSeniorTeamUpdates/1.0 (public match and announcement index)"})
    with urlopen(request, timeout=12) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8-sig")


def parse_date(text, year=None):
    match = FULL_DATE.search(text)
    if match:
        parts = tuple(map(int, match.groups()))
    elif year and (match := SHORT_DATE.search(text)):
        parts = (year, *map(int, match.groups()))
    else:
        return None
    try:
        return date(*parts)
    except ValueError:
        return None


def official_url(base, href):
    url = urljoin(base, href or "")
    parts = urlsplit(url)
    if parts.scheme == "https" and parts.netloc == "www.jfa.jp":
        return parts._replace(fragment="").geturl()
    return None


def read_callups(html, today):
    root = Document(html).root
    # Search smallest containers first, so a timestamp cannot leak to another headline.
    ancestors = list(root.find("a", "li", "article", "div", "tr", "section"))
    callups = {}
    for node in reversed(ancestors):
        own_links = [node] if node.tag == "a" else node.find("a")
        article_links = {}
        for link in own_links:
            url = official_url(NEWS, link.attrs.get("href"))
            if url and JFA_ARTICLE.fullmatch(urlsplit(url).path):
                article_links[url] = link
        if len(article_links) != 1:
            continue
        url, link = next(iter(article_links.items()))
        if url in callups:
            continue
        title = link.text()
        if title.startswith(("20", "２０")):
            title = FULL_DATE.sub("", title, count=1).lstrip(" 日-/｜|")
        date_posted = parse_date(node.text())
        if not date_posted:
            for time in node.find("time"):
                date_posted = parse_date(time.attrs.get("datetime", ""))
                if date_posted:
                    break
        if not date_posted or not today - timedelta(days=365) <= date_posted <= today:
            continue
        if not CALLUP.search(title) or len(title) < 9:
            continue
        if re.search(r"なでしこ|フットサル|ビーチサッカー|U-\d{2}", title, re.IGNORECASE):
            continue
        callups[url] = {
            "id": f"jfa-news-{urlsplit(url).path.rstrip('/').split('/')[-1]}",
            "date": date_posted.isoformat(),
            "title": title,
            "source": {"label": "JFA 招集発表", "url": url},
        }
    if not callups:
        raise ValueError("JFAの招集関連見出しを確認できませんでした")
    return list(callups.values())


def field_index(headers, terms):
    return next((index for index, heading in enumerate(headers) if any(term in heading for term in terms)), None)


def parse_schedule_table(table, url, year, today):
    columns = {}
    fixtures = []
    for row in table.find("tr"):
        cells = [cell for cell in row.children if isinstance(cell, Node) and cell.tag in {"th", "td"}]
        if len(cells) < 2:
            continue
        values = [cell.text() for cell in cells]
        opponent_column = field_index(values, ("対戦相手", "対戦チーム", "対戦カード"))
        if opponent_column is not None:
            columns = {
                "opponent": opponent_column,
                "competition": field_index(values, ("大会名", "大会", "試合名")),
                "date": field_index(values, ("日程", "開催日", "日時", "試合日", "月日")),
                "time": field_index(values, ("時間", "キックオフ", "KO")),
                "venue": field_index(values, ("会場", "開催地", "場所")),
                "result": field_index(values, ("結果", "スコア")),
            }
            continue

        def cell(key):
            index = columns.get(key)
            return cells[index] if index is not None and index < len(cells) else Node("")

        date_cell = cell("date").text() or values[0]
        match_date = parse_date(date_cell, year)
        if not match_date or not today - timedelta(days=365) <= match_date <= today + timedelta(days=550):
            continue

        opponent_cell = cell("opponent")
        opponent = opponent_cell.text()
        if not opponent:
            # Older schedules may mark opponents with "vs" or the national-team suffix.
            opponent = next((value for value in values[1:] if re.match(r"^(?:vs\.?\s+|[^ /]{2,24}代表$)", value, re.I)), "")
        opponent = re.sub(r"^(?:SAMURAI BLUE|日本代表|日本)?\s*(?:vs\.?|対)\s*", "", opponent, flags=re.I)
        opponent = re.sub(r"\s*代表$", "", opponent).strip()
        if not opponent or len(opponent) > 45 or opponent in {"日本", "未定", "調整中", "-", "TBD"}:
            continue

        score = SCORE.match(cell("result").text())
        time = TIME.search(cell("time").text() or date_cell)
        # A past date without an official score may be a tournament span or a postponed match.
        if not score and (match_date < today or re.search(r"中止|延期", " ".join(values))):
            continue

        link = next(opponent_cell.find("a"), None)
        source_url = official_url(url, link.attrs.get("href")) if link else None
        entry = {
            "id": f"jfa-match-{match_date}-{opponent}",
            "date": match_date.isoformat(),
            "opponent": opponent,
            "competition": cell("competition").text() or "日本代表戦",
            "status": "completed" if score else "scheduled",
            "source": {"label": "JFA 試合日程・結果", "url": source_url or url},
        }
        if score:
            entry["score"] = f"{score[1]}–{score[2]}"
        if time:
            entry["time"] = f"{int(time[1]):02}:{time[2]}"
        venue = cell("venue").text()
        if venue and venue not in {"-", "未定"}:
            entry["venue"] = venue
        fixtures.append(entry)
    return fixtures


def read_schedule(html, url, year, today):
    fixtures = []
    for table in Document(html).root.find("table"):
        fixtures.extend(parse_schedule_table(table, url, year, today))
    return fixtures


def fetch_schedule(today):
    root = fetch(SCHEDULE)
    fixtures = read_schedule(root, SCHEDULE, today.year, today)
    urls = {}
    for link in Document(root).root.find("a"):
        url = official_url(SCHEDULE, link.attrs.get("href"))
        if not url:
            continue
        match = re.fullmatch(r"/samuraiblue/schedule_result/(20\d{2})(?:\.html|/)?", urlsplit(url).path)
        if match:
            year = int(match[1])
            if year in {today.year, today.year + 1}:
                urls[url] = year
    for url, year in urls.items():
        try:
            fixtures.extend(read_schedule(fetch(url), url, year, today))
        except (OSError, ValueError) as error:
            print(f"JFA 年別日程 {year}: {error}", file=sys.stderr)
    if not fixtures:
        raise ValueError("JFAの日程表から試合行を確認できませんでした")
    return fixtures


def read_results(csv_text, today):
    rows = csv.DictReader(StringIO(csv_text))
    required = {"date", "home_team", "away_team", "home_score", "away_score", "tournament", "city", "country"}
    if not required <= set(rows.fieldnames or []):
        raise ValueError("公開試合結果の列構成が変わりました")
    matches = []
    for row in rows:
        if "Japan" not in {row["home_team"], row["away_team"]}:
            continue
        match_date = date.fromisoformat(row["date"])
        if not today - timedelta(days=550) <= match_date <= today:
            continue
        japan_home = row["home_team"] == "Japan"
        japan_score = row["home_score"] if japan_home else row["away_score"]
        opponent_score = row["away_score"] if japan_home else row["home_score"]
        if not japan_score.isdecimal() or not opponent_score.isdecimal():
            continue
        opponent = row["away_team"] if japan_home else row["home_team"]
        matches.append({
            "id": f"result-{match_date}-{opponent.lower().replace(' ', '-')}",
            "date": match_date.isoformat(),
            "opponent": COUNTRIES.get(opponent, opponent),
            "competition": TOURNAMENTS.get(row["tournament"], row["tournament"]),
            "venue": " / ".join(part for part in (row["city"], row["country"]) if part),
            "status": "completed",
            "score": f"{japan_score}–{opponent_score}",
            "source": RESULTS_SOURCE,
        })
    if not matches:
        raise ValueError("公開データに日本代表の最近の試合結果がありません")
    return matches


def collect(name, reader, previous, now):
    try:
        return reader(), {"status": "ok", "checkedAt": now}
    except (OSError, ValueError) as error:
        print(f"{name}: {error}", file=sys.stderr)
        return None, {"status": "unavailable", "checkedAt": previous.get("checkedAt")}


def prioritized_fixtures(previous, official, results, today):
    # Reuse previous successful snapshots on feed errors and keep earlier international results.
    recent = today - timedelta(days=550)
    records = {item["id"]: item for item in previous if item["date"] >= recent.isoformat()}
    if results is not None:
        records = {key: item for key, item in records.items() if not key.startswith("result-")}
    for item in (official or []) + (results or []):
        records[item["id"]] = item
    if official is not None:
        active_ids = {item["id"] for item in official}
        records = {
            key: item for key, item in records.items()
            if item["status"] != "scheduled" or key in active_ids
        }
    by_match = {}
    for item in records.values():
        key = item["date"], item["opponent"]
        rank = 2 * (item["status"] == "completed") + item["id"].startswith("jfa-")
        if key not in by_match or rank >= by_match[key][0]:
            by_match[key] = rank, item
    return sorted((item for _, item in by_match.values()), key=lambda item: (item["date"], item["id"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DATA)
    args = parser.parse_args()
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    now = datetime.now(timezone.utc)
    today = now.astimezone(timezone(timedelta(hours=9), "JST")).date()
    checked = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    prior_feeds = previous.get("feeds", {})
    with ThreadPoolExecutor(max_workers=3) as executor:
        sources = {
            "schedule": ("JFA 日程", lambda: fetch_schedule(today)),
            "callups": ("JFA 招集", lambda: read_callups(fetch(NEWS), today)),
            "results": ("公開試合結果", lambda: read_results(fetch(RESULTS), today)),
        }
        tasks = {
            key: executor.submit(collect, name, reader, prior_feeds.get(key, {}), checked)
            for key, (name, reader) in sources.items()
        }
        official, schedule_status = tasks["schedule"].result()
        callups, callups_status = tasks["callups"].result()
        results, results_status = tasks["results"].result()
    if official is None and callups is None and results is None:
        raise SystemExit("全てのソースで取得に失敗しました。既存のデータは保持されます。")
    announcements = {
        item["id"]: item
        for item in previous.get("callups", []) + (callups or [])
        if item["date"] >= (today - timedelta(days=365)).isoformat()
    }
    payload = {
        "checkedAt": checked,
        "feeds": {"schedule": schedule_status, "callups": callups_status, "results": results_status},
        "fixtures": prioritized_fixtures(previous.get("fixtures", []), official, results, today),
        "callups": sorted(announcements.values(), key=lambda item: (item["date"], item["id"]), reverse=True),
    }
    if (
        (previous.get("checkedAt") or "")[:10] == checked[:10]
        and all(prior_feeds.get(key, {}).get("status") == status["status"] for key, status in payload["feeds"].items())
        and previous.get("fixtures") == payload["fixtures"]
        and previous.get("callups") == payload["callups"]
    ):
        print("同日の取得結果と同じ内容のため、既存のデータを保持します。")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(f"{len(payload['fixtures'])} fixtures, {len(payload['callups'])} call-up announcements")


if __name__ == "__main__":
    main()
