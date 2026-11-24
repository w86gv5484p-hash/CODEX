---
name: refresh-data
description: Refresh this repo's generated data (Japan fixtures/call-ups, FIFA ranking, JFA profiles, FPL, injury news, club stats, NSX parts supply) by running the scripts in scripts/ and committing only the changed data files. Use whenever the user says update/refresh/sync data, "最新データに更新", fixtures, 招集メンバー, ランキング, 負傷ニュース, NSX 部品供給, or asks why data/*.json looks stale.
---

# Refresh generated data

The JSON under `data/` and `nsx/data/` is produced by scripts in `scripts/`. CI does the same on a schedule (`.github/workflows/refresh-*.yml`), so mirror the workflows rather than inventing new orderings.

## Which script feeds which file
| Script | Output | Notes |
|---|---|---|
| `refresh_jfa.py` | `data/jfa.json` | results + JFA announcements |
| `update_ranking.py` | `data/ranking.json` | FIFA ranking |
| `update_jfa_profiles.py` | `data/jfa-profiles.json` | links only |
| `update_fpl.py` | `data/fpl.json` | official FPL data |
| `update_injury_news.py` | `data/injury-news.json` | headlines only, unverified |
| `update_squad.py` / `update_clubs.py` | `data/current-*.json`, `data/clubs.json` | clubs needs API-FOOTBALL (the proxy injects the key; no manual key) |
| `update_portraits.py` | `data/portraits.json` | Wikimedia Commons, licensed images only |
| `update_nsx_supply.py` | `nsx/data/supply.json` | Honda official pages |

## Procedure
1. Check `.github/workflows/refresh-*.yml` for the current script order and which files each workflow commits.
2. Run the needed scripts from the repo root (`python scripts/<name>.py`). A failing source should keep the previous data; treat a failure as non-fatal unless both `refresh_jfa.py` and `update_ranking.py` fail.
3. Run `git diff --stat` and skim the diff: dates and counts should move plausibly. Report which scripts failed and which data stayed old.
4. Stage only the data files that changed. Commit only if the user asked.

Why: the scripts are written to keep old data on failure, so a quiet failure looks like "no change". Always say which sources actually updated.
