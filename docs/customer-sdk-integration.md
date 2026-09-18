# 顺丰招聘助手 Next — 客户系统 SDK 对接方案

> **状态**：方案已确认；包 `@ivva/ivva-crx-sdk`（本仓库）  
> **对外 API 总表**：[sdk-command-catalog.md](./sdk-command-catalog.md)  
> **说明**：本文讲对接与职责边界；命令与 payload 以命令目录为准。

本文只定**对接与职责边界**，不替代运维安装清单。

---

## 1. 目标与边界

### 1.1 目标

用现代化、可维护方式让客户 ATS（顺丰）调用插件能力，**替代**「`#plug_trigger` 写 JSON + `click`」作为**主**对接方式。

### 1.2 产品交互模型（已锁定）

以**职位发布**为代表：

| 角色 | 做什么 |
|------|--------|
| ATS | 传业务主键（如 `positionId`）→ 调 SDK → 按钮转圈 → **死等** Promise → 关转圈 / 刷新列表 |
| 插件 | **全部交互 UI**：探缺、补字段、登录引导、超时重试、成功失败提示（PublishHost / Side Panel 等） |

客户页**不需要**进度回调、不需要嵌发布表单。

### 1.3 非目标（首发）

- 不为 Vue2 / Vue3 / React 各做一套 SDK（框架无关）
- SDK 首发不要求 `onProgress`
- **不向页面注入**业务 API / Provider /「可执行方法」
- 对外文档不再主推 DOM 触发协议

### 1.4 明确不做的「注入」

| 说法 | 要不要 |
|------|--------|
| Content Script 匹配 ATS 域并监听 `message` | **要**（扩展标配通道，对客户不可见） |
| 往 MAIN world 挂 `window.IvvaCrx.publish` 等 | **不要** |
| 再注入一层专供 SDK 的中转脚本 | **不要** |
| 隐藏 `#plug_trigger` 等节点 | 仅 CRX **短期内部兼容**旧页，非新方案一部分 |

npm SDK 直接 `postMessage`；插件 Content Script **本就能**听到同页消息，再按 **命令标识 + taskId** 路由执行。无需为对接再做一层注入。

---

## 2. 总体架构

```text
┌──────────────────────────────────────────────┐
│  客户 ATS（任意：Vue / React / jQuery / 其它）   │
│  依赖：轻量 SDK（npm 主交付；UMD 见 README）     │
└────────────────────┬─────────────────────────┘
                     │ createClient / ready / setToken
                     │ invoke(command, payload)  死等终态
                     │ window.postMessage
                     ▼
┌──────────────────────────────────────────────┐
│  同页 window 消息（protocol v1 信封）           │
│  source: ivva-web  →  ivva-crx                │
└────────────────────┬─────────────────────────┘
                     ▼
┌──────────────────────────────────────────────┐
│  CRX Content Script（已有 / 演进 plug.js）      │
│  校验来源 → 按 type/command + taskId 路由       │
│  → Service Worker / runners                   │
│  → 插件内全部业务 UI                           │
│  → postMessage 回 done / fail（同 taskId）     │
└────────────────────┬─────────────────────────┘
                     ▼
                 插件后端（含 telemetry）
```

**一句话**：客户只跟 SDK 说话；SDK 只做传输与等待；会变的能力与 UI 全在 CRX。

---

## 3. 分层职责

### 3.1 客户侧 SDK（尽量「一版过」）

| 职责 | 说明 |
|------|------|
| `createClient(options)` | 如 `profile: 'sf-test' \| 'sf'`，用于双装时选对包 / 校验 |
| `ready()` | 等待 CRX `announce`；超时 → 未安装或需刷新 |
| 调用队列 | 页面早于 CS 就绪时缓冲 |
| `setToken` | 首次设置后缓存（内存；是否 sessionStorage 见待决） |
| `invoke(command, payload)` | **只传数据**，不实现业务 |
| 死等 | 仅 `done` / `fail` 结束 Promise；可忽略中间 `progress` |
| SDK 超时 | 到期 `reject(TIMEOUT)`，避免 ATS 转圈永不结束 |
| 错误透出 | `not_installed` / `EXTENSION_RELOADED` / 业务 `fail` 等 |
| telemetry（可选 API） | **默认经 CRX 转发**插件后端 |

**不做**：业务 UI、命令业务逻辑、框架封装、主路径直连业务 HTTP。

### 3.2 CRX（勤更新）

| 职责 | 说明 |
|------|------|
| 监听 `postMessage` | 按命令 + `taskId` 执行 |
| `announce` | protocol、version、extensionId、commands、升级提示字段 |
| 命令执行与全部 UI | 发布宿主、侧栏、超时对人提示等 |
| 终态回传 | 成功 / 失败 / 超时 **必须** `done` 或 `fail`，否则 SDK 无法收尾 |
| 升级建议 | 坐在 `announce`（或插件 UI），不依赖客户升主站 SDK |
| 旧 DOM | 短期把 `#plug_trigger` **内部**转成同类 invoke（可选） |

### 3.3 对接文档中的三层

1. **传输协议**（冻住）：信封字段、`protocolVersion`、事件名、通用错误码  
2. **命令目录**（文档主体）：`commandId`、入参、出参、是否长耗时、是否需用户手势  
3. **运行时 capabilities**：以 CRX `announce` 为准  

加命令 = 升插件 + 改命令表；**尽量不发 SDK 大版本**。仅 protocol 不兼容时才升 SDK。

---

## 4. 传输约定（示意）

与现有 Next / `ivva_vite` `crxBridge` 方向对齐，便于日后统一（具体字段以实现时与 `plug.js` 对齐为准）。

### 4.1 页面 → 插件（发起）

```json
{
  "source": "ivva-web",
  "v": 1,
  "event": "start",
  "taskId": "uuid",
  "type": "position.publish",
  "payload": { "positionId": "12345" }
}
```

### 4.2 插件 → 页面（终态示例）

```json
{
  "source": "ivva-crx",
  "v": 1,
  "event": "done",
  "taskId": "uuid",
  "type": "position.publish",
  "data": {}
}
```

失败时 `event: "fail"`，带 `error: { code, message, action? }`。  
`action` 建议约定：`retry` | `login` | `upgrade` | `refresh_page`。

### 4.3 就绪公告

```json
{
  "source": "ivva-crx",
  "v": 1,
  "event": "announce",
  "extensionId": "...",
  "data": {
    "protocol": "ivva-crx-v1",
    "version": "x.y.z",
    "commands": ["position.publish", "setIvvaToken", "..."],
    "needsUpdate": false,
    "updateUrl": ""
  }
}
```

Content Script 校验：`event.source === window`，且 `source` 字段为约定值，避免其它脚本噪声。

---

## 5. 典型调用（对外心智）

完整能力与 payload 见 [sdk-command-catalog.md §2](./sdk-command-catalog.md)。

```js
import { createClient } from '@ivva/ivva-crx-sdk'

const crx = createClient({ profile: 'sf' }) // 或 'sf-test'

await crx.setToken(ivvaToken) // 登录后一次

// 发布：可不带 channel → 插件内选渠
await crx.publish({ positionId })

// 查状态 / 上下架 / 外网详情 / 登录态 —— 见命令表
// 全景搜索：用户点击里 invoke('sf.openSidePanel', {})
```

ATS：loading → `await` → 成功刷新 / 按 `error.code` 提示。

### 5.1 长任务

- UI 与超时**对人**提示：只在插件  
- SDK：**死等**终态；CRX 可发 `progress`，SDK 首发可忽略  
- CRX 超时/失败时：页内提示 **且** 必须 `fail` 给 SDK  
- SDK 自身超时：兜底 `reject`，防止 Promise 悬挂  

### 5.2 需用户手势的命令

如打开 Side Panel（全景搜索）：须在真实用户点击回调中调用；命令表标注「需用户手势」。

---

## 6. SDK 交付

| 项 | 定案 |
|----|------|
| 仓库 | 独立 Git 托管（GitHub / 内网 Git），README 说明用法 |
| 主交付 | npm（ESM） |
| UMD | README 说明并提供构建产物 / src；**生产勿只依赖 raw.githubusercontent.com** |
| 框架 | 原生 JS，零 UI 框架依赖 |
| 环境 | **一套 SDK**；`createClient({ profile })` 区分 sf-test / 正式；以 `announce.extensionId` 校验 |
| 版本策略 | 传输层尽量永久兼容；业务能力随 CRX |

---

## 7. Telemetry

| 项 | 定案 |
|----|------|
| 终点 | 插件后端 |
| 默认 | SDK → CRX → 后端 |
| 直连 HTTP | **非主路径**；仅可评估「未安装」等特例 |
| BaseURL | 若做直连：须 `createClient` 或 `announce` 下发，**禁止写死进永久 SDK** |
| 未安装 | 无通道时：`onStatus('not_installed')` / console；不默认直连 |

首发建议：**不做直连**，文档预留。

---

## 8. 版本与升级（旧主站 + 新插件）

| 场景 | 行为 |
|------|------|
| 旧 SDK + 新 CRX | 同一 protocol 下 `invoke` 新命令可用；以 capabilities 探测 |
| 新 SDK + 旧 CRX | 命令不在列表 → 「请升级插件」 |
| 建议更新 | CRX `announce` / 插件 UI 下发，**不靠**客户重新发版主站 |
| 扩展热更导致 CS 失效 | `EXTENSION_RELOADED` → 提示刷新页面 |

升级责任主要在**扩展安装包**；主站 SDK 尽量不动。

---

## 9. 旧协议与切流

| 项 | 定案 |
|----|------|
| 对外新对接 | **仅 SDK + postMessage** |
| CRX 内部 | 可短期兼听 `#plug_trigger`，转内部命令 |
| 文档站 | 更新 [userUrl/api](https://www.ivvajob.com/userUrl/api#/index)；旧 DOM 标废弃 |
| 与旧 sf 包 | 切流由插件侧运维清单负责；本 SDK 仓不附带 CUTOVER |

---

## 10. 客户侧部署步骤（摘要）

1. 安装对应环境的 Chrome 扩展（sf-test / 正式）  
2. 主站引入 SDK（npm 或约定 UMD）  
3. `createClient({ profile })`  
4. 登录后 `setToken`  
5. 业务按钮 `invoke`  
6. 未安装 / 需升级：展示 SDK 或 announce 给出的引导（安装包地址由我方提供）  

插件构建、租户分包、远端上传仍按本仓库现有流程。

---

## 11. 首发 SDK API 最小集

| API | 作用 |
|-----|------|
| `createClient(options)` | profile、默认超时等 |
| `ready()` | 等 announce |
| `getCapabilities()` | 命令与版本 |
| `setToken(token)` | 鉴权 |
| `invoke(command, payload, opts?)` | 通用调用（死等）；`opts.timeoutMs` 可选 |
| 状态/错误类型 | 未安装、需刷新、超时等 |

具名糖（如 `publish(positionId)`）可选，内部仍是 `invoke`。

---

## 12. 已确认决策速查

1. 主对接改为 SDK + `postMessage`，不再主推 DOM click  
2. **不注入**页面业务 API；CS 原生听消息即可  
3. SDK 轻量、尽量一版过；业务与 UI 在 CRX  
4. 客户业务代码不直接写协议细节  
5. 框架无关（无 Vue/React 专用包）  
6. 发布：ATS 传 `positionId`，UI 全在插件，SDK 死等  
7. 一套 SDK，入参区分环境  
8. 升级提示由 CRX announce / 插件 UI 给出  
9. 上报经插件后端；直连非默认  
10. 旧 `#plug_trigger`：仅 CRX 内可选兼容  
11. 独立 Git 放 SDK；README 含 UMD 说明  
12. 对外文档站随后按本方案更新  

---

## 13. 待决清单（定稿前补齐）

| # | 项 | 说明 |
|---|----|------|
| 1 | npm 包名 / 仓库名 | `@ivva/ivva-crx-sdk` / `ivva-crx-sdk` |
| 2 | 命令 ID 终表 | 新命名 vs 兼容旧 `status`（`positionRelease` 等），CRX 内映射 |
| 3 | `position.publish` 完整入参 | 除 `positionId` 外是否还要渠道、其它字段 |
| 4 | 默认超时 | 短 RPC vs 发布类分别多少 ms |
| 5 | 双装选包 | 仅 profile，或强制 `expectedExtensionId` |
| 6 | Token 存储 | 仅内存 / sessionStorage / 是否允许 localStorage |
| 7 | 直连 telemetry | 首发建议不做 |
| 8 | 旧 DOM 兼容下线 | 几个发版周期 |
| 9 | 打开侧栏是否进首发对外 API | 与 Panel「仅搜」产品对齐后写入命令表 |
| 10 | 与 `ivva_vite` crxBridge | 是否共用同一信封，避免两套协议 |
| 11 | 安全 | ATS 域名 matches、命令白名单 |
| 12 | 并发 | 同一职位重复点击：串行 / 拒第二次 / 由插件 UI 消化 |
| 13 | 失败重试 | ATS 是否自动重试；建议客户控；插件内重试不重复占同一 Promise 语义需写清 |

---

## 14. 与当前代码的关系（备忘）

- `src/bridge/plug.js` 已支持网页 `postMessage`（`ivva-web` start）与 SF `#plug_trigger`  
- `ivva_vite` 的 `crxBridge` 已是页侧 SDK 雏形，独立 `@ivva/ivva-crx-sdk` 可抽公共协议或先客户专用再收敛  
- **本文不要求立刻改代码**；实现时另开切片（建 SDK 仓、对齐命令表、更新文档站、CUTOVER 注明新主路径）

---

## 15. 分阶段实现表（SDK 对接）

> 代号 **K**（客户对接 Customer Kit），与插件功能阶段 **S0–S7** 并行，不替代 S 线。  
> 勾选状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

| 阶段 | 目标 | 主要交付 | 入口/验收 | 依赖 | 状态 |
|------|------|----------|-----------|------|------|
| **K0** | 冻结契约 | 命令 ID 初表；信封字段与 `ivva-web`/`ivva-crx` 对齐说明；拍板 §13 中 1–4、10 | 内部评审通过；本文 §4/§11/§13 更新 | 无 | [x] |
| **K1** | SDK 最小可用 | 独立 Git 仓 + npm 包骨架；`createClient` / `ready` / `invoke` / 队列 / 超时 / 错误码；ESM；README 含 UMD 说明 | 无扩展时 `ready` 超时可感知；有扩展时能收到 `announce` | K0 | [x] |
| **K2** | CRX 桥对齐 | CS：`announce` 补齐 capabilities；`start` 按 command+taskId 回 `done`/`fail`；SF ATS matches 确认；**不**做页面业务注入 | 控制台/临时页：`invoke` 短命令（如 setToken / 探测）通 | K0；现有 `plug.js` | [~] |
| **K3** | 发布主路径联调 | `position.publish`：ATS 只传 `positionId` → SDK 死等 → PublishHost 全交互 → 终态回 SDK | 顺丰测网：一点发布弹出插件 UI，结束 ATS 能收成功/失败 | K1+K2；S7 PublishHost | [~] |
| **K4** | 首发命令补齐 | 登录态查询、职位状态/上下架、打开侧栏（若纳入首发）、telemetry 经 CRX；`profile` 区分 sf-test/正式 | 命令表所列首发项均能 `invoke` 打通 | K3；S2/S2.5 等已有能力 | [ ] |
| **K5** | 对外文档与交付 | 更新 [对接文档站](https://www.ivvajob.com/userUrl/api#/index)；CUTOVER 主路径改 SDK；给顺丰安装包+SDK 接入说明；旧 DOM 标废弃 | 顺丰开发按新文档能独立接入 | K4 | [ ] |
| **K6** | 兼容收敛 | 定旧 `#plug_trigger` 下线周期；双装/升级提示（announce）；可选：与 `ivva_vite` crxBridge 协议收敛 | 新对接零 DOM；旧页仍可撑过过渡期或已迁完 | K5；切流策略 | [ ] |

### 阶段关系（示意）

```text
K0 契约 ──► K1 SDK 壳 ──┐
         └► K2 CRX 桥 ──┴► K3 发布联调 ──► K4 命令补齐 ──► K5 文档交付 ──► K6 收敛
                              ▲
                         S7 PublishHost 等
```

### 单阶段完成定义（DoD）

| 阶段 | Done 当且仅当 |
|------|----------------|
| K0 | 命令表+信封有可执行的一页规格；§13 关键项有默认值或明确「延后」 |
| K1 | 包可 `npm i`；README 可跑通「未安装/已安装」两种探测 |
| K2 | 不经过 `#plug_trigger`，短 RPC 双向通；announce 含 commands |
| K3 | 真机：positionId → 插件 UI → Promise 结束；无页面注入业务 API |
| K4 | 首发对外命令清单全部有示例与验收记录 |
| K5 | 文档站与仓库文档一致；顺丰侧可按文档接入 |
| K6 | 废弃时间表书面化；升级提示路径可用 |

### 明确不进本线（或后置）

- 页面 MAIN world 注入业务方法  
- SDK 直连 telemetry（默认不做）  
- 框架专用包（Vue/React hooks）  
- SDK 侧 `onProgress`（CRX 可发，客户首发不依赖）  

### 建议排期口诀

- **先 K0**，避免边写边改命令名  
- **K1 / K2 可并行**（一人 SDK、一人 CRX）  
- **K3 是对外可用性门槛**（发布死等跑通再谈铺量）  
- **K5 再推顺丰改主站**；勿在 K3 前大规模让客户改代码  

---

*文档版本：2026-09-17 · 方案确认稿 + K0–K6 阶段表*
