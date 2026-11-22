#!/usr/bin/env python3
"""Refresh team, season totals, and explicit injury reports from official FPL data."""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from time import monotonic
from tempfile import NamedTemporaryFile
import unicodedata
from urllib.error import URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = {
    "label": "プレミアリーグ公式FPLデータ",
    "url": "https://fantasy.premierleague.com/api/bootstrap-static/",
}
LEAGUE = "プレミアリーグ"
JST = ZoneInfo("Asia/Tokyo")
MAX_BYTES = 8 * 1024 * 1024
INJURY = re.compile(r"\b(?:injur(?:y|ies|ed)|fracture|concussion|surgery|knock|sprain|strain)\b", re.I)

# Stable FPL player codes from the pinned 2026/27 Premier League mirror.
# https://github.com/vaastav/Fantasy-Premier-League/blob/d7b05b51d137bfefef4b692386d18c610975b9b9/data/2026-27/players_raw.csv
VERIFIED_CODES = {
    "ao-tanaka": 248056,
    "daichi-kamada": 209400,
    "daizen-maeda": 442967,
    "hidemasa-morita": 445028,
    "kaoru-mitoma": 451340,
    "takehiro-tomiyasu": 223723,
    "tatsuhiro-sakamoto": 501459,
    "zion-suzuki": 433969,
}
TRACKED = [
    {"id": "kaoru-mitoma", "name": "三笘 薫", "latin": "Kaoru Mitoma"},
    {"id": "hidemasa-morita", "name": "守田 英正", "latin": "Hidemasa Morita"},
]
TEAMS = {
    "Aston Villa": "アストン・ヴィラ", "Brighton": "ブライトン", "Brentford": "ブレントフォード",
    "Burnley": "バーンリー", "Arsenal": "アーセナル", "Chelsea": "チェルシー",
    "Coventry": "コベントリー・シティ", "Crystal Palace": "クリスタル・パレス",
    "Everton": "エヴァートン", "Fulham": "フラム", "Hull": "ハル・シティ",
    "Ipswich Town": "イプスウィッチ・タウン", "Leeds": "リーズ・ユナイテッド",
    "Liverpool": "リバプール", "Man City": "マンチェスター・シティ",
    "Man Utd": "マンチェスター・ユナイテッド", "Newcastle": "ニューカッスル・ユナイテッド",
    "Nott'm Forest": "ノッティンガム・フォレスト", "Spurs": "トッテナム",
    "Sunderland": "サンダーランド", "West Ham": "ウェストハム", "Wolves": "ウルヴァーハンプトン",
}


class FplError(Exception):
    pass


def name_key(value):
    letters = unicodedata.normalize("NFKD", value.casefold())
    return "".join(letter for letter in letters if letter.isalnum())


def get_fpl():
    request = Request(SOURCE["url"], headers={"User-Agent": "SamuraiWatch/1.0", "Accept": "application/json"})
    deadline = monotonic() + 12
    content = bytearray()
    with urlopen(request, timeout=7) as response:
        if response.geturl() != SOURCE["url"]:
            raise FplError("FPL returned an unexpected redirect.")
        while monotonic() < deadline and len(content) <= MAX_BYTES:
            chunk = response.read(64 * 1024)
            if not chunk:
                return json.loads(content)
            content.extend(chunk)
    raise FplError("FPL response exceeded the time or size limit.")


def player_pool():
    selected = {row["id"]: row for row in TRACKED}
    for filename in ("players.json", "current-squad.json"):
        path = ROOT / "data" / filename
        if path.exists():
            roster = json.loads(path.read_text(encoding="utf-8"))
            selected.update({row["id"]: row for row in roster["players"] if row.get("latin")})
    return list(selected.values())


def matching_player(elements, player):
    code = player.get("fplCode", VERIFIED_CODES.get(player["id"]))
    if code is not None:
        matches = [row for row in elements if row["code"] == code]
    else:
        name = name_key(player["latin"])
        matches = [row for row in elements if name in {
            name_key(row["first_name"] + row["second_name"]),
            name_key(row["second_name"] + row["first_name"]),
        }]
    return matches[0] if len(matches) == 1 else None


def season_name(events):
    first_deadline = min(row["deadline_time"] for row in events)
    year = datetime.fromisoformat(first_deadline.replace("Z", "+00:00")).year
    return f"{year}/{(year + 1) % 100:02d}"


def reports_from(data, players, checked_at):
    teams = {row["id"]: row["name"] for row in data["teams"]}
    elements = [row for row in data["elements"] if row["status"] not in {"n", "u"}]
    if not teams or not elements or not data["events"]:
        raise FplError("FPL did not return usable team, player, or season data.")

    day = checked_at.astimezone(JST).date().isoformat()
    season = season_name(data["events"])
    reports = []
    for player in players:
        match = matching_player(elements, player)
        if not match:
            continue
        raw_club = teams[match["team"]]
        club = TEAMS.get(raw_club, raw_club)
        minutes, goals, assists = (match[field] for field in ("minutes", "goals_scored", "assists"))
        if any(type(value) is not int or value < 0 for value in (minutes, goals, assists)):
            raise FplError("FPL returned an invalid numeric player statistic.")
        base = {
            "playerId": player["id"], "playerName": player["name"], "date": day, "club": club,
            "clubAsOf": day, "league": LEAGUE, "source": SOURCE,
        }
        reports.append({
            **base, "type": "club", "scope": "season", "title": f"{season} {LEAGUE}の累計",
            "summary": f"{club}でリーグ戦{minutes}分出場、{goals}得点、{assists}アシスト。",
            "minutes": minutes, "goals": goals, "assists": assists,
        })
        news = match.get("news", "").strip()
        if match["status"] in {"i", "d"} and INJURY.search(news):
            reports.append({
                **base, "type": "injury", "title": "公式FPLに負傷情報",
                "summary": f"FPL掲載の原文は「{news}」です。",
            })
    if not reports:
        raise FplError("No selected Japan players could be verified in FPL.")
    return reports


def save(data, path):
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    try:
        players = player_pool()
        checked_at = datetime.now(timezone.utc)
        reports = reports_from(get_fpl(), players, checked_at)
        save({"checkedAt": checked_at.isoformat(timespec="seconds"), "reports": reports}, ROOT / "data/fpl.json")
        print(f"FPL refreshed. Matched {len({report['playerId'] for report in reports})} players.")
        return 0
    except (FplError, URLError, OSError, KeyError, TypeError, ValueError) as exc:
        print(f"FPL refresh failed. Previous FPL data was preserved. {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
