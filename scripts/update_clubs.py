#!/usr/bin/env python3
"""Import recent club appearances and injury designations from API-FOOTBALL."""

from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://v3.football.api-sports.io"
SOURCE = {"label": "API-FOOTBALL", "url": "https://www.api-football.com/"}
JST = ZoneInfo("Asia/Tokyo")
TEAM_ALIASES = {
    "brighton hove albion": "Brighton",
    "borussia monchengladbach": "Borussia Mönchengladbach",
    "leeds united": "Leeds",
    "st pauli": "FC St. Pauli",
    "mainz 05": "FSV Mainz 05",
    "parma calcio": "Parma",
    "royal antwerp": "Antwerp",
    "stade de reims": "Reims",
    "stade rennais": "Rennes",
    "sporting cp": "Sporting CP",
    "union saint gilloise": "Union St. Gilloise",
}
INJURY = re.compile(r"\b(injur(?:y|ies|ed)|fracture|concussion|surgery|knock|sprain|strain)\b", re.I)
FINISHED = {"FT", "AET", "PEN"}


class FeedError(Exception):
    pass


class BudgetReached(Exception):
    pass


class Client:
    def __init__(self, key, budget):
        self.key = key
        self.budget = budget
        self.cache = {}

    def get(self, endpoint, **params):
        query = f"{endpoint}?{urlencode(params)}"
        if query in self.cache:
            return self.cache[query]
        if self.budget == 0:
            raise BudgetReached
        self.budget -= 1
        request = Request(f"{BASE_URL}/{query}", headers={"x-apisports-key": self.key})
        try:
            with urlopen(request, timeout=25) as reply:
                payload = json.load(reply)
        except HTTPError as exc:
            raise FeedError(f"/{endpoint} returned HTTP {exc.code}.") from exc
        except (URLError, TimeoutError, ValueError) as exc:
            raise FeedError(f"/{endpoint} did not return readable JSON.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("response"), list):
            raise FeedError(f"/{endpoint} returned an unexpected response.")
        if payload.get("errors"):
            raise FeedError(f"/{endpoint} rejected the request. Check the API plan, quota, and coverage.")
        if payload.get("paging", {}).get("total", 0) > 1:
            raise FeedError(f"/{endpoint} returned more than one page for a bounded query.")
        self.cache[query] = payload["response"]
        return self.cache[query]


def normalized(value):
    folded = unicodedata.normalize("NFKD", value.casefold())
    return " ".join(re.findall(r"[a-z0-9]+", "".join(c for c in folded if not unicodedata.combining(c))))


def unique_id(rows):
    ids = {row["id"] for row in rows if type(row.get("id")) is int and row["id"] > 0}
    return next(iter(ids)) if len(ids) == 1 else None


def resolve(client, player, previous):
    club = player.get("clubLatin") or player.get("club", "")
    latin = player.get("latin", "")
    team_id = player.get("apiFootballTeamId")
    player_id = player.get("apiFootballId")
    identity = [club, latin, team_id, player_id]
    if previous.get("identity") == identity:
        return previous

    team_name = TEAM_ALIASES.get(normalized(club), club)
    if team_id is None and normalized(team_name):
        teams = [row["team"] for row in client.get("teams", search=team_name)]
        team_id = unique_id(team for team in teams if normalized(team["name"]) == normalized(team_name))
    if player_id is None and team_id is not None:
        names = normalized(latin).split()
        if len(names) == 2:
            given, surname = names
            matches = {f"{given} {surname}", f"{surname} {given}", f"{given[0]} {surname}"}
            rows = client.get("players/squads", team=team_id)
            match = next((row for row in rows if row["team"]["id"] == team_id), {})
            player_id = unique_id(row for row in match.get("players", []) if normalized(row["name"]) in matches)
    if type(team_id) is int and team_id > 0 and type(player_id) is int and player_id > 0:
        return {"identity": identity, "teamId": team_id, "playerId": player_id}
    return None


def match_context(match, team_id):
    fixture = match["fixture"]
    teams = match["teams"]
    opposition = teams["away"] if teams["home"]["id"] == team_id else teams["home"]
    day = datetime.fromtimestamp(fixture["timestamp"], tz=JST).date().isoformat()
    return fixture["id"], day, match["league"]["name"], opposition["name"]


def reports_for_match(client, match, team_id, player_id):
    fixture_id, day, competition, opponent = match_context(match, team_id)
    reports = []
    club_stats = client.get("fixtures/players", fixture=fixture_id)
    club = next((row for row in club_stats if row["team"]["id"] == team_id), {})
    for entry in club.get("players", []):
        if entry["player"]["id"] != player_id:
            continue
        for stats in entry["statistics"]:
            games = stats["games"]
            minutes = games.get("minutes")
            if type(minutes) is int and minutes > 0:
                reports.append({
                    "date": day,
                    "type": "club",
                    "title": f"{opponent}戦に出場",
                    "summary": f"{competition} ／ 出場 {minutes}分",
                    "source": SOURCE,
                })
                break

    injury_rows = client.get("injuries", fixture=fixture_id)
    for entry in injury_rows:
        player = entry["player"]
        if entry["team"]["id"] != team_id or player["id"] != player_id:
            continue
        reason = player.get("reason") or ""
        if not INJURY.search(reason):
            continue
        designation = player.get("type")
        title = {
            "Questionable": "負傷により出場可否が未定と掲載",
            "Missing Fixture": "負傷により欠場と掲載",
        }.get(designation, "負傷に関する情報が掲載")
        reports.append({
            "date": day,
            "type": "injury",
            "title": title,
            "summary": f"対象試合は{competition}の{opponent}戦。情報提供元の表記は「{reason}」。",
            "source": SOURCE,
        })
    return reports


def merge_reports(new, old):
    by_key = {}
    for report in old + new:
        date.fromisoformat(report["date"])
        by_key[report["date"], report["type"], report["title"]] = report
    return sorted(by_key.values(), key=lambda row: row["date"], reverse=True)[:30]


def refresh(client, curated, previous):
    selected = {player["id"]: player for player in curated}
    old_players = {player["id"]: player for player in previous.get("players", [])}
    players = {player_id: old_players[player_id] for player_id in selected if player_id in old_players}
    resolved = {player_id: mapping for player_id, mapping in previous.get("resolved", {}).items() if player_id in selected}
    attempted_at = {key: value for key, value in previous.get("attemptedAt", {}).items() if key in selected}
    run_time = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pending = sorted(curated, key=lambda player: (attempted_at.get(player["id"], ""), player["id"]))
    checked = 0
    for player in pending:
        player_id = player["id"]
        try:
            mapping = resolve(client, player, resolved.get(player_id, {}))
            if mapping is None:
                print(f"Unresolved club or provider player ID for {player_id}.")
                resolved.pop(player_id, None)
                attempted_at[player_id] = run_time
                continue
            team_id = mapping["teamId"]
            matches = client.get("fixtures", team=team_id, last=1, status="FT-AET-PEN")
            reports = []
            for match in matches:
                if match["fixture"]["status"]["short"] in FINISHED:
                    reports.extend(reports_for_match(client, match, team_id, mapping["playerId"]))
        except BudgetReached:
            print("Request budget reached. Previous reports for remaining players were preserved.")
            break
        prior = players.get(player_id, {}).get("reports", [])
        merged = merge_reports(reports, prior)
        resolved[player_id] = mapping
        attempted_at[player_id] = run_time
        checked += 1
        if merged:
            players[player_id] = {"id": player_id, "name": player["name"], "reports": merged}

    print(f"Checked provider coverage for {checked} of {len(selected)} players.")
    if not checked:
        return None
    return {
        "checkedAt": run_time,
        "coverage": {"checked": checked, "total": len(selected)},
        "players": list(players.values()),
        "resolved": resolved,
        "attemptedAt": attempted_at,
    }


def save(path, data):
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
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        print("API_FOOTBALL_KEY is unset. Club data was preserved.")
        return 0

    try:
        budget = int(os.environ.get("API_FOOTBALL_REQUEST_BUDGET") or "90")
        if budget < 1:
            raise FeedError("API_FOOTBALL_REQUEST_BUDGET must be a positive integer.")
        curated = json.loads((ROOT / "data/players.json").read_text(encoding="utf-8"))["players"]
        if not curated:
            raise FeedError("The curated squad is empty. Club data was preserved.")
        path = ROOT / "data/clubs.json"
        previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        updated = refresh(Client(key, budget), curated, previous)
        if updated is None:
            raise FeedError("No configured player could be checked. Verify the provider IDs and budget.")
        save(path, updated)
    except (FeedError, KeyError, TypeError, ValueError, OSError) as exc:
        print(f"Club update failed. Previous data was preserved. {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
