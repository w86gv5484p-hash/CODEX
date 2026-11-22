"""Export the static app as one self-contained HTML file."""

import argparse
from base64 import b64encode
from datetime import datetime, timedelta, timezone
import json
import mimetypes
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9), "JST")
CSS_URL = re.compile(r'''url\(\s*(["']?)([^"')]+)\1\s*\)''')
SNAPSHOT_POLICY = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data:; base-uri 'none'"
)
OFFLINE_CSS = """
.offline-banner {
  margin-block: 14px 0;
  padding: 10px 14px;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 3px 12px;
  border: 1px solid #cbd6ec;
  border-radius: 12px;
  background: #e9effb;
  color: #21396c;
  font-size: 13px;
  line-break: strict;
}
.offline-banner time { white-space: nowrap; }
"""


def data_url(relative_path):
    path = (ROOT / relative_path).resolve()
    if not path.is_relative_to(ROOT / "assets"):
        raise ValueError(f"Asset outside the application asset directory: {relative_path}")
    mime_type, _ = mimetypes.guess_type(path)
    if mime_type is None:
        raise ValueError(f"Unrecognized asset type: {relative_path}")
    encoded = b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def replace_entry(html, original, replacement):
    if html.count(original) != 1:
        raise ValueError(f"Expected one export entry in index.html: {original}")
    return html.replace(original, replacement, 1)


def build_snapshot(exported_at):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    javascript = (ROOT / "app.js").read_text(encoding="utf-8")
    embedded_feeds = {
        f"./data/{path.name}": json.loads(path.read_text(encoding="utf-8"))
        for path in sorted((ROOT / "data").glob("*.json"))
    }
    portraits = embedded_feeds.get("./data/portraits.json", {}).get("portraits", [])
    for portrait in portraits:
        asset = portrait["path"]
        if (ROOT / asset).is_file():
            portrait["path"] = data_url(asset)
    feed_json = json.dumps(embedded_feeds, ensure_ascii=False, separators=(",", ":"))
    # Escape the raw-text element boundary without changing the decoded data.
    feed_json = feed_json.replace("<", "\\u003c")
    if re.search(r"</script", javascript, re.IGNORECASE):
        raise ValueError("app.js contains an HTML closing-script tag")

    module = f'''<script id="offline-feeds" type="application/json">{feed_json}</script>
  <script type="module">
const offlineFeeds = JSON.parse(document.querySelector("#offline-feeds").textContent);
const fetch = async url => new Response(JSON.stringify(offlineFeeds[url] ?? {{}}), {{
  status: Object.hasOwn(offlineFeeds, url) ? 200 : 404,
  headers: {{ "Content-Type": "application/json" }},
}});
const setInterval = () => undefined;

{javascript}
  </script>'''
    export_label = exported_at.strftime("%Y/%m/%d %H:%M JST")
    banner = f'''  <aside class="shell" aria-label="閲覧モード">
    <p class="offline-banner"><strong>オフライン保存版</strong>
      <time datetime="{exported_at.isoformat(timespec='seconds')}">{export_label}</time>
      <span>保存時点のデータを表示します。自動更新はありません。</span>
    </p>
  </aside>
'''

    css = CSS_URL.sub(lambda match: f'url("{data_url(match[2].strip())}")', css)
    html = replace_entry(html, "<head>", f'<head>\n  <meta http-equiv="Content-Security-Policy" content="{SNAPSHOT_POLICY}">')
    html = replace_entry(html, './assets/favicon.svg', data_url("assets/favicon.svg"))
    html = replace_entry(html, '<link rel="stylesheet" href="./styles.css">', f"<style>\n{css}\n{OFFLINE_CSS}\n  </style>")
    html = replace_entry(html, '<script type="module" src="./app.js"></script>', module)
    html = replace_entry(html, '  <main id="main"', f'{banner}  <main id="main"')
    return html


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Destination HTML file")
    args = parser.parse_args()
    exported_at = datetime.now(JST)
    result = build_snapshot(exported_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
