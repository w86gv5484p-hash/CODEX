#!/usr/bin/env python3
"""Download attributed, freely licensed portraits from Wikimedia Commons."""

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from time import monotonic
import unicodedata
from urllib.error import URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
WIKIPEDIA = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
UPLOAD_HOST = "upload.wikimedia.org"
USER_AGENT = "SamuraiWatch/1.0 (https://github.com/w86gv5484p-hash/CODEX)"
RUN_SECONDS = 50
MAX_BYTES = 3 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
LICENSE_PATH = re.compile(r"/(?:licenses/(by|by-sa)/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:/[a-z-]+)?|publicdomain/zero/1\.0)/?")
VERIFICATION_METHOD = "commons-single-person-v1"
PERSON_ID = re.compile(r"Q[1-9]\d*")
MEDIA_ID = re.compile(r"M[1-9]\d*")
PORTRAIT_CAPTION = re.compile(r"\b(?:portrait|headshot|head shot|profile photo(?:graph)?)\b|肖像|顔写真|ポートレート", re.I)
GROUP_CAPTION = re.compile(
    r"\b(?:group|team (?:photo(?:graph)?|portrait)|line ?up|alongside|and|with|from (?:the )?(?:left|right))\b"
    r"|集合写真|チーム写真|記念撮影|左から|右から|と一緒|とともに",
    re.I,
)


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

    def read(self, url):
        seconds = min(8, self.deadline - monotonic())
        if seconds <= 0:
            raise PortraitError("The portrait update time limit was reached.")
        request = Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with self.opener.open(request, timeout=seconds) as reply:
                content = bytearray()
                while len(content) <= MAX_BYTES and monotonic() < self.deadline:
                    chunk = reply.read(64 * 1024)
                    if not chunk:
                        return bytes(content), reply.headers.get_content_type()
                    content.extend(chunk)
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

    def media_entities(self, ids):
        entities = self.request_json(COMMONS, action="wbgetentities", ids="|".join(ids)).get("entities")
        if not isinstance(entities, dict):
            raise PortraitError("Wikimedia Commons did not return structured file information.")
        return entities


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


def selected_article_images(result, players):
    articles = result["pages"]
    names = {row["id"]: name_forms(row["latin"]) for row in players}
    images = {}
    for article in articles:
        title = re.sub(r"\s*\([^)]*\)$", "", article.get("title", ""))
        image = article.get("pageimage")
        entity = article.get("pageprops", {}).get("wikibase_item", "")
        if not image or article.get("ns") != 0 or not PERSON_ID.fullmatch(entity):
            continue
        summary = " ".join([article.get("extract", ""), *article.get("terms", {}).get("description", [])]).casefold()
        if "japanese" not in summary or not re.search(r"\b(?:footballer|football player|soccer player)\b", summary):
            continue
        for player_id, forms in names.items():
            if identity(title) in forms:
                images[player_id] = (f"File:{image.replace('_', ' ')}", entity)
    return images


def valid_license(url):
    return safe_url(url, "creativecommons.org") and LICENSE_PATH.fullmatch(urlparse(url).path)


def matches_portrait_caption(description, file_label, player):
    if not PORTRAIT_CAPTION.search(identity(description) + " " + description):
        return False
    context = " ".join([description, file_label])
    if GROUP_CAPTION.search(identity(context) + " " + context):
        return False
    normalized = " " + identity(description) + " "
    japanese_name = re.sub(r"\s+", "", unicodedata.normalize("NFKC", player.get("name", "")))
    japanese_description = re.sub(r"\s+", "", unicodedata.normalize("NFKC", description))
    japanese_match = bool(re.search(r"[\u3400-\u9fff]", japanese_name)) and japanese_name in japanese_description
    return japanese_match or any(f" {name} " in normalized for name in name_forms(player["latin"]))


def media_id(page):
    page_id = page.get("pageid")
    return f"M{page_id}" if type(page_id) is int and page_id > 0 and page.get("ns") == 6 else ""


def depicts_only(entity, media, person):
    if entity.get("id") != media or entity.get("type") != "mediainfo":
        return False
    properties = entity.get("statements", entity.get("claims", {}))
    depicted = [statement.get("mainsnak", {}).get("datavalue", {}).get("value")
                for statement in properties.get("P180", []) if statement.get("rank") != "deprecated"]
    return bool(depicted) and all(isinstance(value, dict) and value.get("id") == person for value in depicted)


def decide_photo(page, player, person, entity):
    images = page.get("imageinfo", [])
    media = media_id(page)
    if not images or not media or not depicts_only(entity, media, person):
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

    file_label = " ".join([page["title"], metadata_text(fields, "ObjectName")])
    if not matches_portrait_caption(metadata_text(fields, "ImageDescription"), file_label, player):
        return None

    file_url = info.get("thumburl") or info.get("url", "")
    source_url = info.get("descriptionurl", "")
    if not safe_url(file_url, UPLOAD_HOST, "/wikipedia/commons/"):
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


def refresh(client, players, available):
    pending = [row for row in players if row["id"] not in available]
    if not pending:
        return False
    articles = client.query(
        WIKIPEDIA, titles="|".join(row["latin"] for row in pending), redirects=1,
        prop="pageimages|pageterms|extracts|pageprops", piprop="name", pilicense="free", ppprop="wikibase_item",
        wbptterms="description", exintro=1, explaintext=1, exsentences=2, exlimit="max",
    )
    images = selected_article_images(articles, pending)
    if not images:
        return True

    commons = client.query(
        COMMONS, titles="|".join(dict.fromkeys(title for title, _ in images.values())), redirects=1,
        prop="imageinfo", iiprop="url|mime|size|extmetadata", iiurlwidth=640,
        iiextmetadatafilter="Artist|LicenseShortName|LicenseUrl|ObjectName|ImageDescription",
    )
    redirects = {row["from"]: row["to"] for row in commons.get("normalized", []) + commons.get("redirects", [])}
    files = {row["title"]: row for row in commons["pages"]}
    ids = list(dict.fromkeys(media_id(page) for page in commons["pages"] if media_id(page)))
    entities = client.media_entities(ids) if ids else {}
    for player in pending:
        player_id = player["id"]
        if player_id not in images:
            continue
        title, person = images[player_id]
        page = files.get(redirects.get(title, title))
        choice = decide_photo(page, player, person, entities.get(media_id(page), {})) if page else None
        if not choice:
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
        if refresh(Wikimedia(), list(players.values()), available):
            save_snapshot(output, available, datetime.now(timezone.utc).isoformat(timespec="seconds"))
        count = len(players.keys() & available.keys())
        print(f"Verified portraits available for {count} of {len(players)} roster players.")
        return 0
    except (PortraitError, KeyError, ValueError, OSError) as exc:
        print(f"Portrait refresh could not be completed. Previously verified records were kept. {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
