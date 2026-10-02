# dsh-link 路线图

> **当前版本**：v0.3.0（2026-10-03，session 续问已实现）
> **决策时间**：2026-10-03（v0.3.0 实施）/ 2026-10-02（路线图）
> **决策者**：LinYanZhi + 家里 DSH AI
> **状态**：v0.3.0 代码完成，待装机验证
>
> **本文件目的**：记录 v0.3.0 之后的扩展方向，**不在此刻实现**——保证当前能用起来后，按需推进。

---

## 0. 当前状态：v0.3.0

### 已实现（v0.3.0 新增）

| 能力 | 状态 |
|---|---|
| HTTP + Bearer token + JSON 协议 | ✅ v0.2.0 |
| 双向握手（家里 ↔ 公司） | ✅ 22:21 真机验证 |
| 端到端 task 执行（spawn dsh headless） | ✅ 11.5 秒 |
| 端口冲突 graceful degradation | ✅ v0.2.0 |
| 协议层 mock 测试 | ✅ v0.2.0（5/5 通过；2 个 8123 失败是 UU 远程占端口） |
| `remote` 工具（一次性 task） | ✅ v0.2.0 |
| `remote_peers` 工具（对端健康） | ✅ v0.2.0 |
| URL 容错（自动补 http://） | ✅ v0.2.0 |
| **`session` 参数 + sessionStore** | ✅ **v0.3.0 新增** |
| **`sessionId` 在 result 里返回** | ✅ **v0.3.0 新增** |
| **续问自动喂 context** | ✅ **v0.3.0 新增** |
| **`sessions: []` 在 remote_peers** | ✅ **v0.3.0 新增** |
| **sessionTtlMs TTL 自动清理** | ✅ **v0.3.0 新增** |

### 已知限制（v0.3.0 仍接受）

- **每次 `remote` 仍 spawn 新 headless**（11.5 秒冷启动）—— session 只是客户端上下文传递，不是真持续进程
- **续问仍然 11.5 秒**——v0.4.0 才解
- **不支持中断 / 取消**
- **不支持 token 流式**
- **不传 tool call 中间过程**——v0.5.0+ 才解

### 用户真实需求（已记录）

> 「把远程 AI 当成 subagent 用，能上下对话」（2026-10-02 拍板）

**v0.3.0 解决了 80%** —— 续问体验（不用手动喂 context）。剩下 20%（续问速度 / tool call 可见）需要 v0.4.0+。

---

## 1. 路线图：3 阶段

### 阶段 1：v0.3.0「模拟 subagent」（推荐先做，~200 行 JS，1-2 周）

**核心思想**：v0.2.0 是 stateless，但**让 AI 透明地喂 context**，让用户体验接近 subagent。

#### 改动清单

| 改动 | 文件 | 行数 |
|---|---|---|
| `Config` 加 `sessionTtlMs`（默认 30 分钟） | `src/index.js` | 5 |
| 服务端维护 `sessionStore: Map<id, summary>`，TTL 过期清理 | `src/index.js` | 30 |
| `remote` 工具加 `session` 参数；服务端拼接到 task 文本 | `src/index.js` | 20 |
| `remote_peers` 工具返回 session 信息 | `src/index.js` | 10 |
| systemPrompt 加「续问时传 session」提示 | `src/index.js` | 20 |
| mock 测试 + 端到端测试 | `tests/` | 60 |
| README 更新 | `README.md` | 30 |
| **合计** | — | **~175** |

#### 用户体验

```
你：让公司 AI 帮我看 GLBT 项目
家里 AI：调 remote({peer:"company", task:"看看 GLBT 项目结构"})
       → 返回 {ok:true, output:"..."}
       → 服务端记下 session=abc123 summary

你：那个 React 部分用什么状态管理？
家里 AI：调 remote({peer:"company", task:"...", session:"abc123"})
       → 服务端拼出："已知项目是 React + Tauri。现在问：React 部分用什么状态管理？"
       → 公司 AI 答："Redux Toolkit"
```

#### 优点

- 不动 DSH 源码 ✅（纪律红线）
- 工作量小
- 心智模型升级到 subagent-like

#### 缺点

- 每次 11.5 秒冷启动
- 「对话」是 AI 喂 context，不是真 session

#### 触发条件

- 用户明确反馈「v0.2.0 跑通，但追问不方便」

---

### 阶段 2：v0.4.0「真持续 session」（~300-500 行 JS，2-3 周）

**核心思想**：对端 DSH **长连接 session**，复用同一个 headless 进程。

#### 设计要点

- 第一次收到 task 时 spawn `dsh --profile headless` 进程并保持 stdin 开着
- 后续 task 通过 stdin 喂给同一进程（DSH headless 是否支持 stdin 续问？**待查**）
- 或者改用 DSH SDK 协议（`dsh --profile sdk`）走 JSON-RPC
- 30 分钟无活动 → kill 进程，释放资源

#### 用户体验

- 第一次 11.5 秒冷启动
- 后续追问 < 1 秒（无 spawn 开销）
- 对端真记得上下文（DSH session 持久化）

#### 优点

- 真 subagent 体验
- 续问速度极快

#### 缺点

- 实现复杂（进程生命周期、断线重连、stdio 协议）
- 跟 DSH 现有的 subagent-acp / subagent-dsh-sdk 协议可能冲突
- 工作量大

#### 待解决问题

- DSH headless 是否支持 stdin 续问？
- DSH SDK JSON-RPC 的子集够不够？
- 长连接的 timeout / heartbeat 策略？
- 进程崩溃后 session 怎么恢复？

#### 触发条件

- v0.3.0 跑了一阵，11.5 秒冷启动成为瓶颈
- 用户明确说「续问要快」

---

### 阶段 3：v0.5.0+「官方 backend 候选」（4+ 周，可选）

**核心思想**：写一个新的 `@deepseek-ai/dsh-subagent-acp-http` 包，对齐 DSH 官方 subagent-acp 协议，只是 transport 换成 HTTP。

#### 设计要点

- 新建 DSH package（**动 DSH fork 源码**——纪律红线打破）
- 跟 `subagent-acp` 一样接口，transport 走 HTTP
- 用户装这个新 backend，DSH 把远端 DSH 当成本地 subagent
- 可能贡献给 DSH 上游

#### 优点

- 用户体验 = 原生 DSH subagent
- 一次实现，所有 DSH 用户可用

#### 缺点

- 动 DSH fork 源码
- 工作量大
- 协议设计要跟 DSH 团队对齐（不一定能 merge）

#### 触发条件

- v0.4.0 跑通，确认产品形态有价值
- 用户愿意投入 DSH 上游贡献

---

## 2. 决策日志

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-10-02 | **v0.2.0 先用，不急着做扩展** | 用户要先去公司机装好跑通，验证实际可用性；扩展方向等跑通后再决定 |
| 2026-10-02 | **v0.3.0 是首选升级方向** | 解 80% 痛点 + 不动 DSH 源码 + 工作量小 |
| 2026-10-02 | **不直接做 v0.4.0** | 实现复杂，等 v0.3.0 跑通验证「对话体验」是不是真的瓶颈 |
| 2026-10-02 | **不直接做 v0.5.0** | 动 DSH fork 源码，按纪律红线必须显式授权 |

---

## 3. 相关参考

- **DSH subagent 体系**：`Code/.github/LinYanZhi-Fork/deepseek-harness/packages/subagent/`
- **DSH subagent 已知限制**（写在 subagent-acp / subagent-dsh-sdk README）：「Local workspaces only」「a remote runtime would need its own backend」
- **DSH fork AGENTS.md**（纪律红线）：改 `packages/` 前必读 `docs/architecture.md`
- **cordis 插件 API**：`Code/.github/LinYanZhi-Fork/deepseek-harness/cookbook/cordis-primer.md`

---

## 4. 不在路线图里的事项（明确不做）

- ❌ **不做** 跨机器 session event 流转发（v0.5.0 之前不涉及）
- ❌ **不做** 中断 / 取消（v0.5.0 之前不涉及）
- ❌ **不做** token 流式（v0.5.0 之前不涉及）
- ❌ **不做** GUI 面板（v0.2.0/0.3.0 都是无 UI plugin；DSH web 主聊天窗口的 tool_use 块就是唯一窗口）
- ❌ **不做** 自动 token 协商（两边人工约定）

---

## 5. 触发评估（v0.2.0 跑通后问用户）

跑通公司机部署后，问用户：

1. **追问体验怎么样？** AI 能「续问」吗？还是需要你手动喂上下文？
   - 答「AI 自己续问挺好」 → 暂不升级
   - 答「AI 续问不够智能」 → 触发 v0.3.0

2. **续问速度可以吗？** 每次都要等 11.5 秒吗？
   - 答「能接受」 → 暂不升级
   - 答「太慢」 → 触发 v0.4.0

3. **想看公司 AI 的 tool call 中间过程吗？**
   - 答「不想」 → 暂不升级
   - 答「想」 → 触发 v0.5.0（动 DSH 源码）

---

**最后更新**：2026-10-02（v0.2.0 拍板后立即记录）
**下一次更新**：公司机部署跑通后，根据用户反馈更新触发评估
