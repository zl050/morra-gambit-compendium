#!/usr/bin/env python3
"""Export chapter PGNs to a compact browser JSON tree.

Each source PGN repurposes a few standard fields as export conventions:
  - The "Black" header holds the chapter title.
  - The root comment holds the chapter description.
  - "[%entry]" marks the starting position.
All three are required — there is no generated fallback.
"""

from __future__ import annotations

import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for local_package_dir in (ROOT / ".pydeps", ROOT / ".python-packages"):
    if local_package_dir.exists():
        sys.path.insert(0, str(local_package_dir))

try:
    import chess.pgn
except ImportError as exc:
    raise SystemExit(
        "Missing dependency: python-chess."
    ) from exc


PGN_DIR = ROOT / "data" / "chapters"
OUTPUT_PATH = ROOT / "data" / "chapters.json"
REQUIRED_HEADERS = ("Black",)

# Standard PGN move-quality suffix annotations (Numeric Annotation Glyphs).
# python-chess parses "?!" etc. out of the move text into node.nags rather
# than keeping it in the SAN, so it has to be re-attached here for display.
NAG_SUFFIXES = {
    chess.pgn.NAG_GOOD_MOVE: "!",
    chess.pgn.NAG_MISTAKE: "?",
    chess.pgn.NAG_SPECULATIVE_MOVE: "!?",
    chess.pgn.NAG_DUBIOUS_MOVE: "?!",
}

ENTRY_MARKER_RE = re.compile(r"\[%entry\]\s*")


def extract_entry_marker(comment: str) -> tuple[bool, str]:
    match = ENTRY_MARKER_RE.search(comment)
    if not match:
        return False, comment
    return True, comment[: match.start()] + comment[match.end() :]


@dataclass(frozen=True)
class ExportContext:
    chapter_id: str
    nodes: list[dict]
    entry: list


def main() -> int:
    chapters = []
    for pgn_path in sorted(PGN_DIR.glob("ch*.pgn"), key=chapter_sort_key):
        chapters.append(export_chapter(pgn_path))

    if not chapters:
        raise SystemExit(f"No PGN files found in {PGN_DIR}")

    payload = {"chapters": chapters}
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Exported {len(chapters)} chapters to {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


HEADER_LINE_RE = re.compile(r'^\[\w+ ".*"\]\s*$')


def normalized_pgn_text(pgn_path: Path) -> str:
    # Drop blank lines in the movetext: python-chess's reader treats a blank
    # line as a game separator. Blank lines inside a {...} comment are kept, so
    # a comment can carry intentional paragraph breaks.
    lines = pgn_path.read_text(encoding="utf-8").splitlines()
    header_end = 0
    while header_end < len(lines) and HEADER_LINE_RE.match(lines[header_end]):
        header_end += 1
    body = []
    depth = 0
    for line in lines[header_end:]:
        if line.strip() or depth > 0:
            body.append(line)
        depth += line.count("{") - line.count("}")
    return "\n".join(lines[:header_end] + [""] + body) + "\n"


def export_chapter(pgn_path: Path) -> dict:
    handle = io.StringIO(normalized_pgn_text(pgn_path))
    game = chess.pgn.read_game(handle)
    trailing = handle.read().strip()

    if game is None:
        raise ValueError(f"{pgn_path.name}: no PGN game found")
    if trailing:
        raise ValueError(f"{pgn_path.name}: expected exactly one PGN game")
    if getattr(game, "errors", None):
        raise ValueError(f"{pgn_path.name}: PGN parse errors: {game.errors}")

    validate_headers(pgn_path, game)

    chapter_id = chapter_id_from_path(pgn_path)
    root_board = game.board()
    root_id = f"{chapter_id}-root"
    root_has_entry, root_comment = extract_entry_marker(game.comment)
    context = ExportContext(
        chapter_id=chapter_id,
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
        entry=[root_id if root_has_entry else None],
    )

    walk_variations(game, root_board, root_id, context, parent_is_mainline=True)

    if context.entry[0] is None:
        raise ValueError(f"{pgn_path.name}: no [%entry] marker found")

    return {
        "id": chapter_id,
        "title": game.headers["Black"],
        "sourcePgn": pgn_path.name,
        "rootFen": root_board.fen(),
        "description": chapter_description(pgn_path, root_comment),
        "openingEntryNodeId": context.entry[0],
        "nodes": context.nodes,
    }


def walk_variations(parent_node, board, parent_id: str, context: ExportContext, parent_is_mainline: bool) -> None:
    parent_payload = node_by_id(context.nodes, parent_id)

    for variation_index, child_node in enumerate(parent_node.variations):
        move = child_node.move
        san = board.san(move)
        next_board = board.copy(stack=False)
        next_board.push(move)

        child_id = f"{context.chapter_id}-n{len(context.nodes)}"
        child_is_mainline = parent_is_mainline and variation_index == 0
        payload = {
            "id": child_id,
            "parentId": parent_id,
            "san": san,
            "uci": move.uci(),
            "ply": next_board.ply(),
            "fen": next_board.fen(),
            "children": [],
            "isMainline": child_is_mainline,
        }

        raw_comment = child_node.comment
        if context.entry[0] is None:
            has_entry, raw_comment = extract_entry_marker(raw_comment)
            if has_entry:
                context.entry[0] = child_id

        comment = normalize_comment(raw_comment)
        if comment:
            payload["description"] = comment

        suffix = "".join(NAG_SUFFIXES[nag] for nag in sorted(child_node.nags) if nag in NAG_SUFFIXES)
        if suffix:
            payload["sanSuffix"] = suffix

        context.nodes.append(payload)
        parent_payload["children"].append(child_id)
        walk_variations(child_node, next_board, child_id, context, child_is_mainline)


def validate_headers(pgn_path: Path, game) -> None:
    missing = [header for header in REQUIRED_HEADERS if game.headers.get(header, "?") == "?"]
    if missing:
        raise ValueError(f"{pgn_path.name}: missing required headers: {', '.join(missing)}")

    has_fen = bool(game.headers.get("FEN"))
    has_setup = game.headers.get("SetUp") == "1"
    if has_fen != has_setup:
        raise ValueError(f"{pgn_path.name}: FEN and SetUp \"1\" must be provided together")


CHAPTER_FILENAME_RE = re.compile(r"ch(\d+)\.pgn")


def chapter_id_from_path(pgn_path: Path) -> str:
    match = CHAPTER_FILENAME_RE.fullmatch(pgn_path.name)
    if not match:
        raise ValueError(f"Unexpected PGN filename: {pgn_path.name}")
    return f"ch{int(match.group(1))}"


def chapter_sort_key(pgn_path: Path) -> int:
    return int(CHAPTER_FILENAME_RE.fullmatch(pgn_path.name).group(1))


def chapter_description(pgn_path: Path, root_comment: str) -> str:
    comment = " ".join(root_comment.split())
    if not comment:
        raise ValueError(f"{pgn_path.name}: missing root comment")
    return comment


def normalize_comment(comment: str) -> str:
    return " ".join(comment.split())


def node_by_id(nodes: list[dict], node_id: str) -> dict:
    for node in nodes:
        if node["id"] == node_id:
            return node
    raise KeyError(node_id)


if __name__ == "__main__":
    sys.exit(main())
