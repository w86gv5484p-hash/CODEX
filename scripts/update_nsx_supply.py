"""NSX（NA1）の部品供給状況に関するホンダ公式ページを確認し、nsx/data/supply.json を更新します。

1日1回 GitHub Actions から実行します。各ページの本文を取得して前回との違いを記録し、
掲載されているホンダ純正部品番号（例: 15400-PLM-A01）を抽出します。
取得に失敗したページは前回の内容を保持します。
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nsx" / "data" / "supply.json"
JST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; nsx-care-app/1.0)"
PART_RE = re.compile(r"\b\d{5}-[A-Z0-9]{3}-[A-Z0-9]{3,4}\b")
DOC_RE = re.compile(r"""href=["']([^"']+\.(?:pdf|csv|xlsx))["']""", re.I)

SOURCES = [
    {
        "id": "parts-catalog",
        "label": "NSX 継続供給中部品番号リスト（Honda Heritage Works）",
        "url": "https://www.honda.co.jp/heritage-works/parts/nsx/parts-catalog/",
        "collectParts": True,
    },
    {
        "id": "restoration",
        "label": "Honda Restoration Service（NSX レストア）",
        "url": "https://www.honda.co.jp/heritage-works/restoration/",
    },
    {
        "id": "refresh",
        "label": "NSX リフレッシュ（ホンダ スポーツカーケア）",
        "url": "https://www.honda.co.jp/sportscar/care/nsx_refresh01/",
    },
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def decode(raw: bytes) -> str:
    for enc in ("utf-8", "shift_jis", "euc_jp"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def page_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", markup)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", markup))
    return re.sub(r"\s+", " ", text).strip()


def document_parts(url: str) -> set[str]:
    """リンク先の PDF / CSV / XLSX から部品番号を抽出します（読めない形式は空）。"""
    raw = fetch(url)
    lower = url.lower()
    if lower.endswith(".csv"):
        return set(PART_RE.findall(decode(raw)))
    if lower.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            return set()
        reader = PdfReader(io.BytesIO(raw))
        return set(PART_RE.findall(" ".join(page.extract_text() or "" for page in reader.pages)))
    if lower.endswith(".xlsx"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            return set()
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        found: set[str] = set()
        for sheet in book.worksheets:
            for row in sheet.iter_rows(values_only=True):
                found.update(PART_RE.findall(" ".join(str(v) for v in row if v is not None)))
        return found
    return set()


def main() -> int:
    now = datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    previous = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}
    prev_sources = {s["id"]: s for s in previous.get("sources", [])}
    changes = list(previous.get("changes", []))
    parts = set(previous.get("partNumbers", []))
    new_parts: set[str] | None = None
    results = []
    ok_count = 0

    for src in SOURCES:
        prev = prev_sources.get(src["id"], {})
        entry = {
            "id": src["id"], "label": src["label"], "url": src["url"],
            "hash": prev.get("hash"), "changedAt": prev.get("changedAt"),
            "lastOk": prev.get("lastOk"), "documents": prev.get("documents", []),
        }
        try:
            markup = decode(fetch(src["url"]))
            text = page_text(markup)
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if prev.get("hash") and prev["hash"] != digest:
                entry["changedAt"] = today
                changes.insert(0, {"date": today, "source": src["label"], "url": src["url"], "summary": "ページの内容が更新されました。"})
            elif not prev.get("hash"):
                entry["changedAt"] = today
            entry.update(hash=digest, ok=True, lastOk=now.isoformat(timespec="minutes"))
            ok_count += 1
            if src.get("collectParts"):
                found = set(PART_RE.findall(text))
                docs = sorted({urllib.parse.urljoin(src["url"], h) for h in DOC_RE.findall(markup)})
                entry["documents"] = docs
                for doc in docs:
                    try:
                        found |= document_parts(doc)
                    except Exception as exc:  # noqa: BLE001 - 1件の失敗で全体を止めない
                        print(f"document failed: {doc}: {exc}", file=sys.stderr)
                if found:
                    new_parts = found
        except Exception as exc:  # noqa: BLE001
            entry.update(ok=False, error=str(exc)[:200])
            print(f"fetch failed: {src['url']}: {exc}", file=sys.stderr)
        results.append(entry)

    if new_parts is not None:
        added, removed = sorted(new_parts - parts), sorted(parts - new_parts)
        if parts and (added or removed):
            changes.insert(0, {
                "date": today, "source": "継続供給中部品番号リスト", "url": SOURCES[0]["url"],
                "summary": f"掲載部品番号 追加 {len(added)}件 / 掲載終了 {len(removed)}件",
                "added": added[:200], "removed": removed[:200],
            })
        parts = new_parts

    data = {
        "checkedAt": now.isoformat(timespec="minutes"),
        "ok": ok_count > 0,
        "sources": results,
        "partNumbers": sorted(parts),
        "changes": changes[:40],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"checked {len(SOURCES)} sources, ok={ok_count}, part numbers={len(parts)}")
    return 0 if ok_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
