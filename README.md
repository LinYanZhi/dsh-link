# dsh-link v0.2.0 — 双向跨机远程控制（家里 DSH ↔ 公司 DSH）

> **状态**：✅ 协议层 mock 测试 13/13 通过；✅ 真双机握手测试已联通（UU远程端口映射）。
> **由用户**：插件装到 profile、`pnpm add`、重启 DSH 由用户执行（AI 不擅自动用户级配置）。

## 它做什么

让两台机器上的 DSH agent 互相发任务。跟家里 AI 说「让公司 AI 把 GLBT 部署脚本跑一下」，家里 AI 调 `remote({peer:"company", task:"..."})`，公司机的 DSH headless 跑完后把结果回给家里 AI。

## 关键设计

- **协议**：HTTP POST + Bearer token + JSON `{task}`（已验证）
- **跨公网**：靠 UU远程端口映射（或任意 TCP 隧道）—— 不需要公网 IP、不需要 NAT 穿透配置
- **多轮对话**：每次 `remote` 调用都是 stateless，AI 通过多次调用 + 喂上下文实现追问
- **配置**：双方约定一个 `token`，写进各自的 `peers[]`

## 安装

### 0. 先备份（按你的纪律）

```bash
# 备份你打算装插件的 profile
cp -r ~/.dsh/profiles/web ~/.dsh/profiles/web.bak.$(date +%Y%m%d)
```

### 1. 装到现有 profile（web）

```powershell
# 在 PowerShell 里（家里机或公司机任一台，做一次；建议两边都做）
cd $env:USERPROFILE\.dsh\profiles\web
pnpm add file:..\..\..\..\..\Code\dsh-link
```

> 路径说明：从 `~/.dsh/profiles/web/` 出发回到 `Code/dsh-link/`。
> 如果你装的不是 web profile，把 `web` 改成对应名字。

### 2. 配置 peers + token

打开当前 profile 的 `cordis.patch.yml`，**追加**一段（不要覆盖已有内容）：

```yaml
# 追加到 cordis.patch.yml 末尾
- insert:
    - id: dsh-link
      name: dsh-link/src
      config:
        peers:
          - name: company               # ← 你给对端起的名字（家里机看公司机）
            url: http://127.0.0.1:8123  # ← UU远程映射后的本地端口
            token: <SHARED_SECRET>      # ← 双方约定同一个 token（不入 git；<SHARED_SECRET> 是占位符）
        port: 8124                     # ← dsh-link server 监听端口（避开 UU 的 8123）
        token: <SHARED_SECRET>         # ← 本端入站 token（双方要一致）
        timeoutMs: 300000
```

**两边各自填的 `peers[]` 不同**：
- **家里机**：`peers: [{ name: company, url: http://127.0.0.1:8123, token: ... }]`
- **公司机**：`peers: [{ name: home, url: http://127.0.0.1:8123, token: ... }]`

`port: 8124` 两边都一样（本机 server 监听端口）。

### 3. 重启 DSH（**你来操作**）

```powershell
# Ctrl+C 关掉当前 DSH，然后：
dsh web
```

或者你用 `dsh web2` / `dsh web-staging` 做 staging 验证（DSH 急救与运维 skill 有）。

---

## UU远程端口映射配置

按之前 handshake 测试通过的方式：

| 机器 | UU远程 映射本地端口 | UU远程 映射目标地址 | UU远程 映射目标端口 | dsh-link server 端口 |
|---|---|---|---|---|
| **家里机**（想访问公司机的端口） | `8123` | `127.0.0.1` | **`8124`**（公司机的 dsh-link） | `8124` |
| **公司机**（想访问家里机的端口） | `8123` | `127.0.0.1` | **`8124`**（家里机的 dsh-link） | `8124` |

**为什么目标端口是 8124 而不是 8123**：UU远程 占用了 8123，dsh-link 必须监听 8124 才不冲突。

---

## 使用

跟家里 AI 说（自然语言即可）：

```
帮我让公司 AI 跑一下 npm test，把结果告诉我。
```

家里 AI 会自动：
1. 调 `remote_peers({})` 发现可用 peer
2. 调 `remote({ peer: "company", task: "Run npm test and report results" })`
3. 把公司 AI 的结果告诉你

**追问示例**（多轮）：

```
你刚才的结果里有个 test 失败了，能让公司 AI 看看为什么吗？
```

AI 会再调一次 `remote(...)`，把上一次的失败信息作为 context 喂给新 task。

---

## 配置字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `peers[]` | array | `[]` | 对端列表：`{name, url, token}` |
| `port` | number | `8124` | 本机 HTTP server 监听端口（`0` = 不监听，只出站） |
| `token` | string | `""` | 入站鉴权 token（双方约定一致；空 = 接受任何来源） |
| `headlessCmd` | string[] | `[]` | 本机 spawn DSH headless 的命令（空 = 自动探测 fork source） |
| `timeoutMs` | number | `300000` | 单次任务超时（ms），默认 5 分钟 |
| `systemPromptExtra` | string | `""` | 追加到 systemPrompt 的额外提示（可自定义 AI 行为） |

---

## 回滚

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm remove dsh-link
# 编辑 cordis.patch.yml 删掉 dsh-link 配置块（保留其它）
dsh web    # 重启
```

完整插件代码删 `Code/dsh-link/` 即可（不动 DSH 源码）。

---

## 已知限制（v0.2.0）

- **每次 `remote` 都是 stateless**：每个 task spawn 一个新的 headless session，session 之间不共享上下文
- **多轮对话靠 AI 多次调用**：把上次结果作为 context 喂给下次 task（不是 persistent session）
- **超时 = 5 分钟默认**：超过会被 spawn kill；改 `timeoutMs`
- **单向 / 双向由两边各自 `peers[]` 配置决定**：家里机的 peers 里有 company，公司机的 peers 里有 home → 双向

---

## 文件结构

```
Code/dsh-link/
├── README.md            # 本文件
├── package.json         # cordis 插件元数据
├── LICENSE              # MIT
├── .gitignore
├── cordis.patch.yml     # 默认 bundle 挂载配置
└── src/
    └── index.js         # 插件主体（remote / remote_peers 工具 + HTTP server）
```

---

## 历史

- **2026-09-21** 初版：`_archive/dsh-link-已卸载-2026-09-21/`（默认 port 8123）
- **2026-10-02** v0.2.0 重启：默认 port 8124（避开 UU远程 占用 8123）、加 `remote_peers` 工具、URL 容错、peer 健康状态跟踪

## 相关

- Handshake 测试：`Code/.debug/probe-2026-10-02-dsh-link-handshake/`
- DSH fork：`Code/.github/LinYanZhi-Fork/deepseek-harness/`
- 旧的归档版：`_archive/dsh-link-已卸载-2026-09-21/`
