import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import 'chessground/assets/chessground.base.css';
import './style.css';
import './board-theme.css';
import './pieces-merida.css';
import { initSounds, playMove } from './sound.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GENERAL_DESCRIPTION =
  'Get started by selecting a chapter or searching by PGN/FEN.';

// Maximum positionDistance for a non-exact match to be offered as the
// "closest similar position" — roughly "about one move away"
const MAX_SIMILAR_DISTANCE = 6;

// Exact hits at or below this ply are too shallow to anchor a deviation report.
const MIN_DEVIATION_ANCHOR_PLY = 6;

const QUIZ_DESCRIPTION = 'White to move: seize the initiative with precise attack!';

// In-memory "scratch" chapter created the first time a user plays a move on the
// home page (no real chapter open).
const SCRATCH_ID = '__scratch__';

const els = {
  chapterSelect: document.querySelector('#chapter-select'),
  descriptionText: document.querySelector('#description-text'),
  board: document.querySelector('#board'),
  startLine: document.querySelector('#start-line'),
  prevMove: document.querySelector('#prev-move'),
  nextMove: document.querySelector('#next-move'),
  endLine: document.querySelector('#end-line'),
  tree: document.querySelector('#tree'),
  forkPanel: document.querySelector('#fork-panel'),
  flipBoard: document.querySelector('#flip-board'),
  toggleSearch: document.querySelector('#toggle-search'),
  searchRow: document.querySelector('#search-row'),
  searchInput: document.querySelector('#search-input'),
  searchGo: document.querySelector('#search-go'),
  searchStatus: document.querySelector('#search-status'),
  toggleExport: document.querySelector('#toggle-export'),
  exportRow: document.querySelector('#export-row'),
  exportText: document.querySelector('#export-text'),
  copyPgn: document.querySelector('#copy-pgn'),
  toggleChallenge: document.querySelector('#challenge-bot'),
  challengeRow: document.querySelector('#challenge-row'),
  quizMode: document.querySelector('#quiz-mode'),
  quizModeIcon: document.querySelector('#quiz-mode-icon'),
  quizExitIcon: document.querySelector('#quiz-exit-icon'),
  quizStatus: document.querySelector('#quiz-status'),
  treePanel: document.querySelector('#tree-panel'),
  notesBlock: document.querySelector('#notes-block'),
  enginePanel: document.querySelector('#engine-panel'),
  engineToggle: document.querySelector('#engine-toggle'),
  engineEval: document.querySelector('#engine-eval'),
  engineNote: document.querySelector('#engine-note'),
  enginePvs: document.querySelector('#engine-pvs'),
  enginePvPreview: document.querySelector('#engine-pv-preview'),
  enginePvPreviewBoard: document.querySelector('#engine-pv-preview-board'),
  engineMetaSecondary: document.querySelector('#engine-meta-secondary'),
  engineInfoBtn: document.querySelector('#engine-info-btn'),
};

const state = {
  repertoire: null,
  chapter: null,
  nodesById: new Map(),
  selectedNodeId: null,
  // Index of the armed fork option among the selected node's children.
  forkIndex: 0,
  fenIndex: new Map(),
  quizActive: false,
  engineEnabled: false,
  // Static cloud evals (data/cloud-evals.json), keyed by node FEN.
  cloudEvals: new Map(),
  // Counters for the current quiz session's summary, reset in startQuiz().
  quizCorrectCount: 0,
  quizRetryCount: 0,
  // Counter for unique ids of user-created (free-play) nodes.
  nodeSeq: 0,
  // The NOTES panel is emphasized only once, on the first home-page free-play move.
  notesEmphasized: false,
};

// `viewOnly` must stay false for the board's whole lifetime. 
// Interactivity is gated instead via movable.color / draggable.enabled.
// 
// Drawable is enabled here, at construction, since that's what binds the
// contextmenu-suppression listener — drawing works globally.
const ANNOTATION_BLUE = '#003088';
const ANNOTATION_RED = '#882020';

// chessground's eventBrush() picks one of four fixed slots by modifier; the
// slot names are colors but carry no color meaning to us, so alias them by
// modifier instead.
const SLOT_NONE = 'green'; // right-click, no modifier
const SLOT_SHIFT_CTRL = 'red'; // + Shift / Ctrl
const SLOT_ALT = 'blue'; // + Alt
const annotationBrushes = {
  [SLOT_NONE]: { key: 'g', color: ANNOTATION_BLUE, opacity: 1, lineWidth: 10 },
  [SLOT_SHIFT_CTRL]: { key: 'r', color: ANNOTATION_RED, opacity: 1, lineWidth: 10 },
  [SLOT_ALT]: { key: 'b', color: ANNOTATION_RED, opacity: 1, lineWidth: 10 },
};
const ground = Chessground(els.board, {
  fen: START_FEN,
  orientation: 'white',
  coordinates: false,
  viewOnly: false,
  movable: { free: false, color: undefined },
  draggable: { enabled: false },
  drawable: {
    enabled: true,
    defaultSnapToValidMove: false,
    brushes: annotationBrushes,
  },
});

setupBoardResize();
init();

// Resize grip lives in `.board-frame`, not chessground's DOM (`redrawAll()`
// would wipe it). Chessground rounds the board to integer square sizes, so
// it's a few px smaller than the frame and the gap varies as the frame is
// dragged — the handle is repositioned onto the rendered board's actual
// corner after every redraw instead of being pinned to the frame corner.
function setupBoardResize() {
  const frame = document.querySelector('.board-frame');
  const handle = document.querySelector('#board-resize');
  if (!frame || !handle) return;

  // 22px handle offset to overhang the corner by 9px, like lichess's -9px.
  const positionHandle = () => {
    const container = els.board.querySelector('cg-container');
    if (!container) return;
    const c = container.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    handle.style.right = 'auto';
    handle.style.bottom = 'auto';
    handle.style.left = `${Math.round(c.right - f.left) - 13}px`;
    handle.style.top = `${Math.round(c.bottom - f.top) - 13}px`;
  };

  let drag = null;
  let initialBoardSize = null;
  let pendingSize = null;
  let rafId = 0;

  const applyResize = () => {
    rafId = 0;
    if (pendingSize == null) return;
    frame.style.maxWidth = 'none';
    frame.style.width = `${pendingSize}px`;
    ground.redrawAll();
    positionHandle();
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (initialBoardSize === null) {
      initialBoardSize = frame.getBoundingClientRect().width;
    }
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      startSize: frame.getBoundingClientRect().width,
    };
    document.body.classList.add('resizing');
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const shell = frame.parentElement;
    const styles = getComputedStyle(shell.parentElement);
    const multiColumn = styles.gridTemplateColumns.split(' ').length > 1;
    const gap = parseFloat(styles.columnGap) || 0;
    // Largest size that still fits the layout cleanly.
    const layoutMax = multiColumn
      ? Math.min(shell.clientHeight, shell.clientWidth + 2 * gap)
      : shell.clientWidth;
    // Keep the zoom modest and relative to the board's initial size: 0.75x–1.25x.
    // The displayed initial size is 1.1x the original baseline.
    const baseSize = initialBoardSize / 1.1;
    const minSize = baseSize * 0.75;
    const maxSize = Math.min(baseSize * 1.25, layoutMax);
    const delta = Math.max(event.clientX - drag.startX, event.clientY - drag.startY);
    pendingSize = Math.max(minSize, Math.min(drag.startSize + delta, maxSize));
    // Coalesce to one redraw per frame so fast drags don't thrash redrawAll().
    if (!rafId) rafId = requestAnimationFrame(applyResize);
  });

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('resizing');
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    applyResize(); // flush the final size
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Reposition on first render and any later resize. cg-container may not
  // exist yet on the very first frame, so retry until chessground builds it.
  const observeBoard = () => {
    const container = els.board.querySelector('cg-container');
    if (!container) {
      requestAnimationFrame(observeBoard);
      return;
    }
    positionHandle();
    if ('ResizeObserver' in window) {
      new ResizeObserver(positionHandle).observe(container);
    }
  };
  observeBoard();
}

const SHORTCUTS = {
  ArrowLeft: selectPrevious,
  ArrowRight: selectNext,
  ArrowUp: () => moveFork(-1),
  ArrowDown: () => moveFork(1),
  f: () => ground.toggleOrientation(),
  l: toggleEnginePanel,
};

function selectedChildren() {
  if (!state.chapter) return [];
  return getSelectedNode().children.map((id) => state.nodesById.get(id));
}

function defaultForkIndex(node) {
  const children = node.children.map((id) => state.nodesById.get(id));
  if (children.length < 2) return 0;
  const mainIdx = children.findIndex((child) => child.isMainline);
  return mainIdx < 0 ? 0 : mainIdx;
}

function moveFork(direction) {
  if (state.quizActive || !state.chapter) return;
  const count = selectedChildren().length;
  if (count < 2) return;
  state.forkIndex = (state.forkIndex + direction + count) % count;
  renderFork();
}

function armedChild() {
  const children = selectedChildren();
  if (children.length === 0) return null;
  if (children.length < 2) return children[0];
  return children[state.forkIndex] || children[0];
}

function renderFork() {
  const panel = els.forkPanel;
  if (!panel) return;
  panel.textContent = '';

  const children = state.quizActive ? [] : selectedChildren();
  if (children.length < 2) {
    panel.hidden = true;
    return;
  }

  children.forEach((child, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fork-option${index === state.forkIndex ? ' armed' : ''}`;
    button.textContent = inlineLabel(child, true);
    button.dataset.id = child.id;
    panel.append(button);
  });
  panel.hidden = false;
}

async function init() {
  setDescription(GENERAL_DESCRIPTION);
  initSounds();

  try {
    const [response, evalsResponse, gamesResponse] = await Promise.all([
      fetch('./data/chapters.json', { cache: 'no-cache' }),
      fetch('./data/cloud-evals.json', { cache: 'no-cache' }).catch(() => null),
      fetch('./data/games.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!response.ok) {
      throw new Error(`Could not load chapters.json (${response.status})`);
    }
    if (evalsResponse?.ok) {
      try {
        const rawEvals = await evalsResponse.json();
        for (const [fen, data] of Object.entries(rawEvals)) {
          state.cloudEvals.set(fenKey(fen), data);
        }
      } catch {
        console.warn('cloud-evals.json is corrupt');
      }
    } else {
      console.warn('Could not load cloud-evals.json');
    }

    state.repertoire = await response.json();
    if (gamesResponse?.ok) {
      try {
        const { games } = await gamesResponse.json();
        // Appended after chapters: fenIndex insertion order doubles as search priority.
        state.repertoire.chapters.push(...games);
      } catch {
        console.warn('games.json is corrupt');
      }
    } else {
      console.warn('Could not load games.json');
    }
    state.fenIndex = buildFenIndex(state.repertoire);
    renderChapterOptions();
    restoreFromHash();
    if (!state.chapter) {
      document.documentElement.classList.add('is-home');
      applyFreePlay(START_FEN);
      updateNavigationState();
    }
  } catch (error) {
    showLoadError(error);
  }

  els.chapterSelect.addEventListener('change', () => {
    if (state.quizActive) return;
    selectChapter(els.chapterSelect.value);
  });
  els.tree.addEventListener('click', (event) => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    const node = state.nodesById.get(button.dataset.id);
    if (!node || node.id === state.selectedNodeId) return;
    playMove(node.san);
    selectNode(node.id);
  });
  els.forkPanel.addEventListener('click', (event) => {
    const button = event.target.closest('.fork-option');
    if (!button) return;
    const node = state.nodesById.get(button.dataset.id);
    if (!node) return;
    playMove(node.san);
    selectNode(node.id);
  });
  els.startLine.addEventListener('click', selectStart);
  els.prevMove.addEventListener('click', selectPrevious);
  els.nextMove.addEventListener('click', selectNext);
  els.endLine.addEventListener('click', selectEnd);
  els.flipBoard.addEventListener('click', () => ground.toggleOrientation());
  els.toggleSearch.addEventListener('click', () => toggleToolRow(els.searchRow, els.toggleSearch));
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runPositionSearch(els.searchInput.value);
    }
  });
  els.searchGo.addEventListener('click', () => runPositionSearch(els.searchInput.value));
  els.toggleExport.addEventListener('click', () => {
    const open = toggleToolRow(els.exportRow, els.toggleExport);
    if (open) refreshExportPgn();
  });
  els.copyPgn.addEventListener('click', copyExportPgn);
  els.toggleChallenge.addEventListener('click', () => toggleToolRow(els.challengeRow, els.toggleChallenge));
  els.engineToggle.addEventListener('click', toggleEnginePanel);
  setupEngineInfoTip();
  els.enginePvs.addEventListener('click', (event) => {
    if (state.quizActive) return;
    const button = event.target.closest('.engine-pv-move');
    if (!button) return;
    const isHomeFirstMove = !state.chapter;
    if (isHomeFirstMove) startScratchChapter();
    const anchor = getSelectedNode();
    const node = walkUciMoves(anchor, button.dataset.uci.split(' '));
    if (node.id === anchor.id) return;
    playMove(node.san);
    selectNode(node.id);
    if (isHomeFirstMove) emphasizeNotesOnce();
  });
  els.enginePvs.addEventListener('mouseover', (event) => {
    const button = event.target.closest('.engine-pv-move');
    if (button) showPvPreview(button);
  });
  els.enginePvs.addEventListener('mouseleave', hidePvPreview);
  els.quizMode.addEventListener('click', () => {
    if (state.quizActive) {
      endQuiz();
    } else {
      startQuiz();
    }
  });
  els.board.addEventListener(
    'wheel',
    (event) => {
      if (!state.chapter || state.quizActive) return;
      event.preventDefault();
      if (event.deltaY < 0) selectPrevious();
      if (event.deltaY > 0) selectNext();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (event) => {
    if (state.quizActive) {
      if (event.key === 'Escape') endQuiz();
      return;
    }
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const handler = SHORTCUTS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  });
  window.addEventListener('hashchange', restoreFromHash);
}

const CHAPTER_GROUP_BOUNDARIES = [
  { beforeId: 'ch1', label: 'Accepted' },
  { beforeId: 'ch11', label: 'Declined' },
  { beforeId: 'g1', label: 'Model Games' },
];

function renderChapterOptions() {
  let target = els.chapterSelect;
  for (const chapter of state.repertoire.chapters) {
    const boundary = CHAPTER_GROUP_BOUNDARIES.find((item) => item.beforeId === chapter.id);
    if (boundary) {
      target = document.createElement('optgroup');
      target.label = boundary.label;
      els.chapterSelect.append(target);
    }
    const option = document.createElement('option');
    option.value = chapter.id;
    option.textContent = chapter.title;
    target.append(option);
  }
}

function selectChapter(chapterId, preferredNodeId = null, updateHash = true) {
  const chapter = state.repertoire.chapters.find((item) => item.id === chapterId);
  if (!chapter) return;

  state.chapter = chapter;
  document.documentElement.classList.remove('is-home');
  els.notesBlock?.classList.remove('is-emphasized');
  clearQuizStatus();
  els.quizMode.disabled = chapter.kind === 'game' && chapter.result === '0-1';
  // Clone nodes into a working copy so free-play edits never mutate the shared
  // repertoire data (also backing fenIndex/search) and are discarded on switch.
  state.nodesById = new Map(
    chapter.nodes.map((node) => [node.id, { ...node, children: [...node.children] }]),
  );
  state.nodeSeq = 0;
  els.chapterSelect.value = chapter.id;

  const defaultNodeId = preferredNodeId && state.nodesById.has(preferredNodeId) ? preferredNodeId : getOpeningEntryNodeId();
  selectNode(defaultNodeId, updateHash);
}

// The opening-entry node is authored per chapter in its PGN (`[%entry]`)
function getOpeningEntryNodeId() {
  const nodeId = state.chapter.openingEntryNodeId;
  return state.nodesById.has(nodeId) ? nodeId : getRootNode().id;
}

function selectNode(nodeId, updateHash = true) {
  if (!state.chapter || !state.nodesById.has(nodeId)) return;

  state.selectedNodeId = nodeId;
  const node = getSelectedNode();
  state.forkIndex = defaultForkIndex(node);
  const description = node.description || state.chapter.description || GENERAL_DESCRIPTION;

  ground.set({
    fen: node.fen,
    lastMove: getLastMove(node),
    ...(state.quizActive ? {} : freePlayBoardConfig(node.fen)),
  });
  setDescription(description);
  updateTreeSelection(nodeId);
  renderFork();
  updateNavigationState();
  if (!els.exportRow.hidden) refreshExportPgn();
  if (state.engineEnabled) showCloudEval(node.fen);

  if (updateHash && !node.isUser && state.chapter.id !== SCRATCH_ID) {
    replaceHash(`${state.chapter.id}/${node.id}`);
  }
}

function updateTreeSelection(nodeId) {
  const target = els.tree.querySelector(`[data-id="${nodeId}"]`);
  if (!target) {
    renderTree();
    return;
  }
  els.tree.querySelector('.selected')?.classList.remove('selected');
  target.classList.add('selected');
  target.scrollIntoView({ block: 'nearest' });
}

function renderTree() {
  els.tree.textContent = '';

  if (!state.chapter) return;

  const root = getRootNode();

  if (root.children.length === 0) {
    els.tree.textContent = 'This chapter has no moves.';
    return;
  }

  const table = document.createElement('div');
  table.className = 'notation-table';
  renderMainlineRows(root, table);
  if (state.chapter.result) {
    const result = document.createElement('div');
    result.className = 'notation-result';
    result.textContent = state.chapter.result;
    table.append(result);
  }
  els.tree.append(table);

  els.tree.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

const EMPTY_MOVE = Symbol('empty-move');

function renderMainlineRows(position, table) {
  let node = position;

  while (true) {
    const white = mainlineChild(node);
    if (!white) return;
    const whiteVariations = siblingVariations(node, white);

    const black = mainlineChild(white);
    const blackVariations = black ? siblingVariations(white, black) : [];
    const number = String(Math.ceil(white.ply / 2));

    if (whiteVariations.length > 0) {
      appendMoveRow(table, number, white, EMPTY_MOVE);
      appendVariationRows(table, whiteVariations);
      if (black) appendMoveRow(table, number, EMPTY_MOVE, black);
    } else {
      appendMoveRow(table, number, white, black);
    }
    appendVariationRows(table, blackVariations);

    if (!black) return;
    node = black;
  }
}

function appendMoveRow(table, number, whiteCell, blackCell) {
  const moveNumber = document.createElement('div');
  moveNumber.className = 'notation-number';
  moveNumber.textContent = number;
  table.append(moveNumber, renderNotationCell(whiteCell), renderNotationCell(blackCell));
}

function appendVariationRows(table, variations) {
  for (const variation of variations) {
    table.append(renderVariationLine(variation, 'notation-variation-row'));
  }
}

function siblingVariations(parent, chosen) {
  return parent.children.map((id) => state.nodesById.get(id)).filter((child) => child !== chosen);
}

function renderNotationCell(node) {
  const cell = document.createElement('div');
  cell.className = 'notation-cell';

  if (!node) return cell;

  if (node === EMPTY_MOVE) {
    const empty = document.createElement('span');
    empty.className = 'notation-move-empty';
    empty.textContent = '…';
    cell.append(empty);
    return cell;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `notation-move${node.id === state.selectedNodeId ? ' selected' : ''}`;
  button.textContent = node.san + (node.sanSuffix || '');
  button.dataset.id = node.id;
  cell.append(button);
  return cell;
}

function renderMovesFrom(position, container, forceNumber) {
  let node = position;
  let force = forceNumber;

  while (true) {
    const children = node.children.map((id) => state.nodesById.get(id));
    if (children.length === 0) return;

    const main = children.find((child) => child.isMainline) || children[0];
    const variations = children.filter((child) => child !== main);

    const parenthetical = variations.length === 1 && !hasDeepBranching(variations[0]);

    if (variations.length > 0 && !parenthetical) {
      for (const child of children) {
        container.append(renderVariationLine(child, 'variation-block'));
      }
      return;
    }

    container.append(renderInlineMove(main, force));
    for (const variation of variations) {
      container.append(renderVariation(variation));
    }

    force = variations.length > 0;
    node = main;
  }
}

const VARIATION_LOOKAHEAD_PLIES = 6;

function hasDeepBranching(node, depth = VARIATION_LOOKAHEAD_PLIES) {
  if (depth <= 0) return true;
  if (node.children.length > 1) return true;
  const next = mainlineChild(node);
  return next ? hasDeepBranching(next, depth - 1) : false;
}

function renderVariation(variation) {
  const span = document.createElement('span');
  span.className = 'variation';
  const opening = document.createElement('span');
  opening.className = 'variation-open';
  opening.append(' (', renderInlineMove(variation, true));
  span.append(opening);
  renderMovesFrom(variation, span, false);
  span.append(')');
  return span;
}

function renderVariationLine(variation, className) {
  const el = document.createElement('div');
  el.className = className;
  el.append(renderInlineMove(variation, true));
  renderMovesFrom(variation, el, false);
  return el;
}

function renderInlineMove(node, forceNumber) {
  const button = document.createElement('button');
  button.type = 'button';
  const role = node.isMainline ? 'mainline' : 'sideline';
  const selected = node.id === state.selectedNodeId ? ' selected' : '';
  button.className = `notation-move-inline ${role}${selected}`;
  button.textContent = inlineLabel(node, forceNumber);
  button.dataset.id = node.id;
  return button;
}

function inlineLabel(node, forceNumber) {
  const san = node.san + (node.sanSuffix || '');
  const moveNumber = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) {
    return `${moveNumber}.${san}`;
  }
  return forceNumber ? `${moveNumber}…${san}` : san;
}

function mainlineChild(node) {
  const children = node.children.map((id) => state.nodesById.get(id));
  return children.find((child) => child.isMainline) || children[0] || null;
}

function selectStart() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  selectNode(getRootNode().id);
}

function selectPrevious() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  const node = getSelectedNode();
  if (node.parentId) {
    selectNode(node.parentId);
  }
}

function selectNext() {
  if (state.quizActive) return;
  if (!state.chapter) return;
  const next = armedChild();
  if (next) {
    playMove(next.san);
    selectNode(next.id);
  }
}

function selectEnd() {
  if (state.quizActive) return;
  if (!state.chapter) return;

  let node = getSelectedNode();
  while (node.children.length > 0) {
    node = mainlineChild(node);
  }
  if (node.id !== state.selectedNodeId) playMove(node.san);
  selectNode(node.id);
}

function updateNavigationState() {
  if (!state.chapter) {
    els.startLine.disabled = true;
    els.prevMove.disabled = true;
    els.nextMove.disabled = true;
    els.endLine.disabled = true;
    return;
  }

  const node = getSelectedNode();
  els.startLine.disabled = !node.parentId;
  els.prevMove.disabled = !node.parentId;
  els.nextMove.disabled = node.children.length === 0;
  els.endLine.disabled = node.children.length === 0;
}

function restoreFromHash() {
  if (state.quizActive) return;
  if (!state.repertoire) return;

  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const [chapterId, nodeId] = hash.split('/');
  if (chapterId) {
    selectChapter(chapterId, nodeId, false);
  }
}

function getRootNode() {
  for (const node of state.nodesById.values()) {
    if (node.parentId === null) return node;
  }
  return undefined;
}

function getSelectedNode() {
  return state.nodesById.get(state.selectedNodeId) || getRootNode();
}

function getSelectedPath() {
  const path = [];
  let node = getSelectedNode();

  while (node) {
    path.unshift(node);
    node = node.parentId ? state.nodesById.get(node.parentId) : null;
  }

  return path;
}

function getLastMove(node) {
  if (!node.uci || node.uci.length < 4) return undefined;
  return [node.uci.slice(0, 2), node.uci.slice(2, 4)];
}

function toggleToolRow(row, button) {
  row.hidden = !row.hidden;
  button.setAttribute('aria-expanded', String(!row.hidden));
  return !row.hidden;
}

// ---- Engine panel ----
//
// Evals come from lichess cloud-eval database (no local engine); 
// The toggle here is a lookup by exact node FEN.
//
// cp/mate are from White's point of view — lila normalizes Stockfish's
// side-to-move scores before storing them (lila ui/lib/src/ceval/protocol.ts).

const ENGINE_PV_MAX_PLIES = 7;

function toggleEnginePanel() {
  state.engineEnabled = !state.engineEnabled;
  els.engineToggle.setAttribute('aria-checked', String(state.engineEnabled));
  // While on, hits and misses share one fixed panel height (CSS min-height).
  els.enginePanel.classList.toggle('engine-panel--on', state.engineEnabled);
  if (state.engineEnabled) {
    showCloudEval(currentFen());
  } else {
    renderEngineIdle();
  }
}

// `hovering`/`pinned` gate the tip in JS, not CSS :hover, so a click can
// toggle it regardless of hover state. Touch has no hover, so `pinned` is
// its only path (pointerType filters mouse-only events).
function setupEngineInfoTip() {
  const info = els.engineInfoBtn.closest('.engine-info');
  let hovering = false;
  let pinned = false;
  const sync = () => info.classList.toggle('is-open', hovering || pinned);

  info.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovering = true;
    sync();
  });
  info.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovering = false;
    sync();
  });
  els.engineInfoBtn.addEventListener('click', () => {
    pinned = !pinned;
    if (!pinned) hovering = false;
    sync();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!pinned || info.contains(event.target)) return;
    pinned = false;
    sync();
  });
}

function currentFen() {
  return getSelectedNode()?.fen ?? START_FEN;
}

function showCloudEval(fen) {
  if (state.quizActive) return;
  const data = state.cloudEvals.get(fenKey(fen));
  if (data) renderCloudEval(fen, data);
  else renderEngineMiss();
}

function renderEngineIdle() {
  els.engineEval.textContent = ' ';
  els.engineMetaSecondary.textContent = '';
  els.engineNote.hidden = true;
  els.enginePvs.hidden = true;
  hidePvPreview();
}

function renderEngineMiss() {
  els.engineEval.textContent = ' ';
  els.engineMetaSecondary.textContent = '';
  els.enginePvs.hidden = true;
  els.engineNote.textContent = 'No cloud analysis for this position.';
  els.engineNote.hidden = false;
  hidePvPreview();
}

function renderCloudEval(fen, data) {
  const { depth, pvs } = data;
  els.engineEval.textContent = formatEval(pvs[0]);
  els.engineMetaSecondary.textContent = `Depth ${depth}`;
  els.engineNote.hidden = true;
  renderPvRows(fen, pvs);
  els.enginePvs.hidden = false;
}

function renderPvRows(fen, pvs) {
  hidePvPreview();
  els.enginePvs.textContent = '';
  for (const pv of pvs) {
    const row = document.createElement('div');
    row.className = 'engine-pv-row';

    const score = document.createElement('span');
    score.className = 'engine-pv-score';
    score.textContent = formatEval(pv);

    const uci = pv.moves.split(' ').slice(0, ENGINE_PV_MAX_PLIES);
    const moves = document.createElement('span');
    moves.className = 'engine-pv-moves';
    renderPvMoveButtons(moves, fen, uci);

    row.append(score, moves);
    els.enginePvs.append(row);
  }
}

// Render `uciMoves` as numbered SAN, each move its own button carrying the
// UCI prefix needed to reach it (data-uci) — clicked in the delegated
// handler below to jump the board there, extending the tree if needed.
function renderPvMoveButtons(container, fen, uciMoves) {
  const plies = pvToPlies(fen, uciMoves);
  let needSpace = false;
  const appendToken = (node) => {
    if (needSpace) container.append(' ');
    container.append(node);
    needSpace = true;
  };
  plies.forEach((ply, index) => {
    if (ply.prefix) appendToken(ply.prefix);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'engine-pv-move';
    button.textContent = ply.san;
    button.dataset.uci = uciMoves.slice(0, index + 1).join(' ');
    button.dataset.fen = ply.fen;
    appendToken(button);
  });
}

// Read-only mini board shown while hovering a PV move — one lazily-built
// Chessground instance, repositioned/re-fenned per hover.
let previewGround = null;

function getPreviewGround() {
  if (!previewGround) {
    previewGround = Chessground(els.enginePvPreviewBoard, {
      viewOnly: true,
      coordinates: false,
    });
  }
  return previewGround;
}

function showPvPreview(button) {
  const row = els.enginePvs.lastElementChild;
  if (!row) return;
  const panelRect = els.enginePanel.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  els.enginePvPreview.style.top = `${rowRect.bottom - panelRect.top}px`;
  els.enginePvPreview.style.left = `${rowRect.left - panelRect.left}px`;
  els.enginePvPreview.hidden = false;
  getPreviewGround().set({
    fen: button.dataset.fen,
    orientation: ground.state.orientation,
    lastMove: getLastMove({ uci: button.dataset.uci.split(' ').pop() }),
  });
}

function hidePvPreview() {
  els.enginePvPreview.hidden = true;
}

function formatEval(pv) {
  if (typeof pv.mate === 'number') return `#${pv.mate}`;
  const pawns = (pv.cp / 100).toFixed(1);
  if (pv.cp > 0) return `+${pawns}`;
  if (pv.cp < 0) return pawns;
  return ` ${pawns}`;
}

// lichess encodes castling as king-takes-rook (e1h1/e1a1/e8h8/e8a8), which
// chess.js rejects — normalize to the king's actual destination, guarded on
// the mover being a king since e.g. a rook e1-h1 is a legal non-castling move.
const CASTLING_UCI = {
  e1h1: 'e1g1',
  e1a1: 'e1c1',
  e8h8: 'e8g8',
  e8a8: 'e8c8',
};

// Apply one UCI move (castling-normalized) to `chess`. 
// Returns { move, uci: normalized } or null if the move is illegal/malformed.
function applyUciMove(chess, uci) {
  const normalized =
    CASTLING_UCI[uci] && chess.get(uci.slice(0, 2))?.type === 'k' ? CASTLING_UCI[uci] : uci;
  try {
    const move = chess.move({
      from: normalized.slice(0, 2),
      to: normalized.slice(2, 4),
      promotion: normalized.slice(4) || undefined,
    });
    return { move, uci: normalized };
  } catch {
    return null;
  }
}

// Walk a cloud PV, returning one entry per ply: { uci, san, prefix, fen }.
// Stops early at a malformed/illegal tail.
function pvToPlies(fen, uciMoves) {
  const chess = new Chess(fen);
  const plies = [];
  for (const uci of uciMoves) {
    const white = chess.turn() === 'w';
    const number = chess.moveNumber();
    const applied = applyUciMove(chess, uci);
    if (!applied) break; // malformed tail — keep whatever converted cleanly
    const prefix = white ? `${number}.` : plies.length === 0 ? `${number}…` : null;
    plies.push({ uci: applied.uci, san: applied.move.san, prefix, fen: chess.fen() });
  }
  return plies;
}

// Walk `uciMoves` from `anchor`, reusing existing children or creating
// synthetic side-line nodes (see attachChild). Stops early on an illegal
// move, which shouldn't happen since PV moves come from a validated eval.
function walkUciMoves(anchor, uciMoves) {
  const chess = new Chess(anchor.fen);
  let node = anchor;
  for (const uci of uciMoves) {
    const applied = applyUciMove(chess, uci);
    if (!applied) break;
    node = attachChild(node, chess.fen(), applied.move.san, applied.uci);
  }
  return node;
}

// Build a chessground `dests` map (from-square -> legal to-squares) for the
// position `fen`, via chess.js's verbose move list. Dedupe promotion entries.
function computeDests(fen) {
  const chess = new Chess(fen);
  const dests = new Map();
  for (const move of chess.moves({ verbose: true })) {
    const tos = dests.get(move.from) || [];
    if (!tos.includes(move.to)) tos.push(move.to);
    dests.set(move.from, tos);
  }
  return dests;
}

// chessground's `turnColor` is never derived from `fen` by ground.set(), so it
// must be set explicitly whenever the position changes.
function turnColorOf(fen) {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function quizSummaryMessage() {
  return `Quiz complete · ${pluralize(state.quizCorrectCount, 'move', 'moves')} · ${pluralize(state.quizRetryCount, 'retry', 'retries')}`;
}

function setQuizStatus(message, kind) {
  els.quizStatus.textContent = message;
  els.quizStatus.dataset.kind = kind;
  els.quizStatus.hidden = false;
}

// Render rich quiz feedback into #quiz-status. `parts` items are either
// strings ('\n' becomes <br>) or { button, onClick } inline buttons. Built as
// DOM, not innerHTML, so SAN text is safe and buttons can carry handlers.
function setQuizStatusContent(parts, kind) {
  els.quizStatus.replaceChildren();
  els.quizStatus.dataset.kind = kind;
  for (const part of parts) {
    if (typeof part === 'string') {
      const lines = part.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) els.quizStatus.appendChild(document.createElement('br'));
        if (line) els.quizStatus.appendChild(document.createTextNode(line));
      });
    } else if (part && part.button) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-alt-btn';
      btn.textContent = part.button;
      btn.addEventListener('click', part.onClick);
      els.quizStatus.appendChild(btn);
    }
  }
  els.quizStatus.hidden = false;
}

function clearQuizStatus() {
  els.quizStatus.hidden = true;
  els.quizStatus.textContent = '';
  delete els.quizStatus.dataset.kind;
}

function isWrongAnswer(node) {
  const suffix = node.sanSuffix || '';
  return suffix === '?' || suffix === '?!';
}

function acceptableWhiteChildren(node) {
  return node.children
    .map((id) => state.nodesById.get(id))
    .filter((child) => !isWrongAnswer(child));
}

function sanLabel(node) {
  return node.san + (node.sanSuffix || '');
}

function sanLabelSentence(node) {
  const label = sanLabel(node);
  return /[?!]$/.test(label) ? label : `${label}.`;
}

function startQuiz() {
  if (!state.chapter || state.chapter.id === SCRATCH_ID) {
    setQuizStatus('Select a chapter first.', 'error');
    return;
  }
  if (state.chapter.kind === 'game' && state.chapter.result === '0-1') return;

  const startNode = getSelectedNode();
  if (startNode.children.length === 0) {
    setQuizStatus('This is the end of the line.', 'error');
    return;
  }

  let currentNode = startNode;
  let blackOpening = false;
  if (turnColorOf(startNode.fen) === 'black') {
    // Black's opening reply uses the mainline (same rule as auto-replies during
    // the quiz, see presentBlackReply), not a random pick.
    const blackReply = mainlineChild(startNode);
    if (!blackReply || blackReply.children.length === 0) {
      setQuizStatus('This is the end of the line.', 'error');
      return;
    }
    currentNode = blackReply;
    blackOpening = true;
  }

  if (!els.searchRow.hidden) toggleToolRow(els.searchRow, els.toggleSearch);
  if (!els.exportRow.hidden) toggleToolRow(els.exportRow, els.toggleExport);
  if (!els.challengeRow.hidden) toggleToolRow(els.challengeRow, els.toggleChallenge);

  state.quizActive = true;
  state.selectedNodeId = currentNode.id;
  state.quizCorrectCount = 0;
  state.quizRetryCount = 0;

  ground.set({
    fen: currentNode.fen,
    orientation: 'white',
    turnColor: turnColorOf(currentNode.fen),
    lastMove: getLastMove(currentNode),
    movable: {
      free: false,
      color: 'white',
      dests: computeDests(currentNode.fen),
      showDests: false,
      events: { after: onUserMove },
    },
    draggable: { enabled: true },
    selectable: { enabled: true },
  });

  if (blackOpening) {
    renderOpeningBlackStatus(startNode, currentNode);
  } else {
    setQuizStatus(QUIZ_DESCRIPTION, 'info');
  }

  els.treePanel.hidden = true;

  els.chapterSelect.disabled = true;
  els.startLine.disabled = true;
  els.prevMove.disabled = true;
  els.nextMove.disabled = true;
  els.endLine.disabled = true;
  els.flipBoard.disabled = true;
  els.toggleSearch.disabled = true;

  els.quizMode.querySelector('.tool-label').textContent = 'Quit quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'true');
  els.quizMode.setAttribute('aria-label', 'Quit quiz mode');
  els.quizMode.title = 'Quit quiz mode';
  els.quizModeIcon.style.display = 'none';
  els.quizExitIcon.style.display = '';
}

function endQuiz(message, kind) {
  state.quizActive = false;

  ground.set({
    movable: {
      free: false,
      color: undefined,
      dests: undefined,
      showDests: true,
      events: { after: undefined },
    },
    draggable: { enabled: false },
    selectable: { enabled: true },
  });

  els.treePanel.hidden = false;

  els.chapterSelect.disabled = false;
  els.flipBoard.disabled = false;
  els.toggleSearch.disabled = false;

  els.quizMode.querySelector('.tool-label').textContent = 'Quiz mode';
  els.quizMode.setAttribute('aria-expanded', 'false');
  els.quizMode.setAttribute('aria-label', 'Quiz mode');
  els.quizMode.title = 'Quiz mode';
  els.quizModeIcon.style.display = '';
  els.quizExitIcon.style.display = 'none';

  // Resyncs description, tree, hash, and nav-button disabled state.
  selectNode(state.selectedNodeId, true);

  if (message) {
    setQuizStatus(message, kind);
  } else {
    clearQuizStatus();
  }
}

// Chessground config for free play (legal moves only, either color, no
// destination dots) at `fen`. Used everywhere outside quiz mode.
function freePlayBoardConfig(fen) {
  return {
    turnColor: turnColorOf(fen),
    movable: {
      free: false,
      color: turnColorOf(fen),
      dests: computeDests(fen),
      showDests: false,
      events: { after: onFreeMove },
    },
    draggable: { enabled: true },
    selectable: { enabled: true },
  };
}

// Apply free-play interactivity at `fen` without changing the displayed position
// (used for the initial home board, where the FEN is already set).
function applyFreePlay(fen) {
  ground.set(freePlayBoardConfig(fen));
}

// Create the in-memory scratch chapter for home-page free play. Sets it as the
// current chapter so the notation area and free play reuse the chapter machinery.
function startScratchChapter() {
  const root = {
    id: 'scratch-root',
    parentId: null,
    san: null,
    uci: null,
    ply: 0,
    fen: START_FEN,
    children: [],
    isMainline: true,
  };
  state.chapter = { id: SCRATCH_ID, title: 'Free play', description: null, nodes: [root] };
  document.documentElement.classList.add('is-home');
  state.nodesById = new Map([[root.id, root]]);
  state.selectedNodeId = root.id;
  state.nodeSeq = 0;
}

function emphasizeNotesOnce() {
  if (state.notesEmphasized) return;
  state.notesEmphasized = true;
  const panel = els.notesBlock;
  if (!panel) return;
  panel.classList.add('is-emphasized');
  panel
    .querySelector('#description-text')
    ?.addEventListener('animationend', () => panel.classList.remove('is-emphasized'), { once: true });
}

// Reset the board to `fen` (after an illegal or rejected move attempt),
// restoring its legal moves.
function restoreBoardTo(fen, lastMove) {
  ground.set({
    fen,
    turnColor: turnColorOf(fen),
    lastMove,
    movable: { dests: computeDests(fen) },
  });
}

// Handle a user move while browsing (free play). Walks into an existing child if
// the move already has one; otherwise appends a new side-line node.
function onFreeMove(orig, dest) {
  if (state.quizActive) return;

  const isHomeFirstMove = !state.chapter;
  const beforeFen = state.chapter ? getSelectedNode().fen : START_FEN;
  const chess = new Chess(beforeFen);

  let result;
  try {
    result = chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    restoreBoardTo(beforeFen, state.chapter ? getLastMove(getSelectedNode()) : undefined);
    return;
  }

  if (isHomeFirstMove) startScratchChapter();
  const before = getSelectedNode();
  const node = attachChild(before, chess.fen(), result.san, orig + dest + (result.promotion || ''));
  playMove(node.san);
  selectNode(node.id);

  if (isHomeFirstMove) emphasizeNotesOnce();
}

// Reach `fen` from `parent`: reuse an existing child if one already arrives
// there, otherwise append a new synthetic side-line node. Shared by
// free-play and PV-jump.
function attachChild(parent, fen, san, uci) {
  const existing = parent.children
    .map((id) => state.nodesById.get(id))
    .find((child) => fenKey(child.fen) === fenKey(fen));
  if (existing) return existing;

  const node = {
    id: `u${state.nodeSeq++}`,
    parentId: parent.id,
    san,
    uci,
    ply: parent.ply + 1,
    fen,
    children: [],
    isMainline: false,
    isUser: true,
  };
  state.nodesById.set(node.id, node);
  parent.children.push(node.id);
  return node;
}

function onUserMove(orig, dest) {
  if (!state.quizActive) return;

  const before = getSelectedNode();
  const chess = new Chess(before.fen);

  let result;
  try {
    result = chess.move({ from: orig, to: dest, promotion: 'q' });
  } catch {
    state.quizRetryCount += 1;
    restoreBoardTo(before.fen, getLastMove(before));
    setQuizStatus("That move isn't legal here.", 'error');
    return;
  }

  // Model games quiz on the moves as played; chapters accept any non-mistake line.
  const isGame = state.chapter.kind === 'game';
  const acceptable = isGame ? [mainlineChild(before)].filter(Boolean) : acceptableWhiteChildren(before);
  const playedKey = fenKey(chess.fen());
  const whiteNode = acceptable.find((child) => fenKey(child.fen) === playedKey);

  if (!whiteNode) {
    state.quizRetryCount += 1;
    ground.set({
      fen: chess.fen(),
      turnColor: turnColorOf(chess.fen()),
      lastMove: [orig, dest],
      movable: { dests: new Map() },
    });
    const expected = isGame ? 'the move played in the game' : 'the repertoire move';
    setQuizStatus(`${result.san} is not ${expected}.`, 'error');

    setTimeout(() => {
      if (!state.quizActive) return;
      restoreBoardTo(before.fen, getLastMove(before));
    }, 900);
    return;
  }

  state.quizCorrectCount += 1;
  playMove(whiteNode.san);
  state.selectedNodeId = whiteNode.id;
  ground.set({
    fen: whiteNode.fen,
    turnColor: turnColorOf(whiteNode.fen),
    lastMove: getLastMove(whiteNode),
    movable: { dests: new Map() },
  });

  // Surface the other acceptable White moves as "Also playable".
  const whiteAlts = acceptable.filter((child) => child.id !== whiteNode.id);
  const whiteLine = whiteAlts.length
    ? `Correct! Also playable: ${whiteAlts.map(sanLabel).join(', ')}`
    : 'Correct!';
  setQuizStatus(whiteLine, 'success');

  const blackNode = mainlineChild(whiteNode);
  if (!blackNode) {
    endQuiz(quizSummaryMessage(), 'success');
    return;
  }

  setTimeout(() => {
    if (!state.quizActive) return;
    presentBlackReply(whiteNode, blackNode, whiteLine);
  }, 700);
}

function playQuizReply(node) {
  playMove(node.san);
  state.selectedNodeId = node.id;

  const terminal = node.children.length === 0;
  ground.set({
    fen: node.fen,
    turnColor: turnColorOf(node.fen),
    lastMove: getLastMove(node),
    movable: { dests: terminal ? new Map() : computeDests(node.fen) },
  });

  if (terminal) endQuiz(quizSummaryMessage(), 'success');
  return terminal;
}

function presentBlackReply(whiteNode, blackNode, whiteLine) {
  if (playQuizReply(blackNode)) return;

  // Game quiz follows the game as played: no sideline swaps for Black.
  const blackAlts = state.chapter.kind === 'game'
    ? []
    : whiteNode.children
        .map((id) => state.nodesById.get(id))
        .filter((child) => child.id !== blackNode.id);

  const parts = [`${whiteLine}\nBlack played ${sanLabelSentence(blackNode)}`];
  if (blackAlts.length) {
    parts.push('\nBlack could also play: ');
    blackAlts.forEach((alt) => {
      parts.push({
        button: sanLabel(alt),
        onClick: () => {
          if (!state.quizActive) return;
          // Swap in the alternative by re-presenting from `whiteNode`.
          presentBlackReply(whiteNode, alt, whiteLine);
        },
      });
    });
  }
  setQuizStatusContent(parts, 'success');
}

// Opening feedback when the quiz starts on Black's move, plus buttons for
// Black's sibling replies. The board itself is set up by the caller.
function renderOpeningBlackStatus(startNode, blackNode) {
  const blackAlts = state.chapter.kind === 'game'
    ? []
    : startNode.children
        .map((id) => state.nodesById.get(id))
        .filter((child) => child.id !== blackNode.id);

  const parts = [`Black played ${sanLabelSentence(blackNode)} Find White's best move.`];
  if (blackAlts.length) {
    parts.push('\nBlack could also play: ');
    blackAlts.forEach((alt) => {
      parts.push({
        button: sanLabel(alt),
        onClick: () => swapOpeningBlackReply(startNode, alt),
      });
    });
  }
  setQuizStatusContent(parts, 'info');
}

// Swap the opening Black reply for `alt`. Doesn't count as a quizzed move.
function swapOpeningBlackReply(startNode, alt) {
  if (!state.quizActive) return;
  if (playQuizReply(alt)) return;
  renderOpeningBlackStatus(startNode, alt);
}

// Index normalized position key -> every chapter node reaching it, so a
// searched PGN/FEN can match regardless of which chapter(s) reach it.
function buildFenIndex(repertoire) {
  const index = new Map();
  for (const chapter of repertoire.chapters) {
    for (const node of chapter.nodes) {
      const key = fenKey(node.fen);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ chapterId: chapter.id, nodeId: node.id });
    }
  }
  return index;
}

// Normalize a FEN to its position-identifying fields (placement, turn,
// castling, en-passant). The en-passant field is re-derived rather than
// trusted because python-chess (repertoire export) only sets it when a legal
// capture exists, while chess.js (searched PGN/FEN) sets it after any double
// pawn push — trusting it would split one position into two different keys.
function fenKey(fen) {
  const [placement, turn, castle, ep] = fen.trim().split(/\s+/);
  return [placement, turn, castle, normalizeEpSquare(placement, turn, ep)].join(' ');
}

function normalizeEpSquare(placement, turn, ep) {
  if (!ep || ep === '-') return '-';
  const squares = expandPlacement(placement);
  const file = ep.charCodeAt(0) - 97; // 'a'..'h' -> 0..7
  const epRank = Number(ep[1]); // 6 (white to capture) or 3 (black to capture)
  const pawnChar = turn === 'w' ? 'P' : 'p';
  const pawnRank = turn === 'w' ? epRank - 1 : epRank + 1;
  const at = (rank, f) => squares[(8 - rank) * 8 + f]; // expandPlacement is a8..h1
  for (const df of [-1, 1]) {
    const f = file + df;
    if (f >= 0 && f <= 7 && at(pawnRank, f) === pawnChar) return ep;
  }
  return '-';
}

// Expand a FEN piece-placement field (e.g. "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
// into a 64-element array of single characters, using '.' for empty squares.
function expandPlacement(placement) {
  const squares = [];
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') {
      squares.push(...Array(Number(ch)).fill('.'));
    } else {
      squares.push(ch);
    }
  }
  return squares;
}

// Distance between two fenKey strings: board Hamming distance plus small
// penalties for side-to-move/castling/en-passant differences. Lower = more
// similar; only meaningful as a relative ranking, not a "moves away" count.
function positionDistance(keyA, keyB) {
  const [placementA, turnA, castleA, epA] = keyA.split(' ');
  const [placementB, turnB, castleB, epB] = keyB.split(' ');

  const squaresA = expandPlacement(placementA);
  const squaresB = expandPlacement(placementB);
  let distance = 0;
  for (let i = 0; i < 64; i++) {
    if (squaresA[i] !== squaresB[i]) distance++;
  }

  if (turnA !== turnB) distance += 2;

  // Charge castling-rights loss only while the king hasn't moved — once it has,
  // the Hamming part already counts the king/rook squares.
  const sameWhiteKing = squaresA.indexOf('K') === squaresB.indexOf('K');
  const sameBlackKing = squaresA.indexOf('k') === squaresB.indexOf('k');
  for (const flag of 'KQkq') {
    const sameKing = flag === 'K' || flag === 'Q' ? sameWhiteKing : sameBlackKing;
    if (sameKing && castleA.includes(flag) !== castleB.includes(flag)) distance += 1;
  }

  if (epA !== epB) distance += 1;

  return distance;
}

// Find the indexed position closest (by positionDistance) to `targetKey`.
// Returns { key, entries, distance }, or null if state.fenIndex is empty.
// Ties go to the first-encountered key.
function findClosestPosition(targetKey) {
  let best = null;
  for (const [key, entries] of state.fenIndex) {
    const distance = positionDistance(targetKey, key);
    if (best === null || distance < best.distance) {
      best = { key, entries, distance };
    }
  }
  return best;
}

function tryParseFen(input) {
  if (!input.includes('/')) return null;
  try {
    return new Chess(input).fen();
  } catch {
    return null;
  }
}

// Parse `input` as PGN move text from the starting position. Returns the
// verbose move list, or null if `input` isn't a valid, non-empty sequence.
function tryParsePgn(input) {
  try {
    const chess = new Chess();
    chess.loadPgn(input);
    const moves = chess.history({ verbose: true });
    return moves.length === 0 ? null : moves;
  } catch {
    return null;
  }
}

function alsoReachedSuffix(rest) {
  if (rest.length === 0) return '';
  return ` (Also reached by ${pluralize(rest.length, 'other position', 'other positions')} in the compendium.)`;
}

function runPositionSearch(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    setSearchStatus('Enter partial/full game move sequence (PGN) or position (FEN).', 'info');
    return;
  }

  const fenResult = tryParseFen(input);
  if (fenResult !== null) {
    runFenSearch(fenResult);
    return;
  }

  const moves = tryParsePgn(input);
  if (moves === null) {
    setSearchStatus('Invalid PGN or FEN.', 'error');
    return;
  }

  runGameSearch(moves);
}

function reportExactMatch(entries) {
  const [match, ...rest] = entries;
  selectChapter(match.chapterId, match.nodeId);
  setSearchStatus(
    `Found matching position in "${state.chapter.title}".${alsoReachedSuffix(rest)}`,
    'success',
  );
}

function trySimilarJump(searchKey) {
  const closest = findClosestPosition(searchKey);
  if (closest === null || closest.distance > MAX_SIMILAR_DISTANCE) return false;
  const [match, ...rest] = closest.entries;
  selectChapter(match.chapterId, match.nodeId);
  const message =
    `No exact match was found. Jumped to the closest similar position ` +
    `in "${state.chapter.title}".${alsoReachedSuffix(rest)}`;
  setSearchStatus(message, 'similar');
  return true;
}

function runFenSearch(fen) {
  const searchKey = fenKey(fen);
  const matches = state.fenIndex.get(searchKey);
  if (matches) {
    reportExactMatch(matches);
    return;
  }
  if (trySimilarJump(searchKey)) return;
  setSearchStatus('No matching position was found in the compendium.', 'error');
}

// Match the pasted game ply by ply against the cross-chapter fenIndex, so
// transpositions count. The final position decides the outcome; a game that
// left the compendium is anchored at its last exact hit when deep enough.
function runGameSearch(moves) {
  let lastExact = null; // { entries, index } of the latest exact hit

  for (let i = 0; i < moves.length; i++) {
    const entries = state.fenIndex.get(fenKey(moves[i].after));
    if (entries) lastExact = { entries, index: i };
  }

  if (lastExact && lastExact.index === moves.length - 1) {
    reportExactMatch(lastExact.entries);
    return;
  }

  if (trySimilarJump(fenKey(moves[moves.length - 1].after))) return;

  if (lastExact && lastExact.index + 1 > MIN_DEVIATION_ANCHOR_PLY) {
    const [match, ...rest] = lastExact.entries;
    selectChapter(match.chapterId, match.nodeId);
    const lastBookMove = inlineLabel(getSelectedNode(), true);
    setSearchStatus(
      `Matched up to ${lastBookMove} in "${state.chapter.title}".${alsoReachedSuffix(rest)}`,
      'similar',
    );
    return;
  }

  setSearchStatus('No matching position was found in the compendium.', 'error');
}

function setSearchStatus(message, kind) {
  els.searchStatus.textContent = message;
  els.searchStatus.dataset.kind = kind;
  els.searchStatus.hidden = false;
}

function buildLinePgn() {
  const moves = getSelectedPath().filter((node) => node.san);
  let pgn = '';
  for (const node of moves) {
    if (node.ply % 2 === 1) {
      pgn += `${Math.ceil(node.ply / 2)}.${node.san} `;
    } else if (pgn === '') {
      pgn += `${Math.ceil(node.ply / 2)}...${node.san} `;
    } else {
      pgn += `${node.san} `;
    }
  }
  return pgn.trim();
}

function refreshExportPgn() {
  els.exportText.value = state.chapter ? buildLinePgn() : '';
}

const COPIED_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>';

let copyIconResetTimer = 0;
let copyOriginalIcon = null;

async function copyExportPgn() {
  const text = els.exportText.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.exportText.select();
    document.execCommand('copy');
  }

  // Capture the pristine icon once — a re-click while the checkmark is
  // showing must not capture the checkmark as the icon to restore.
  if (copyOriginalIcon === null) copyOriginalIcon = els.copyPgn.innerHTML;
  els.copyPgn.innerHTML = COPIED_ICON;
  clearTimeout(copyIconResetTimer);
  copyIconResetTimer = setTimeout(() => {
    els.copyPgn.innerHTML = copyOriginalIcon;
  }, 1200);
}

// Blank lines separate paragraphs; single newlines (pre-line) break lines
// within one. A multi-paragraph game description opens with its metadata block.
function setDescription(text) {
  const blocks = text.split(/\n{2,}/);
  els.descriptionText.replaceChildren(
    ...blocks.map((block, index) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = block;
      if (index === 0 && blocks.length > 1 && state.chapter?.kind === 'game') {
        paragraph.className = 'desc-metadata';
      }
      return paragraph;
    }),
  );
}

function showLoadError(error) {
  setDescription(`Unable to load repertoire: ${error.message} Run the export script to generate data/chapters.json.`);
}

function replaceHash(hash) {
  const url = hash ? `#${hash}` : `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, '', url);
}
