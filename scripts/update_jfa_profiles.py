#!/usr/bin/env python3
"""Find each player's official JFA profile page (links only; JFA images are not copied)."""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "jfa-profiles.json"
BASE = "https://www.jfa.jp/samuraiblue/member/"


def slug(part):
    plain = unicodedata.normalize("NFKD", part.casefold())
    return re.sub(r"[^a-z]", "", "".join(char for char in plain if not unicodedata.combining(char)))


def long_vowels(word):
    # JFA spells long vowels without macrons, sometimes with an extra "u" or "h".
    forms = {word}
    for end in ("o", "u"):
        if word.endswith(end):
            forms |= {word + "u", word + "h"}
    return forms


def candidates(latin):
    words = [slug(word) for word in latin.split() if slug(word)]
    if len(words) < 2:
        return []
    family = words[-1]
    givens = {*words[:-1], "".join(words[:-1]), "_".join(words[:-1])}
    urls = [f"{BASE}{f}_{g}.html" for f in long_vowels(family) for given in givens for g in long_vowels(given)]
    exact = f"{BASE}{family}_{words[0]}.html"
    return [exact] + sorted(set(urls) - {exact})


def page_mentions(url, name):
    request = Request(url, headers={"User-Agent": "SamuraiWatch/1.0 (link checker)"})
    try:
        with urlopen(request, timeout=12) as reply:
            text = reply.read().decode("utf-8", "replace")
    except HTTPError:
        return False
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", name))
    return compact in re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))


def main():
    roster = json.loads((ROOT / "data/players.json").read_text(encoding="utf-8"))["players"]
    squad = json.loads((ROOT / "data/current-squad.json").read_text(encoding="utf-8")).get("players", [])
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    known = {row["id"]: row for row in previous.get("profiles", [])}
    players = {row["id"]: row for row in roster + squad if row.get("latin") and row.get("name")}
    try:
        for player_id, player in players.items():
            if player_id in known:
                continue
            for url in candidates(player["latin"]):
                if page_mentions(url, player["name"]):
                    known[player_id] = {"id": player_id, "url": url}
                    break
    except URLError as error:
        print(f"JFA could not be reached; kept {len(known)} saved links. {error}", file=sys.stderr)
    payload = {
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "profiles": sorted((row for key, row in known.items() if key in players), key=lambda row: row["id"]),
    }
    if payload["profiles"] == previous.get("profiles"):
        print("JFA profile links are unchanged.")
        return
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"JFA profile links for {len(payload['profiles'])} of {len(players)} players.")


if __name__ == "__main__":
    main()
