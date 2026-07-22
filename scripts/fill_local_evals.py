#!/usr/bin/env python3
"""Analyse cloud-eval misses with local Stockfish.

fetch_cloud_evals.py records positions lichess has no analysis for as null.
This script analyses those locally (multipv=3, fixed depth) and stores the
results in the same shape as the cloud entries — plus "local": true — so the
viewer needs no changes. Scores are from White's point of view, matching the
lichess convention.

Incremental like the fetch script: only null entries are computed, progress is
saved as it goes, and an interrupted run resumes where it left off. Run after
fetch_cloud_evals.py — only positions already in the store are considered.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for local_package_dir in (ROOT / ".pydeps", ROOT / ".python-packages"):
    if local_package_dir.exists():
        sys.path.insert(0, str(local_package_dir))

try:
    import chess
    import chess.engine
except ImportError as exc:
    raise SystemExit("Missing dependency: python-chess.") from exc

EVALS_PATH = ROOT / "data" / "cloud-evals.json"

DEFAULT_ENGINE = r"C:\path\to\stockfish.exe"  # placeholder — pass --engine or edit
MULTI_PV = 3
DEFAULT_DEPTH = 20
SAVE_EVERY = 5


def main() -> int:
    args = parse_args()
    engine_path = shutil.which(args.engine) or args.engine
    if not Path(engine_path).exists():
        raise SystemExit(f"Engine not found: {args.engine} — pass --engine or edit DEFAULT_ENGINE")
    if not EVALS_PATH.exists():
        raise SystemExit(f"{EVALS_PATH} not found — run fetch_cloud_evals.py first")

    evals = json.loads(EVALS_PATH.read_text(encoding="utf-8"))
    pending = [fen for fen, data in evals.items() if data is None]
    print(f"{len(evals)} positions stored, {len(pending)} cloud misses to analyse")
    if not pending:
        return 0

    engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    try:
        engine.configure({"Threads": args.threads, "Hash": args.hash_mb})
        for index, fen in enumerate(pending, start=1):
            evals[fen] = analyse(engine, fen, args.depth)
            print(f"[{index}/{len(pending)}] depth {args.depth}  {fen}", flush=True)
            if index % SAVE_EVERY == 0:
                save(evals)
    except KeyboardInterrupt:
        print("\nInterrupted — progress saved; rerun to resume")
        return 1
    finally:
        engine.quit()
        save(evals)
        print(f"Saved {len(evals)} positions to {EVALS_PATH.relative_to(ROOT)}")
    return 0


def analyse(engine, fen: str, depth: int) -> dict:
    infos = engine.analyse(chess.Board(fen), chess.engine.Limit(depth=depth), multipv=MULTI_PV)
    pvs = []
    for info in infos:
        score = info["score"].white()
        pv = {"moves": " ".join(move.uci() for move in info.get("pv", []))}
        if score.is_mate():
            pv["mate"] = score.mate()
        else:
            pv["cp"] = score.score()
        pvs.append(pv)
    return {
        "depth": min(info.get("depth", 0) for info in infos),
        "pvs": pvs,
        "local": True,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--engine", default=DEFAULT_ENGINE, help="path to a UCI engine binary")
    parser.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--hash-mb", type=int, default=256, dest="hash_mb")
    return parser.parse_args()


def save(evals: dict) -> None:
    # Write-then-replace so an interrupted run can't corrupt the store.
    tmp = EVALS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(evals, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(EVALS_PATH)


if __name__ == "__main__":
    sys.exit(main())
