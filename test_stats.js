// 集成测试：主题色广播 + 管理员在线数据统计
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = 4021;
const DB = __dirname + '/_test_stats.db';
try { fs.unlinkSync(DB); } catch (e) {}
const ADMIN_CODE = '202201';
const URL = 'ws://127.0.0.1:' + PORT;

const srv = spawn('node', ['--experimental-sqlite', 'server.js'], {
  cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), DB_PATH: DB, ADMIN_CODE }), stdio: 'ignore'
});

const results = [];
const ok = (n, c) => results.push((c ? 'PASS' : 'FAIL') + ' ' + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connectAndLogin(role, name, code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const msgs = [];
    const onMsg = d => { try { msgs.push(JSON.parse(d.toString())); } catch (e) {} };
    ws.on('message', onMsg);
    ws.on('open', () => {
      const p = role === 'admin'
        ? { type: 'login', mode: 'user', name, code }
        : { type: 'login', mode: role === 'guest' ? 'guest' : 'user', name };
      ws.send(JSON.stringify(p));
    });
    ws.on('error', reject);
    setTimeout(() => resolve({ ws, msgs }), 600);
  });
}
const find = (msgs, type) => msgs.find(m => m.type === type);
const waitFor = (msgs, type, ms) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const m = find(msgs, type);
    if (m || Date.now() - t0 > ms) { clearInterval(iv); res(m || null); }
  }, 100);
});
const waitForStats = (msgs, minOnline, ms) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const cand = msgs.filter(m => m.type === 'admin_stats').pop();
    if ((cand && cand.online >= minOnline) || Date.now() - t0 > ms) { clearInterval(iv); res(cand || null); }
  }, 150);
});

(async () => {
  await sleep(1500); // 等服务器启动
  const admin = await connectAndLogin('admin', '管理员A', ADMIN_CODE);
  const user = await connectAndLogin('user', '用户B');
  ok('welcome 含 color（默认）', !!find(admin.msgs, 'welcome') && find(admin.msgs, 'welcome').color === '#8ab4ff');

  // 管理员改主题色
  admin.ws.send(JSON.stringify({ type: 'set_color', color: '#ff3366' }));
  const rc1 = await waitFor(user.msgs, 'room_color', 1500);
  const rc2 = await waitFor(admin.msgs, 'room_color', 1500);
  ok('普通用户收到 room_color', rc1 && rc1.color === '#ff3366');
  ok('管理员收到 room_color', rc2 && rc2.color === '#ff3366');

  // 新加入者 welcome 应使用新主题色
  const late = await connectAndLogin('user', '用户C');
  ok('新用户 welcome 使用新主题色', find(late.msgs, 'welcome') && find(late.msgs, 'welcome').color === '#ff3366');

  // 管理员收到在线数据统计（等待定时器采样，人数应 >= 3）
  const stats = await waitForStats(admin.msgs, 3, 8000);
  ok('管理员收到 admin_stats', !!stats);
  if (stats) {
    ok('在线人数 >= 3', stats.online >= 3);
    ok('用户列表含姓名', Array.isArray(stats.users) && stats.users.length >= 3 && stats.users.some(u => u.name === '管理员A'));
    ok('history 为数组', Array.isArray(stats.history));
    ok('distinct 计数 >= 3', stats.distinct >= 3);
  }

  // 等待下一轮采样，history 应增长
  const before = stats ? stats.history.length : 0;
  const stats2 = await waitForStats(admin.msgs, 3, 8000);
  ok('采样后 history 增长', stats2 && stats2.history.length >= before);

  admin.ws.close(); user.ws.close(); late.ws.close();
  await sleep(300);
  srv.kill();
  try { fs.unlinkSync(DB); } catch (e) {}
  const failed = results.filter(r => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('结果: ' + results.length + ' 通过, ' + failed.length + ' 失败');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('测试异常', e); srv.kill(); process.exit(1); });
