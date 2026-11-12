# 生产服务器信息（部署事实）

> 最后核实：**2026-11-02 00:26 (CST)**，全部数据来自线上实机，不是转述。
> 本文是**部署事实记录**，改动服务器后请同步更新本文件。

---

## 1. 访问入口

| 项 | 值 |
| --- | --- |
| 站点 | **https://124.221.164.209/pvz/**（注意尾部斜杠，`/pvz` 会 308 重定向） |
| 健康检查 | `https://124.221.164.209/api/health` → `{"ok":true,...}` |
| 联机 WebSocket | `wss://124.221.164.209/ws`（**根路径，不在 /pvz 下**） |
| SSH | `ssh ubuntu@124.221.164.209` |
| 地域 | 上海（腾讯云 Lighthouse） |
| 当前 build | `dev`（服务器未设 `BUILD_ID`，即不校验客户端构建号） |
| 协议 | 已实测 Caddy 走 **HTTP/2** |

## 2. 机器规格（实测）

| 项 | 实测值 |
| --- | --- |
| 系统 | Ubuntu 24.04.4 LTS |
| CPU | **2 核** Intel Xeon Platinum 8255C @ 2.50GHz，**Thread(s) per core: 1**（独占物理核，非超线程共享，比预估好） |
| 内存 | 7.5 GiB 总量；核实当时 used 3.3 GiB / available 4.2 GiB |
| 磁盘 | 79 G，已用 28 G（37%） |
| Node | **v22.23.2**（`/usr/bin/node`） |
| 负载 | 核实当时 load average 0.07（空闲） |
| Docker | **未安装**（验收内存请用 `systemctl status pvz-duo` 的 `Memory:` 行或 `ps -o rss`） |

> ⚠️ 内存：`available` 只有 4.2 GiB，但这是含 buff/cache 的口径。重构后每场约 1 MB（§ 计划 §1.2），不构成压力。真正要盯的是**出网流量**，不是内存。

## 3. 目录与进程

| 用途 | 路径 |
| --- | --- |
| 源码仓库 | `/home/ubuntu/pvz-shoot`（约 420 MB，含 `node_modules`） |
| 静态发布目录 | `/var/www/pvz`（约 29 MB，Caddy 的 root） |
| 部署脚本 | `/home/ubuntu/bin/pvz-deploy.sh` |
| Caddy 路由片段 | `/etc/caddy/acli.d/routes/pvz-shoot.caddy` |
| systemd 单元 | `/etc/systemd/system/pvz-duo.service` |

`pvz-duo.service` 关键配置（实机读取）：

```
User=ubuntu
WorkingDirectory=/home/ubuntu/pvz-shoot
Environment=HOST=127.0.0.1
Environment=PORT=8090
Environment=PUBLIC_DIR=/var/www/pvz
Environment=TRUST_PROXY=1
Environment=MAX_MATCHES=8
Environment=MAX_CONN_PER_IP=6
Environment=RECONNECT_GRACE=45
ExecStart=/usr/bin/node server/index.js
Restart=always
```

服务**只监听 127.0.0.1:8090**，由 Caddy 反代对外。核实当刻：`active (running)`，内存 18.7 MB，峰值 24.9 MB。

## 4. Caddy 路由（实机读取）

```caddy
redir /pvz /pvz/ 308

handle /ws      { reverse_proxy 127.0.0.1:8090 }
handle /api/*   { reverse_proxy 127.0.0.1:8090 }

handle_path /pvz/* {
	root * /var/www/pvz
	@hashed path /assets/*
	header @hashed Cache-Control "public, max-age=604800"
	@unhashed not path /assets/*
	header @unhashed Cache-Control "no-cache"
	file_server
}
```

## 5. 静态资源构成（`/var/www/pvz`，实测）

**总计约 29 MB / 92 个文件**，其中：

| 目录 | 体积 | 缓存策略 |
| --- | --- | --- |
| `models/` | **26 MB** | `no-cache`（每次回源校验，304 几乎不耗流量，但**首访必付 26 MB**） |
| `assets/` | 2.2 MB | `public, max-age=604800`（7 天） |
| `audio/` | 968 KB | `no-cache` |

最大的几个文件（这也是**首屏慢的主因**）：

| 文件 | 体积 |
| --- | --- |
| `models/mushroom-king.glb` | **4.2 MB** |
| `models/dragon-evolved.glb` | **2.7 MB** |
| `assets/main-*.js` | 1.4 MB |
| `models/skeleton.glb` | 1.4 MB |
| `models/football.glb` / `alchemist.glb` | 各 1.3 MB |

> **给网络重构的结论**：见计划 §5.1。`assets/` 已有 hash 可放心长缓存；`models/` 文件名不含 hash，改成 `immutable` 前**必须先做带版本号的路径**（如 `models/v2/xxx.glb`），否则改了模型用户永远拿旧的。
> `farmer.glb`（1.3 MB，旧队友模型）已移除，首屏与全量体积各少 1.3 MB。

## 6. SSH 注意事项

本机（开发环境）`/etc/ssh/ssh_config.d/50-ocs.conf` 权限异常（644，需 600/644 之外的正确权限），会导致：

```
Bad owner or permissions on /etc/ssh/ssh_config.d/50-ocs.conf
```

**绕过办法**：加 `-F /dev/null`。

```bash
ssh -F /dev/null ubuntu@124.221.164.209
```

（这是本机环境问题，与服务端无关，新机器上不一定存在。）

## 7. 部署流程

```bash
# 在服务器上执行（脚本内含：跑测试 → 构建 → rsync → 按需重启 → 自检）
~/bin/pvz-deploy.sh              # 完整流程
~/bin/pvz-deploy.sh --skip-tests # 跳过测试（不推荐）
```

脚本行为要点：
- 测试失败直接退出，不发版；
- `rsync -a --delete` 同步 `dist/` → `/var/www/pvz/`；
- **只有** `server/`、`src/net/`、`src/entities/`、`src/Game.js` 有变动才重启 `pvz-duo`（避免打断进行中的对局）；
- 末尾自检：`/pvz/` 必须 200 且 `/api/health` 必须 `ok:true`，否则退出码非 0。

> **网络重构后要改这个脚本**：重构会把模拟层放进 `src/sim/`、把房间逻辑放进 `server/`。脚本里那段「哪些目录变了才重启」的文件清单**必须加上 `src/sim/`**，否则改了模拟逻辑却不重启服务，线上跑的还是旧代码——这是重构后极易踩的坑。

## 8. 待办（部署相关）

| # | 事项 | 说明 |
| --- | --- | --- |
| D1 | 设置 `BUILD_ID` | 现在是 `dev`，意味着客户端与服务端构建号不校验。发版时设成 git sha 可防版本错配 |
| D2 | 静态资源缓存升级 | 见 §5，需先做带版本的模型路径 |
| D3 | 移除 `farmer.glb` | 已完成（1.3 MB 死文件） |
| D4 | 部署脚本加 `src/sim/` | 见 §7 |
| D5 | 确认内存余量 | 核实当时 available 仅 4.2 GiB，重构后按 §1.2 每场 ~1 MB 不成问题，但压测时要盯 |
