// 聊天室进阶测试：频道密码、房主踢人、图片消息、历史含图
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';

const a = new WebSocket(URL);
const b = new WebSocket(URL);
const c = new WebSocket(URL);
const got = { a: [], b: [], c: [] };
const collect = (ws, key) => ws.on('message', d => got[key].push(JSON.parse(d.toString())));
collect(a, 'a'); collect(b, 'b'); collect(c, 'c');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  await wait(400);
  a.send(JSON.stringify({ type: 'join', name: 'Alice' }));
  b.send(JSON.stringify({ type: 'join', name: 'Bob' }));
  await wait(300);

  // 1) 创建加密频道 #secret (密码 1234)
  a.send(JSON.stringify({ type: 'switch', channel: 'secret', password: '1234' }));
  await wait(300);

  // 2) Bob 无密码进入 -> denied；带密码进入 -> switched
  b.send(JSON.stringify({ type: 'switch', channel: 'secret' }));
  await wait(300);
  const deniedPass = got.b.some(m => m.type === 'denied' && m.channel === 'secret');
  b.send(JSON.stringify({ type: 'switch', channel: 'secret', password: '1234' }));
  await wait(300);
  const joinSecretPass = got.b.some(m => m.type === 'switched' && m.channel === 'secret');

  // 3) Alice 是房主，踢 Bob
  a.send(JSON.stringify({ type: 'kick', target: 'Bob' }));
  await wait(300);
  const kickPass = got.b.some(m => m.type === 'kicked' && m.channel === 'secret')
                && got.b.some(m => m.type === 'switched' && m.channel === 'general');

  // 4) Alice 在 secret 发图片消息（Bob 已被踢，收不到实时，但进历史）
  a.send(JSON.stringify({ type: 'msg', text: '看这张图', image: IMG }));
  await wait(300);

  // 5) Bob 重新带密码进入 secret，应收到含图片的历史；Carol 进入也应收到
  b.send(JSON.stringify({ type: 'switch', channel: 'secret', password: '1234' }));
  await wait(300);
  c.send(JSON.stringify({ type: 'join', name: 'Carol' }));
  await wait(200);
  c.send(JSON.stringify({ type: 'switch', channel: 'secret', password: '1234' }));
  await wait(400);

  const imageHistoryPass = got.b.some(m => m.type === 'history' && m.messages.some(x => x.image))
                        || got.c.some(m => m.type === 'history' && m.messages.some(x => x.image));
  const textHistoryPass = got.c.some(m => m.type === 'history' && m.messages.some(x => x.name === 'Alice' && x.text === '看这张图'));

  console.log('--- 聊天室进阶测试结果 ---');
  console.log('加密频道无密码被拒: ', deniedPass ? 'PASS ✅' : 'FAIL ❌');
  console.log('带密码进入成功:     ', joinSecretPass ? 'PASS ✅' : 'FAIL ❌');
  console.log('房主踢人(移回大厅): ', kickPass ? 'PASS ✅' : 'FAIL ❌');
  console.log('图片进入历史:       ', imageHistoryPass ? 'PASS ✅' : 'FAIL ❌');
  console.log('文本历史保留:       ', textHistoryPass ? 'PASS ✅' : 'FAIL ❌');

  a.close(); b.close(); c.close();
  process.exit(0);
})();
