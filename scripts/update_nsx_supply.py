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
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nsx" / "data" / "supply.json"
JST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; nsx-care-app/1.0)"
PART_RE = re.compile(r"\b\d{5}-[A-Z0-9]{3}-[A-Z0-9]{3,4}\b")
# PDF の表では区切りがスペースや別のダッシュになっている場合があるため、資料からはゆるく読み取って正規化する
LOOSE_RE = re.compile(r"(?<![0-9A-Z])(\d{5})[ \-‐–—]{0,2}([A-Z0-9]{3})[ \-‐–—]{0,2}([A-Z0-9]{3,4})(?![0-9A-Z])")
DIAG: dict[str, dict] = {}


def unshift(text: str) -> str:
    """文字コードが 31 ずれて埋め込まれた PDF（例: "&/(*/&" = "ENGINE"）の英数字を元に戻す。"""
    return "".join(chr(ord(c) + 31) if 0 < ord(c) < 0x60 and c not in " \n\r\t" else c for c in text)


def find_parts(text: str) -> set[str]:
    text = unicodedata.normalize("NFKC", text).upper()
    found = set(PART_RE.findall(text))
    found |= {f"{a}-{b}-{c}" for a, b, c in LOOSE_RE.findall(text) if any(ch.isalpha() for ch in b + c)}
    return found
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
        return find_parts(decode(raw))
    if lower.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            return set()
        reader = PdfReader(io.BytesIO(raw))
        text = " ".join(page.extract_text() or "" for page in reader.pages)
        found = find_parts(text)
        decoded = ""
        if not found and text.strip():
            alt = unshift(text)
            found = find_parts(alt)
            if found:
                text, decoded = alt, "shift31"
        DIAG[url] = {"bytes": len(raw), "pages": len(reader.pages), "textChars": len(text.strip()),
                     "found": len(found), "decoded": decoded, "sample": re.sub(r"\s+", " ", text)[:600]}
        return found
    if lower.endswith(".xlsx"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            return set()
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        found: set[str] = set()
        for sheet in book.worksheets:
            for row in sheet.iter_rows(values_only=True):
                found |= find_parts(" ".join(str(v) for v in row if v is not None))
        return found
    return set()


def main() -> int:
    now = datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    previous = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}
    prev_sources = {s["id"]: s for s in previous.get("sources", [])}
    changes = list(previous.get("changes", []))
    # version 2 からは継続供給中リストとパーツカタログを分けて保存する（以前の混在データとは比較しない）
    same_format = previous.get("listVersion") == 2
    parts = set(previous.get("partNumbers", [])) if same_format else set()
    catalog = set(previous.get("catalogNumbers", []))
    new_parts: set[str] | None = None
    new_catalog: set[str] | None = None
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
                # 「parts-list」= 継続供給中部品番号リスト、それ以外の PDF = パーツカタログ（廃番を含む全部品）
                docs = sorted({urllib.parse.urljoin(src["url"], h) for h in DOC_RE.findall(markup)})
                entry["documents"] = docs
                listed: set[str] = set()
                cataloged: set[str] = set()
                list_ok = False
                for doc in docs:
                    is_list = "parts-list" in doc.lower()
                    try:
                        found = document_parts(doc)
                    except Exception as exc:  # noqa: BLE001 - 1件の失敗で全体を止めない
                        print(f"document failed: {doc}: {exc}", file=sys.stderr)
                        continue
                    print(f"{'list' if is_list else 'catalog'}: {doc}: {len(found)} part numbers")
                    if is_list:
                        listed |= found
                        list_ok = list_ok or bool(found)
                    else:
                        cataloged |= found
                if not list_ok:
                    listed = set(PART_RE.findall(text))
                if listed:
                    new_parts = listed
                if cataloged:
                    new_catalog = cataloged
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
    if new_catalog is not None:
        catalog = new_catalog

    data = {
        "listVersion": 2,
        "checkedAt": now.isoformat(timespec="minutes"),
        "ok": ok_count > 0,
        "sources": results,
        "partNumbers": sorted(parts),
        "catalogNumbers": sorted(catalog),
        "changes": changes[:40],
        "diagnostics": DIAG,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"checked {len(SOURCES)} sources, ok={ok_count}, supply list={len(parts)}, catalog={len(catalog)}")
    return 0 if ok_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
