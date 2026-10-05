# dsh-link 明日任务清单（2026-10-06）

> **谁读这份文档**：明天回公司时，公司 DSH TUI / 家里 DSH web / 用户本人按清单逐项落地。
> **状态字段**：✅ 已完成 · ⏳ 待办 · ⚠️ 卡点 / 阻塞 · ❓ 未核实 · 💡 长期 TODO
> **公司机编码**：cmd.exe spawn（不是 pwsh），task 用 `cmd /c` 风格。

---

## A. 紧急文档（今晚收工前做）

来源：`Code/紧急-2026-10-01-多AI并行worktree规范.md`（根目录紧急文档）。按 §一 红线 4「紧急文档协议」：

- [ ] **A1**：跑 `node my-skills/scripts/pre-task-check.mjs dsh-link-4ai` 出当前纪律快照（my-skills HEAD = 73a4cf2，紧急要求 f8b478f，**有 drift**）
- [ ] **A2**：跑 `node my-skills/scripts/check-drift.ps1` 看具体哪些点漂移
- [ ] **A3**：跑 `node my-skills/scripts/sync-dsh-config.ps1 -Update` 对账
- [ ] **A4**：跑 `node my-skills/scripts/inject-discipline-to-clients.ps1` 推到所有 DSH 客户端
- [ ] **A5**：跑 `node my-skills/scripts/check-links.ps1` 修文档断链
- [ ] **A6**：紧急文档处理完 → `git rm Code/紧急-2026-10-01-多AI并行worktree规范.md` → commit
- [ ] **A7**：跑 `node my-skills/scripts/workspace-health.mjs discipline-audit -n 1` 看今天有没有违规

⚠️ 公司 TUI 报告：my-skills HEAD ≠ 紧急要求 commit，**漂移未对账**。脚本在仓里能跑。

---

## B. 4-AI 联邦跨机部署（明天主战场）

### B1. 家里机 ⏳ 待办（家里 TUI / user 干）

- [ ] **B1.1** HMR row → `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：
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
- [ ] **B1.2** 重启家里 web：`Ctrl+C` 关 → `dsh web` → 日志看 `watching dsh-link/src`
- [ ] **B1.3** 家里 dsh-tui 装 bridge：`cd $env:USERPROFILE\.dsh\profiles\dsh-tui; pnpm add file:..\..\..\..\..\Code\dsh-link\packages\dsh-link-tui-bridge`
- [ ] **B1.4** `~/.dsh/profiles/dsh-tui/cordis.patch.yml` 末尾追加 bridge insert（同 handoff 文档 §B1.4）
- [ ] **B1.5** 重启家里 tui：`dsh tui` → 日志看 `[dsh-link-tui-bridge] listening on 127.0.0.1:8125`
- [ ] **B1.6** 家里 web profile dsh-link `peers[]` 加 home-tui（kind:"tui"，url: 127.0.0.1:8125）
- [ ] **B1.7** 重启家里 web 让 v0.5.0 加载 + `remote_subagent_list` 显示 home-tui peer

### B2. 公司机 ⏳ 待办（公司 TUI / user 干）

- [ ] **B2.1** `cd /d C:\Users\Administrator\Code\dsh-link; git fetch origin`
- [ ] **B2.2** 看公司 dsh-link 仓 HEAD 分支：`git status -sb`（master 还是 main？）
- [ ] **B2.3** 处理 `64f6eea` commit：跑 `git show 64f6eea` 看 diff → 决定要不要带
- [ ] **B2.4** 拉 v0.5.0：`git pull --ff-only origin main`（或 master，看公司分支）；冲突保留 v0.5.0 那侧（已隐式修 64f6eea 的 bug）
- [ ] **B2.5** 处理 `?? company` 未跟踪文件：删 / 移 / 保留，公司 user 决定
- [ ] **B2.6** 公司 web profile 装 v0.5.0（file: 软链，pull 即生效，不用 pnpm add）
- [ ] **B2.7** 公司 web profile HMR row（base 改 `C:\Users\Administrator\Code`）
- [ ] **B2.8** 重启公司 web：`dsh web` → 日志看 `watching dsh-link/src`
- [ ] **B2.9** 公司 dsh-tui 装 bridge（路径调成公司）
- [ ] **B2.10** 公司 dsh-tui profile cordis.patch.yml 追加 bridge insert
- [ ] **B2.11** 重启公司 tui：`dsh tui`
- [ ] **B2.12** 公司 web profile dsh-link `peers[]` 加 home（web）+ company-tui（kind:"tui"）
- [ ] **B2.13** 重启公司 web 让 v0.5.0 加载
- [ ] **B2.14** 公司机 dsh-link 仓分支统一：master → main（如果公司还想 master，跳过）

### B3. 4-AI 联邦端到端验证（家里 + 公司都装齐后做）

- [ ] **B3.1** 家里 web 调 `POST http://127.0.0.1:8123/handshake`（走 UU远程到公司 8124）→ 应回 `{version:"0.5.0", capabilities:[...]}`
- [ ] **B3.2** 公司 web 同样 handshake 验证
- [ ] **B3.3** 家里 web `remote_subagent_list` 看到 home-tui peer
- [ ] **B3.4** 公司 web `remote_subagent_list` 看到 company-tui peer
- [ ] **B3.5** 紧急修复 E2E：家里 web 改 dsh-link → push → upgrade_peer 推到公司 → 公司 web 调 tui_command 重启公司 web

---

## C. dsh-link 仓本身（今晚 / 明天做的代码层任务）

### C1. ✅ 已 push 到 GitHub（commit a5b72d5）

| commit | 内容 |
|---|---|
| `a5b72d5` | docs v0.5.0 4-AI federation |
| `3d8af48` | feat v0.5.0 tui_command + peers[].kind |
| `5e8a4b2` | feat dsh-link-tui-bridge v0.5.0 companion |
| `6f741b8` | docs v0.4.0 README + CHANGELOG |
| `ff03545` | feat v0.4.0 state/upgrade/file/subagent-prompt |

### C2. ⏳ 待办（按 v0.5.0 ROADMAP）

- [ ] **C2.1** `restart-dsh` 守护：Windows Task Scheduler / NSSM 配起家里 + 公司 web（bridge 退出后能自动拉起）
- [ ] **C2.2** `restart-dsh` 实测：让 bridge 跑 restart-dsh → DSH 应该被 Task Scheduler 拉起
- [ ] **C2.3** E2E 测试：双机都装齐后跑 4-AI 联邦真实联通验证
- [ ] **C2.4** 写 E2E 测试脚本到 `tests/e2e/cross-machine-federation.test.js`（或类似路径）

### C3. 💡 长期 TODO（不阻塞当前）

- [ ] **C3.1** token 走 fork `packages/credentials/`（`~/.dsh/.credentials.yaml`）—— 现在 token 在 cordis.patch.yml，**进仓要小心**
- [ ] **C3.2** sessionStore 走 fork `packages/session/session-persistence/` API（替代本地 JSON）
- [ ] **C3.3** v0.6.0：file transfer 加密 + 大文件分块（>10MB）
- [ ] **C3.4** v0.7.0：OTA 自动升级（绕开家里 hosts 劫持 GitHub——用 GH token + npm mirror）
- [ ] **C3.5** v0.8.0：把 dsh-link-tui-bridge 贡献到 fork upstream（ROADMAP §3 候选）

---

## D. 公司机特有（明早回公司先看）

### D1. ❓ 未核实（明天核实）

- 公司 dsh-link 仓分支名（master 还是 main）→ B2.2 解决
- 公司 DSH web 真实 PID + 是否在跑（探查时假设在跑）
- 公司 dsh-tui profile 是否装了 dsh-link（之前调研只看了 web profile）
- 公司机 ~/.dsh/.credentials.yaml 是否已存 token
- 公司 fork 实际路径：`Code\deepseek-harness` 还是 `Code\.github\LinYanZhi-Fork\deepseek-harness`？（launcher 注释说前者，公司 TUI 报告没明说）

### D2. ⚠️ 公司机已知问题

- **dsh-link 还是 v0.3.0**——没有 /handshake /upgrade /file 端点，task 输出 GBK 乱码
- **公司 headless spawn cmd.exe**（不是 pwsh）—— task 别写 PowerShell cmdlet
- **`64f6eea` 没推**——公司 dsh-link HEAD 比 GitHub main 旧 1 commit
- **公司机有 `?? company`** 未跟踪文件——遗留调试产物
- **公司 dsh-link package.json version 是 0.2.0**（CHANGELOG / README 已写 v0.3.0，没 bump）——`bump_version` + commit 单独修

---

## E. 壳目录（Code-workspace）同步

### E1. ✅ 已同步

- 当前 Code HEAD = `b90145c`（vs 紧急文档要求 `c498945`，**有 drift**）
- 当前 main = origin/main（无 ahead/behind）
- `.gitignore` 设计：只跟踪根级文档（AGENTS.md / README.md / AI_DEVELOPMENT_RULES.md / 紧急-*.md），其他项目在各自子目录仓

### E2. ⏳ 待办

- [ ] **E2.1** 决定 Code-workspace 仓要不要 commit（b90145c vs c498945 drift）—— 看 my-skills discipline-audit 输出
- [ ] **E2.2** `2025-国庆维护重构任务清单.md` 是否仍在根目录 / 是否要 commit

---

## F. 跨机转交经验教训（沉淀，明天别再踩）

### F1. 已发生的错误

- ❌ **"做好了"错觉**：6 commit 在家里机本地 .git/objects 里，没 push = 公司机看不到
- ❌ **`.gitignore` 误判**：把 handoff 文档落 `_tmp/`（gitignored）→ 公司永远拿不到
- ❌ **壳目录设计未读**：Code/ 根目录 `.gitignore` 是 `/*` 屏蔽一切，只白名单 `紧急-*.md`——不放项目文件
- ❌ **Move-Item + Remove-Item 顺序错**：第一次 Move 把文件从 `_tmp/` 移走，第二次 Remove 当成还在原位误删，靠重写兜回来

### F2. 修复原则

- **"完成"判定** = 本机 commit + GitHub 已 push + 远端能 fetch 验证，三件齐
- **跨机可访问归宿** = 共享仓（dsh-link 这种）`docs/` 子目录，不是 `_tmp/` 也不是项目仓根目录
- **跨机调查** = 走 dsh-link 协议（/handshake 端点 + POST / task），不盲开浏览器或 ssh
- **动手前先确认状态** = 看 cwd、看 .gitignore、看目标文件存在性，不假设

---

## G. 纪律红线（公司 TUI 必读）

🚫 **不杀进程**（硬红线 2026-10-03）：`Stop-Process` / `taskkill` / `kill` 都不行，除非 user 当面指令 + 复述 + 二次确认
🚫 **不写系统环境变量**：HKCU\Environment / HKLM\...Environment 都不动
🚫 **不擅自装/卸插件**：所有 `pnpm add` / `pnpm remove` / 改 `cordis.patch.yml` 由 user 执行
🚫 **不擅自 push**：commit ≠ push；本次任务清单已 commit + push 完成，后续 push 仍需 user 拍板
🚫 **不擅自 fetch / reset 公司机仓**：公司机 user 自管
✅ **commit 必含 `[why]:` 行**（第一行 ≤72 字符）
✅ **commit 单次 ≤20 文件 / ≤500 行 / 单文件 ≤400 行**（业务）/ ≤500 行（控制器）
✅ **落点合规**：临时调试 → `_tmp/` 或 `.debug/` 或 `<项目>/.debug/probe-YYYY-MM-DD/`；跨机共享 → `<项目>/docs/`

---

## H. 下次会话预期

下次开始时（家里 web 或公司 TUI），应该看到：

- dsh-link 仓 GitHub main = `a5b72d5`
- 包含本清单 `docs/dsh-link-tomorrow-tasks-2026-10-05.md`
- 家里 ⏳ 待办里**已 commit + push 的部分**可对照清单状态推进
- 公司 ⏳ 待办由公司 TUI 按 §B2 逐项完成

---

**完成时间**：2026-10-05（家里 web AI 自评；用户授权 commit + push）
**关联**：handoff 文档 `docs/dsh-link-4ai-federation-handoff-2026-10-05.md`（状态快照）
