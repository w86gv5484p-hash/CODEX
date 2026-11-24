---
name: refresh-samurai-data
description: Refresh the SAMURAI WATCH (Japan national team) data in data/ and assets/portraits/ — fixtures, 招集メンバー, FIFA ranking, JFA profiles, FPL, 負傷ニュース, club appearances, player portraits — by running scripts/ and staging only changed files. Use when the user asks to update/refresh/sync 代表データ, "最新データに更新", or asks why data/*.json looks stale. Not for NSX (use refresh-nsx-data).
---

# Refresh SAMURAI WATCH data

Scope: the Japan national team app only — `data/` and `assets/portraits/`. Never run NSX scripts or stage anything under `nsx/`. If the user also wants NSX data, run the `refresh-nsx-data` skill as a separate step.

## Scripts and outputs
| Script | Writes | Reads / needs | Run by CI |
|---|---|---|---|
| `update_squad.py` | `data/current-squad.json` (call-up snapshot) | public archive of JFA announcements | **no** (only `run_local.py`) |
| `refresh_jfa.py` | `data/jfa.json` (fixtures, results, announcements) | JFA | `refresh-jfa.yml` |
| `update_ranking.py` | `data/ranking.json` | FIFA | `refresh-jfa.yml` |
| `update_jfa_profiles.py` | `data/jfa-profiles.json` (links only) | `current-squad.json` | `refresh-jfa.yml` |
| `update_fpl.py` | `data/fpl.json` | official FPL | `refresh-jfa.yml` |
| `update_injury_news.py` | `data/injury-news.json` (headlines, unverified) | `current-squad.json` | `refresh-jfa.yml` |
| `update_clubs.py` | `data/clubs.json` | env `API_FOOTBALL_KEY` (+ optional `API_FOOTBALL_REQUEST_BUDGET`, default 90), `current-squad.json` | `refresh-clubs.yml` |
| `update_portraits.py` | `data/portraits.json`, `assets/portraits/` | Wikimedia Commons, `current-squad.json` | `refresh-portraits.yml` (weekly) |

`data/players.json`, `data/current-clubs.json`, `data/lineups.json`, `data/player-biographies.json` are hand-curated: no script updates them, so don't edit them during a refresh.

## Procedure
1. Pick the scripts the request needs. For a general refresh: `update_squad.py` first (others read its output), then the `refresh-jfa.yml` order: `refresh_jfa.py`, `update_ranking.py`, `update_jfa_profiles.py`, `update_fpl.py`, `update_injury_news.py`. Add `update_clubs.py` / `update_portraits.py` only when asked about clubs or photos.
2. Run each from the repo root (`python3 scripts/<name>.py; echo $?`). The scripts keep the previous data on failure. Treat the run as failed only if both `refresh_jfa.py` and `update_ranking.py` fail (same rule as CI); report any other failure per source.
3. Check that each source really updated. Exit 0 is not proof:
   - `update_clubs.py` exits 0 and changes nothing when `API_FOOTBALL_KEY` is unset (no proxy supplies it). Check the variable's presence (never print its value) and say so if it is missing; the fix is the repo secret / a local env var.
   - `ranking.json`: compare `publishedAt`, not `checkedAt`. `checkedAt` moves on every run.
   - `jfa.json`: every `feeds.*.status` should be `ok`.
   - `current-squad.json`: "変更はありません" means the archive has nothing newer yet; compare against the newest call-up in `jfa.json`.
4. `git diff --stat` and skim: dates and counts should move plausibly.
5. Stage only the changed files from the table above. Commit only if the user asked.

Report which sources actually updated, which kept old data, and why. A quiet failure looks just like "no change".
