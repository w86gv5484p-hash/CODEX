#!/usr/bin/env python3
"""Collect recent injury-related news headlines for each squad player from Google News RSS.

Only headlines, publishers, dates and links are stored; articles are not copied.
Headlines are shown in the app as unverified reports, separate from confirmed records.
"""

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import re
import sys
from time import sleep
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "injury-news.json"
FEED = "https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"
KEYWORDS = "(負傷 OR 離脱 OR 怪我 OR ケガ OR 故障 OR 復帰 OR 欠場)"
TOPIC = re.compile(r"負傷|重傷|離脱|怪我|ケガ|けが|故障|復帰|欠場|手術|骨折|肉離れ|筋損傷|靱帯|靭帯")
# Returning to the national team is a call-up, and a teammate's injury is someone else's news.
NOT_FITNESS = re.compile(
    r"(?:日本)?代表(?:戦|チーム)?に?復帰|代表から離脱|怪我をしない|ケガをしない"
    r"|(?:負傷|ケガ|怪我)(?:した|の|中の)?\S{0,6}?同僚"
)
WINDOW = 12   # characters after the player's name in which the fitness word must appear
TRAIL = 6     # a fitness word directly followed by another player's name belongs to that player


def about_player(title, names, others):
    """True when the headline's fitness news is about this player.

    The player must be the first squad member named, the fitness word must follow the
    name closely, and it must not lead straight into another player's name.
    """
    text = NOT_FITNESS.sub("", compact(title))
    positions = [text.find(name) for name in names if name in text]
    if not positions:
        return False
    start = min(positions)
    if any(0 <= text.find(other) < start for other in others):
        return False
    name = next(name for name in names if text.find(name) == start)
    end = start + len(name)
    segment = text[end:end + WINDOW]
    cut = min((segment.find(other) for other in others if other in segment), default=-1)
    if cut >= 0:
        segment = segment[:cut]
    for match in TOPIC.finditer(segment):
        after = text[end + match.end(): end + match.end() + TRAIL]
        if not any(other in after for other in others):
            return True
    return False


JST = timezone(timedelta(hours=9))
DAYS = 14
PER_PLAYER = 3


def compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or ""))


def players():
    roster = json.loads((ROOT / "data/players.json").read_text(encoding="utf-8"))["players"]
    squad = json.loads((ROOT / "data/current-squad.json").read_text(encoding="utf-8")).get("players", [])
    unique = {}
    for row in squad + roster:
        if row.get("id") and row.get("name") and row["id"] not in unique:
            unique[row["id"]] = row
    return list(unique.values())


def fetch(query, retry=True):
    url = FEED.format(query=quote(query))
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SamuraiWatch/1.0)"})
    try:
        with urlopen(request, timeout=15) as reply:
            return reply.read()
    except HTTPError as error:
        if error.code == 429 and retry:
            sleep(20)
            return fetch(query, retry=False)
        raise


def headlines(player, now, others):
    name = compact(player["name"])
    family = player["name"].split()[0] if " " in player["name"] else name[:2]
    root = ET.fromstring(fetch(f'"{name}" {KEYWORDS} when:{DAYS}d'))
    items = []
    for item in root.iter("item"):
        title = item.findtext("title") or ""
        publisher = (item.findtext("source") or "").strip()
        link = item.findtext("link") or ""
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3]
        title = " ".join(title.split())
        parts = urlsplit(link)
        if parts.scheme != "https" or parts.hostname != "news.google.com":
            continue
        if published < now - timedelta(days=DAYS) or published > now + timedelta(hours=1):
            continue
        # The headline itself must name the player and mention fitness.
        if not about_player(title, [name, compact(family)], others):
            continue
        items.append({
            "playerId": player["id"],
            "playerName": player["name"],
            "publishedAt": published.astimezone(timezone.utc).isoformat(timespec="seconds"),
            "date": published.astimezone(JST).date().isoformat(),
            "title": title,
            "publisher": publisher or "ニュース",
            "url": link,
        })
    items.sort(key=lambda row: row["publishedAt"], reverse=True)
    picked, seen = [], set()
    for row in items:
        key = compact(row["title"])[:24]
        if key in seen:
            continue
        seen.add(key)
        picked.append(row)
        if len(picked) == PER_PLAYER:
            break
    return picked


def main():
    now = datetime.now(timezone.utc)
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    collected, failures = [], 0
    roster = players()
    for player in roster:
        try:
            others = [compact(row["name"].split()[0]) for row in roster if row["id"] != player["id"] and " " in row["name"]]
            collected.extend(headlines(player, now, [name for name in others if name != compact(player["name"].split()[0])]))
        except (URLError, OSError, ET.ParseError) as error:
            failures += 1
            print(f"{player['name']}: {error}", file=sys.stderr)
        sleep(2)
    if failures == len(roster):
        print("Google News could not be reached; previous headlines were kept.", file=sys.stderr)
        return 1
    collected.sort(key=lambda row: row["publishedAt"], reverse=True)
    if collected == previous.get("items"):
        print("Injury headlines are unchanged.")
        return 0
    payload = {"checkedAt": now.isoformat(timespec="seconds"), "windowDays": DAYS, "items": collected}
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(collected)} injury headlines for {len({row['playerId'] for row in collected})} players.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
