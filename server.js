const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { WebSocketServer } = require('ws');
const { DatabaseSync } = require('node:sqlite');
const ChessEngine = require('./public/chess-game.js');

const PORT = process.env.PORT || 3000;
const MAX_IMAGE = 1500000; // 图片 base64 字符上限
const ADMIN_CODE = process.env.ADMIN_CODE || '123456'; // 管理员特殊数字口令（可环境变量覆盖）

// ===================== SQLite 持久化 =====================
const dbPath = process.env.DB_PATH || path.join(__dirname, 'chat.db');
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT, name TEXT, text TEXT, image TEXT, time TEXT, date TEXT, ip TEXT
)`);
try { db.exec('ALTER TABLE messages ADD COLUMN ip TEXT'); } catch (e) {}
// 启动加载：每频道最近 200 条到内存（用于实时广播与回放）
const history = new Map();
const chRows = db.prepare('SELECT DISTINCT channel FROM messages').all();
for (const { channel } of chRows) {
  const rows = db.prepare('SELECT id,name,text,image,time,date FROM messages WHERE channel=? ORDER BY id DESC LIMIT 200').all(channel);
  history.set(channel, rows.reverse().map(r => ({
    id: r.id, name: r.name, text: r.text || '', image: r.image || undefined, time: r.time, date: r.date
  })));
}
const insertMsg = db.prepare('INSERT INTO messages(channel,name,text,image,time,date,ip) VALUES(?,?,?,?,?,?,?)');
// 管理员信息流（最近 100 条，含发言 IP），用于后台删除/定位
const feed = [];
{
  const rows = db.prepare("SELECT id,name,text,ip,time FROM messages WHERE channel='general' ORDER BY id DESC LIMIT 100").all();
  for (const r of rows.reverse()) feed.push({ id: r.id, name: r.name, text: r.text || '', ip: r.ip || 'unknown', time: r.time });
}

// ===================== 状态 =====================
const clients = new Map();                                   // ws -> { name, channel, role, ip }
const channels = new Map([['general', { password: '', owner: null }]]); // name -> { password, owner }
let adminWs = null; // 唯一在线的管理员
function roleLabel(r) { return r === 'admin' ? '管理员' : r === 'guest' ? '访客' : '用户'; }

// ===================== 联机国际象棋 =====================
const chessGames = new Map();   // gameId -> { id, white, black, state, over }
const chessWaiting = [];        // 等待匹配的 ws 队列
function chessFind(ws) { for (const g of chessGames.values()) if (g.white === ws || g.black === ws) return g; return null; }

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

// ===================== 地理定位（管理员查看发言地，按需查询，带缓存与降级）=====================
const geoCache = new Map();
function geoLookup(ip) {
  if (!ip || ip === 'unknown') return Promise.resolve('未知');
  if (geoCache.has(ip)) return Promise.resolve(geoCache.get(ip));
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return Promise.resolve(ip); // 非公网 IPv4 直接返回
  return new Promise((res) => {
    const req = https.get('http://ip-api.com/json/' + ip + '?fields=country,regionName,city', (r) => {
      let body = ''; r.on('data', d => body += d);
      r.on('end', () => { try { const j = JSON.parse(body); const g = [j.country, j.regionName, j.city].filter(Boolean).join(' ') || ip; geoCache.set(ip, g); res(g); } catch (e) { res(ip); } });
    });
    req.on('error', () => res(ip));
    req.setTimeout(1500, () => { req.destroy(); res(ip); });
  });
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

wss.on('connection', (ws, req) => {
  const xff = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  const ip = xff || (ws._socket && ws._socket.remoteAddress) || 'unknown';
  clients.set(ws, { name: null, channel: null, role: null, ip });
  // 暂不进入房间：等待客户端发送 login 后再正式加入

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    const c = clients.get(ws);
    if (!c) return;

    // —— 登录（进入房间前必须 login）——
    if (m.type === 'login') {
      if (c.role) return; // 已登录
      const mode = (m.mode || '').toString();
      let role, name;
      if (mode === 'guest') {
        role = 'guest';
        name = '访客' + Math.floor(Math.random() * 1000);
      } else {
        name = (m.name || '').toString().trim();
        if (!name) { send(ws, { type: 'login_fail', reason: '名字必填' }); return; }
        name = name.slice(0, 16);
        const code = (m.code || '').toString().trim();
        if (code && code === ADMIN_CODE) {
          if (adminWs && adminWs !== ws && adminWs.readyState === ws.OPEN) {
            send(ws, { type: 'login_fail', reason: '管理员已在线' }); return;
          }
          role = 'admin'; adminWs = ws;
        } else {
          role = 'user';
        }
      }
      c.role = role; c.name = name; c.channel = 'general';
      send(ws, { type: 'welcome', name, role, channel: 'general' });
      pushUsers('general');
      sendHistory(ws, 'general');
      channelInfo(ws, 'general');
      broadcastChannel('general', { type: 'sys', text: `${name}（${roleLabel(role)}）加入了 #general` }, null);
      if (role === 'admin') send(ws, { type: 'admin_recent', messages: feed });
      return;
    }
    if (!c.role) return; // 尚未登录，忽略其余指令

    // 访客只读：禁止发言/私聊/改名/下棋
    if (c.role === 'guest' && ['msg', 'whisper', 'join', 'chess_new', 'chess_join', 'chess_move', 'chess_resign'].includes(m.type)) {
      send(ws, { type: 'sys', text: '访客无法操作（仅可查看）' }); return;
    }

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
      const info = insertMsg.run(c.channel, c.name, text, image || null, t, d, c.ip);
      const mid = info.lastInsertRowid;
      broadcastChannel(c.channel, { type: 'chat', id: mid, name: c.name, text, image: image || undefined, channel: c.channel, time: t, date: d }, null);

      if (!history.has(c.channel)) history.set(c.channel, []);
      history.get(c.channel).push({ id: mid, name: c.name, text, image: image || undefined, time: t, date: d });
      if (history.get(c.channel).length > 200) history.get(c.channel).shift();
      feed.push({ id: mid, name: c.name, text, ip: c.ip, time: t });
      if (feed.length > 100) feed.shift();
      for (const [w, cc] of clients) if (cc.role === 'admin') send(w, { type: 'admin_msg', id: mid, name: c.name, text, ip: c.ip, time: t });

      // @提醒：匹配当前在线昵称
      const mentions = [...text.matchAll(/@([^\s@]+)/g)].map(x => x[1]);
      const names = allNames();
      for (const nm of mentions) {
        if (names.includes(nm) && nm !== c.name) {
          for (const [w, cc] of clients) if (cc.name === nm) send(w, { type: 'mention', from: c.name, text, channel: c.channel, time: t });
        }
      }
    }
    else if (m.type === 'chess_new' || m.type === 'chess_join') {
      if (chessFind(ws)) return;                       // 已在棋局中则忽略
      let opp = null;
      for (let i = chessWaiting.length - 1; i >= 0; i--) { if (chessWaiting[i] !== ws) { opp = chessWaiting.splice(i, 1)[0]; break; } }
      if (opp) {
        const white = opp, black = ws, st = ChessEngine.newGame();
        const id = 'g' + Date.now() + Math.floor(Math.random() * 1000);
        chessGames.set(id, { id, white, black, state: st, over: false });
        const p = (color, oppName) => ({ type: 'chess_start', color, opponent: oppName, board: st.board, turn: st.turn, castling: st.castling, ep: st.ep });
        send(white, p('w', clients.get(black).name));
        send(black, p('b', clients.get(white).name));
      } else {
        if (!chessWaiting.includes(ws)) chessWaiting.push(ws);
        send(ws, { type: 'chess_wait', text: '已加入匹配，等待对手…' });
      }
    } else if (m.type === 'chess_move') {
      const g = chessFind(ws); if (!g || g.over) return;
      const color = g.white === ws ? 'w' : 'b';
      if (g.state.turn !== color) { send(ws, { type: 'chess_err', text: '还没轮到你' }); return; }
      const from = m.from, to = m.to;
      if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 2 || to.length !== 2) return;
      if (!g.state.board[from[0]] || !g.state.board[from[0]][from[1]]) return;
      const legal = ChessEngine.legalMoves(g.state, from[0], from[1]);
      if (!legal.some(x => x[0] === to[0] && x[1] === to[1])) { send(ws, { type: 'chess_err', text: '非法走子' }); return; }
      const pp = (g.state.board[from[0]][from[1]].type === 'p' && (to[0] === 0 || to[0] === 7)) ? (m.promotion || 'q') : null;
      g.state = ChessEngine.makeMove(g.state, from, to, pp);
      const st = ChessEngine.status(g.state);
      if (st.over) g.over = true;
      const payload = { type: 'chess_state', board: g.state.board, turn: g.state.turn, castling: g.state.castling, ep: g.state.ep, status: st, white: clients.get(g.white).name, black: clients.get(g.black).name };
      send(g.white, payload); send(g.black, payload);
    } else if (m.type === 'chess_resign') {
      const g = chessFind(ws); if (!g || g.over) return;
      const winner = g.white === ws ? 'b' : 'w';
      g.over = true;
      const payload = { type: 'chess_end', winner, reason: 'resign', white: clients.get(g.white).name, black: clients.get(g.black).name };
      send(g.white, payload); send(g.black, payload);
      chessGames.delete(g.id);
    } else if (m.type === 'admin_delete') {  // 管理员删除违规发言
      if (c.role !== 'admin') return;
      const id = m.id; if (!id) return;
      db.prepare('DELETE FROM messages WHERE id=?').run(id);
      const i = feed.findIndex(x => x.id === id); if (i >= 0) feed.splice(i, 1);
      broadcastChannel('general', { type: 'delete_msg', id }, null);
    } else if (m.type === 'admin_geo_req') {  // 管理员查看发言人地点
      if (c.role !== 'admin') return;
      const id = m.id; const fm = feed.find(x => x.id === id); if (!fm) return;
      geoLookup(fm.ip).then(geo => send(ws, { type: 'admin_geo', id, geo }));
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    if (!c) return;
    if (c.role === 'admin' && adminWs === ws) adminWs = null; // 管理员下线，释放唯一席位
    const gi = chessWaiting.indexOf(ws); if (gi >= 0) chessWaiting.splice(gi, 1);
    const g = chessFind(ws);
    if (g && !g.over) {
      const opp = g.white === ws ? g.black : g.white;
      g.over = true;
      send(opp, { type: 'chess_end', winner: g.white === ws ? 'b' : 'w', reason: 'opponent_left' });
      chessGames.delete(g.id);
    }
    broadcastChannel(c.channel, { type: 'sys', text: `${c.name} 离开了 #${c.channel}` }, null);
    clients.delete(ws);
    pushUsers(c.channel);
  });
});

server.listen(PORT, () => console.log(`聊天室服务器已启动: http://localhost:${PORT}`));
