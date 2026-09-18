## 业务能力 ↔ API 总表（客户首发）

| # | 能力 | command | 旧 status 别名 | SDK 写法 | 主要 payload | 默认超时 | 需用户手势 | UI 在哪 | 状态 |
|---|------|---------|----------------|----------|--------------|----------|------------|---------|------|
| 1 | 一键职位发布 | `position.publish` | `positionRelease` / `positionUpdate` / `positionUpload` | `publish({ positionId })` 或 `invoke(...)` | `positionId`；可选 `channel`（不带则插件内选渠） | 600s | 建议在点击里调 | **PublishHost**（选渠/探缺/确认） | 已接线 |
| 2 | 职位上下架 | `position.channelStatus` | `updateChannePositionStatus` / `uploadChannePositionStatus` | `invoke('position.channelStatus', …)` | `action:'update'`, `positionId`, `channel`, `positionRealStatus` | 180s | 否 | 插件执行 | 已有 runner |
| 3 | 获取外网职位当前状态 | `position.channelStatus` | `getChannePositionStatus` | 同上 | `action:'get'`, `positionId`；可选 `channel` | 180s | 否 | 无大弹层 | 已有 |
| 4 | 跳转外网职位详情 | `position.openExternal` | `toPositonDetail` / `toPositionDetail` | `invoke('position.openExternal', …)` | `positionId`, `channel` | 60s | 否 | 开外网 Tab | 已有 |
| 5 | 获取渠道登录状态 | `channel.loginStatus` | `getChanneLoginStatus` | `invoke('channel.loginStatus', …)` | 可选 `channels: ['boss','lp','zl','qc']` | 60s | 否 | 无 | 已有 |
| 6 | 设置 ivvaToken（鉴权） | `auth.setToken` | `setIvvaToken` | `setToken(token)` | `token` / `ivvaToken` | 15s | 否 | 无 | 已接线 |
| 7 | 全景搜索 | `sf.openSidePanel` | `openSidePanel` / `openPanel` / `sidePanel` | `invoke('sf.openSidePanel', {})` | `{}` | 15s | **必须用户点击** | **Side Panel**（产品定为仅搜） | 已接线 |

<!-- 附属（同命令族，非独立能力名）：

| 能力 | command | action / 说明 |
|------|---------|----------------|
| 刷新外网职位 | `position.channelStatus` | `action:'refresh'`（旧 status `refresh`） |
| 探测能力 | `crx.getCapabilities` | 拉完整 capabilities |
| 更新插件 | `crx.updatePlugin` | 旧 `updatePlugin` | -->

**全景搜索说明**：客户首发对外 API = **打开侧栏**；搜条件与结果 UI 全在 Panel。插件内部另有 `resume.search` 等，**暂不作为客户主 API**。

未进首发（后置）：`radar.updateContact`（暂缓）、IM 等。

---

## 3. 别名规则

SDK / CS 收到旧 status 时归一到上表 **command**，再执行。客户文档只写左列 command；兼容旧名便于迁移。

发布不带 `channel`（或空）：与 `#plug_trigger` 一致 → **PublishHost 先弹渠道选择**。

---

## 4. 推荐调用顺序

```js
import { createClient } from '@ivva/ivva-crx-sdk'

const crx = createClient({ profile: 'sf-test' }) // 正式包用 'sf'

// 登录后准备一次
await crx.setToken(token) // 建议内部顺带 ready；亦可显式 await crx.ready()

// 业务（等待终态）
await crx.publish({ positionId: '12345' })

await crx.invoke('position.channelStatus', {
  action: 'get',
  positionId: '12345',
})

await crx.invoke('position.channelStatus', {
  action: 'update',
  positionId: '12345',
  channel: [3, 4],
  positionRealStatus: 2, // 1 上架 / 2 下架 / 3 删除
})

await crx.invoke('position.openExternal', {
  positionId: '12345',
  channel: 'boss',
})

await crx.invoke('channel.loginStatus', {
  channels: ['boss', 'lp', 'zl', 'qc'],
})

// 全景搜索：必须在用户点击回调里
btn.addEventListener('click', () => {
  void crx.invoke('sf.openSidePanel', {})
})
```

回包：`event === 'done' | 'fail'`；失败看 `error.code` / `message`。

---

## 5. 典型 payload

### 5.1 auth.setToken

```json
{ "token": "<ivvaToken>" }
```

亦接受 `ivvaToken`。

### 5.2 position.publish

```json
{ "positionId": "12345" }
```

- 不带 `channel` → 插件内选渠（PublishHost）。  
- 带 `channel`（数组或单渠）→ 可跳过选渠、直接查缺（与 Host 现逻辑一致）。  
- ATS 最小只需 `positionId`；职位字段探缺/补全在插件内。

### 5.3 position.channelStatus

| 字段 | 说明 |
|------|------|
| `action` | `get` 查外网状态；`update` 上架 / 下架 / 删除 |
| `positionId` | ATS 职位主键（必填） |
| `channel` | 目标渠道；可为 apiId 数字数组（如 `[3, 4]`）或渠道 abbr（如 `'boss'`），以实现侧解析为准 |
| `positionRealStatus` | 仅 `action:'update'` 时必填，见下表 |

`positionRealStatus` 取值：

| 值 | 含义 |
|----|------|
| `1` | 上架 |
| `2` | 下架 |
| `3` | 删除 |

查状态：

```json
{
  "action": "get",
  "positionId": "12345"
}
```

上下架（示例：下架）：

```json
{
  "action": "update",
  "positionId": "12345",
  "channel": [3, 4],
  "positionRealStatus": 2
}
```

<!-- 刷新：

```json
{
  "action": "refresh",
  "positionId": "12345",
  "channel": [3, 4]
}
``` -->

### 5.4 position.openExternal

```json
{
  "positionId": "12345",
  "channel": "boss"
}
```

### 5.5 channel.loginStatus

```json
{
  "channels": ["boss", "lp", "zl", "qc"]
}
```

省略时由插件默认探测首发渠。

### 5.6 sf.openSidePanel

```json
{}
```

须在用户点击回调中 `invoke`，否则 Chrome 可能拒绝 `sidePanel.open`。

---

## 6. announce.data 约定

| 字段 | 含义 |
|------|------|
| `protocol` | `ivva-crx-v1` |
| `profile` | `sf-test` \| `sf` |
| `version` / `extensionId` | 清单 |
| `types` | 内部 runner 全量 |
| `customerCommands` | §2 对外 command 数组 |
| `needsUpdate` / `updateUrl` | 可选；升级提示 |

`createClient({ profile })` 在 ready 后若与 announce 不一致 → 「连错扩展包」。

---

## 7. 已拍板默认值

| 项 | 默认 |
|----|------|
| 包名 | `@ivva/ivva-crx-sdk` |
| 命令 ID | Next 风格；旧 status 作别名 |
| publish 入参 | 最小 `positionId`；其余插件内 |
| 超时 | 见 §2 |
| 双装 | `profile` 校验；可选 `expectedExtensionId` |
| Token | SDK 内存 + 交给 CRX |
| 直连 telemetry | 首发不做 |
| 旧 DOM | CRX 内短期兼容 |
| 全景搜 | `sf.openSidePanel`，非裸调 `resume.search` |

---

## 8. 阶段勾选

- [x] K0 契约 / 命令表  
- [x] K1 SDK 包（`e:\ivva\ivva-crx-sdk`）  
- [~] K2 announce + 短 RPC（已接线）  
- [~] K3 `position.publish` 等待 + PublishHost（已接线，实机持续验）  
- [ ] K4 首发命令补齐示例与验收记录（本表 §2 七项）  
- [ ] K5 对外文档站同步  

---

*文档版本：2026-09-17 · 对外 API 总表落档*
