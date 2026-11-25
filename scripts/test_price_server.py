"""price_server.py の正規化とローカルAPIのテスト。実行：python3 -m unittest scripts/test_price_server.py"""

import json
from pathlib import Path
import sys
import tempfile
from threading import Thread
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import price_server as ps  # noqa: E402

FETCHED = "2026-11-25T03:00:00+00:00"


class RakutenTest(unittest.TestCase):
    def test_format_v2(self):
        data = {"items": [
            {"itemName": "A", "itemPrice": 12980, "postageFlag": 0, "pointRate": 10, "availability": 1,
             "shopName": "店A", "itemUrl": "https://item.rakuten.co.jp/a/", "mediumImageUrls": ["https://img/a.jpg"], "taxFlag": 0},
            {"itemName": "B", "itemPrice": 1000, "postageFlag": 1, "availability": 1, "taxFlag": 1},
        ]}
        a, b = ps.normalize_rakuten(data, FETCHED)
        self.assertEqual((a["price"], a["shippingFee"], a["pointRate"], a["image"]), (12980, 0, 10, "https://img/a.jpg"))
        self.assertIsNone(b["shippingFee"])           # 送料別は金額が分からない
        self.assertEqual(b["pointRate"], 1)            # 倍率なし＝通常1倍
        self.assertEqual(b["price"], 1100)             # 税抜表示を税込に換算

    def test_format_v1_wrapped(self):
        data = {"Items": [{"Item": {}}, {"item": {"itemName": "C", "itemPrice": 500, "postageFlag": 0,
                                                    "mediumImageUrls": [{"imageUrl": "https://img/c.jpg"}]}}]}
        offers = ps.normalize_rakuten(data, FETCHED)
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["image"], "https://img/c.jpg")

    def test_request_uses_header_for_access_key(self):
        url, headers = ps.rakuten_request({"RAKUTEN_APP_ID": "app", "RAKUTEN_ACCESS_KEY": "pk_x", "RAKUTEN_REFERER": "https://example.com/"}, "イヤホン", "")
        q = parse_qs(urlsplit(url).query)
        self.assertTrue(url.startswith(ps.RAKUTEN_URL))
        self.assertNotIn("accessKey", q)
        self.assertEqual(headers["accessKey"], "pk_x")
        self.assertEqual(headers["Referer"], "https://example.com/")
        self.assertEqual(q["formatVersion"], ["2"])

    def test_error_formats(self):
        self.assertEqual(ps.error_message({"error": "wrong_parameter", "error_description": "specify valid applicationId"}),
                         "wrong_parameter specify valid applicationId")
        self.assertEqual(ps.error_message({"errors": [{"errorCode": "REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING", "errorMessage": "x"}]}),
                         "REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING x")


class YahooTest(unittest.TestCase):
    def test_points_and_shipping(self):
        data = {"hits": [
            {"name": "Y", "price": 12800, "url": "https://store.shopping.yahoo.co.jp/y/", "inStock": True, "janCode": "2001234000017",
             "shipping": {"code": 2, "name": "送料無料"}, "seller": {"name": "店Y"}, "image": {"medium": "https://img/y.jpg"},
             "point": {"amount": 0, "bonusAmount": 0, "lyLimitedBonusAmount": 640}},
            {"name": "Z", "price": 900, "shipping": {"code": 3, "name": "条件付き送料無料"}, "point": {}},
        ]}
        y, z = ps.normalize_yahoo(data, FETCHED)
        self.assertEqual((y["price"], y["shippingFee"], y["points"], y["janCode"]), (12800, 0, 640, "2001234000017"))
        self.assertIsNone(z["shippingFee"])
        self.assertIsNone(z["points"])

    def test_request_uses_jan(self):
        q = parse_qs(urlsplit(ps.yahoo_request({"YAHOO_CLIENT_ID": "cid"}, "", "2001234000017")).query)
        self.assertEqual(q["jan_code"], ["2001234000017"])
        self.assertNotIn("query", q)


class AmazonTest(unittest.TestCase):
    def test_offers_v2(self):
        data = {"searchResult": {"items": [
            {"asin": "B000", "detailPageURL": "https://www.amazon.co.jp/dp/B000",
             "itemInfo": {"title": {"displayValue": "AMZ"}, "externalIds": {"eans": {"displayValues": ["2001234000017"]}}},
             "offersV2": {"listings": [
                 {"isBuyBoxWinner": False, "price": {"money": {"amount": 99999}}},
                 {"isBuyBoxWinner": True, "price": {"money": {"amount": 13200.0, "currency": "JPY"}},
                  "availability": {"type": "IN_STOCK"}, "merchantInfo": {"name": "Amazon.co.jp"}, "loyaltyPoints": {"points": 132}},
             ]}},
            {"asin": "B001", "offersV2": {"listings": []}},
        ]}}
        offers = ps.normalize_amazon(data, FETCHED)
        self.assertEqual(len(offers), 1)
        o = offers[0]
        self.assertEqual((o["price"], o["points"], o["janCode"], o["shop"]), (13200, 132, "2001234000017", "Amazon.co.jp"))
        self.assertIsNone(o["shippingFee"])  # OffersV2 は送料を返さない
        self.assertTrue(o["inStock"])

    def test_body(self):
        body = ps.amazon_body({"AMAZON_PARTNER_TAG": "tag-22"}, "イヤホン", "")
        self.assertEqual(body["marketplace"], "www.amazon.co.jp")
        self.assertIn("offersV2.listings.loyaltyPoints", body["resources"])


class KeysAndSearchTest(unittest.TestCase):
    def test_env_overrides_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "keys.json"
            path.write_text(json.dumps({"YAHOO_CLIENT_ID": "file", "UNKNOWN": "x"}), encoding="utf-8")
            keys = ps.load_keys({"YAHOO_CLIENT_ID": "env"}, path)
            self.assertEqual(keys, {"YAHOO_CLIENT_ID": "env"})
            self.assertEqual(ps.configured(keys), {"rakuten": False, "yahoo": True, "amazon": False})

    def test_no_keys_returns_mock(self):
        r = ps.search("イヤホン", "", {})
        self.assertEqual(r["mode"], "mock")
        self.assertTrue(all(o["source"] == "mock" for o in r["offers"]))

    def test_one_provider_error_does_not_stop_others(self):
        saved = dict(ps.PROVIDERS)
        try:
            ps.PROVIDERS["rakuten"] = lambda k, q, j: [{"store": "rakuten", "price": 1}]
            def boom(k, q, j):
                raise ps.ApiError("HTTP 429: too_many_requests")
            ps.PROVIDERS["yahoo"] = boom
            r = ps.search("x", "", {"RAKUTEN_APP_ID": "a", "RAKUTEN_ACCESS_KEY": "b", "YAHOO_CLIENT_ID": "c"})
            self.assertEqual(r["mode"], "live")
            self.assertEqual(len(r["offers"]), 1)
            self.assertEqual(r["providers"]["yahoo"]["state"], "error")
            self.assertEqual(r["providers"]["amazon"]["state"], "not_configured")
        finally:
            ps.PROVIDERS.clear()
            ps.PROVIDERS.update(saved)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(ps.Handler, {}))
        cls.port = cls.server.server_port
        Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def get(self, path):
        with urlopen(f"http://127.0.0.1:{self.port}{path}") as res:
            return res.status, res.headers.get("Content-Type"), res.read()

    def test_search_and_static(self):
        status, ctype, body = self.get("/api/price/search?q=%E3%82%A4%E3%83%A4%E3%83%9B%E3%83%B3")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["mode"], "mock")
        status, ctype, _ = self.get("/price/pricing.js")
        self.assertIn("javascript", ctype)

    def test_path_traversal_blocked(self):
        from urllib.error import HTTPError
        with self.assertRaises(HTTPError) as ctx:
            self.get("/price/../scripts/price_server.py")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
