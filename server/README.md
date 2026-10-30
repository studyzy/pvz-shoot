# 双人联机服务器（M0 / M1）

当前进度：**M0 配对/重连 + M1 同场 + M2 input / 僵尸 / 命中 / 救援**。已实现自动配对、多场并发、断线重连、玩家 input 同步；僵尸由房主模拟，20 Hz 快照 + spawn/dead 事件同步；客人的命中/爆炸由房主裁决；共享阳光值、个人分与倒地救援已接。共享补给、阳光球同步、结算页、断线 resync 仍在开发。

## 启动

```bash
npm install
npm run build
PORT=8080 npm run server
```

- 服务器同时托管 `dist/` 与 WebSocket，浏览器直接打开 `http://<服务器>:8080/`。
- 开发时：`npm run dev`（5173）+ `npm run server`（8080）。客户端在 DEV 下会连 `ws://<当前主机名>:8080/ws`。
- 健康检查：`curl http://localhost:8080/api/health`。
- 同一台电脑测试：房主点「双人联机」后地址栏会带 `?join=...`，点「复制邀请链接」发给另一个标签页/浏览器打开即可；token 存在 `sessionStorage`，同一浏览器的两个标签页也会拿到不同 token。
- 没有加入链接时自动配对仍然生效（FIFO）；join 失效返回 `JOIN_EXPIRED`，客户端会清掉参数让你重新匹配。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8080 | HTTP + WS 端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `PUBLIC_DIR` | `dist` | 静态文件目录 |
| `MAX_MATCHES` | 8 | 同时最多几场（每场 2 人） |
| `MAX_CONN_PER_IP` | 6 | 同一 IP 的连接上限 |
| `TRUST_PROXY` | 0 | 反代后设为 1，读 `X-Forwarded-For` |
| `WAIT_TTL` | 600 | 等待队友超时（秒） |
| `RECONNECT_GRACE` | 45 | 掉线重连窗口（秒） |
| `BUILD_ID` | 空 | 设置后校验客户端构建号 |
| `ACCESS_CODE` | 空 | 全服口令（不是房间） |

## 部署示例

```ini
# /etc/systemd/system/pvz-duo.service
[Service]
ExecStart=/usr/bin/node /opt/pvz-duo/server/index.js
WorkingDirectory=/opt/pvz-duo
Environment=PORT=8080 PUBLIC_DIR=/opt/pvz-duo/dist TRUST_PROXY=1 MAX_CONN_PER_IP=6
Restart=always
```

```
# Caddyfile
pvz.example.com {
  reverse_proxy localhost:8080
}
```

只开 80/443；Caddy 自动处理 TLS，浏览器连 `wss://pvz.example.com/ws`。

## 结构

- `src/net/protocol.js`：客户端/服务端共用的消息与清洗。
- `server/matchmaker.js`：waiting FIFO、多场、座位、重连、中继。
- `server/index.js`：HTTP 静态 + `/ws` 升级 + 心跳 + `/api/health`。
- `src/net/NetClient.js`：浏览器 WebSocket、token、心跳/RTT、自动重连。
- `src/net/DuoSession.js`：把网络消息翻译成 `Game.startDuo / applyRemoteState / pause / endDuo`。

房主权威：seat 0 的浏览器负责游戏模拟；服务器只配对、中继、记账。M2 会把僵尸模拟接到房主侧。
