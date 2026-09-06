# TDShogi 部署说明

本平台是**单进程 Node.js 常驻服务**（Express REST + ws WebSocket 同端口），依赖：
- 常驻进程（对局状态、WebSocket 长连接、棋钟 tick）
- 可写文件系统（`data/` 目录落盘棋谱、会话、评级）
- Node.js 22+ 运行时（better-sqlite3 v13 硬性要求，npm install 会因 engines 不符直接报错）

> ⚠️ 因此它**不是纯静态站**，部署目标必须是能运行 Node.js 常驻进程的服务器（云主机 / VPS / Docker / PaaS）。

---

## 一、要传哪些文件（部署包清单）

**必传（应用代码 + 依赖清单）：**

```
tdshogi/
├── package.json          # 依赖声明与 npm start 脚本
├── package-lock.json     # 锁定依赖版本（保证可复现）
├── .npmrc                # better-sqlite3 预编译包镜像（服务器免编译工具链）
├── server.js             # 服务端入口
├── src/                  # 服务端逻辑（13 个模块，全部需要）
│   ├── protocol.js  rooms.js  game.js  coords.js   # 对局核心
│   ├── auth.js  accounts.js  ratings.js  records.js
│   ├── kif.js  storage.js  tournaments.js
│   ├── announcements.js  admin.js
├── public/               # 前端（静态资源，全部需要）
│   ├── *.html            # 8 个页面
│   ├── css/              # style.css board.css review.css
│   ├── js/               # 15 个脚本（含统一棋盘组件 freeboard.js、棋子图集配置 pieces.js）
│   └── pieces/           # 棋子图片 kinki.png ryoko.png
├── DEPLOY.md             # 本文件（可选）
└── README.md             # （可选）
```

**选传：**

```
├── scripts/              # 批量导入 KIF 的工具（非运行时必需）
└── data/                 # 已有数据（如迁移旧服务器，可带上保留棋谱/用户）
```

**绝对不传：**

```
❌ node_modules/           # 服务器上 npm install 重新生成
❌ 参考文件/               # 你的本地参考项目，无部署价值
❌ 棋子素材/               # 素材原图（public/pieces 已有）
❌ .playwright-cli/       # E2E 测试缓存
❌ .codebuddy/            # 本机工具数据
❌ srv.log srv.err 等日志
```

**如何在服务器上准备（Linux 示例）：**

```bash
# 1. 上传上述文件到服务器（如 scp / rsync / 宝塔面板 / Git）
rsync -av --exclude 'node_modules' --exclude '.playwright-cli' \
      --exclude '参考文件' --exclude '棋子素材' --exclude '.codebuddy' \
      ./ user@server:/opt/tdshogi/

# 2. 服务器上安装依赖（仓库自带 .npmrc，无需任何 C++ 编译工具链）
cd /opt/tdshogi
npm ci --omit=dev

# 2.5 验证依赖健康（应输出 sqlite OK）
node -e "const db=require('better-sqlite3')(':memory:');db.exec('create table t(a)');console.log('sqlite OK')"

# 3. 配置环境变量（推荐）
export PORT=3000
export DATA_DIR=/var/lib/tdshogi        # 持久数据目录（可选，默认 ./data）
export ADMIN_PASSWORD=你的强密码        # 管理员登录密码（不设置则使用内置密码 Cplusplus123）
export ADMIN_SECRET=随机长字符串        # token 签名密钥（不设置则从管理密码派生）
export TRUST_PROXY=1                    # 走 Nginx 反代时必配（1 层），否则记录到的 IP 是 127.0.0.1
export ADMIN_ENTRY_KEY=随机长字符串     # 可选：隐藏管理后台入口（见下）

# 4. 启动
npm start
```

**管理后台入口（普通用户不可见）：**

- 导航栏的 🛡️ 入口**仅在本机已登录过管理员时显示**（token 存于该浏览器的 localStorage），
  普通用户任何页面都看不到入口。
- 管理员自己直接访问 `/admin.html` 即可进入登录页。
- 更隐蔽：设置 `ADMIN_ENTRY_KEY` 后，访问 `/admin.html` 必须带 `?k=<ADMIN_ENTRY_KEY>`
  （如 `https://站点/admin.html?k=你的key`），否则返回 404——连后台存在都不暴露。
  该 key 只用于"找到页面"，登录仍需管理密码（服务端 `admin.verify` 鉴权不变）。

**用 PM2 保持常驻：**

```bash
npm install -g pm2
pm2 start server.js --name tdshogi --env production
pm2 save && pm2 startup
```

**用 systemd（可选）：**

```ini
# /etc/systemd/system/tdshogi.service
[Unit]
Description=TDShogi shogi server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/tdshogi
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/tdshogi
Environment=ADMIN_PASSWORD=你的强密码
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

**用 Docker（可选）：**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.js src/ public/ ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t tdshogi .
docker run -d --name tdshogi -p 3000:3000 \
  -v tdshogi-data:/app/data \
  -e ADMIN_PASSWORD=你的强密码 \
  tdshogi
```

**Nginx 反代（WebSocket 必须）：**

```nginx
server {
    listen 80;
    server_name shogi.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket 升级
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

---

## 二、能否用 EdgeOne Pages 部署？

**结论：当前架构（单进程常驻 Node + WebSocket + 文件落盘）不能直接部署在 EdgeOne Pages 上。**

原因如下：

| 需求 | TDShogi 需要 | EdgeOne Pages 提供 |
|------|-------------|---------------------|
| 常驻进程 | 服务端维护对局状态机、棋钟 tick、WebSocket 长连接 | **Serverless/边缘函数，按请求触发，无常驻进程** |
| WebSocket | 实时对局双向推送（ws 库） | 边缘函数不支持自建 WebSocket 长连接推送（EdgeOne 的 WebSocket 是**反向代理加速**给源站，不托管运行） |
| 持久文件系统 | `data/` 落盘棋谱/会话/评级 | 函数运行环境**临时/只读**，无持久文件写入（需配合外部存储） |
| 规则引擎 | shogi.js 服务端权威判定 | 无 Node 长驻运行时 |

**能部署的部分：**
- `public/` 静态资源（HTML/CSS/JS/图片）可发布到 EdgeOne Pages 作为**静态站点**，但没有后端则无法对局、登录、存棋谱。

**如果一定要上 EdgeOne，需要重构：**
1. 把规则引擎 + 对局状态迁移到**云函数**（按走子请求触发）
2. 对局状态存**内存共享 / Redis / EdgeOne KV**
3. WebSocket 改为**长轮询 / SSE / EdgeOne 专属通道**
4. 棋谱存对象存储或数据库
> 这是一个较大改造，**建议先上传统 Node 服务器**跑通，后续如需弹性可再演进。

---

## 三、推荐的部署目标（按成本/复杂度排序）

1. **云服务器 VPS**（腾讯云轻量 / 阿里云 ECS）— 最简单，`npm install && npm start`，配合 PM2
2. **宝塔面板**（国内方便）— 上传文件 + Node 项目管理器
3. **Docker**（任一云主机 / 容器平台）— 可移植
4. **PaaS 平台**（Railway / Render / Fly.io）— 支持常驻 Node + WebSocket + 持久卷，`DATA_DIR` 指向挂载卷
