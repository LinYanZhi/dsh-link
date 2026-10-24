# 交接：两机 DSH 互连（家里 ⇄ 公司），走樱花穿透（2026-10-18）

> **谁读这份**：家里机 AI 读 §3、§5；公司机 AI 读 §4、§5。两边都要读 §0–§2、§6–§8。
> **本文件自包含**，读它不需要看之前任何对话。
> **状态字段**：✅ 已验证 · ⏳ 待办 · ⚠️ 注意 · 🛑 红线 · ❓ 未核实

---

## 0. 结论先行：这次为什么能成（评估结论）

| 项 | 结论 | 证据 |
|---|---|---|
| 插件要不要重写 | **不用**，已有 `dsh-link v0.5.0` | 本仓 `package.json` / `src/`；2026-10 曾真机跑通 |
| 兼容 DSH 0.2.0-rc.2 | ✅ | `package.json` → `dsh.compatibility.dsh: ">=0.1.1-rc.1 <0.3.0"` |
| 上次（10-09）为什么没成 | **不是插件问题，是网络验证没做完** | `docs/probe-2026-10-09-sakurafrp-handshake.md` 阶段 1–3 全空；探针脚本当时没入仓 |
| 本次新增的好条件 | 家里机樱花客户端**已装且在跑** | `C:\Program Files\SakuraFrpLauncher\`，`frpc.exe` pid 存活，节点 `59.36.97.245:80` |

**一句话**：不用写新代码，只需「两边装插件 + 各配一条隧道 + 双向验证」。

---

## 1. 架构：**必须两边各一条入站隧道**

`dsh-link` 是「每台机起一个 HTTP 服务，对方来调」——所以**谁能被连到，谁就能被委派**。

```
公司 AI ──HTTP──> 家里公网端点(樱花) ──> 127.0.0.1:8124 (家里 dsh-link) ──> 家里 headless AI 执行
家里 AI ──HTTP──> 公司公网端点(??? ) ──> 127.0.0.1:8124 (公司 dsh-link) ──> 公司 headless AI 执行
```

🛑 **最容易踩的坑**：只在**家里**装樱花 → 只有「公司 → 家里」通，**反向不通**。
`peers[]` 里填一个连不上的 URL，工具调用会超时，看起来像「插件坏了」，其实是缺一条隧道。

| 方向 | 需要谁的入站通道 | 只有家里有樱花时 |
|---|---|---|
| 公司 AI 委派家里 AI | 家里 | ✅ 可用 |
| 家里 AI 委派公司 AI | **公司** | ❌ 不可用 |

**公司侧入站通道三选一**（公司机 AI 先自检再选）：
1. **UU远程端口映射** —— 类似上次跑通的方式（若公司机还装着，最省事）
2. **樱花穿透便携版（frpc.exe）** —— 只出站连节点，通常能过公司网络；需公司机允许跑该程序
3. **Cloudflare Tunnel（cloudflared）** —— 只走 443 出站，最容易被公司网络放行

---

## 2. 双方共同前置（不满足就别往下走）

```powershell
hostname                                  # 确认自己在哪台机
dsh --version                             # 必须 0.2.0-rc.2（<0.3.0 都行）
$env:DSH_HOME; $env:DSH_PROFILE           # 确认 home/profile
Get-NetTCPConnection -State Listen -LocalPort 8124 -ErrorAction SilentlyContinue   # 必须为空
Test-Path "$env:USERPROFILE\Code\dsh-link\package.json"                            # 插件源码在不在
```

- 若 `Code\dsh-link` 不存在：**停下问用户**，不要自己 clone（可能撞代理/凭证问题）。
- 若 `dsh --version` ≥ 0.3.0：**停下**，`dsh-link` 未适配，需要先改代码。

---

## 3. 家里机侧（`LINYANZHI-HOST`，2026-10-18 已核实）

| 事实 | 值 |
|---|---|
| DSH home / 端口 | `~/.dsh0` / 3080（有 `headless` profile ✅） |
| 工作区 | `C:\Users\LinYanZhi\Code` |
| dsh-link 源码 | `C:\Users\LinYanZhi\Code\dsh-link`（v0.5.0） |
| 当前是否已装 | ❌ 未装（`profiles/web/node_modules/dsh-link` 不存在，`cordis.patch.yml` 无 dsh-link 块） |
| 8124 端口 | ✅ 空闲 |
| 樱花穿透 | ✅ 已装 `C:\Program Files\SakuraFrpLauncher\`，frpc 在跑 |
| OpenSSH Server | ❌ 未装（所以不能走「SSH 反向隧道」方案） |
| headless 启动命令解析 | ✅ `~/bin/dsh.cmd` 存在 → 自动探测会用它 |

### 3.1 装插件（🛑 用户执行，AI 不改用户级配置）

```powershell
# 先备份 profile 配置
Copy-Item "$env:USERPROFILE\.dsh0\profiles\web\cordis.patch.yml" "$env:USERPROFILE\.dsh0\profiles\web\cordis.patch.yml.bak-$(Get-Date -f yyyyMMdd-HHmmss)"

# 装本地插件（file: 路径指向 dsh-link 仓）
dsh plugin --profile web add "file:C:\Users\LinYanZhi\Code\dsh-link"

# 验证确实进了包与 bundle
Get-Content "$env:USERPROFILE\.dsh0\profiles\web\package.json" -Raw | Select-String 'dsh-link'
```

### 3.2 配 `cordis.patch.yml`（**追加**，不要覆盖）

文件：`C:\Users\LinYanZhi\.dsh0\profiles\web\cordis.patch.yml`

```yaml
# === dsh-link v0.5.0（家里侧）===
# [why]: 2026-10-18 两机 AI 互连；家里侧对端 = 公司
- insert:
    - id: dsh-link
      name: dsh-link/src
      config:
        peers:
          - name: company
            url: http://<公司公网节点>:<公司远程端口>   # ← 公司侧隧道建好后填
            token: <SHARED_SECRET>
        port: 8124
        token: <SHARED_SECRET>
        timeoutMs: 300000
```

### 3.3 建樱花 TCP 隧道（家里 → 暴露自己的 8124）

樱面板 → 隧道 → 新建：

| 字段 | 值 |
|---|---|
| 隧道类型 | **TCP**（不要 HTTP——HTTP 隧道在国内节点要 ICP 备案） |
| 本地地址 | `127.0.0.1` |
| 本地端口 | `8124` |
| 远程端口 | **留空**（自动分配，且必须 ≥10240） |
| 节点 | 延迟低的即可 |

建好记下 **节点域名/IP** + **远程端口**，启动隧道，日志出现 `隧道启动成功`。
（家里自己的 `peers.company.url` 用不到这条，这条是给**公司侧**用的。）

### 3.4 应用配置

`profiles/web` 的 `package.json` 里 `dsh.profile.patchReload: "live"` → 通常**无需重启**。
装完/改完等 5–10 秒，新会话里应能看到工具 `remote_subagent_list`。
若看不到：**先问用户**再重启 DSH（重启会中断当前 GUI 会话）。

---

## 4. 公司机侧（`DESKTOP-2638SM0`）

### 4.1 先自检（把结果回报，别猜）

```powershell
hostname; whoami
dsh --version
$env:DSH_HOME; $env:DSH_PROFILE
Get-NetTCPConnection -State Listen -LocalPort 8124 -ErrorAction SilentlyContinue
Get-Command frpc -ErrorAction SilentlyContinue
Test-Path "$env:USERPROFILE\Code\dsh-link\package.json"
```

### 4.2 入站通道（§1 的三选一，先测通再配插件）

不管选哪个，判定标准都一样：**从家里机能用浏览器/`Invoke-WebRequest` 打到公司端点，拿到 401（而不是连不上）**。
拿到 401 = 隧道通了、只差 token；连不上 = 隧道没成，别急着配插件。

### 4.3 装插件 + 配 `cordis.patch.yml`

同 §3.1 / §3.2，但 `peers[]` 反过来：

```yaml
        peers:
          - name: home
            url: http://<家里樱花节点>:<家里远程端口>   # ← 家里侧 §3.3 产出的两样
            token: <SHARED_SECRET>                     # 与家里完全一致
```

`port: 8124`、`token` 与家里一致。

---

## 5. 验证（**必须跑坏样本**，只见好样本 = 假绿）

在**任意一侧**的新会话里让 AI 调工具，或直接命令行打端点。

**好样本（双向各一次）**
```powershell
# 反向（家里打公司 / 公司打家里）——期望 401，证明端点活着
Invoke-WebRequest -Uri "http://<对端公网端点>" -Method POST -TimeoutSec 10 -UseBasicParsing `
  -Headers @{ Authorization = "Bearer <SHARED_SECRET>" } `
  -Body '{"task":"reply with exactly: LINK-OK","timeoutMs":120000}' -ContentType 'application/json'
# 期望 200，body 内含 LINK-OK
```

**坏样本 1：错 token → 必须 401**
```powershell
Invoke-WebRequest -Uri "http://<对端公网端点>" -Method POST -TimeoutSec 10 -UseBasicParsing `
  -Headers @{ Authorization = "Bearer WRONG-TOKEN" } -Body '{"task":"x"}' -ContentType 'application/json'
```

**坏样本 2：停掉隧道/错端口 → 必须连接失败**（不是 401、不是超时到 5 分钟）

**工具层验证**
```
remote_subagent_list({})                       → 能看到 peers（company / home）
remote_subagent_run({peer:"home", task:"跑 hostname 并原样回报"})
```

完成判定 = 双向各一次 200 + 两个坏样本行为正确 + `remote_subagent_list` 有对端。

---

## 6. 安全红线（🛑 违反就是给自己开后门）

`dsh-link` 的入站端点 = **能 spawn 一个能执行任意命令的 AI**。它挂到公网，就是一个带 token 的远程执行入口。

1. **token 必须 32+ 随机字符**，用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成，两边约定同一个。
2. **token 只放本机 `cordis.patch.yml`**（在 `~/.dsh0`，不进 git）。🛑 **绝对不能**让它进 `my-skills` 仓 —— `sync-dsh-config.ps1 -Update` 生成的配置快照在 `my-skills/archives/dsh-config/`，会随仓库推送。
3. **只开 8124 这一条隧道**。🛑 不要顺手把 22 / 3389 / 445 / 3080 挂公网。
4. 隧道是**明文 TCP**（第三方节点可见流量）。将来若要更安全：改用「家里装 OpenSSH Server + SSH 反向隧道」，公网只暴露 SSH 且仅密钥登录。
5. **用完可停隧道**（面板一键），不常用就别常开。
6. 端点被别人抢到端口时，token 校验会挡住（401），但**看到 401 要警觉**。

---

## 7. 回报格式（公司 AI → 用户 → 家里 AI）

固定 6 行，别写散文：

```
[公司机] hostname=... | dsh=... | home=... | profile=...
[公司机] 8124 空闲=是/否 | dsh-link 源码在=是/否 | 已装=是/否
[公司机] 入站通道=UU/樱花/cloudflared/无 | 公网端点=host:port | 自测=<401=通 / 连不上>
[公司机] token 是否已配=是/否（不要在这里写 token 值）
[公司机] 坏样本：错token→<401? > | 停隧道→<连接失败? >
[公司机] 阻塞项=<一句话 / 无>
```

---

## 8. 排障速查

| 现象 | 原因 / 对策 |
|---|---|
| 工具列表里没有 `remote_subagent_*` | 插件没装进当前 profile / 未生效 → `dsh plugin --profile web list`，必要时重启（先问用户） |
| 调工具立刻报 connection refused | 对端隧道没开，或端口写错 |
| 调工具卡到 5 分钟超时 | 对端隧道在但 dsh-link 服务没起（8124 没监听）→ 看对端 DSH 日志 |
| 401 | token 不一致（最常见：一方改过没同步给另一方） |
| 对端 AI 执行报 `local headless timed out` | 对端 headless 起不来 → 对端 `headlessCmd` 显式配 `["C:\\Users\\<user>\\bin\\dsh.cmd","--profile","headless"]` |
| 家里改了插件源码但对端没变 | v0.4.0+ 有 `upgrade_peer`，但本次不涉及 |
| 樱花日志 `port already used` | 同一隧道 ID 已在别的机/进程跑 → 先问用户停哪个 |
| 樱花 HTTP 隧道报 503 | 你建成了 HTTP 隧道 → 改 **TCP** |
| 隧道启动成功但连不上 | 换节点；确认本地 8124 真在监听 |

---

## 9. 未决问题（等用户拍板）

- [ ] ❓ 公司机能否跑隧道客户端？装哪一种（UU / 樱花 / cloudflared）？
- [ ] ❓ `SHARED_SECRET` 谁来生成、怎么传（只能对话里传，不能落文件）？
- [ ] ❓ 家里这台 3080（本会话宿主）装插件后是否立刻生效，需不需要重启（重启会断当前 GUI 会话）？
- [ ] ❓ 家里是否顺手装 OpenSSH Server，为将来「只用 SSH 一条隧道」的加固方案铺路？
- [ ] ❓ 公司机 `Code\dsh-link` 仓在不在、版本是不是 v0.5.0（`git log --oneline -1`）？

---

**写这份的机器**：`LINYANZHI-HOST`（家里机），2026-10-18 23:4x
**关联**：`docs/handoff-2026-10-09-home-sakurafrp.md`（旧版，只做握手验证）、`README.md`（安装/配置/回滚）
