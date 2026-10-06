// 登录 / 权限 测试：访客只读、昵称登录、管理员删除与定位、管理员唯一席位
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
const waitType = (ws, t, ms = 2500) => new Promise((res) => {
  const found = last(ws, t);
  if (found) return res(found);
  const iv = setInterval(() => { const f = last(ws, t); if (f) { clearInterval(iv); res(f); } }, 50);
  setTimeout(() => { clearInterval(iv); res(null); }, ms);
});

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

  // 访客登录
  const G = mk('Guest');
  await open(G);
  send(G, { type: 'login', mode: 'guest' });
  await wait(150);
  ok('访客收到 welcome(role=guest)', last(G, 'welcome') && last(G, 'welcome').role === 'guest');
  // 访客发言被拒
  send(G, { type: 'msg', text: '我试试发言' });
  await wait(200);
  ok('访客发言被拒(sys 提示)', !!last(G, 'sys'));
  ok('访客不会收到自己的 chat', !last(G, 'chat'));

  // 用户登录
  const U = mk('User');
  await open(U);
  send(U, { type: 'login', mode: 'user', name: '用户甲' });
  await wait(150);
  ok('用户收到 welcome(role=user)', last(U, 'welcome') && last(U, 'welcome').role === 'user');
  // 用户发言成功（带 id）
  send(U, { type: 'msg', text: 'Hello 世界' });
  await wait(200);
  const uc = last(U, 'chat');
  ok('用户发言成功(chat 带 id)', uc && typeof uc.id === 'number');
  const msgId = uc && uc.id;
  ok('访客能收到该消息(chat 广播)', !!last(G, 'chat'));

  // 管理员登录
  const A = mk('Admin');
  await open(A);
  send(A, { type: 'login', mode: 'user', name: '管理员', code: '202201' });
  await wait(150);
  ok('管理员收到 welcome(role=admin)', last(A, 'welcome') && last(A, 'welcome').role === 'admin');
  ok('管理员收到 admin_recent 数组', Array.isArray(last(A, 'admin_recent') && last(A, 'admin_recent').messages));

  // 管理员查看发言地点（geo）
  send(A, { type: 'admin_geo_req', id: msgId });
  const geo = await waitType(A, 'admin_geo', 3000);
  ok('管理员查看地点返回 admin_geo', geo && geo.id === msgId);

  // 管理员删除发言
  send(A, { type: 'admin_delete', id: msgId });
  await wait(200);
  ok('删除广播 delete_msg', last(A, 'delete_msg') && last(A, 'delete_msg').id === msgId);
  ok('用户也收到 delete_msg', last(U, 'delete_msg') && last(U, 'delete_msg').id === msgId);

  // 管理员唯一席位：第二个管理员被拒
  const A2 = mk('Admin2');
  await open(A2);
  send(A2, { type: 'login', mode: 'user', name: '冒牌管理员', code: '202201' });
  await wait(200);
  ok('第二管理员被拒(login_fail 管理员已在线)', last(A2, 'login_fail') && last(A2, 'login_fail').reason === '管理员已在线');

  // 错误口令：普通用户（不带管理员）
  const A3 = mk('Admin3');
  await open(A3);
  send(A3, { type: 'login', mode: 'user', name: '路人', code: '000000' });
  await wait(150);
  ok('错误口令仅普通用户', last(A3, 'welcome') && last(A3, 'welcome').role === 'user');

  // 旧口令 123456 已失效（降级为普通用户）
  const A5 = mk('Admin5');
  await open(A5);
  send(A5, { type: 'login', mode: 'user', name: '旧口令用户', code: '123456' });
  await wait(150);
  ok('旧口令123456已失效(仅为普通用户)', last(A5, 'welcome') && last(A5, 'welcome').role === 'user');

  // 空名字被拒
  const A4 = mk('Admin4');
  await open(A4);
  send(A4, { type: 'login', mode: 'user', name: '' });
  await wait(150);
  ok('空名字被拒(名字必填)', last(A4, 'login_fail') && last(A4, 'login_fail').reason === '名字必填');

  G.close(); U.close(); A.close(); A2.close(); A3.close(); A4.close(); A5.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
