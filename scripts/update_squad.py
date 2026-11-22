#!/usr/bin/env python3
"""Refresh the Japan men's call-up snapshot from the public JFA announcement archive."""

import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

REPOSITORY = "issakatou2-bit/sports-notify-mvp"
ARCHIVE = f"https://raw.githubusercontent.com/{REPOSITORY}/main/data"
SQUAD_FILE = "soccer_national_squad.json"
FIXTURES_FILE = "soccer_national_fixtures.json"
SQUAD_SOURCE = {
    "label": "JFA発表を記録した公開データ",
    "url": f"https://github.com/{REPOSITORY}/blob/main/data/{SQUAD_FILE}",
}
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "current-squad.json"
JST = timezone(timedelta(hours=9))
POSITIONS = {"GK", "DF", "MF", "FW", "MF/FW"}
MAX_RESPONSE = 1024 * 1024


def fetch_archive(filename):
    request = Request(
        f"{ARCHIVE}/{filename}",
        headers={"User-Agent": "SamuraiWatch/1.0", "Accept": "application/json"},
    )
    with urlopen(request, timeout=12) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("招集資料のサイズが想定を超えました")
    return json.loads(raw)


def source_text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        raise ValueError("招集資料の必須項目が欠けています")
    if re.search(r"[<>\x00-\x1f]", value):
        raise ValueError("招集資料の文字列に不正な形式があります")
    return value.strip()


def jfa_announcement(url):
    parts = urlsplit(source_text(url))
    if (
        parts.scheme != "https"
        or parts.netloc not in {"www.jfa.jp", "jfa.jp"}
        or not re.fullmatch(r"/(?:samuraiblue|national_team_20\d{2})/news/\d{8}/?", parts.path)
        or parts.query
        or parts.fragment
    ):
        raise ValueError("登録資料にJFA発表への参照がありません")
    return url


def published_date(value):
    stamp = datetime.fromisoformat(value)
    if stamp.tzinfo is None:
        raise ValueError("招集資料の日付にタイムゾーンがありません")
    return stamp.astimezone(JST).date()


def person_key(value):
    return "".join(unicodedata.normalize("NFKC", value).split())


def slug(value):
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    result = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    if not result:
        raise ValueError("招集資料の選手IDが生成できません")
    return result


def read_players(rows, previous_players):
    if not isinstance(rows, list) or not 15 <= len(rows) <= 40:
        raise ValueError("招集資料の選手数が想定範囲外です")
    old_players = {person_key(player["name"]): player for player in previous_players}
    clubs = {player["club"]: player["clubLatin"] for player in previous_players if player.get("clubLatin")}
    # Keep established player IDs and Japanese name spacing across newer call-ups.
    players = []
    for row in rows:
        name = source_text(row["name_jp"])
        latin = source_text(row["name_en"])
        club = source_text(row["club"])
        position = source_text(row["position"])
        if position not in POSITIONS:
            raise ValueError(f"招集資料に未知のポジションがあります ({position})")
        prior = old_players.get(person_key(name), {})
        player = {
            "id": prior["id"] if prior else slug(latin),
            "name": prior["name"] if prior else name,
            "latin": latin,
            "position": position,
            "club": club,
        }
        if club in clubs:
            player["clubLatin"] = clubs[club]
        players.append(player)
    if (
        len({player["id"] for player in players}) != len(players)
        or len({person_key(player["name"]) for player in players}) != len(players)
    ):
        raise ValueError("招集資料に重複した選手がいます")
    return players


def read_withdrawals(rows, players, previous, publication, official_url, today, load_archive):
    if not isinstance(rows, list) or len(rows) > len(players):
        raise ValueError("選手不参加の資料形式が正しくありません")
    if not rows:
        return previous
    player_ids = {player["latin"]: player["id"] for player in players}
    fixtures = load_archive(FIXTURES_FILE)
    if jfa_announcement(fixtures["source_url"]) != official_url:
        raise ValueError("不参加情報と試合資料が同じ招集発表を参照していません")
    match_dates = {
        row["key"]: published_date(row["kickoff_jst"]) for row in fixtures["matches"]
    }
    entries = {(entry["playerId"], entry["matchId"]): entry for entry in previous}
    for row in rows:
        player_id = player_ids[row["name_en"]]
        opponent = row["match_key"]
        if slug(opponent) != opponent:
            raise ValueError("不参加の対象試合を特定できません")
        match_date = match_dates[opponent]
        announced = date.fromisoformat(row["announced_on"])
        if not publication <= announced <= min(match_date, today):
            raise ValueError("不参加情報の発表日が対象期間外です")
        match_id = f"result-{match_date}-{opponent}"
        entry = {
            "playerId": player_id,
            "matchId": match_id,
            "date": announced.isoformat(),
            "reason": source_text(row["reason"]),
            "source": {"label": "JFA 選手不参加のお知らせ", "url": jfa_announcement(row["source_url"])},
        }
        prior = entries.get((player_id, match_id), {})
        if prior.get("date", "") <= entry["date"]:
            entries[(player_id, match_id)] = entry
    return list(entries.values())


def read_snapshot(raw, previous, today, load_archive=fetch_archive):
    publication = published_date(raw["announced_at"])
    period = date.fromisoformat(f"{raw['window']}-01")
    if publication > today or abs((publication - period).days) > 45:
        raise ValueError("招集発表の日付が対象期間外です")
    if raw["version"] != 1:
        raise ValueError("招集資料の書式が変わりました")
    if publication.isoformat() < (previous.get("publishedAt") or ""):
        raise ValueError("公開資料の発表日が現在の記録より古いため、既存データを保持します")
    official = jfa_announcement(raw["source_url"])
    players = read_players(raw["players"], previous.get("players", []))
    withdrawals = read_withdrawals(
        raw.get("withdrawals", []), players, previous.get("withdrawals", []),
        publication, official, today, load_archive,
    )
    return {
        **previous,
        "publishedAt": publication.isoformat(),
        "updatedAt": max(publication.isoformat(), *(entry["date"] for entry in withdrawals), ""),
        "title": f"{period.year}年{period.month}月招集メンバー",
        "archived": True,
        "players": players,
        "withdrawals": withdrawals,
        "source": SQUAD_SOURCE,
        "officialSource": {"label": f"JFA {period.month}月のメンバー発表", "url": official},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
        now = datetime.now(timezone.utc)
        latest = read_snapshot(fetch_archive(SQUAD_FILE), previous, now.astimezone(JST).date())
        if previous and all(previous.get(key) == value for key, value in latest.items() if key != "source"):
            print("公開招集資料に変更はありません。")
            return 0
        latest["checkedAt"] = now.isoformat(timespec="seconds").replace("+00:00", "Z")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".tmp")
        temporary.write_text(json.dumps(latest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(args.output)
        print(f"{latest['title']}: {len(latest['players'])}人 ({latest['publishedAt']}発表)")
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"招集資料を更新できませんでした。既存データを保持します。 {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
