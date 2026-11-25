#!/usr/bin/env python3
"""安値世界一（price/）をこのコンピューターで起動し、各社の公式APIで価格を取得するローカルサーバー。

API キーは公開リポジトリやブラウザーに置かず、このサーバーだけが読みます。
キーは環境変数か、リポジトリ直下の price.keys.json（.gitignore 済み）に書きます。
キーが1つも無いときや ?mock=1 のときは price/mock.json のサンプルデータを返します。

  python3 scripts/price_server.py --open

使う公式API（2026-11 時点で確認した仕様。変更されることがあります）:
  楽天市場商品検索API 2026-07-01版  https://webservice.rakuten.co.jp/documentation/ichiba-item-search
  Yahoo!ショッピング商品検索API v3   https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
  Amazon Creators API SearchItems   https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
スクレイピングは行いません。公式ショップの価格は画面から手入力します。
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import sys
from threading import Lock
from time import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
import webbrowser

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "price"
KEYS_FILE = ROOT / "price.keys.json"
TIMEOUT = 12
USER_AGENT = "price-compare-local/1.0"

RAKUTEN_URL = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701"
YAHOO_URL = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"
AMAZON_TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token"  # Far East（JP）。資格情報 v3.3
AMAZON_SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems"
AMAZON_MARKETPLACE = "www.amazon.co.jp"

KEY_NAMES = (
    "RAKUTEN_APP_ID", "RAKUTEN_ACCESS_KEY", "RAKUTEN_REFERER", "RAKUTEN_AFFILIATE_ID",
    "YAHOO_CLIENT_ID",
    "AMAZON_CREDENTIAL_ID", "AMAZON_CREDENTIAL_SECRET", "AMAZON_PARTNER_TAG",
)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_keys(env=os.environ, path=KEYS_FILE):
    keys = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            keys.update({k: str(v).strip() for k, v in data.items() if k in KEY_NAMES and v})
        except (OSError, ValueError) as error:
            print(f"{path.name} を読めませんでした: {error}", file=sys.stderr)
    keys.update({k: env[k].strip() for k in KEY_NAMES if env.get(k, "").strip()})
    return keys


def configured(keys):
    return {
        "rakuten": bool(keys.get("RAKUTEN_APP_ID") and keys.get("RAKUTEN_ACCESS_KEY")),
        "yahoo": bool(keys.get("YAHOO_CLIENT_ID")),
        "amazon": bool(keys.get("AMAZON_CREDENTIAL_ID") and keys.get("AMAZON_CREDENTIAL_SECRET") and keys.get("AMAZON_PARTNER_TAG")),
    }


class ApiError(Exception):
    pass


def http_json(url, headers=None, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            return json.loads(res.read().decode("utf-8"))
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8"))
        except ValueError:
            detail = {}
        raise ApiError(f"HTTP {error.code}: {error_message(detail) or error.reason}") from None
    except (URLError, TimeoutError, ValueError) as error:
        raise ApiError(f"通信エラー: {error}") from None


def error_message(detail):
    """各社のエラー形式から読みやすい文を取り出す。楽天は公式ドキュメントの error/error_description と、
    実際に返ることが報告されている errors[].errorCode/errorMessage の両方に対応する。"""
    if not isinstance(detail, dict):
        return ""
    if detail.get("error_description") or detail.get("error"):
        return f"{detail.get('error', '')} {detail.get('error_description', '')}".strip()
    errors = detail.get("errors")
    if isinstance(errors, list) and errors:
        e = errors[0] if isinstance(errors[0], dict) else {}
        return f"{e.get('errorCode', '')} {e.get('errorMessage', '')}".strip()
    if isinstance(errors, dict):
        return f"{errors.get('errorCode', '')} {errors.get('errorMessage', '')}".strip()
    if isinstance(detail.get("Error"), dict):
        return str(detail["Error"].get("Message", ""))
    return str(detail.get("message", ""))


def to_int(value):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


# ---------- 楽天市場 ----------

def rakuten_request(keys, query, jan):
    params = {
        "applicationId": keys["RAKUTEN_APP_ID"],
        "keyword": jan or query,  # 商品検索APIに JAN 指定のパラメータは無いため、JAN もキーワードで検索する
        "hits": 30,
        "availability": 1,
        "formatVersion": 2,
        "sort": "+itemPrice" if jan else "standard",
    }
    if keys.get("RAKUTEN_AFFILIATE_ID"):
        params["affiliateId"] = keys["RAKUTEN_AFFILIATE_ID"]
    headers = {"accessKey": keys["RAKUTEN_ACCESS_KEY"]}  # クエリより URL やログに残りにくいヘッダーで送る
    if keys.get("RAKUTEN_REFERER"):
        headers["Referer"] = keys["RAKUTEN_REFERER"]
    return f"{RAKUTEN_URL}?{urlencode(params)}", headers


def normalize_rakuten(data, fetched_at=None):
    offers = []
    for raw in data.get("items") or data.get("Items") or []:
        item = raw.get("item", raw) if isinstance(raw, dict) else {}
        price = to_int(item.get("itemPrice"))
        if price is None:
            continue
        rate = to_int(item.get("pointRate")) or 1  # 倍率の表示が無い商品は通常ポイント（1倍＝1%）とみなす
        images = item.get("mediumImageUrls") or []
        image = images[0] if images else None
        if isinstance(image, dict):
            image = image.get("imageUrl")
        tax_excluded = item.get("taxFlag") == 1
        offers.append({
            "store": "rakuten",
            "title": item.get("itemName", ""),
            "shop": item.get("shopName", ""),
            "url": item.get("affiliateUrl") or item.get("itemUrl"),
            "image": image,
            "price": price if not tax_excluded else price * 11 // 10,
            "priceNote": "税抜表示の商品を税込（10%）に換算" if tax_excluded else "",
            # postageFlag（レスポンス）: 0=送料込み、1=送料別（金額は API に無い）
            "shippingFee": 0 if item.get("postageFlag") == 0 else None,
            "pointRate": rate,
            "pointRateEnd": item.get("pointRateEndTime"),
            "points": None,
            "janCode": None,
            "inStock": item.get("availability") != 0,
            "itemCode": item.get("itemCode"),
            "fetchedAt": fetched_at or now_iso(),
            "source": "api",
        })
    return offers


def search_rakuten(keys, query, jan):
    url, headers = rakuten_request(keys, query, jan)
    return normalize_rakuten(http_json(url, headers))


# ---------- Yahoo!ショッピング ----------

def yahoo_request(keys, query, jan):
    params = {"appid": keys["YAHOO_CLIENT_ID"], "results": 30, "in_stock": "true"}
    if jan:
        params.update(jan_code=jan, sort="+price")
    else:
        params.update(query=query)
    return f"{YAHOO_URL}?{urlencode(params)}"


def normalize_yahoo(data, fetched_at=None):
    offers = []
    for hit in data.get("hits") or []:
        price = to_int(hit.get("price"))
        if price is None:
            continue
        point = hit.get("point") or {}
        shipping = hit.get("shipping") or {}
        seller = hit.get("seller") or {}
        image = (hit.get("image") or {}).get("medium")
        # point.amount / bonusAmount は 0 固定に変わったため、PayPay ポイント（期間限定）の lyLimitedBonusAmount を使う
        bonus = to_int(point.get("lyLimitedBonusAmount")) or 0
        offers.append({
            "store": "yahoo",
            "title": hit.get("name", ""),
            "shop": seller.get("name", ""),
            "url": hit.get("url"),
            "image": image,
            "price": price,
            "taxExcludedPrice": to_int(hit.get("taxExcludePrice")),
            # shipping.code: 1=設定無し、2=送料無料、3=条件付き送料無料
            "shippingFee": 0 if shipping.get("code") == 2 else None,
            "shippingNote": shipping.get("name", ""),
            "pointRate": None,
            "points": bonus or None,
            "pointsLabel": "ストアポイント（PayPay期間限定）",
            "janCode": hit.get("janCode") or None,
            "inStock": hit.get("inStock") is not False,
            "fetchedAt": fetched_at or now_iso(),
            "source": "api",
        })
    return offers


def search_yahoo(keys, query, jan):
    return normalize_yahoo(http_json(yahoo_request(keys, query, jan)))


# ---------- Amazon（Creators API。PA-API 5.0 は廃止） ----------

class AmazonToken:
    def __init__(self):
        self.lock = Lock()
        self.value = None
        self.expires = 0

    def get(self, keys):
        with self.lock:
            if self.value and time() < self.expires - 60:
                return self.value
            data = http_json(AMAZON_TOKEN_URL, body={
                "grant_type": "client_credentials",
                "client_id": keys["AMAZON_CREDENTIAL_ID"],
                "client_secret": keys["AMAZON_CREDENTIAL_SECRET"],
                "scope": "creatorsapi::default",
            })
            self.value = data.get("access_token")
            self.expires = time() + int(data.get("expires_in") or 3600)
            if not self.value:
                raise ApiError("アクセストークンを取得できませんでした")
            return self.value


AMAZON_TOKEN = AmazonToken()
AMAZON_RESOURCES = [
    "itemInfo.title", "itemInfo.externalIds", "images.primary.medium",
    "offersV2.listings.price", "offersV2.listings.availability", "offersV2.listings.merchantInfo",
    "offersV2.listings.loyaltyPoints", "offersV2.listings.isBuyBoxWinner", "offersV2.listings.condition",
]


def amazon_body(keys, query, jan):
    return {
        "keywords": jan or query,
        "searchIndex": "All",
        "itemCount": 10,
        "partnerTag": keys["AMAZON_PARTNER_TAG"],
        "marketplace": AMAZON_MARKETPLACE,
        "resources": AMAZON_RESOURCES,
    }


def _amazon_eans(item):
    ext = (item.get("itemInfo") or {}).get("externalIds") or {}
    eans = ext.get("eans") or ext.get("EANs") or {}
    values = eans.get("displayValues") or eans.get("DisplayValues") or []
    return [str(v) for v in values]


def normalize_amazon(data, fetched_at=None):
    result = data.get("searchResult") or data.get("itemsResult") or {}
    offers = []
    for item in result.get("items") or []:
        listings = (item.get("offersV2") or {}).get("listings") or []
        listing = next((l for l in listings if l.get("isBuyBoxWinner")), listings[0] if listings else None)
        if not listing:
            continue
        money = ((listing.get("price") or {}).get("money") or {})
        price = to_int(money.get("amount"))
        if price is None:
            continue
        title = (((item.get("itemInfo") or {}).get("title") or {}).get("displayValue")) or ""
        image = ((((item.get("images") or {}).get("primary") or {}).get("medium") or {}).get("url"))
        availability = (listing.get("availability") or {}).get("type")
        eans = _amazon_eans(item)
        offers.append({
            "store": "amazon",
            "title": title,
            "shop": ((listing.get("merchantInfo") or {}).get("name")) or "",
            "url": item.get("detailPageURL"),
            "image": image,
            "price": price,
            # OffersV2 は送料（配送情報）を返さない
            "shippingFee": None,
            "pointRate": None,
            "points": to_int((listing.get("loyaltyPoints") or {}).get("points")),
            "pointsLabel": "Amazonポイント",
            "janCode": eans[0] if eans else None,
            "inStock": availability not in ("OUT_OF_STOCK", "UNAVAILABLE"),
            "asin": item.get("asin"),
            "fetchedAt": fetched_at or now_iso(),
            "source": "api",
        })
    return offers


def search_amazon(keys, query, jan):
    token = AMAZON_TOKEN.get(keys)
    data = http_json(AMAZON_SEARCH_URL, headers={
        "Authorization": f"Bearer {token}", "x-marketplace": AMAZON_MARKETPLACE,
    }, body=amazon_body(keys, query, jan))
    return normalize_amazon(data)


PROVIDERS = {"rakuten": search_rakuten, "yahoo": search_yahoo, "amazon": search_amazon}


def load_mock(query, jan):
    data = json.loads((APP_DIR / "mock.json").read_text(encoding="utf-8"))
    stamp = now_iso()
    offers = [{**o, "fetchedAt": stamp, "source": "mock"} for o in data["offers"]]
    return offers


def search(query, jan, keys, use_mock=False):
    status = configured(keys)
    providers = {}
    if use_mock or not any(status.values()):
        for name in PROVIDERS:
            providers[name] = {"state": "mock", "message": "サンプルデータ"}
        return {"mode": "mock", "offers": load_mock(query, jan), "providers": providers, "fetchedAt": now_iso()}
    offers = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {name: pool.submit(fn, keys, query, jan) for name, fn in PROVIDERS.items() if status[name]}
        for name in PROVIDERS:
            if name not in futures:
                providers[name] = {"state": "not_configured", "message": "APIキー未設定"}
                continue
            try:
                found = futures[name].result()
                offers.extend(found)
                providers[name] = {"state": "ok", "message": f"{len(found)}件"}
            except ApiError as error:
                providers[name] = {"state": "error", "message": str(error)}
            except Exception as error:  # 1社の不具合で全体を止めない
                providers[name] = {"state": "error", "message": f"想定外のエラー: {error}"}
    return {"mode": "live", "offers": offers, "providers": providers, "fetchedAt": now_iso()}


class Handler(BaseHTTPRequestHandler):
    def __init__(self, keys, *args, **kwargs):
        self.keys = keys
        super().__init__(*args, **kwargs)

    def send_body(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_json(self, obj, status=200):
        self.send_body(json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

    def allowed_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def do_GET(self):
        if not self.allowed_host():
            self.send_error(403)
            return
        parts = urlsplit(self.path)
        route = parts.path
        if route == "/api/price/status":
            self.send_json({"providers": configured(self.keys)})
            return
        if route == "/api/price/search":
            q = parse_qs(parts.query)
            query = (q.get("q") or [""])[0].strip()[:128]
            jan = "".join(ch for ch in (q.get("jan") or [""])[0] if ch.isdigit())[:13]
            if not query and not jan:
                self.send_json({"error": "キーワードかJANコードを入力してください"}, 400)
                return
            self.send_json(search(query, jan, self.keys, use_mock=(q.get("mock") or ["0"])[0] == "1"))
            return
        if route in ("/", "/price"):
            self.send_response(302)
            self.send_header("Location", "/price/")
            self.end_headers()
            return
        if not route.startswith("/price/"):
            self.send_error(404)
            return
        rel = route[len("/price/"):] or "index.html"
        path = (APP_DIR / rel).resolve()
        if APP_DIR not in path.parents or not path.is_file():
            self.send_error(404)
            return
        self.send_body(path.read_bytes(), mimetypes.guess_type(path)[0] or "application/octet-stream")

    do_HEAD = do_GET

    def log_message(self, format, *args):
        if len(args) > 1 and str(args[1]) not in ("200", "302", "304"):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--open", action="store_true", help="ブラウザーで開く")
    args = parser.parse_args()
    keys = load_keys()
    status = configured(keys)
    labels = {"rakuten": "楽天市場", "yahoo": "Yahoo!ショッピング", "amazon": "Amazon"}
    for name, ok in status.items():
        print(f"  {labels[name]}: {'APIキーあり' if ok else '未設定'}")
    if not any(status.values()):
        print("  APIキーが無いため、サンプルデータで動きます。")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, keys))
    url = f"http://127.0.0.1:{args.port}/price/"
    print(f"起動しました: {url}  （終了は Ctrl+C）", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
