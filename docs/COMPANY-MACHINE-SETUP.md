# 公司机 DSH-link 安装指南

> 给"中间人"——也就是你——用的傻瓜式操作清单。
> 你不需要懂技术，只需要把下面 5 步在公司机上各跑一遍（或者转发给公司 AI 让他跑）。

## 前提

- 公司机也是 DSH 用户（DSH web 默认 3080 端口）
- 公司机也能 git pull（如果不行，看下面"网络问题"段）
- 公司机和家里机都装了同一个 UU远程，能让两边互访（dsh-link 走 `127.0.0.1:8123` 通过 UU远程到对端 `8124`）

## 5 步安装

### 第 1 步：拉 dsh-link 仓到公司机

在公司机 DSH 3080 web 的聊天窗口，跟公司 AI 说：

> "帮我 git clone https://github.com/LinYanZhi/dsh-link 到 Code/ 目录下，然后告诉我结果"

公司 AI 会自己跑 `git clone`，完成后告诉你路径。**预期结果**：`Code/dsh-link/` 存在。

### 第 2 步：装 dsh-link 到 DSH profile

在公司机 DSH 3080 web 聊天窗口说：

> "在 PowerShell 里跑：`cd $env:USERPROFILE\.dsh\profiles\web; pnpm add file:..\..\..\Code\dsh-link`，告诉我输出"

公司 AI 会跑这条命令。**预期结果**：pnpm 装包成功，没有 error。

### 第 3 步：把 cordis.patch.yml 加 hmr 段

文件位置：`~/.dsh/profiles/web/cordis.patch.yml`

> **⚠️ 千万**别整段覆盖——只能**追加**到文件末尾。

在公司机聊天窗口说：

> "把 `Code/dsh-link/docs/snippet-cordis-patch.yml` 末尾的 `--- copy below ---` 到 `--- end copy ---` 之间那段，追加到 `~/.dsh/profiles/web/cordis.patch.yml` 末尾。注意 `base:` 路径要改成公司机的工作区根，比如 `C:\Users\Administrator\Code`，不要用家里的 `LinYanZhi`。改完让我看 diff。"

公司 AI 会读 snippet 文件、追加到 cordis.patch.yml、改 base 路径、show diff 给你。

### 第 4 步：重启 DSH

在 PowerShell 里：

```powershell
# Ctrl+C 关掉当前 DSH 窗口（如果还开着）
dsh web
```

或者让公司 AI 跑。

**预期**：DSH 重启后日志里有 `watching dsh-link/src`（HMR watcher 起来了）。

### 第 5 步：家里 ⇄ 公司双向握手验证

回到家里 DSH 3080 聊天窗口，跟家里 AI 说：

> "用 dsh-link 跟公司机握下手，看对端版本和 capabilities。然后让公司机也调 remote_subagent_list 看家里的版本。"

家里 AI 会调 `POST http://127.0.0.1:8123/handshake`，转发到公司机的 8124（UU远程映射）。

**预期结果**（两边都能看到）：
```json
{
  "ok": true,
  "version": "0.4.0",
  "capabilities": ["remote_subagent_run", "remote_subagent_followup", "remote_subagent_cancel", "remote_subagent_list", "send_file", "read_file", "upgrade_peer", "state_persistence"],
  "wire": "v1"
}
```

## 网络问题

**如果公司机 git clone 失败**（家里 hosts 劫持 GitHub 是 DSH 公知的）：

- 方案 A：把家里仓 push 到公司能访问的镜像（npm / GitLab 等），公司机从镜像 clone
- 方案 B：用 scp 把家里 `Code/dsh-link/` 整个目录传到公司机
- 方案 C：让公司 AI 通过 dsh-link 直接从家里 fetch（v0.4.0 的 `upgrade_peer` 能干这事，但要先装好——见下面的"先装老版本再升级"）

**先装老版本再升级**：如果公司机网络完全不能拉 GitHub，但已经能跟家里 dsh-link 通信：

1. 公司机先装 v0.3.0（任何能装的方式，npm 优先）
2. 验证家里⇄公司连通（`remote_subagent_list` 互相看到对方）
3. 让家里 AI 用 `upgrade_peer` 把 v0.4.0 推到公司机：
   ```
   家里 AI: 
   - 把本地 Code/dsh-link/src/index.js 读成字符串
   - base64 编码
   - sha256 算 checksum
   - 调 upgrade_peer({peer: "company", payload: base64, checksum, version: "0.4.0"})
   ```
4. 公司机 HMR 检测到 src/index.js 变化 → 自动 reload 到 v0.4.0
5. 公司机再次 `/handshake` 看版本确认升级成功

## 升级流程（以后日常）

家里改了 dsh-link 代码后：

1. 家里 commit + push
2. 家里跟家里 AI 说："用 upgrade_peer 把家里机 dsh-link 推到公司机 v0.5.0"
3. 家里 AI 跑（读 src → base64 → sha256 → POST /upgrade 到公司）
4. 公司机 HMR 自动 reload，state 持久化不丢
5. 双向连通继续工作，**DSH 没重启、连接没断**

## 出问题怎么办

| 现象 | 原因 | 解决 |
|---|---|---|
| 家里调 `remote_subagent_list` 看不到公司 | UU远程 8123 没起来 / 公司机关机 / 公司 dsh-link 没监听 8124 | 公司机先 `dsh web` 起来；看 UU远程 端口映射还在不在 |
| HMR 没 reload（改了 src 不生效） | `base` 路径错 / `root` 写错 / `disabled: false` 没生效 | 公司机看 DSH 日志有没有 `watching dsh-link/src`；重启 DSH |
| `/upgrade` 返回 `checksum mismatch` | base64 解码出问题 / sha256 工具版本差异 | 让家里 AI 重算一次（用 `createHash('sha256').update(bytes).digest('hex')`） |
| `/file` 返回 `path rejected (sandbox)` | 路径含 `..` 或绝对路径 | 用相对路径，比如 `reports/2026-10.md`，不要 `/etc/passwd` |

## 不需要懂的部分

- HMR 怎么 dispose fiber、怎么重新 import——fork `vendor/hmr/` 已经做好，dsh-link 只是用
- base64 / sha256 怎么算——家里 AI 会算
- atomic write / 备份怎么管理——dsh-link 内部处理
- session 怎么跨重启保留——state.json 自动
- DSH 进程模型 / cordis plugin lifecycle——fork 已经实现
