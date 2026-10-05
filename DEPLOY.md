# 聊天室部署教程（手把手详细版）

目标：把你本地的 `chat/` 多人聊天室，推到 GitHub，再部署到云端（Railway 或 Render 二选一），得到一个公网网址，发给朋友就能多人同服聊天。

---

## 前置条件（先确认）
1. 本机已装 **Node.js ≥ 22**（终端跑 `node -v` 看版本）。
2. 本地能跑起来：在 `chat/` 目录执行
   ```bash
   npm install
   npm start
   ```
   浏览器开 `http://localhost:3000`，开两个标签页互发消息正常。
3. `chat/` 已经是 Git 仓库且有过提交（已帮你做好，`git log` 能看到提交）。
4. 你需要：一个 **GitHub 账号** + 一个 **Railway 或 Render 账号**（都免费注册，支持用 GitHub 一键登录）。

---

## 第一步：推到 GitHub

### 1.1 在网页上建一个空仓库
1. 打开 https://github.com 并登录。
2. 右上角点 **＋** → **New repository**（新建仓库）。
3. 填写：
   - **Repository name**：随便起，例如 `web-chatroom`。
   - **Description**（可选）：可填「多频道网页聊天室」。
   - **Public / Private**：选 **Public**（免费，且部署平台拉取代码需要公开或授权）。
   - **Important**：**不要**勾选 "Add a README file"、".gitignore"、"License" —— 保持空仓库，否则首次 push 会冲突。
4. 点 **Create repository**。

### 1.2 复制仓库地址
建好后页面会显示一个地址，形如：
```
https://github.com/你的用户名/web-chatroom.git
```
点一下右边的复制按钮记下它（把 `你的用户名` 换成你真实的 GitHub 用户名）。

### 1.3 本机连接并推送
在 `chat/` 目录打开终端，依次执行：
```bash
# 1) 关联远程仓库（把地址换成你刚复制的）
git remote add origin https://github.com/你的用户名/web-chatroom.git

# 2) 把分支名统一成 main（GitHub 默认叫 main，本地叫 master，改名更省事）
git branch -M main

# 3) 推送
git push -u origin main
```

### 1.4 关于「推送时要登录」
⚠️ GitHub **早已不支持用账号密码 push**，必须用以下任一方式：
- **方式 A（最简单，推荐）**：用 **Personal Access Token (PAT)** 当密码。
  1. GitHub 网页 → 右上角头像 → **Settings** → 左侧最下方 **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**。
  2. Note 随便写；**Expiration** 选个 long（如 90 days 或 No expiration）；**Select scopes** 勾上 **repo**（全选 repo 那一组）。
  3. 点 **Generate token**，**立刻复制**那串 `ghp_xxx`（只显示这一次！）。
  4. 回到终端 `git push` 时：用户名填你的 GitHub 用户名，密码那里**粘贴这个 token**（粘贴时屏幕不显示，正常）。
- **方式 B**：装 GitHub CLI（`https://cli.github.com`）→ 终端 `gh auth login` 按提示登录，之后 push 不再要密码。
- **方式 C（Windows）**：装 Git for Windows 时勾选了 Git Credential Manager，首次 push 会弹窗让你登录，之后记住。

### 1.5 验证推送成功
刷新 GitHub 仓库页面，能看到 `server.js`、`package.json`、`public/`、`Dockerfile`、`railway.toml`、`render.yaml` 等文件，就成功了。

> 小提示：当前 Git 提交身份是占位的 `dev@example.com`。如果想改成你自己的，跑：
> ```bash
> git config user.email 你的邮箱
> git config user.name 你的名字
> ```

---

## 第二步：部署到 Railway（推荐，最省心）

Railway 会自动读仓库里的 `railway.toml` + `Dockerfile` 来构建部署。

### 2.1 注册 / 登录
1. 打开 https://railway.app → 点 **Login** → 选 **GitHub** 一键登录并授权。
2. 首次会进到 Dashboard。

### 2.2 从 GitHub 导入
1. 点 **New Project**（或左上 **＋**）。
2. 选 **Deploy from GitHub repo**（从 GitHub 仓库部署）。
3. 如果第一次，Railway 会请求授权访问你的 GitHub，点 **Authorize**。
4. 在仓库列表里选你刚 push 的 `web-chatroom`。
5. Railway 检测到 `railway.toml` 和 `Dockerfile`，自动开始构建部署。

### 2.3 等待构建
1. 点进这个项目，看 **Deployments** 里的日志。
2. 正常会看到：`npm install`（装 ws）→ 构建镜像 → 启动 → 日志出现「聊天室服务器已启动: http://localhost:3000」（云端实际端口由 Railway 用环境变量注入，不影响）。
3. 状态变 **Success / Active** 即可。

### 2.4 拿到公网网址
1. 项目页点 **Settings** → **Networking**（或 Deployments 右侧 **Generate Domain**）。
2. 点 **Generate Domain**，会得到一个形如 `web-chatroom.up.railway.app` 的网址。
3. 浏览器打开它 —— 多人聊天室上线了！把网址发给朋友即可。

### 2.5 让聊天记录永久保存（挂持久卷，可选但建议）
默认容器重启数据会丢。要永久：
1. 项目里点 **Volumes** → **Create Volume / New Volume**。
2. 填：Name 随便（如 `chatdata`），**Mount Path** 填 **`/app/data`**，大小选最小（1GB）。
3. 创建后，到 **Variables**（环境变量）里加一项：
   - Key: `DB_PATH`
   - Value: `/app/data/chat.db`
4. 触发一次 **Redeploy**（重新部署），服务器就会把数据库写到挂载卷，容器重建也不丢。
> 注意：Railway 的持久卷通常需要 **Pro 付费计划**才支持；免费层可能不提供卷。免费层的话，聊天记录会随容器销毁丢失（功能照常），介意就升级或用下面的 Render。

---

## 第三步：部署到 Render（备选，免费层也支持挂盘）

### 3.1 注册 / 登录
1. 打开 https://render.com → **Sign Up** → 用 **GitHub** 注册登录。

### 3.2 新建 Web Service
1.  dashboard 点 **New** → **Web Service**。
2.  连 GitHub：首次会让你 **Authorize Render** 访问 GitHub，授权后选 `web-chatroom` 仓库。
3.  Name 随便（如 `web-chatroom`）。
4.  **Runtime / Environment**：选 **Docker**（它会读仓库的 `Dockerfile`）。
5.  **Instance Type**：选 **Free**（免费）。
6.  其他默认，先别急着 Create。

### 3.3 配置持久磁盘（让数据永久）
在设置页往下找 **Disk / Disks** 区域：
- 勾选 **Add a Disk**（或填 Disk 部分）。
- Name: `data`
- **Mount Path**: `/app/data`
- Size: `1 GB`
- 同时在 **Environment Variables** 加：`DB_PATH` = `/app/data/chat.db`

### 3.4 部署
1. 点 **Create Web Service**，Render 开始构建（拉 Dockerfile → 装依赖 → 启动）。
2. 看 **Logs** 确认出现「聊天室服务器已启动」。
3. 完成后 Render 给一个 `https://web-chatroom.onrender.com` 域名，打开即用。
> Render 免费 Web Service 有「休眠」机制：15 分钟无访问会休眠，下次访问冷启动约几秒，属正常。

---

## 第四步：上线后验证 & 多人测试
1. 打开你的公网网址。
2. 开 **两个浏览器标签**（或不同设备/无痕窗口），各自设不同昵称。
3. 在一个标签发消息，另一个标签应立刻收到（验证实时同服）。
4. 试功能：建加密房间（`频道名:密码`）、私聊（`/w 昵称 消息`）、`@提醒`、发图片、刷新页面看历史是否还在。
5. 刷新页面历史仍在 = 持久化 OK；换设备登录历史也在 = 持久卷生效。

---

## 常见问题排查
- **本地 `npm start` 报错 `SQLite is an experimental feature`**：这是正常的实验性警告，不是错误，程序已启动。
- **本地 `npm start` 报端口占用**：`netstat` 找占用 3000 的进程杀掉，或改 `PORT` 环境变量换端口。
- **GitHub push 报 `Authentication failed` / `Support for password authentication was removed`**：说明用了密码。改用 **PAT（方式 A）** 当密码，或 `gh auth login`。
- **push 报 `failed to push some refs` / `non-fast-forward`**：因为 GitHub 仓库不是完全空（比如你勾了初始化 README）。解决：先 `git pull --rebase origin main` 再 `git push`，或删掉仓库重建为空仓库。
- **Railway/Render 部署失败**：第一时间看 **Deploy Logs / Build Logs**。常见原因：
  - 找不到 `Dockerfile` → 确认已 push 且文件名就是 `Dockerfile`（大写 D，无后缀）。
  - `node:sqlite` 报错 → 确认 Dockerfile 基础镜像是 `node:22-alpine`（已配好），且启动带 `--experimental-sqlite`（已配好）。
  - 启动后立刻退出 → 看是否端口监听问题（代码已用 `process.env.PORT`，平台会注入，正常）。
- **网址打不开 / 一直转圈**：部署可能还在进行；确认状态是 Active/Success；Railway 需在 Networking 里 **Generate Domain** 才有网址。
- **聊天记录丢失**：没挂持久卷（见 2.5 / 3.3）。本地运行数据在 `chat.db`，不受影响。

---

## 本地运行回顾
```bash
cd chat
npm install
npm start          # 需 Node ≥ 22，自动带 --experimental-sqlite
# 浏览器开 http://localhost:3000 ，多标签即多玩家同服
```
