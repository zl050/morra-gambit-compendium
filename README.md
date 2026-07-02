# Smith-Morra Repertoire Viewer

A standalone static website for browsing a curated Smith-Morra Gambit repertoire
by chapter, on an interactive board. Select a chapter or search by PGN/FEN, step
through the lines and practise White's moves in quiz mode.

## Acknowledgements

The repertoire draws on ideas and selected lines from *Mayhem in the Morra*
(2012) by **Marc Esserman** — with thanks to the author for the foundational
work behind this opening. The lines have been modified and restructured
through original analysis, rather than reproduced from the book.

Coverage is not yet comprehensive and will continue to expand.

## Development

Requires [pnpm](https://pnpm.io/) and Python. PGN files in `data/pgn/` are the
editable source of truth; the export script regenerates `data/repertoire.json`.

```powershell
python -m pip install python-chess
pnpm install
python scripts/export_repertoire_json.py
pnpm run dev
```

## License & attribution

**GPL-3.0-or-later** — see [LICENSE](LICENSE). Bundles
[`chessground`](https://github.com/lichess-org/chessground) (GPL-3.0-or-later)
and [`chess.js`](https://github.com/jhlywa/chess.js) (BSD-2-Clause).
Move-navigation icons are from the
[lichess icon font](https://github.com/lichess-org/lila) (AGPL-3.0-or-later).
