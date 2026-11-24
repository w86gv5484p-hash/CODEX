---
name: refresh-nsx-data
description: Refresh the NSX (NA1) section's parts-supply data in nsx/data/ from Honda's official pages with scripts/update_nsx_supply.py, and stage only the changed NSX files. Use when the user asks to update NSX 部品供給, 継続供給リスト, parts catalog, or why nsx/data/supply.json looks stale. Not for the Japan national team data (use refresh-samurai-data).
---

# Refresh NSX parts-supply data

Scope: the NSX section only — `nsx/data/supply.json` and `nsx/data/supply-list.json`. Never run other scripts or stage anything under `data/`. `nsx/data/vehicle.json` and `photos.json` are hand-curated, so leave them alone.

CI does the same work in `.github/workflows/refresh-nsx.yml` (daily).

## Procedure
1. Install the document readers the workflow uses: `python3 -c "import pypdf, openpyxl" || pip install --quiet pypdf openpyxl`. Without `pypdf` the PDF part lists are silently skipped.
2. Run `python3 scripts/update_nsx_supply.py; echo $?` from the repo root. Exit 1 means no source could be fetched; the old part lists are kept.
3. Check what really changed:
   - `checkedAt` changes on every run, even a failed one, so a non-empty diff proves nothing.
   - In `supply.json`, look at `ok`, each `sources[].ok` / `error`, the counts of `partNumbers` and `catalogNumbers`, and the newest entry in `changes`.
   - A sharp drop in counts (e.g. to 0) suggests a parse failure. Check `diagnostics` before keeping it.
   - If every source failed, restore with `git checkout -- nsx/data/` and report the errors.
4. Stage `nsx/data/supply.json`, plus `nsx/data/supply-list.json` if it changed (the script rewrites it only when it parsed list rows). Commit only if the user asked.

Report which Honda pages were fetched, which failed (their data stays old), and the old→new counts. If only `checkedAt` moved, say that nothing in the supply data changed.
