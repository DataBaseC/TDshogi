# TDShogi 在线将棋对战平台

轻量级在线将棋对战平台，参考 [81Dojo](https://81dojo.com) 与 [lishogi](https://lishogi.org) 的功能形态设计，采用 **Node.js + Express + ws** 单进程部署，无数据库依赖，棋子为程序化生成的 SVG 矢量木棋子。

## 特性

- 游客免注册即可开始对局（`localStorage` 持久化），可在个人页注册账号保留数据
- 账号系统：用户名+密码注册/登录（scrypt 加盐哈希，无数据库依赖），游客升级账号自动迁移对局/评级/棋谱
- 在线人人对战（服务端权威规则判定）+ 实时观战
- 好友房间（6 位房间码邀请）+ 快速匹配
- 随机观战（一键进入进行中的对局）
- ELO 评级系统（参考 81Dojo R300 形态，起始 1500，K=32）
- 单败淘汰赛事（4/8/16 人）
- 棋谱自动保存 + **日本标准 KIF / CSA 格式导出**
- 棋谱回放（感想战式）
- 和风 × 现代深色 UI，�木暖色棋盘 + 金色点缀
- 自生成 SVG 木棋子（无外部图片素材）

## 目录结构

```
shogiwebapp/
├── package.json
├── server.js                  # 入口：Express + ws 同端口
├── src/
│   ├── coords.js              # USI 坐标 ↔ shogi.js (x,y) 转换
│   ├── game.js                # 基于 shogi.js 的规则封装（王手过滤、升变、判定）
│   ├── rooms.js               # 房间 / 匹配 / 对局状态机 / 棋钟
│   ├── protocol.js            # WebSocket 消息路由 + REST 适配
│   ├── records.js             # 棋谱落盘 + 日本标准 KIF/CSA 导出/导入判定
│   ├── tournaments.js         # 单败淘汰赛
│   ├── ratings.js             # ELO 积分与排行榜
│   ├── announcements.js       # 系统公告
│   ├── auth.js                # 游客会话
│   └── storage.js             # JSON 文件存储工具
├── public/
│   ├── index.html             # 首页（随机观战/公告/排行榜）
│   ├── lobby.html             # 对战大厅
│   ├── play.html              # 对局页（对战 + 观战）
│   ├── history.html           # 棋谱管理 + 回放 + KIF/CSA 导出
│   ├── tournaments.html       # 赛事
│   ├── profile.html           # 个人页
│   ├── css/style.css          # 全局和风深色主题
│   ├── css/board.css          # 棋盘样式
│   └── js/
│       ├── api.js             # WS / REST 封装
│       ├── nav.js             # 全局导航渲染
│       ├── board.js           # SVG 棋子 + 棋盘渲染 + 走子交互
│       ├── home.js / lobby.js / play.js / history.js / tournaments.js / profile.js
└── data/                      # 运行时生成（gitignore）
    ├── records/               # 棋谱 JSON
    ├── sessions/              # 游客会话
    ├── ratings.json
    ├── tournaments.json
    └── announcements.json
```

## 快速开始

### 环境要求

- Node.js 22+（依赖 better-sqlite3 v13 的硬性要求；22/24 实测通过）
- npm 9+
- 现代浏览器（Chrome / Edge / Firefox）

> 无需 Python / Visual Studio / gcc 等 C++ 编译工具链：better-sqlite3 v13 的 tarball
> 自带全平台预编译二进制（`prebuilds/*.node`），项目根 `.npmrc` 已设置 `ignore-scripts=true`
> 阻止 npm 对它做无谓且易失败的本地编译（详见下文「常见问题」）。

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 启动服务器（默认端口 3000）
npm start

# 3. 访问
open http://localhost:3000
```

### 常见问题：npm install 报 node-gyp / gyp ERR find VS 失败

`better-sqlite3` 包内带 `binding.gyp` 且未声明 install 脚本，npm 默认会自动执行
`node-gyp rebuild`，在缺少 MSVC 工具链（Windows）或 build-essential（Linux）的机器上
整体安装失败。修复方式由仓库根目录 `.npmrc` 的 `ignore-scripts=true` 自动生效。

验证安装是否健康：

```bash
node -e "const db=require('better-sqlite3')(':memory:');db.exec('create table t(a)');console.log('sqlite OK')"
```

若手动加过 `--ignore-scripts=false` 或改坏了 `.npmrc`，恢复即可。
注意：本项目所有依赖均不需要生命周期脚本；若未来引入需要编译/postinstall 的依赖，
需重新评估该配置。

### 自定义端口

```bash
PORT=8080 npm start
```

## 部署

### 单机直接运行

```bash
npm start
```

### 使用 PM2（推荐生产）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server.js --name tdshogi

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
pm2 logs tdshogi
```

### 使用 systemd（Linux）

创建 `/etc/systemd/system/tdshogi.service`：

```ini
[Unit]
Description=TDShogi shogi server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/tdshogi
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=www-data
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tdshogi
sudo systemctl status tdshogi
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name shogi.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

```bash
docker build -t tdshogi .
docker run -d --name tdshogi -p 3000:3000 -v $(pwd)/data:/app/data tdshogi
```

## REST API

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/home` | GET | 首页数据（公告 + 排行榜 + 统计 + 进行中对局） |
| `/api/lobby` | GET | 对战大厅数据 |
| `/api/history?player=<id>` | GET | 某玩家的对局记录 |
| `/api/records/:id/export?fmt=kif\|csa` | GET | 导出棋谱（下载） |
| `/api/records/:id/playback` | GET | 回放数据（中间局面） |
| `/api/tournaments` | GET | 赛事列表 |
| `/api/profile?player=<id>` | GET | 个人战绩与评级 |
| `/api/register` | POST | 注册账号 `{username, password, guestId?}`（guestId 用于游客升级迁移数据） |
| `/api/login` | POST | 登录 `{username, password}`，返回会话令牌 |
| `/api/me?token=<token>` | GET | 校验会话令牌，返回账号信息 |

## WebSocket 协议

WS 路径：`ws://<host>/ws?guest=<guestId>`

客户端消息 `type`：
- `create_room` 创建房间
- `join_room {code}` 加入房间
- `quick_match` / `cancel_match` 快速匹配
- `move {usi}` 走子
- `resign` 认输
- `rematch` 再来一局
- `spectate {roomId}` / `random_spectate` 观战（该身份在此房间有断线座位时自动回位到选手座位，`spectating` 带 `rebind:true`）
- `leave` 离开
- `rename {name}` 改名
- `create_tournament {name,size}` / `join_tournament {id}` 赛事
- `request_state {roomId?}` 请求当前状态（roomId=页面 URL 指向的房间，回位优先绑定它）
- 感想战（FINISHED 后）：`demo_move {usi,index}` / `demo_undo` / `demo_claim` / `demo_transfer` / `demo_reset` / `demo_legal {index}`

服务端消息 `type`：`hello / matched / room_created / room_joined / game_start / state / clock / move_invalid / game_over / elo_updated / spectator_update / tournament_update / renamed / spectating / demo_state / demo_legal / error`

## 棋谱格式（KIF / CSA）

严格遵循日本业内标准格式（参照 python-shogi record.py 的判定原理实现）：

**KIF 示例：**
```
# ---- Kifu for Windows V7 V7.1 棋譜ファイル ----
開始日時：2026-08-13 04:07:09
手合割：平手
先手：先手太郎
後手：後手次郎
手数----指手---------消費時間--
1 ７四歩(73)
2 ３六歩(37)
まで2手で後手次郎の勝ち
```

**CSA 示例：**
```
V2.2
N+先手太郎
N-後手次郎
P1-KY-KE-GI-KI-OU-KI-GI-KE-KY
...
+
+7374FU
-3736FU
%TORYO
```

## 数据存储

所有数据写入单一 SQLite 库 `data/tdshogi.db`（WAL 模式；storage.js 提供 kv 兼容层）：

- `kv` 表：评级 / 账号 / 赛事 / 公告 / 会话 / 管理配置（原各 *.json 的键值化落点）
- `records` 表：每局棋谱（含起止局面、走法、玩家、结果、书签/评论/变着），支持 json_extract 组合检索
- `gamesnapshots` 表：进行中对局快照，服务器重启自动恢复未完成对局

**备份建议**：定期备份 `data/tdshogi.db` 单个文件即可还原所有数据。首次启动会自动把旧版
JSON 文件迁移入库并改名为 `.bak`。

## 规则说明

- 标准将棋初始局面（平手）
- 完整支持：升变、打步、持驹、王手、将死、投了、千日手、入玉、时间切れ
- 服务端权威判定（shogi.js + 自实现的王手过滤与结果判定）
- 棋钟：每方 15 分钟，未使用秒读

## 开发与测试

```bash
# 开发模式（自动重启）
npm run dev

# 端到端测试（需 playwright-cli）
npm install -g @playwright/cli
playwright-cli install-browser
# 启动服务器后，另开两个会话模拟双人对局
```

## 限制与扩展

v1 限制：
- 駒落ち（让子）尚未支持（仅平手）
- 暂无 AI 对战（可接入 USI 引擎如 YaneuraOu）
- 暂无锦标赛（仅单败淘汰赛事）
- 游客账号无密码（已支持升级为带密码的正式账号）

扩展方向：
- 接入 USI 引擎（人机对战）
- 锦标赛（多轮淘汰 + 循环赛）
- 驹落ち（香落ち等）
- 实名账号体系（基于游客 id 升级）
- 棋谱搜索与战术题库

## License

MIT
