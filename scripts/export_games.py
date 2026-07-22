#!/usr/bin/env python3
"""Export model-game PGNs to a compact browser JSON tree.

Mirrors export_chapters, but for standalone model games:
  - White/Black/Result/Date are real PGN headers (not repurposed).
  - The title is built from the player surnames and year.
  - No "[%entry]" marker: games always start from move 1.
  - The root comment holds the game's narrative description, and its line
    breaks are preserved.
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

import export_chapters as ec  # Importing an export, confusing the audience: reuse the chapter exporter's PGN-walking helpers
import chess.pgn

ROOT = Path(__file__).resolve().parents[1]
PGN_DIR = ROOT / "data" / "games"
OUTPUT_PATH = ROOT / "data" / "games.json"
REQUIRED_HEADERS = ("White", "Black", "Result", "Date")
VALID_RESULTS = {"1-0", "0-1", "1/2-1/2"}

GAME_FILENAME_RE = re.compile(r"g(\d+)\.pgn")


def main() -> int:
    games = [export_game(path) for path in sorted(PGN_DIR.glob("g*.pgn"), key=game_sort_key)]
    if not games:
        raise SystemExit(f"No PGN files found in {PGN_DIR}")

    OUTPUT_PATH.write_text(json.dumps({"games": games}, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Exported {len(games)} games to {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


def export_game(pgn_path: Path) -> dict:
    handle = io.StringIO(ec.normalized_pgn_text(pgn_path))
    game = chess.pgn.read_game(handle)
    trailing = handle.read().strip()

    if game is None:
        raise ValueError(f"{pgn_path.name}: no PGN game found")
    if trailing:
        raise ValueError(f"{pgn_path.name}: expected exactly one PGN game")
    if getattr(game, "errors", None):
        raise ValueError(f"{pgn_path.name}: PGN parse errors: {game.errors}")

    validate(pgn_path, game)

    game_id = game_id_from_path(pgn_path)
    root_board = game.board()
    root_id = f"{game_id}-root"
    context = ec.ExportContext(
        chapter_id=game_id,
        nodes=[
            {
                "id": root_id,
                "parentId": None,
                "san": None,
                "uci": None,
                "ply": root_board.ply(),
                "fen": root_board.fen(),
                "children": [],
                "isMainline": True,
            }
        ],
        entry=[root_id],
    )

    ec.walk_variations(game, root_board, root_id, context, parent_is_mainline=True)

    return {
        "id": game_id,
        "kind": "game",
        "title": build_title(pgn_path, game.headers),
        "sourcePgn": pgn_path.name,
        "rootFen": root_board.fen(),
        "result": game.headers["Result"],
        "description": normalize_description(pgn_path, game.comment),
        "openingEntryNodeId": root_id,
        "nodes": context.nodes,
    }


def validate(pgn_path: Path, game) -> None:
    missing = [h for h in REQUIRED_HEADERS if game.headers.get(h, "?") in ("", "?")]
    if missing:
        raise ValueError(f"{pgn_path.name}: missing required headers: {', '.join(missing)}")

    result = game.headers["Result"]
    if result not in VALID_RESULTS:
        raise ValueError(f"{pgn_path.name}: Invalid result")

    if game.headers.get("FEN") or game.headers.get("SetUp"):
        raise ValueError(f"{pgn_path.name}: games must start from the initial position (no FEN/SetUp)")

    if "[%entry]" in pgn_path.read_text(encoding="utf-8"):
        raise ValueError(f"{pgn_path.name}: [%entry] is not used for games")


def build_title(pgn_path: Path, headers) -> str:
    year = headers["Date"][:4]
    if not year.isdigit():
        raise ValueError(f"{pgn_path.name}: Date must start with a 4-digit year, got {headers['Date']!r}")
    return f"{surname(headers['White'])} – {surname(headers['Black'])}, {year}"


def surname(name: str) -> str:
    return name.split(",")[0].strip()


def normalize_description(pgn_path: Path, comment: str) -> str:
    lines = [" ".join(line.split()) for line in comment.strip().split("\n")]
    out: list[str] = []
    for line in lines:
        if line == "" and (not out or out[-1] == ""):
            continue
        out.append(line)
    while out and out[-1] == "":
        out.pop()

    text = "\n".join(out)
    if not text:
        raise ValueError(f"{pgn_path.name}: missing root comment")
    return text


def game_id_from_path(pgn_path: Path) -> str:
    match = GAME_FILENAME_RE.fullmatch(pgn_path.name)
    if not match:
        raise ValueError(f"Unexpected PGN filename: {pgn_path.name}")
    return f"g{int(match.group(1))}"


def game_sort_key(pgn_path: Path) -> int:
    return int(GAME_FILENAME_RE.fullmatch(pgn_path.name).group(1))


if __name__ == "__main__":
    sys.exit(main())
