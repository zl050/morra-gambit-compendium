#!/usr/bin/env python3
"""Fetch lichess cloud evals for every repertoire position into a static file.

The lichess cloud-eval endpoint rate-limits per-position queries too
aggressively for live use, so the whole (finite) repertoire is fetched once
at build time and served as static JSON.

Incremental: positions already in data/cloud-evals.json — including recorded
misses (null) — are skipped, and progress is saved as it goes, so an
interrupted or rate-limited run resumes where it left off.

Pass --retry-misses to re-fetch recorded misses too.

Stored positions no longer reachable from the current repertoire are pruned
before fetching.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPERTOIRE_PATH = ROOT / "data" / "repertoire.json"
OUTPUT_PATH = ROOT / "data" / "cloud-evals.json"

API_URL = "https://lichess.org/api/cloud-eval"
MULTI_PV = 3
REQUEST_INTERVAL_S = 1.0
SAVE_EVERY = 20
BACKOFF_S = 60
MAX_BACKOFFS = 3
USER_AGENT = "morra-gambit-compendium build script (https://github.com/zl050/morra-gambit-compendium)"


def main() -> int:
    args = parse_args()
    if not REPERTOIRE_PATH.exists():
        raise SystemExit(f"{REPERTOIRE_PATH} not found")

    repertoire = json.loads(REPERTOIRE_PATH.read_text(encoding="utf-8"))
    fens: list[str] = []
    seen: set[str] = set()
    for chapter in repertoire["chapters"]:
        for node in chapter["nodes"]:
            if node["fen"] not in seen:
                seen.add(node["fen"])
                fens.append(node["fen"])

    evals = json.loads(OUTPUT_PATH.read_text(encoding="utf-8")) if OUTPUT_PATH.exists() else {}

    stale = [fen for fen in evals if fen not in seen]
    if stale:
        for fen in stale:
            del evals[fen]
        print(f"pruned {len(stale)} stale position(s)")

    pending = [
        fen for fen in fens
        if fen not in evals or (args.retry_misses and evals[fen] is None)
    ]
    print(f"{len(fens)} unique positions, {len(evals)} already stored, {len(pending)} to fetch")
    if not pending:
        if stale:
            save(evals)
        return 0

    try:
        for index, fen in enumerate(pending, start=1):
            result = fetch_eval(fen)
            evals[fen] = result
            label = "no cloud analysis" if result is None else f"depth {result['depth']}"
            print(f"[{index}/{len(pending)}] {label}  {fen}", flush=True)
            if index % SAVE_EVERY == 0:
                save(evals)
            time.sleep(REQUEST_INTERVAL_S)
    except KeyboardInterrupt:
        print("\nInterrupted — progress saved; rerun to resume")
        return 1
    finally:
        save(evals)
        print(f"Saved {len(evals)} positions to {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


def fetch_eval(fen: str) -> dict | None:
    """One position's cloud eval: {depth, pvs} on a hit, None when
    lichess has no analysis (404). Retries on 429 with a fixed backoff;
    anything unrecoverable aborts the run (progress is saved by main)."""
    query = urllib.parse.urlencode({"fen": fen, "multiPv": str(MULTI_PV)})
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )

    for attempt in range(MAX_BACKOFFS + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            return {"depth": data["depth"], "pvs": data["pvs"]}
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code == 429 and attempt < MAX_BACKOFFS:
                print(f"  rate limited — backing off {BACKOFF_S}s", flush=True)
                time.sleep(BACKOFF_S)
                continue
            raise SystemExit(f"HTTP {error.code} for {fen} — progress saved, rerun to resume")
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt < MAX_BACKOFFS:
                print(f"  network error ({error}) — retrying in 5s", flush=True)
                time.sleep(5)
                continue
            raise SystemExit(f"Network failure for {fen}: {error} — progress saved, rerun to resume")
    raise AssertionError("unreachable")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--retry-misses", action="store_true",
        help="re-fetch positions previously recorded as having no cloud analysis",
    )
    return parser.parse_args()


def save(evals: dict) -> None:
    OUTPUT_PATH.write_text(json.dumps(evals, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
