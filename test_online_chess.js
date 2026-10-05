// 联机国际象棋端到端测试：两个 ws 客户端配对并完整走一局
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://localhost:3999';

function mk(name) {
  const ws = new WebSocket(URL);
  ws.name = name; ws.msgs = [];
  ws.on('message', d => { try { ws.msgs.push(JSON.parse(d.toString())); } catch (e) {} });
  return ws;
}
const open = ws => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const send = (ws, o) => ws.send(JSON.stringify(o));
const last = (ws, t) => [...ws.msgs].reverse().find(m => m.type === t);

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

  const A = mk('Alice'), B = mk('Bob');
  await Promise.all([open(A), open(B)]);
  send(A, { type: 'join', name: 'Alice' });
  send(B, { type: 'join', name: 'Bob' });
  await wait(200);

  // 匹配：A 发起，B 加入
  send(A, { type: 'chess_new' });
  await wait(150);
  ok('A 发起后收到 chess_wait', !!last(A, 'chess_wait'));
  send(B, { type: 'chess_join' });
  await wait(250);
  const sa = last(A, 'chess_start'), sb = last(B, 'chess_start');
  ok('A 收到 chess_start 且执白', !!sa && sa.color === 'w');
  ok('B 收到 chess_start 且执黑', !!sb && sb.color === 'b');
  ok('起始白方先手', sa && sa.turn === 'w');
  ok('起始棋盘 8x8', sa && Array.isArray(sa.board) && sa.board.length === 8);

  // 白 e2-e4 [6,4]->[4,4]
  send(A, { type: 'chess_move', from: [6, 4], to: [4, 4] });
  await wait(250);
  const s1A = last(A, 'chess_state'), s1B = last(B, 'chess_state');
  ok('双方收到 chess_state', !!s1A && !!s1B);
  ok('走子后轮到黑', s1A && s1A.turn === 'b');
  ok('e4 出现白兵', s1A && s1A.board[4][4] && s1A.board[4][4].type === 'p' && s1A.board[4][4].color === 'w');

  // 黑 e7-e5 [1,4]->[3,4] 合法
  send(B, { type: 'chess_move', from: [1, 4], to: [3, 4] });
  await wait(250);
  const s2 = last(A, 'chess_state');
  ok('黑走子后轮到白', s2 && s2.turn === 'w');

  // 白非法走子：a2[6,0] 横走到 [6,1]（兵不能横走）
  send(A, { type: 'chess_move', from: [6, 0], to: [6, 1] });
  await wait(200);
  ok('非法走子被拒(chess_err)', !!last(A, 'chess_err'));
  ok('非法走子后仍在白回合', last(A, 'chess_state').turn === 'w');

  // 黑在白回合抢走：应被拒「还没轮到你」
  send(B, { type: 'chess_move', from: [3, 4], to: [3, 5] });
  await wait(200);
  const errB = last(B, 'chess_err');
  ok('非回合走子被拒(还没轮到你)', errB && errB.text === '还没轮到你');

  // A 认输 -> 双方 chess_end, winner b
  send(A, { type: 'chess_resign' });
  await wait(200);
  const eA = last(A, 'chess_end'), eB = last(B, 'chess_end');
  ok('A 认输后双方 chess_end winner=b', eA && eB && eA.winner === 'b' && eB.winner === 'b');
  ok('chess_end reason=resign', eA && eA.reason === 'resign');

  // 断线通知：开 C，匹配 D 后让 D 断线，C 应收到 opponent_left
  const C = mk('Carol'), D = mk('Dave');
  await Promise.all([open(C), open(D)]);
  send(C, { type: 'join', name: 'Carol' });
  send(D, { type: 'join', name: 'Dave' });
  send(C, { type: 'chess_new' });
  send(D, { type: 'chess_join' });
  await wait(250);
  ok('第二轮 C/D 匹配成功', !!last(C, 'chess_start') && !!last(D, 'chess_start'));
  D.close();
  await wait(300);
  const eC = last(C, 'chess_end');
  ok('对手断线 C 收到 chess_end(opponent_left)', eC && eC.reason === 'opponent_left');

  A.close(); B.close(); C.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
