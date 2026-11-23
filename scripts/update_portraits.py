#!/usr/bin/env python3
"""Download attributed, freely licensed portraits from Wikimedia Commons."""

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from time import monotonic, sleep
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
WIKIPEDIA = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
UPLOAD_HOSTS = ("upload.wikimedia.org", "thumb.wikimedia.org")
USER_AGENT = "SamuraiWatch/1.0 (https://github.com/w86gv5484p-hash/CODEX)"
RUN_SECONDS = 240
MAX_BYTES = 3 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
LICENSE_PATH = re.compile(r"/(?:licenses/(by|by-sa)/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:/[a-z-]+)?|publicdomain/zero/1\.0)/?(?:deed\.[a-zA-Z-]+)?")
VERIFICATION_METHOD = "wikipedia-wikidata-birthdate-v1"
PERSON_ID = re.compile(r"Q[1-9]\d*")
MEDIA_ID = re.compile(r"M[1-9]\d*")



class PortraitError(Exception):
    pass


def safe_url(url, host, prefix="/"):
    try:
        parts = urlparse(url)
        return (
            parts.scheme == "https" and parts.hostname == host
            and parts.port in (None, 443) and parts.username is None
            and parts.path.startswith(prefix)
        )
    except ValueError:
        return False


class WikimediaRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, message, headers, newurl):
        if not safe_url(newurl, urlparse(req.full_url).hostname):
            raise PortraitError("Wikimedia returned an unexpected redirect.")
        return super().redirect_request(req, fp, code, message, headers, newurl)


class Wikimedia:
    def __init__(self):
        self.opener = build_opener(WikimediaRedirect())
        self.deadline = monotonic() + RUN_SECONDS

    def read(self, url, attempt=0):
        seconds = min(8, self.deadline - monotonic())
        if seconds <= 0:
            raise PortraitError("The portrait update time limit was reached.")
        request = Request(url, headers={"User-Agent": USER_AGENT})
        sleep(1)  # stay well under Wikimedia's request-rate limits
        try:
            with self.opener.open(request, timeout=seconds) as reply:
                content = bytearray()
                while len(content) <= MAX_BYTES and monotonic() < self.deadline:
                    chunk = reply.read(64 * 1024)
                    if not chunk:
                        return bytes(content), reply.headers.get_content_type()
                    content.extend(chunk)
        except HTTPError as exc:
            if exc.code == 429 and attempt < 3 and monotonic() + 10 < self.deadline:
                sleep(5 * (attempt + 1))
                return self.read(url, attempt + 1)
            raise PortraitError(f"Wikimedia returned HTTP {exc.code} for {urlparse(url).hostname}.") from exc
        except (URLError, OSError) as exc:
            raise PortraitError(f"Wikimedia could not be reached for {urlparse(url).hostname}.") from exc
        raise PortraitError("Wikimedia response exceeded the size or time limit.")

    def request_json(self, endpoint, **parameters):
        query = urlencode({"format": "json", "formatversion": "2", **parameters})
        content, _ = self.read(f"{endpoint}?{query}")
        try:
            result = json.loads(content)
            if not isinstance(result, dict) or "error" in result:
                raise ValueError("response")
            return result
        except (TypeError, ValueError) as exc:
            raise PortraitError("Wikimedia did not return readable metadata.") from exc

    def query(self, endpoint, **parameters):
        try:
            result = self.request_json(endpoint, action="query", **parameters)["query"]
            if not isinstance(result["pages"], list):
                raise ValueError("pages")
            return result
        except (KeyError, TypeError, ValueError) as exc:
            raise PortraitError("Wikimedia did not return a readable page list.") from exc


class MetadataText(HTMLParser):
    def __init__(self, value):
        super().__init__()
        self.chunks = []
        self.feed(value)

    def handle_data(self, data):
        self.chunks.append(data)


def metadata_text(fields, name):
    value = fields.get(name, {}).get("value", "")
    return " ".join(" ".join(MetadataText(value).chunks).split())


def identity(value):
    folded = unicodedata.normalize("NFKD", value.casefold())
    plain = "".join(char for char in folded if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", plain))


def name_forms(value):
    words = identity(value).split()
    if len(words) < 2:
        return set()
    return {" ".join(words), " ".join(reversed(words))}


def article_matches(article):
    """True when a Wikipedia article is about a Japanese footballer."""
    if article.get("ns") != 0 or article.get("missing"):
        return False
    if not PERSON_ID.fullmatch(article.get("pageprops", {}).get("wikibase_item", "")):
        return False
    summary = " ".join(article.get("terms", {}).get("description", [])).casefold()
    return "japan" in summary and re.search(r"football|soccer", summary) is not None


def candidate_titles(player, birth_dates):
    latin = player["latin"]
    titles = [latin, f"{latin} (footballer)"]
    year = birth_dates.get(player["id"], "")[:4]
    if year:
        titles.append(f"{latin} (footballer, born {year})")
    return titles


def wikidata_facts(client, ids):
    facts = {}
    for chunk in (ids[i:i + 50] for i in range(0, len(ids), 50)):
        result = client.request_json(WIKIDATA, action="wbgetentities", ids="|".join(chunk), props="claims")
        for entity_id, entity in (result.get("entities") or {}).items():
            claims = entity.get("claims", {})
            def first(prop):
                for claim in claims.get(prop, []):
                    if claim.get("rank") == "deprecated":
                        continue
                    value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
                    if value:
                        return value
                return None
            birth = first("P569")
            facts[entity_id] = {
                "birth": birth.get("time", "")[1:11] if isinstance(birth, dict) else "",
                "image": first("P18") if isinstance(first("P18"), str) else "",
            }
    return facts


def selected_images(client, players, birth_dates):
    """Map player id -> (Commons file title, Wikidata id) using Wikipedia + Wikidata."""
    titles = {}
    for player in players:
        for title in candidate_titles(player, birth_dates):
            titles.setdefault(title, []).append(player["id"])
    pages = {}
    redirects = {}
    names = list(titles)
    for chunk in (names[i:i + 50] for i in range(0, len(names), 50)):
        result = client.query(
            WIKIPEDIA, titles="|".join(chunk), redirects=1,
            prop="pageimages|pageterms|pageprops", piprop="name", pilicense="free",
            ppprop="wikibase_item", wbptterms="description",
        )
        for row in result.get("normalized", []) + result.get("redirects", []):
            redirects[row["from"]] = row["to"]
        for article in result["pages"]:
            pages[article.get("title", "")] = article

    def resolve(title):
        seen = set()
        while title in redirects and title not in seen:
            seen.add(title)
            title = redirects[title]
        return pages.get(title)

    matched = {}
    for player in players:
        for title in candidate_titles(player, birth_dates):
            article = resolve(title)
            if article and article_matches(article):
                matched[player["id"]] = article
                break
    if not matched:
        return {}
    facts = wikidata_facts(client, sorted({a["pageprops"]["wikibase_item"] for a in matched.values()}))
    images = {}
    for player_id, article in matched.items():
        entity = article["pageprops"]["wikibase_item"]
        fact = facts.get(entity, {})
        expected = birth_dates.get(player_id, "")
        if expected and fact.get("birth") != expected:
            continue
        image = fact.get("image") or article.get("pageimage")
        if not image:
            continue
        images[player_id] = (f"File:{image.replace('_', ' ')}", entity)
    return images


def valid_license(url):
    return safe_url(url, "creativecommons.org") and LICENSE_PATH.fullmatch(urlparse(url).path)


def media_id(page):
    page_id = page.get("pageid")
    return f"M{page_id}" if type(page_id) is int and page_id > 0 and page.get("ns") == 6 else ""


def decide_photo(page, player, person):
    images = page.get("imageinfo", [])
    media = media_id(page)
    if not images or not media:
        return None
    info = images[0]
    fields = info.get("extmetadata", {})
    photographer = metadata_text(fields, "Artist")
    license_name = metadata_text(fields, "LicenseShortName")
    license_url = metadata_text(fields, "LicenseUrl")
    if license_url.startswith("//creativecommons.org/"):
        license_url = "https:" + license_url
    if license_url.startswith("http://creativecommons.org/"):
        license_url = "https://" + license_url.removeprefix("http://")
    if not photographer or len(photographer) > 220 or identity(photographer) in {"unknown", "unknown author"}:
        return None
    if not valid_license(license_url) or not re.fullmatch(r"CC(?:\s+BY(?:-SA)?|0)(?:\s+[\w.() -]+)?", license_name, re.I):
        return None

    file_url = info.get("thumburl") or info.get("url", "")
    source_url = info.get("descriptionurl", "")
    if not any(safe_url(file_url, host, "/wikipedia/commons/") for host in UPLOAD_HOSTS):
        return None
    if not safe_url(source_url, "commons.wikimedia.org", "/wiki/"):
        return None
    if info.get("mime") not in IMAGE_TYPES:
        return None
    if not info.get("thumburl") and info.get("size", MAX_BYTES + 1) > MAX_BYTES:
        return None
    return file_url, {
        "id": player["id"],
        "attribution": photographer,
        "license": license_name,
        "licenseUrl": license_url,
        "source": {"label": "Wikimedia Commons", "url": source_url},
        "verification": {"method": VERIFICATION_METHOD, "entity": person, "media": media},
    }


def image_extension(content, mime):
    if mime == "image/jpeg" and content.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if mime == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if mime == "image/webp" and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "webp"
    return None


def save(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temp = Path(handle.name)
            handle.write(content)
        temp.replace(path)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def is_usable(row):
    player_id = row.get("id", "")
    path = row.get("path", "")
    verification = row.get("verification", {})
    return (
        verification.get("method") == VERIFICATION_METHOD
        and PERSON_ID.fullmatch(verification.get("entity", ""))
        and MEDIA_ID.fullmatch(verification.get("media", ""))
        and re.fullmatch(r"[a-z0-9-]+", player_id)
        and path in {f"assets/portraits/{player_id}.{extension}" for extension in IMAGE_TYPES.values()}
        and (ROOT / path).is_file() and row.get("attribution") and row.get("license")
        and valid_license(row.get("licenseUrl", ""))
        and safe_url(row.get("source", {}).get("url", ""), "commons.wikimedia.org", "/wiki/")
    )


def refresh(client, players, available, birth_dates):
    pending = [row for row in players if row["id"] not in available]
    if not pending:
        return False
    images = selected_images(client, pending, birth_dates)
    if not images:
        return True
    commons = {"pages": [], "normalized": [], "redirects": []}
    file_titles = list(dict.fromkeys(title for title, _ in images.values()))
    for chunk in (file_titles[i:i + 50] for i in range(0, len(file_titles), 50)):
        result = client.query(
            COMMONS, titles="|".join(chunk), redirects=1,
            prop="imageinfo", iiprop="url|mime|size|extmetadata", iiurlwidth=500,
            iiextmetadatafilter="Artist|LicenseShortName|LicenseUrl",
        )
        for key in commons:
            commons[key].extend(result.get(key, []))
    redirects = {row["from"]: row["to"] for row in commons["normalized"] + commons["redirects"]}
    files = {row["title"]: row for row in commons["pages"]}
    for player in pending:
        player_id = player["id"]
        if player_id not in images:
            continue
        title, person = images[player_id]
        page = files.get(redirects.get(title, title))
        choice = decide_photo(page, player, person) if page else None
        if not choice:
            print(f"No reusable photo for {player['latin']}.")
            continue
        url, portrait = choice
        try:
            content, mime = client.read(url)
            extension = image_extension(content, mime)
            if extension:
                portrait["path"] = f"assets/portraits/{player_id}.{extension}"
                save(ROOT / portrait["path"], content)
                available[player_id] = portrait
        except PortraitError as exc:
            print(f"Portrait download stopped after {len(available)} matched players. {exc}")
            break
    return True


def save_snapshot(output, available, checked_at):
    snapshot = {
        "verificationMethod": VERIFICATION_METHOD,
        "checkedAt": checked_at,
        "portraits": sorted(available.values(), key=lambda row: row["id"]),
    }
    save(output, (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def main():
    output = ROOT / "data/portraits.json"
    try:
        roster = json.loads((ROOT / "data/players.json").read_text(encoding="utf-8"))
        existing = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
        squad_path = ROOT / "data/current-squad.json"
        squad = json.loads(squad_path.read_text(encoding="utf-8")) if squad_path.exists() else {}
        players = {
            row["id"]: row for row in roster["players"] + squad.get("players", [])
            if re.fullmatch(r"[a-z0-9-]+", row.get("id", "")) and name_forms(row.get("latin", ""))
        }
        previous = existing.get("portraits", [])
        available = {row["id"]: row for row in previous if row.get("id") in players and is_usable(row)}
        current_method = existing.get("verificationMethod") == VERIFICATION_METHOD
        if not current_method or len(previous) != len(available):
            save_snapshot(output, available, existing.get("checkedAt") if current_method else None)
        biographies_path = ROOT / "data/player-biographies.json"
        biographies = json.loads(biographies_path.read_text(encoding="utf-8")) if biographies_path.exists() else {}
        birth_dates = {
            row["id"]: row["birthDate"] for row in biographies.get("players", [])
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(row.get("birthDate", "")))
        }
        if refresh(Wikimedia(), list(players.values()), available, birth_dates):
            save_snapshot(output, available, datetime.now(timezone.utc).isoformat(timespec="seconds"))
        count = len(players.keys() & available.keys())
        print(f"Verified portraits available for {count} of {len(players)} roster players.")
        return 0
    except (PortraitError, KeyError, ValueError, OSError) as exc:
        print(f"Portrait refresh could not be completed. Previously verified records were kept. {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
