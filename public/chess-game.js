/* 自包含国际象棋引擎 + UI（集成进聊天室）
 * 纯前端，无外部依赖。引擎部分可在 Node 下测试。 */
(function () {
  'use strict';

  /* ===================== 引擎（纯逻辑） ===================== */
  var FILES = 'abcdefgh';
  function cloneBoard(b) { return b.map(function (row) { return row.map(function (c) { return c ? { type: c.type, color: c.color } : null; }); }); }
  function initialBoard() {
    var b = []; for (var r = 0; r < 8; r++) { b.push([null, null, null, null, null, null, null, null]); }
    var back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (var c = 0; c < 8; c++) { b[0][c] = { type: back[c], color: 'b' }; b[1][c] = { type: 'p', color: 'b' }; b[6][c] = { type: 'p', color: 'w' }; b[7][c] = { type: back[c], color: 'w' }; }
    return b;
  }
  function findKing(b, color) { for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) { var p = b[r][c]; if (p && p.type === 'k' && p.color === color) return [r, c]; } return null; }

  // 某子"攻击"的格子（兵只算斜前，不含前进）
  function pieceAttacks(b, r, c) {
    var p = b[r][c]; if (!p) return [];
    var me = p.color, out = [], en = me === 'w' ? 'b' : 'w';
    function push(rr, cc) { if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) out.push([rr, cc]); }
    if (p.type === 'p') { var dir = me === 'w' ? -1 : 1; push(r + dir, c - 1); push(r + dir, c + 1); }
    else if (p.type === 'n') { var m = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]; m.forEach(function (d) { push(r + d[0], c + d[1]); }); }
    else if (p.type === 'k') { for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) { if (dr || dc) push(r + dr, c + dc); } }
    else {
      var dirs = p.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
        : p.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
          : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (var i = 0; i < dirs.length; i++) {
        var rr = r + dirs[i][0], cc = c + dirs[i][1];
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          var t = b[rr][cc];
          if (!t) out.push([rr, cc]); else { if (t.color === en) out.push([rr, cc]); break; }
          rr += dirs[i][0]; cc += dirs[i][1];
        }
      }
    }
    return out;
  }
  function attackedBy(b, r, c, color) {
    for (var rr = 0; rr < 8; rr++) for (var cc = 0; cc < 8; cc++) {
      var p = b[rr][cc];
      if (p && p.color === color && pieceAttacks(b, rr, cc).some(function (a) { return a[0] === r && a[1] === c; })) return true;
    }
    return false;
  }
  function inCheck(b, color) { var k = findKing(b, color); if (!k) return false; return attackedBy(b, k[0], k[1], color === 'w' ? 'b' : 'w'); }

  function pseudoMoves(state, r, c) {
    var b = state.board, p = b[r][c]; if (!p) return [];
    var me = p.color, en = me === 'w' ? 'b' : 'w', out = [];
    function add(rr, cc) { if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { var t = b[rr][cc]; if (!t) out.push([rr, cc]); else if (t.color === en) out.push([rr, cc]); } }
    if (p.type === 'p') {
      var dir = me === 'w' ? -1 : 1, startRow = me === 'w' ? 6 : 1;
      if (!b[r + dir][c]) { out.push([r + dir, c]); if (r === startRow && !b[r + 2 * dir][c]) out.push([r + 2 * dir, c]); }
      for (var k = -1; k <= 1; k += 2) { var rr = r + dir, cc = c + k; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { var t = b[rr][cc]; if (t && t.color === en) out.push([rr, cc]); else if (state.ep && state.ep[0] === rr && state.ep[1] === cc) out.push([rr, cc]); } }
    } else if (p.type === 'n') { var mv = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]; mv.forEach(function (d) { add(r + d[0], c + d[1]); }); }
    else if (p.type === 'k') {
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) { if (dr || dc) add(r + dr, c + dc); }
      var row = me === 'w' ? 7 : 0;
      if (r === row && c === 4 && !inCheck(b, me)) {
        if (state.castling[me === 'w' ? 'wK' : 'bK'] && !b[row][5] && !b[row][6] && b[row][7] && b[row][7].type === 'r' && b[row][7].color === me && !attackedBy(b, row, 5, en) && !attackedBy(b, row, 6, en)) out.push([row, 6]);
        if (state.castling[me === 'w' ? 'wQ' : 'bQ'] && !b[row][3] && !b[row][2] && !b[row][1] && b[row][0] && b[row][0].type === 'r' && b[row][0].color === me && !attackedBy(b, row, 3, en) && !attackedBy(b, row, 2, en)) out.push([row, 2]);
      }
    } else {
      var dirs = p.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : p.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (var i = 0; i < dirs.length; i++) { var qx = r + dirs[i][0], qy = c + dirs[i][1]; while (qx >= 0 && qx < 8 && qy >= 0 && qy < 8) { var t = b[qx][qy]; if (!t) out.push([qx, qy]); else { if (t.color === en) out.push([qx, qy]); break; } qx += dirs[i][0]; qy += dirs[i][1]; } }
    }
    return out;
  }

  // 纯函数：返回走子后的新 state，不修改入参
  function makeMove(state, from, to, promotion) {
    var b = cloneBoard(state.board);
    var fr = from[0], fc = from[1], tr = to[0], tc = to[1];
    var p = b[fr][fc];
    var ns = { board: b, turn: state.turn === 'w' ? 'b' : 'w', castling: { wK: state.castling.wK, wQ: state.castling.wQ, bK: state.castling.bK, bQ: state.castling.bQ }, ep: null };
    // 吃过路兵
    if (p.type === 'p' && fc !== tc && !b[tr][tc]) b[fr][tc] = null;
    b[tr][tc] = { type: p.type, color: p.color };
    b[fr][fc] = null;
    if (p.type === 'p' && (tr === 0 || tr === 7)) { b[tr][tc] = { type: promotion || 'q', color: p.color }; }
    if (p.type === 'k' && Math.abs(tc - fc) === 2) {
      var row = fr;
      if (tc === 6) { b[row][5] = b[row][7]; b[row][7] = null; }
      else if (tc === 2) { b[row][3] = b[row][0]; b[row][0] = null; }
    }
    if (p.type === 'k') { if (p.color === 'w') { ns.castling.wK = false; ns.castling.wQ = false; } else { ns.castling.bK = false; ns.castling.bQ = false; } }
    if ((fr === 0 && fc === 0) || (tr === 0 && tc === 0)) ns.castling.bQ = false;
    if ((fr === 0 && fc === 7) || (tr === 0 && tc === 7)) ns.castling.bK = false;
    if ((fr === 7 && fc === 0) || (tr === 7 && tc === 0)) ns.castling.wQ = false;
    if ((fr === 7 && fc === 7) || (tr === 7 && tc === 7)) ns.castling.wK = false;
    if (p.type === 'p' && Math.abs(tr - fr) === 2) ns.ep = [(fr + tr) / 2, fc];
    return ns;
  }

  function legalMoves(state, r, c) {
    var p = state.board[r][c]; if (!p || p.color !== state.turn) return [];
    var res = [], pm = pseudoMoves(state, r, c);
    for (var i = 0; i < pm.length; i++) {
      var ns = makeMove(state, [r, c], pm[i]);
      if (!inCheck(ns.board, p.color)) res.push(pm[i]);
    }
    return res;
  }
  function allLegalMoves(state) {
    var res = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = state.board[r][c];
      if (p && p.color === state.turn) { var lm = legalMoves(state, r, c); for (var i = 0; i < lm.length; i++) res.push({ from: [r, c], to: lm[i] }); }
    }
    return res;
  }
  function status(state) {
    var moves = allLegalMoves(state);
    var chk = inCheck(state.board, state.turn);
    if (moves.length === 0) {
      if (chk) return { over: true, winner: state.turn === 'w' ? 'black' : 'white', type: 'checkmate' };
      return { over: true, winner: null, type: 'stalemate' };
    }
    return { over: false, check: chk, turn: state.turn };
  }

  var Engine = {
    newGame: function () { return { board: initialBoard(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, ep: null }; },
    legalMoves: legalMoves, makeMove: makeMove, status: status, inCheck: function (s, c) { return inCheck(s.board, c); }, allLegalMoves: allLegalMoves, findKing: findKing,
    toAlg: function (rc) { return FILES[rc[1]] + (8 - rc[0]); }
  };

  /* ===================== UI（仅浏览器） ===================== */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    return;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;

  var SYM = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };
  var VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  var game = Engine.newGame();
  var history = [];
  var selected = null;
  var legalTargets = [];
  var mode = 'pvp';      // 'pvp' 双人对战 | 'pve' 人机
  var aiColor = 'b';

  var boardEl, statusEl, modeBtn;

  function render() {
    boardEl.innerHTML = '';
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var cell = document.createElement('div');
      cell.className = 'cell ' + (((r + c) % 2) ? 'dark' : 'light');
      var p = game.board[r][c];
      if (p) { var s = document.createElement('span'); s.className = 'piece ' + p.color; s.textContent = SYM[p.color][p.type]; cell.appendChild(s); }
      var isMove = legalTargets.some(function (t) { return t[0] === r && t[1] === c; });
      if (isMove) { cell.classList.add('move'); if (p) cell.classList.add('capture'); }
      if (selected && selected[0] === r && selected[1] === c) cell.classList.add('selected');
      (function (rr, cc) { cell.addEventListener('click', function () { onClick(rr, cc); }); })(r, c);
      boardEl.appendChild(cell);
    }
    updateStatus();
  }

  function onClick(r, c) {
    if (mode === 'pve' && game.turn === aiColor) return; // 等 AI
    var p = game.board[r][c];
    if (selected && legalTargets.some(function (t) { return t[0] === r && t[1] === c; })) { doMove(selected, [r, c]); return; }
    if (p && p.color === game.turn) { selected = [r, c]; legalTargets = Engine.legalMoves(game, r, c); render(); }
    else { selected = null; legalTargets = []; render(); }
  }

  function doMove(from, to) {
    history.push(game);
    var piece = game.board[from[0]][from[1]];
    var promo = (piece.type === 'p' && (to[0] === 0 || to[0] === 7)) ? 'q' : null;
    game = Engine.makeMove(game, from, to, promo);
    selected = null; legalTargets = [];
    render();
    var st = Engine.status(game);
    if (st.over) return;
    if (mode === 'pve' && game.turn === aiColor) setTimeout(aiMove, 350);
  }

  function aiMove() {
    var moves = Engine.allLegalMoves(game);
    if (!moves.length) { render(); return; }
    var scored = moves.map(function (m) { var t = game.board[m.to[0]][m.to[1]]; return { m: m, v: t ? VALUE[t.type] : 0 }; });
    scored.sort(function (a, b) { return b.v - a.v; });
    var top = scored.filter(function (x) { return x.v === scored[0].v; }).map(function (x) { return x.m; });
    var pick = top[Math.floor(Math.random() * top.length)];
    history.push(game);
    var piece = game.board[pick.from[0]][pick.from[1]];
    var promo = (piece.type === 'p' && (pick.to[0] === 0 || pick.to[0] === 7)) ? 'q' : null;
    game = Engine.makeMove(game, pick.from, pick.to, promo);
    selected = null; legalTargets = [];
    render();
  }

  function updateStatus() {
    var st = Engine.status(game);
    var txt = (game.turn === 'w' ? '白方' : '黑方') + ' 走棋';
    if (st.over) {
      if (st.type === 'checkmate') txt = '将死！' + (st.winner === 'white' ? '白方' : '黑方') + '胜 🏆';
      else txt = '和棋（困毙）🤝';
    } else if (st.check) txt += ' · 将军！⚠️';
    if (mode === 'pve') txt = (game.turn === aiColor ? '电脑' : '你') + txt.slice(2);
    statusEl.textContent = txt;
  }

  function newGame() { game = Engine.newGame(); history = []; selected = null; legalTargets = []; render(); }
  function undo() { if (history.length) { game = history.pop(); selected = null; legalTargets = []; render(); } }
  function toggleMode() {
    mode = (mode === 'pvp') ? 'pve' : 'pvp';
    modeBtn.textContent = (mode === 'pvp') ? '模式：双人对战' : '模式：人机(你执白)';
    if (mode === 'pve' && game.turn === aiColor) setTimeout(aiMove, 350);
    render();
  }

  function init() {
    boardEl = document.getElementById('chessBoard');
    statusEl = document.getElementById('chessStatus');
    modeBtn = document.getElementById('modeBtn');
    if (!boardEl) return;
    document.getElementById('newGameBtn').onclick = newGame;
    document.getElementById('undoBtn').onclick = undo;
    modeBtn.onclick = toggleMode;
    var gb = document.getElementById('gameBtn');
    if (gb) gb.onclick = function () {
      var gv = document.getElementById('gameView');
      var showing = gv.style.display !== 'none';
      gv.style.display = showing ? 'none' : 'flex';
      ['log', 'hint', 'inputBar'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = showing ? '' : 'none'; });
      if (!showing) render();
    };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
