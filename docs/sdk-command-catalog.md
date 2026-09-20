## 1. 业务能力 ↔ API 总表（客户首发）

> 窄表 + 单元格内换行；旧 status / SDK / payload / UI 叠在「command · 说明」列。细节见后文 §4。

| # | 能力 | command · 说明 | 超时 |
|---|------|----------------|------|
| 1 | 一键职位发布<br>**已接线** | `position.publish`<br>旧：`positionRelease` / `positionUpdate` / `positionUpload`<br>SDK：`publish({ positionId })` 或 `invoke(...)`<br>payload：`positionId`；可选 `channel`（不带则插件内选渠）<br>UI：**PublishHost**（选渠 / 探缺 / 确认） · 建议在点击里调 | 600s |
| 2 | 职位上下架<br>已有 runner | `position.channelStatus`<br>旧：`updateChannePositionStatus` / `uploadChannePositionStatus`<br>SDK：`invoke('position.channelStatus', …)`<br>payload：`action:'update'`, `positionId`, `channel`, `positionRealStatus`<br>UI：插件执行 | 180s |
| 3 | 获取外网职位当前状态<br>已有 | `position.channelStatus`<br>旧：`getChannePositionStatus`<br>SDK：同上<br>payload：`action:'get'`, `positionId`；可选 `channel`<br>UI：无大弹层 | 180s |
| 4 | 跳转外网职位详情<br>已有 | `position.openExternal`<br>旧：`toPositonDetail` / `toPositionDetail`<br>SDK：`invoke('position.openExternal', …)`<br>payload：`positionId`, `channel`<br>UI：开外网 Tab | 60s |
| 5 | 获取渠道登录状态<br>已有 | `channel.loginStatus`<br>旧：`getChanneLoginStatus`<br>SDK：`invoke('channel.loginStatus', …)`<br>payload：可选 `channels: ['boss','lp','zl','qc']`<br>UI：无 | 60s |
| 6 | 设置 ivvaToken（鉴权）<br>**已接线** | `auth.setToken`<br>旧：`setIvvaToken`<br>SDK：`setToken(token)`<br>payload：`token` / `ivvaToken`<br>UI：无 | 15s |
| 7 | 全景搜索<br>**已接线** | `sf.openSidePanel`<br>旧：`openSidePanel` / `openPanel` / `sidePanel`<br>SDK：`invoke('sf.openSidePanel', payload)`（须用户点击）<br>payload：见 §4.6（`mode` + `text` / `positionId` / `fileUrl`）<br>UI：**Side Panel**（仅搜） | 15s |

<!-- 附属（同命令族，非独立能力名）：

| 能力 | command | action / 说明 |
|------|---------|----------------|
| 刷新外网职位 | `position.channelStatus` | `action:'refresh'`（旧 status `refresh`） |
| 探测能力 | `crx.getCapabilities` | 拉完整 capabilities |
| 更新插件 | `crx.updatePlugin` | 旧 `updatePlugin` | -->

**全景搜索说明**：客户首发对外 API = **打开侧栏并可选预填**；搜条件解析 / 结果 / 匹配 UI 仍在 Panel。插件内部另有 `resume.search` 等，**暂不作为客户主 API**。`done` 仅表示侧栏已打开（及预填已受理），**不是**搜索结束。

未进首发（后置）：`radar.updateContact`（暂缓）、IM 等。

---

## 2. 别名规则

SDK / CS 收到旧 status 时归一到上表 **command**，再执行。客户文档只写左列 command；兼容旧名便于迁移。

发布不带 `channel`（或空）：与 `#plug_trigger` 一致 → **PublishHost 先弹渠道选择**。

---

## 3. 推荐调用顺序

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

// 全景搜索：必须在用户点击回调里；可按 mode 预填
btn.addEventListener('click', () => {
  void crx.invoke('sf.openSidePanel', {
    mode: 'nl',
    text: '北京 5年 Java 本科',
  })
  // mode: 'job', positionId: '12345'
  // mode: 'upload', fileUrl: 'https://…/resume.pdf', fileName: 'a.pdf'
})
```

回包：`event === 'done' | 'fail'`；失败看 `error.code` / `message`。

---

## 4. 典型 payload

### 4.1 auth.setToken

```json
{ "token": "<ivvaToken>" }
```

亦接受 `ivvaToken`。

### 4.2 position.publish

```json
{ "positionId": "12345" }
```

- 不带 `channel` → 插件内选渠（PublishHost）。  
- 带 `channel`（数组或单渠）→ 可跳过选渠、直接查缺（与 Host 现逻辑一致）。  
- ATS 最小只需 `positionId`；职位字段探缺/补全在插件内。

### 4.3 position.channelStatus

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

### 4.4 position.openExternal

```json
{
  "positionId": "12345",
  "channel": "boss"
}
```

### 4.5 channel.loginStatus

```json
{
  "channels": ["boss", "lp", "zl", "qc"]
}
```

省略时由插件默认探测首发渠。

### 4.6 sf.openSidePanel

打开 Side Panel（全景搜索）。**必须在用户点击回调中** `invoke`，否则 Chrome 可能拒绝 `sidePanel.open`。

`done` = 侧栏已打开（预填已交给 Panel）；搜索过程与结果只在插件内，不经本 Promise 返回列表。

#### 公共字段

| 字段 | 说明 |
|------|------|
| `mode` | `nl` 自然语言 · `job` 职位搜索 · `upload` 上传简历搜索；省略则打开默认 Tab（自然语言），不预填 |

三种 `mode` **互斥预填**（一次只传一种业务入参）。

#### 自然语言（`mode: 'nl'`）

| 字段 | 必填 | 说明 |
|------|------|------|
| `text` | 是* | 自然语言搜条件；别名 `txt` |
| `txt` | — | 同 `text` |

```json
{
  "mode": "nl",
  "text": "北京 5年 Java 本科"
}
```

#### 职位搜索（`mode: 'job'`）

| 字段 | 必填 | 说明 |
|------|------|------|
| `positionId` | 是 | ATS 职位主键；插件按职位拆解 JD 后寻访 |

```json
{
  "mode": "job",
  "positionId": "12345"
}
```

#### 上传简历搜索（`mode: 'upload'`）

ATS **不传本地文件 / base64**，只传**可下载地址**；插件拉取文件后走现有 LLM 上传解析接口，再在 Panel 内搜索。

| 字段 | 必填 | 说明 |
|------|------|------|
| `fileUrl` | 是 | 简历下载 URL（HTTPS GET）；别名 `downloadUrl` / `url` |
| `fileName` | 否 | 文件名（含扩展名，便于解析）；无则从 `Content-Disposition` 或 URL 推断 |
| `headers` | 否 | 下载所需请求头（如短时 Token）；扩展**不会**自动带上 ATS 页 Cookie |

```json
{
  "mode": "upload",
  "fileUrl": "https://ats.example.com/api/resume/download?id=xxx",
  "fileName": "zhang.pdf"
}
```

约束（与 Panel 上传 Tab 对齐，实现侧校验）：

- 建议体积 ≤ 20MB；扩展名 `pdf` / `doc` / `docx` / `txt`
- 下载失败（401/404/跨域未授权等）在 **Panel 内提示**；勿依赖本命令长时间等待解析/搜完
- 下载域名须在扩展 `host_permissions`（或可选权限）覆盖范围内——联调时与插件侧确认

仅打开侧栏、不预填：

```json
{}
```

---

## 5. announce.data 约定

| 字段 | 含义 |
|------|------|
| `protocol` | `ivva-crx-v1` |
| `profile` | `sf-test` \| `sf` |
| `version` / `extensionId` | 清单 |
| `types` | 内部 runner 全量 |
| `customerCommands` | §1 对外 command 数组 |
| `needsUpdate` / `updateUrl` | 可选；升级提示 |

`createClient({ profile })` 在 ready 后若与 announce 不一致 → 「连错扩展包」。

---

*文档版本：2026-09-20 · 对外 API 总表（去掉内部默认值/阶段勾选；全景搜预填 + fileUrl）*
