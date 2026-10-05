# dsh-link 4-AI 联邦 — 跨机部署 Handoff（2026-10-05）

> **谁读这份文档**：明天回公司时，公司 DSH TUI（或用户本人）按这个清单一项一项落地。
> **状态字段**：✅ 已完成 · ⏳ 待办 · ⚠️ 阻塞 / 卡点 · ❓ 未核实
> **公司机编码**：cmd.exe spawn（不是 pwsh）—— task 里用 `cmd /c` 风格，不要用 PowerShell cmdlet。

---

## TL;DR

| 端 | dsh-link 版本 | 仓 HEAD | GitHub | 关键缺失 |
|---|---|---|---|---|
| **家里 web (linyanzhi)** | v0.5.0（源码） | `a5b72d5` | `a5b72d5` ✅ 已 push | HMR row 没加；tui-bridge 没装 |
| **家里 tui** | n/a | n/a | n/a | tui-bridge 没装 |
| **公司 web (Administrator)** | **v0.3.0**（推断） | `master` 分支，未 fetch | `64f6eea`（fork main 比 GitHub 旧） | 没 pull、没 /handshake、没 /upgrade、没 /file |
| **公司 tui** | n/a | n/a | n/a | tui-bridge 没装 |

---

## 家里机现状（详细）

### ✅ 已完成
- **v0.4.0**：3 commit（cf131a9 / 481360a / 5bbbbc9 → rebase 后新 hash：ff03545 / 6f741b8 / a5b72d5 一部分）
- **v0.5.0**：3 commit（bff5c72 / 6beeabc / fc72908 → rebase 后：5e8a4b2 / 3d8af48 / a5b72d5）
- **GitHub main HEAD**：`a5b72d5`（2026-10-05 push 成功）
- **packages/dsh-link-tui-bridge/**：新增（package.json + src/index.js + README.md）
- **dsh-link /handshake /upgrade /file 端点**：已加（v0.4.0）
- **state.json 持久化**：跨 HMR / 重启不掉
- **subagent 工具重命名**：`remote_subagent_run/followup/cancel/list` + `tui_command` + `send_file/read_file` + `upgrade_peer`

### ⏳ 待办（家里 TUI 干，或明天家里 user 干）
1. **家里 web profile HMR 启用**：`~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：
   ```yaml
   - insert:
       - id: hmr
         disabled: false
         config:
           base: 'C:\Users\LinYanZhi\Code'
           root: ['dsh-link/src']
           debounce: 100
           ignored: ['**/node_modules', '**/.git', '**/.*']
   ```
   路径写**家里**的；公司用 `C:\Users\Administrator\Code`（fork 路径在 launcher 注释里查）。
2. **家里 web 重启**：`Ctrl+C` 关 → `dsh web` → 日志看 `watching dsh-link/src`。
3. **家里 dsh-tui 装 bridge**：
   ```powershell
   cd $env:USERPROFILE\.dsh\profiles\dsh-tui
   pnpm add file:..\..\..\..\..\Code\dsh-link\packages\dsh-link-tui-bridge
   ```
4. **家里 dsh-tui profile cordis.patch.yml 末尾追加**（⚠️ 只追加别覆盖）：
   ```yaml
   - insert:
       - id: dsh-link-tui-bridge
         name: dsh-link-tui-bridge/src
         config:
           port: 8125
           token: mysecret2026
           allowedProfiles: ['web', 'dsh-tui', 'headless']
           logTailLines: 200
   ```
5. **家里 dsh-tui 重启**：`dsh tui` → 日志看 `[dsh-link-tui-bridge] listening on 127.0.0.1:8125`。
6. **家里 web profile cordis.patch.yml dsh-link 加 peer**（v0.5.0 新字段 `kind`）：
   ```yaml
   - id: dsh-link
     name: dsh-link/src
     config:
       peers:
         - name: company
           url: http://127.0.0.1:8123
           token: mysecret2026
           kind: web
         - name: home-tui
           url: http://127.0.0.1:8125
           token: mysecret2026
           kind: tui
       port: 8124
       token: mysecret2026
       timeoutMs: 300000
   ```
7. **家里 web 重启**让 v0.5.0 加载 + 验证 `remote_subagent_list` 显示 home-tui peer。

### ❓ 未核实（家里）
- fork vendor/hmr 的 npm 包名（cordis patch 里的 id 是 `hmr` 还是 `fork-vendor-hmr`？profile-boot.ts:281 显示 DSH 自动 load，但 id 是不是就叫 `hmr` 要看 fork 当前状态）
- bridge 的 `restart-dsh` 是 `process.exit(0)`——需要 Windows Task Scheduler 守护拉起（家里 + 公司都要配）
- 4-AI 联邦实际联通验证脚本（v0.5.0 跑通没？公司没装齐）

---

## 公司机现状（详细）

### ✅ 已完成
- **dsh-link v0.3.0** 装在 `~/.dsh/profiles/web/node_modules/dsh-link`（file:..\..\..\Code\dsh-link）
- **公司 web 与家里 web 双向握手连通**（2026-10-02 v0.2.0 / 2026-10-05 v0.3.0 实测过）
- **DSH web 3080 + dsh-link 8124** 在跑

### ⚠️ 当前问题（公司机独有）
- **dsh-link 版本太旧**：v0.3.0 没有 /handshake / /upgrade / /file 端点——公司机 dsh-link /handshake 直接 400。
- **仓是 `master` 不是 `main`**：公司机 dsh-link 仓 HEAD 在 `master` 分支，跟家里 `main` 不一致；fork master HEAD 大概率还是 `64f6eea` 之前的 commit。
- **`package.json` version 是 0.2.0**，CHANGELOG / README 已经写 v0.3.0——版本号没 bump（commit message 缺 `[why:]` 行也违反纪律）。
- **公司 headless spawn 用 cmd.exe**（不是 pwsh）——task 里写 PowerShell cmdlet 会失败（实测 `Select-String` not recognized）。
- **公司机仓有未跟踪 `?? company`** 文件——可能是之前调试遗留。
- **`64f6eea` commit 没推送**——公司 dsh-link HEAD 比 GitHub main 旧 1 个 commit；公司 dsh-link 用户上轮用公司 TUI 拍板决定不直接 push，要先看 diff。

### ⏳ 待办（公司 TUI / user 干）
1. **公司机 git fetch + 拉 v0.5.0**：
   ```cmd
   cd /d C:\Users\Administrator\Code\dsh-link
   git fetch origin
   git checkout master   ^< 或 main，看公司用哪个
   git pull --ff-only origin master   ^< 不冲突就 ff，冲突保留远端
   ```
   或直接 reset：
   ```cmd
   git fetch origin
   git reset --hard origin/main   ^< 危险，要先 git status 确认 clean
   ```
2. **公司 web profile 装 v0.5.0**（已经 `file:` 软链，pull 后 src 变了就行，不用 pnpm add）。
3. **公司 web profile HMR row**（同家里模板，base 改 `C:\Users\Administrator\Code`）。
4. **公司 web 重启**：`dsh web`。
5. **公司 dsh-tui 装 bridge**（同家里命令，路径调成公司）。
6. **公司 dsh-tui profile cordis.patch.yml 追加 bridge insert**（同家里模板）。
7. **公司 dsh-tui 重启**：`dsh tui`。
8. **公司 web profile dsh-link 加 peer**：
   ```yaml
   peers:
     - name: home
       url: http://127.0.0.1:8123
       token: mysecret2026
       kind: web
     - name: company-tui
       url: http://127.0.0.1:8125
       token: mysecret2026
       kind: tui
   ```
9. **公司 web 重启**让 v0.5.0 加载。
10. **公司机 `64f6eea` commit 处理**：要么看 diff 决定要不要带，要么直接 reset 到 origin/main 抛弃。

### ❓ 未核实（公司）
- 公司 dsh-link 仓是 `master` 还是 `main`（要 fetch 看）
- 公司 DSH web 是否真在跑（探查时假设在跑，但没确认 PID）
- 公司 dsh-tui profile 是否装了 dsh-link（应该没装——之前调研只看了 web profile）
- 公司机 ~/.dsh/.credentials.yaml 是否已存 token（应该是空，公司机用 cordis.patch.yml 配 token）

---

## 4-AI 联邦架构图

```
家里 web (AI_1, 3080) ←→ 家里 tui (AI_2, 8125 bridge)
     ↕  dsh-link HTTP + UU远程端口映射  ↕
公司 web (AI_3, 3080) ←→ 公司 tui (AI_4, 8125 bridge)
```

- 家里 web ↔ 公司 web：dsh-link v0.4.0 wire（HTTP POST + Bearer + JSON）
- 家里 web → 家里 tui：dsh-link `tui_command({peer:"home-tui",...})` → 127.0.0.1:8125
- 家里 web → 公司 tui：调公司 web subagent → 公司 web `tui_command({peer:"company-tui",...})` → 公司机 8125
- 公司 web → 家里 tui：同上反向

---

## 关键纪律红线（公司 TUI 必读）

🚫 **不杀进程**（硬红线 2026-10-03）：不要用 `Stop-Process` / `taskkill` / `kill`。
🚫 **不写系统环境变量**：HKCU\Environment / HKLM\...Environment 都不动。
🚫 **不擅自装/卸插件**：所有 `pnpm add` / `pnpm remove` / 改 `cordis.patch.yml` 由用户执行。
🚫 **不擅自 push**：commit 不等于 push，push 前 user 拍板。
🚫 **不擅自 fetch / reset 公司机仓**：公司机用户自管。
✅ **commit 必含 `[why]:` 行**（第一行 ≤72 字符）
✅ **commit 单次 ≤20 文件 / ≤500 行 / 单文件 ≤400 行**（业务），超 500 是控制器上限

---

## 跨机转交经验教训（沉淀）

### 问题
之前"做好了"是错觉——6 commit 在家里机本地 .git/objects 里，没 push = 公司机看不到；转交中间人流程里"commit 落地"≠"跨机可见"。

### 修复
- **"完成"判定 = 本机 commit + GitHub 已 push + 远端能 fetch 验证**，三件齐才算。
- **转交中间人 = 准备给另一台机 AI 的 prompt + 文档**，不是用户复制粘贴代码片段。
- **调研另一台机 = 通过 dsh-link 协议**（/handshake 端点拿版本，POST / 跑 task 拿状态），不盲开浏览器或 ssh。

### 公司机编码细节
- 公司 DSH headless 在 **cmd.exe** 跑（不是 pwsh）—— task 写 `cmd /c "dir & echo done"`，不要写 PowerShell cmdlet。
- 公司 dsh-link 还是 v0.3.0 协议——只能 `/` task 端点，没有 `/handshake /upgrade /file`，task 输出是 GBK（中文系统默认），家里 web 看输出会乱码。

---

## 紧急文档（按纪律必读）

`Code/紧急-2026-10-01-多AI并行worktree规范.md`——明天回公司前 user 必读。

---

## 相关链接

- **dsh-link GitHub main**：`https://github.com/LinYanZhi/dsh-link/tree/a5b72d5`
- **bridge README**：`Code/dsh-link/packages/dsh-link-tui-bridge/README.md`
- **公司机同步指南**：`Code/dsh-link/docs/COMPANY-MACHINE-SETUP.md`
- **HMR snippet**：`Code/dsh-link/docs/snippet-cordis-patch.yml`
- **紧急文档**：`Code/紧急-2026-10-01-多AI并行worktree规范.md`

---

**状态更新**：写到 `docs/dsh-link-4ai-federation-handoff-2026-10-05.md`，**未 commit**（纪律 §1：未提交改动必 commit 再 pull；等你审 commit message 后 commit + push）。
