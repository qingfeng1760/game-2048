(function () {
  'use strict';

  var SIZE = 4;
  var MOVE_MS = 100;
  var GHOST_MS = 200;
  var BEST_KEY = 'pink2048.best';

  var VECTORS = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1]
  };

  var KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };

  var boardEl = document.getElementById('board');
  var gridEl = document.getElementById('grid');
  var tilesEl = document.getElementById('tiles');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var popEl = document.getElementById('score-pop');
  var overlayEl = document.getElementById('overlay');
  var overlayTextEl = document.getElementById('overlay-text');
  var overlayBtn = document.getElementById('overlay-btn');
  var newGameBtn = document.getElementById('new-game');
  var undoBtn = document.getElementById('undo');

  /* ---------------- 状态 ---------------- */

  var tiles = [];        // { id, value, r, c, prevR, prevC, isNew, pop, ghost }
  var tileEls = new Map();
  var nextId = 1;
  var history = [];      // 每步移动前的棋盘快照，用于撤回

  var score = 0;
  var best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  var won = false;
  var keepPlaying = false;
  var finished = false;
  var animating = false;
  var overlayMode = 'over';

  /* ---------------- 尺寸计算 ---------------- */

  function metrics() {
    var cs = getComputedStyle(document.documentElement);
    var cell = parseFloat(cs.getPropertyValue('--cell')) || 100;
    var gap = parseFloat(cs.getPropertyValue('--gap')) || 12;
    return { cell: cell, gap: gap, step: cell + gap };
  }

  /* ---------------- 棋盘背景 ---------------- */

  function buildGrid() {
    gridEl.innerHTML = '';
    for (var i = 0; i < SIZE * SIZE; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      gridEl.appendChild(cell);
    }
  }

  /* ---------------- 渲染 ---------------- */

  function applyFace(inner, value) {
    var text = String(value);
    inner.textContent = text;
    inner.setAttribute('data-v', value <= 2048 ? text : 'big');
    inner.className = 'tile-inner d' + Math.min(text.length, 5);
  }

  function render() {
    var step = metrics().step;
    var alive = {};
    var i;

    for (i = 0; i < tiles.length; i++) alive[tiles[i].id] = true;

    // 清理已消失的方块
    tileEls.forEach(function (el, id) {
      if (!alive[id]) {
        el.remove();
        tileEls.delete(id);
      }
    });

    for (i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var el = tileEls.get(t.id);

      if (!el) {
        el = document.createElement('div');
        el.className = 'tile';
        var inner = document.createElement('div');
        el.appendChild(inner);
        applyFace(inner, t.value);

        el.style.transition = 'none';
        el.style.transform = 'translate(' + (t.prevC * step) + 'px,' + (t.prevR * step) + 'px)';
        tilesEl.appendChild(el);
        tileEls.set(t.id, el);

        void el.offsetWidth; // 强制回流，让初始位置先生效
        el.style.transition = '';
      } else {
        applyFace(el.firstChild, t.value);
      }

      el.style.transform = 'translate(' + (t.c * step) + 'px,' + (t.r * step) + 'px)';
      el.classList.toggle('ghost', !!t.ghost);
      el.classList.toggle('new', !!t.isNew);
      el.classList.toggle('pop', !!t.pop);
    }
  }

  /* ---------------- 棋盘读取 ---------------- */

  function buildBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(null);
      b.push(row);
    }
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t.ghost) b[t.r][t.c] = t;
    }
    return b;
  }

  /* ---------------- 生成新方块 ---------------- */

  function spawnTile() {
    var b = buildBoard();
    var empty = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!b[r][c]) empty.push([r, c]);
      }
    }
    if (!empty.length) return null;

    var pick = empty[Math.floor(Math.random() * empty.length)];
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = {
      id: nextId++,
      value: value,
      r: pick[0],
      c: pick[1],
      prevR: pick[0],
      prevC: pick[1],
      isNew: true,
      pop: false,
      ghost: false
    };
    tiles.push(tile);
    return tile;
  }

  /* ---------------- 计分 ---------------- */

  function addScore(n) {
    score += n;
    scoreEl.textContent = String(score);

    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch (e) { /* 忽略隐私模式下的写入失败 */ }
    }

    popEl.textContent = '+' + n;
    popEl.classList.remove('show');
    void popEl.offsetWidth;
    popEl.classList.add('show');
  }

  /* ---------------- 移动 ---------------- */

  function move(dir) {
    if (finished || animating) return;

    var vec = VECTORS[dir];
    var dr = vec[0];
    var dc = vec[1];
    var snapshot = takeSnapshot();

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      t.prevR = t.r;
      t.prevC = t.c;
      t.isNew = false;
      t.pop = false;
    }

    var board = buildBoard();
    var rows = [0, 1, 2, 3];
    var cols = [0, 1, 2, 3];
    if (dr > 0) rows.reverse();
    if (dc > 0) cols.reverse();

    var merged = {};
    var moved = false;
    var gained = 0;

    for (var ri = 0; ri < SIZE; ri++) {
      for (var ci = 0; ci < SIZE; ci++) {
        var r = rows[ri];
        var c = cols[ci];
        var tile = board[r][c];
        if (!tile) continue;

        var nr = r;
        var nc = c;
        var target = null;

        for (;;) {
          var tr = nr + dr;
          var tc = nc + dc;
          if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;

          var other = board[tr][tc];
          if (!other) {
            nr = tr;
            nc = tc;
            continue;
          }
          if (other.value === tile.value && !merged[other.id]) {
            target = other;
            nr = tr;
            nc = tc;
          }
          break;
        }

        if (nr === r && nc === c) continue;

        moved = true;
        board[r][c] = null;
        tile.r = nr;
        tile.c = nc;

        if (target) {
          tile.ghost = true;
          merged[target.id] = true;
          target.value *= 2;
          target.pop = true;
          gained += target.value;
          if (!won && target.value >= 2048) won = true;
        } else {
          board[nr][nc] = tile;
        }
      }
    }

    if (!moved) {
      for (var k = 0; k < tiles.length; k++) {
        tiles[k].prevR = tiles[k].r;
        tiles[k].prevC = tiles[k].c;
      }
      return;
    }

    if (gained) addScore(gained);

    pushHistory(snapshot);
    spawnTile();
    render();
    scheduleGhostCleanup();

    animating = true;
    setTimeout(function () { animating = false; }, MOVE_MS + 20);

    if (won && !keepPlaying) {
      finished = true;
      setTimeout(function () { showOverlay('win'); }, 180);
      return;
    }

    if (!movesAvailable()) {
      finished = true;
      setTimeout(function () { showOverlay('over'); }, 180);
    }
  }

  function scheduleGhostCleanup() {
    setTimeout(function () {
      var hasGhost = false;
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i].ghost) { hasGhost = true; break; }
      }
      if (!hasGhost) return;

      tiles = tiles.filter(function (t) { return !t.ghost; });
      render();
    }, GHOST_MS);
  }

  function movesAvailable() {
    var b = buildBoard();
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var t = b[r][c];
        if (!t) return true;
        if (r + 1 < SIZE && b[r + 1][c] && b[r + 1][c].value === t.value) return true;
        if (c + 1 < SIZE && b[r][c + 1] && b[r][c + 1].value === t.value) return true;
      }
    }
    return false;
  }

  /* ---------------- 遮罩层 ---------------- */

  function showOverlay(mode) {
    overlayMode = mode;
    if (mode === 'win') {
      overlayTextEl.textContent = '🎉 你赢了！达成 2048';
      overlayBtn.textContent = '继续挑战';
    } else {
      overlayTextEl.textContent = '💔 游戏结束';
      overlayBtn.textContent = '再来一局';
    }
    overlayEl.classList.add('show');
  }

  function hideOverlay() {
    overlayEl.classList.remove('show');
  }

  /* ---------------- 撤回 ---------------- */

  function takeSnapshot() {
    var state = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.ghost) continue;
      state.push({ value: t.value, r: t.r, c: t.c });
    }
    return {
      tiles: state,
      score: score,
      won: won,
      keepPlaying: keepPlaying
    };
  }

  function pushHistory(snapshot) {
    history.push(snapshot);
    if (history.length > 200) history.shift();
    updateUndoButton();
  }

  function updateUndoButton() {
    undoBtn.disabled = history.length === 0;
  }

  function undo() {
    if (!history.length) return;

    var snap = history.pop();
    var restored = [];

    for (var i = 0; i < snap.tiles.length; i++) {
      var s = snap.tiles[i];
      restored.push({
        id: nextId++,
        value: s.value,
        r: s.r,
        c: s.c,
        prevR: s.r,
        prevC: s.c,
        isNew: true,
        pop: false,
        ghost: false
      });
    }

    tiles = restored;
    score = snap.score;
    won = snap.won;
    keepPlaying = snap.keepPlaying;
    finished = false;
    animating = false;

    scoreEl.textContent = String(score);
    hideOverlay();
    render();
    updateUndoButton();
  }

  /* ---------------- 新游戏 ---------------- */

  function newGame() {
    tiles = [];
    history = [];
    tileEls.forEach(function (el) { el.remove(); });
    tileEls.clear();

    score = 0;
    scoreEl.textContent = '0';

    won = false;
    keepPlaying = false;
    finished = false;
    animating = false;

    hideOverlay();
    spawnTile();
    spawnTile();
    render();
    updateUndoButton();
  }

  /* ---------------- 输入 ---------------- */

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  }, { passive: false });

  var touchStart = null;

  boardEl.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) {
      touchStart = null;
      return;
    }
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  boardEl.addEventListener('touchmove', function (e) {
    if (!touchStart || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - touchStart.x;
    var dy = e.touches[0].clientY - touchStart.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;

    touchStart = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx > 0 ? 'right' : 'left');
    } else {
      move(dy > 0 ? 'down' : 'up');
    }
  }, { passive: true });

  // 鼠标拖拽（桌面端也能用鼠标滑动）
  var dragStart = null;

  boardEl.addEventListener('mousedown', function (e) {
    dragStart = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', function (e) {
    if (!dragStart) return;
    var dx = e.clientX - dragStart.x;
    var dy = e.clientY - dragStart.y;
    dragStart = null;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx > 0 ? 'right' : 'left');
    } else {
      move(dy > 0 ? 'down' : 'up');
    }
  });

  overlayBtn.addEventListener('click', function () {
    if (overlayMode === 'win') {
      keepPlaying = true;
      finished = false;
      hideOverlay();
    } else {
      newGame();
    }
  });

  newGameBtn.addEventListener('click', newGame);
  undoBtn.addEventListener('click', undo);

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      render();
    }, 120);
  });

  /* ---------------- 初始化 ---------------- */

  bestEl.textContent = String(best);
  buildGrid();
  newGame();
})();
