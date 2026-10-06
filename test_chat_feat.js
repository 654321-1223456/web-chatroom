// 集成测试：正在输入（typing）、撤回（recall）、群公告（notice）
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://localhost:3999';
const ADMIN_CODE = '202201';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };
const connect = () => new Promise((res, rej) => {
  const ws = new WebSocket(URL);
  ws.msgs = [];
  ws.on('message', d => { try { ws.msgs.push(JSON.parse(d.toString())); } catch (e) {} });
  ws.on('open', () => res(ws));
  ws.on('error', rej);
});
const loginWait = (ws, mode, name, code) => new Promise((res, rej) => {
  ws.send(JSON.stringify({ type: 'login', mode, name, code }));
  const t0 = Date.now();
  const iv = setInterval(() => {
    const m = ws.msgs.find(x => x.type === 'welcome' || x.type === 'login_fail');
    if (m) { clearInterval(iv); res(m); }
    else if (Date.now() - t0 > 3000) { clearInterval(iv); rej(new Error('login timeout')); }
  }, 20);
});
const waitFor = (ws, type, ms = 2500) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const m = ws.msgs.find(x => x.type === type);
    if (m || Date.now() - t0 > ms) { clearInterval(iv); res(m || null); }
  }, 20);
});

(async () => {
  const a = await connect(); await loginWait(a, 'user', 'Alice');
  const b = await connect(); await loginWait(b, 'user', 'Bob');

  // 1) 普通消息 + 广播 id
  a.send(JSON.stringify({ type: 'msg', text: '你好世界' }));
  const c1 = await waitFor(b, 'chat');
  ok('Bob 收到 chat 且含 id', !!c1 && typeof c1.id === 'number');

  // 2) 撤回自己的消息
  a.send(JSON.stringify({ type: 'recall', id: c1.id }));
  const del = await waitFor(b, 'delete_msg');
  ok('撤回后他人收到 delete_msg', !!del && del.id === c1.id);

  // 3) 他人尝试撤回别人消息应被忽略（不应产生新的 delete_msg）
  const before = b.msgs.filter(x => x.type === 'delete_msg').length;
  b.send(JSON.stringify({ type: 'recall', id: c1.id }));
  await new Promise(r => setTimeout(r, 600));
  const after = b.msgs.filter(x => x.type === 'delete_msg').length;
  ok('非拥有者撤回他人消息被忽略', after === before);

  // 4) 正在输入
  a.send(JSON.stringify({ type: 'typing' }));
  const tp = await waitFor(b, 'typing');
  ok('Bob 收到 typing 含 Alice', !!tp && tp.name === 'Alice');
  a.send(JSON.stringify({ type: 'typing_stop' }));
  const ts = await waitFor(b, 'typing_stop');
  ok('Bob 收到 typing_stop', !!ts && ts.name === 'Alice');

  // 5) 群公告（管理员设置 + 全员接收）
  const admin = await connect(); await loginWait(admin, 'user', 'Admin', ADMIN_CODE);
  admin.send(JSON.stringify({ type: 'set_notice', text: '文明发言' }));
  const ntA = await waitFor(a, 'notice');
  const ntB = await waitFor(b, 'notice');
  ok('普通用户收到 notice', !!ntA && ntA.text === '文明发言');
  ok('另一用户收到 notice', !!ntB && ntB.text === '文明发言');

  // 6) 新用户登录应带 notice
  const c = await connect(); const w = await loginWait(c, 'user', 'Carol');
  ok('新用户 welcome 含 notice', !!w.notice && w.notice === '文明发言');

  // 7) 管理员撤回他人消息
  a.send(JSON.stringify({ type: 'msg', text: '待撤回' }));
  const c2 = await waitFor(b, 'chat');
  admin.send(JSON.stringify({ type: 'recall', id: c2.id }));
  const del2 = await waitFor(b, 'delete_msg');
  ok('管理员撤回他人消息生效', !!del2 && del2.id === c2.id);

  a.close(); b.close(); admin.close(); c.close();
  await new Promise(r => setTimeout(r, 300));
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
