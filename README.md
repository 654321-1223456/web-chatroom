# 可联机网页聊天室（多频道 · 持久化 · 私聊 · 加密房间 · 图片）

基于 Node.js + 原生 `ws` 的实时多人网页聊天室。支持多频道、昵称、在线列表、频道隔离、消息历史持久化、@提醒、私聊、表情、图片、加密房间与房主管理。

## 运行
```bash
cd chat
npm install
npm start
```
浏览器打开 http://localhost:3000

## 功能
- 🔹 多频道：默认 `#general`
- 🔹 加密房间：`新建频道` 输入 `频道名:密码` 创建加密房间；进入加密房间会提示输入密码，密码错误被拒
- 🔹 房主管理：房间创建者即为房主，可在线列表点「踢」将他人移回大厅
- 🔹 昵称 / 在线列表 / 频道隔离
- 🔹 消息历史：SQLite（`chat.db`）永久存储，重启/容器重建均保留；进频道回放最近 20 条（含图片）
- 🔹 @提醒 / 私聊（`/w 昵称 消息` 或点用户名）
- 🔹 表情面板 / 图片上传（≤1.2MB，base64 广播）
- 🔹 时间分组：按天显示「今天 / 昨天 / 日期」分隔

## 协议（WebSocket + JSON）
客户端 → 服务器：`join` / `switch{channel,password?}` / `msg{text?,image?}` / `whisper{to,text}` / `kick{target}`
服务器 → 客户端：`welcome` / `channels[{name,locked}]` / `users` / `channelInfo{locked,owner,isOwner}` / `switched` / `history` / `chat{text,image?,date}` / `whisper{dir}` / `mention` / `denied` / `kicked` / `sys`

## 部署
已提供 `Dockerfile` + `railway.toml`（Railway）+ `render.yaml`（Render）。`PORT` 走环境变量。
步骤：把 `chat/` 推到 GitHub 仓库 → 在 Railway/Render 导入仓库 → 自动识别 Dockerfile 部署。
注意：数据存 `chat.db`（SQLite）。本地运行与挂载持久卷的容器均永久保留；免费临时磁盘容器销毁则数据丢失，需挂持久卷。
