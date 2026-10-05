const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const MAX_IMAGE = 1500000; // 图片 base64 字符上限

// ===================== SQLite 持久化 =====================
const dbPath = process.env.DB_PATH || path.join(__dirname, 'chat.db');
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT, name TEXT, text TEXT, image TEXT, time TEXT, date TEXT
)`);
// 启动加载：每频道最近 200 条到内存（用于实时广播与回放）
const history = new Map();
const chRows = db.prepare('SELECT DISTINCT channel FROM messages').all();
for (const { channel } of chRows) {
  const rows = db.prepare('SELECT name,text,image,time,date FROM messages WHERE channel=? ORDER BY id DESC LIMIT 200').all(channel);
  history.set(channel, rows.reverse().map(r => ({
    name: r.name, text: r.text || '', image: r.image || undefined, time: r.time, date: r.date
  })));
}
const insertMsg = db.prepare('INSERT INTO messages(channel,name,text,image,time,date) VALUES(?,?,?,?,?,?)');

// ===================== 状态 =====================
const clients = new Map();                                   // ws -> { name, channel }
const channels = new Map([['general', { password: '', owner: null }]]); // name -> { password, owner }

const time = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const dateKey = (d = new Date()) => d.toISOString().slice(0, 10);

// ===================== 工具 =====================
const send = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
function channelUsers(ch) { return [...clients.entries()].filter(([, c]) => c.channel === ch).map(([, c]) => c.name); }
function allNames() { return [...clients.values()].map(c => c.name); }
function broadcastChannel(ch, obj, except) { for (const [w, c] of clients) if (c.channel === ch && w !== except) send(w, obj); }
function pushChannels() {
  const list = [...channels.entries()].map(([n, ci]) => ({ name: n, locked: !!ci.password }));
  for (const w of clients.keys()) send(w, { type: 'channels', list });
}
function pushUsers(ch) { const list = channelUsers(ch); for (const [w, c] of clients) if (c.channel === ch) send(w, { type: 'users', channel: ch, list }); }
function sendHistory(ws, ch) { send(ws, { type: 'history', channel: ch, messages: (history.get(ch) || []).slice(-20) }); }
function channelInfo(ws, ch) {
  const ci = channels.get(ch) || { password: '', owner: null };
  const me = clients.get(ws);
  send(ws, { type: 'channelInfo', channel: ch, locked: !!ci.password, owner: ci.owner, isOwner: !!(me && ci.owner === me.name) });
}

// ===================== HTTP 静态服务 =====================
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(__dirname, 'public', urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

// ===================== WebSocket =====================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const name = '访客' + Math.floor(Math.random() * 1000);
  clients.set(ws, { name, channel: 'general' });

  send(ws, { type: 'welcome', name, channel: 'general' });
  pushChannels();
  pushUsers('general');
  sendHistory(ws, 'general');
  channelInfo(ws, 'general');
  broadcastChannel('general', { type: 'sys', text: `${name} 加入了 #general` }, null);

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    const c = clients.get(ws);
    if (!c) return;

    if (m.type === 'join') {                 // 设置 / 修改昵称
      const old = c.name;
      c.name = (m.name || old).toString().slice(0, 16);
      broadcastChannel(c.channel, { type: 'sys', text: `${old} 改名为 ${c.name}` }, null);
      pushUsers(c.channel);
    } else if (m.type === 'switch') {        // 切换 / 创建频道（可带密码）
      const ch = (m.channel || '').toString().trim();
      if (!ch) return;
      const ci = channels.get(ch);
      if (!ci) {                             // 创建新频道
        const pw = (m.password || '').toString();
        channels.set(ch, { password: pw, owner: c.name });
        pushChannels();
        broadcastChannel(c.channel, { type: 'sys', text: `${c.name} 离开了 #${c.channel}` }, null);
        c.channel = ch;
        send(ws, { type: 'switched', channel: ch });
        sendHistory(ws, ch);
        channelInfo(ws, ch);
        pushUsers(ch);
        broadcastChannel(ch, { type: 'sys', text: `${c.name} 创建了 #${ch}${pw ? '（加密）' : ''} 并进入` }, ws);
      } else {                               // 已有频道：密码校验
        if (ci.password && ci.password !== (m.password || '').toString()) {
          send(ws, { type: 'denied', channel: ch, reason: '密码错误或未提供' });
          return;
        }
        broadcastChannel(c.channel, { type: 'sys', text: `${c.name} 离开了 #${c.channel}` }, null);
        c.channel = ch;
        send(ws, { type: 'switched', channel: ch });
        sendHistory(ws, ch);
        channelInfo(ws, ch);
        pushUsers(ch);
        broadcastChannel(ch, { type: 'sys', text: `${c.name} 进入了 #${ch}` }, ws);
      }
    } else if (m.type === 'kick') {          // 房主踢人（移回 general）
      const ci = channels.get(c.channel);
      if (!ci || ci.owner !== c.name) { send(ws, { type: 'sys', text: '只有房主可以踢人' }); return; }
      const target = (m.target || '').toString().trim();
      let tw = null;
      for (const [w, cc] of clients) if (cc.name === target && cc.channel === c.channel) { tw = w; break; }
      if (!tw) { send(ws, { type: 'sys', text: `${target} 不在此频道` }); return; }
      const tc = clients.get(tw);
      tc.channel = 'general';
      send(tw, { type: 'kicked', channel: c.channel });
      send(tw, { type: 'switched', channel: 'general' });
      sendHistory(tw, 'general');
      channelInfo(tw, 'general');
      pushUsers('general');
      broadcastChannel('general', { type: 'sys', text: `${tc.name} 被请离 #${c.channel}，进入 #general` }, null);
      broadcastChannel(c.channel, { type: 'sys', text: `${tc.name} 已被房主移出 #${c.channel}` }, null);
      pushUsers(c.channel);
    } else if (m.type === 'whisper') {       // 私聊
      const to = (m.to || '').toString().trim();
      const text = (m.text || '').toString().trim();
      if (!to || !text) return;
      let target = null;
      for (const [w, cc] of clients) if (cc.name === to) { target = w; break; }
      if (!target) { send(ws, { type: 'sys', text: `找不到用户 ${to}` }); return; }
      const t = time();
      send(ws, { type: 'whisper', from: c.name, to, text, time: t, dir: 'out' });
      send(target, { type: 'whisper', from: c.name, to, text, time: t, dir: 'in' });
    } else if (m.type === 'msg') {           // 频道广播消息（文本 / 图片）
      const text = (m.text || '').toString().trim();
      const image = (m.image || '').toString();
      if (!text && !image) return;
      if (image && image.length > MAX_IMAGE) { send(ws, { type: 'sys', text: '图片过大，发送失败' }); return; }
      const t = time(), d = dateKey();
      broadcastChannel(c.channel, { type: 'chat', name: c.name, text, image: image || undefined, channel: c.channel, time: t, date: d }, null);

      if (!history.has(c.channel)) history.set(c.channel, []);
      history.get(c.channel).push({ name: c.name, text, image: image || undefined, time: t, date: d });
      if (history.get(c.channel).length > 200) history.get(c.channel).shift();
      insertMsg.run(c.channel, c.name, text, image || null, t, d); // 永久落库

      // @提醒：匹配当前在线昵称
      const mentions = [...text.matchAll(/@([^\s@]+)/g)].map(x => x[1]);
      const names = allNames();
      for (const nm of mentions) {
        if (names.includes(nm) && nm !== c.name) {
          for (const [w, cc] of clients) if (cc.name === nm) send(w, { type: 'mention', from: c.name, text, channel: c.channel, time: t });
        }
      }
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    if (!c) return;
    broadcastChannel(c.channel, { type: 'sys', text: `${c.name} 离开了 #${c.channel}` }, null);
    clients.delete(ws);
    pushUsers(c.channel);
  });
});

server.listen(PORT, () => console.log(`聊天室服务器已启动: http://localhost:${PORT}`));
