#!/usr/bin/env python3
"""Refresh Japan's published FIFA Men's World Ranking."""

import argparse
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PAGE = "https://inside.fifa.com/fifa-world-ranking/men"
API = "https://inside.fifa.com/api/ranking-overview"
FIFA_API = "https://api.fifa.com/api/v3/rankings?gender=1"
LABEL = "FIFA 男子世界ランキング"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "ranking.json"
NEXT_DATA = re.compile(
    r"""<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>(.*?)</script>""",
    re.DOTALL,
)


def fetch(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 (Japan senior team dashboard)"})
    with urlopen(request, timeout=12) as response:
        return response.read().decode("utf-8")


def latest_publication(html, today):
    embedded = NEXT_DATA.search(html)
    if embedded is None:
        raise ValueError("FIFA公式ページにランキングの公開日情報がありません")
    ranking = json.loads(embedded[1])["props"]["pageProps"]["pageData"]["ranking"]
    publications = []
    for year in ranking["dates"]:
        for item in year["dates"]:
            publication = date.fromisoformat(item["iso"][:10])
            if publication <= today:
                publications.append((publication, item["id"]))
    if not publications:
        raise ValueError("FIFA公式ページに公開済みのランキングがありません")
    return max(publications)


def parse_position(value):
    if isinstance(value, bool) or not str(value).isdecimal():
        raise ValueError("FIFAの順位データの形式が変わりました")
    rank = int(value)
    if not 1 <= rank <= 300:
        raise ValueError("FIFAの順位データの範囲が変わりました")
    return rank


def japan_ranking(payload):
    for row in payload["rankings"]:
        item = row["rankingItem"]
        if item.get("name") != "Japan" and item.get("countryCode") != "JPN":
            continue
        return ranking_values(item["rank"], item.get("previousRank"), item["totalPoints"])
    raise ValueError("公式の男子ランキングに日本の項目がありません")


def ranking_values(rank, previous_rank, points):
    rank = parse_position(rank)
    previous = parse_position(previous_rank) if previous_rank not in (None, "", 0, "0") else None
    points = float(points)
    if not math.isfinite(points) or not 0 < points < 10000:
        raise ValueError("FIFAのポイント形式が変わりました")
    return rank, previous, points


def api_ranking(payload, today):
    for item in payload["Results"]:
        if item.get("IdCountry") != "JPN" or item.get("Gender") != 1:
            continue
        published = date.fromisoformat(item["PubDate"][:10])
        if published > today:
            raise ValueError("FIFA APIの公開日が未来です")
        values = ranking_values(item["Rank"], item.get("PrevRank"), item["DecimalTotalPoints"])
        return published, item["IdSchedule"], values
    raise ValueError("FIFA APIの男子ランキングに日本の項目がありません")


def refresh(now):
    try:
        published, date_id = latest_publication(fetch(PAGE), now.date())
        query = urlencode({"locale": "en", "dateId": date_id})
        rank, previous_rank, points = japan_ranking(json.loads(fetch(f"{API}?{query}")))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FIFA公式ページの読み込みに失敗したため、公式APIを確認します。 {error}", file=sys.stderr)
        published, date_id, values = api_ranking(json.loads(fetch(FIFA_API)), now.date())
        rank, previous_rank, points = values
    return {
        "checkedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "publishedAt": published.isoformat(),
        "rank": rank,
        "previousRank": previous_rank,
        "points": points,
        "archived": False,
        "source": {"label": LABEL, "url": f"{PAGE}?{urlencode({'dateId': date_id})}"},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    try:
        data = refresh(datetime.now(timezone.utc))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FIFAランキングを取得できませんでした。既存データを保持します。 {error}", file=sys.stderr)
        return 1
    if previous.get("publishedAt") and previous["publishedAt"] > data["publishedAt"]:
        print("公式ページから取得した公開日が保存済みデータより古いため、既存データを保持します。", file=sys.stderr)
        return 1
    if (
        (previous.get("checkedAt") or "")[:10] == data["checkedAt"][:10]
        and all(previous.get(key) == value for key, value in data.items() if key != "checkedAt")
    ):
        print("同日のFIFAランキングに変更はありません。")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(f"FIFA男子ランキング: 日本 {data['rank']}位 ({data['publishedAt']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
