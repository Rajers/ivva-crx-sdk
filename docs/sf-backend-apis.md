# 用户侧需配合的后端能力（全景搜索）

> 面向 **客户后端 / 中间层**。前端 SDK 用法见 [README](../README.md)、命令总表见 [sdk-command-catalog.md](./sdk-command-catalog.md) §4.6。  
> 本文只约定：**用户侧要提供/保证什么**；插件如何调用 SDK 不在此展开。

全景搜预填由 ATS 页调用 `sf.openSidePanel` 触发。下列两项由 **用户侧提供或保证**，插件侧消费。

| # | 用途 | 用户侧能力 | 插件 / ATS 怎么用 |
|---|------|------------|-------------------|
| 1 | 按职位搜索 | 按用户侧职位 ID 返回职位详情（字段兼容 ATS `getPositionDetail`） | ATS：`invoke('sf.openSidePanel', { mode:'job', positionId })` → 插件再拉详情拆 JD |
| 2 | 按简历搜索 | 提供 **HTTPS 可 GET 的简历原件下载地址**（二进制文件流） | ATS：`invoke('sf.openSidePanel', { mode:'upload', fileUrl, fileName? })` → 插件下载后解析再搜 |

---

## 1. 按职位 ID 取职位详情

### 职责

插件在收到 `positionId` 后，需要拿到与现有 ATS **`/position/getPositionDetail`** 同形的职位数据，才能拆解 JD 并生成搜条件。

请用户侧保证其一：

- 在插件配置的 `ajaxUrl` 上实现兼容接口；或  
- 职位已同步至 ivva ATS，插件继续走现有 `getPositionDetail`（入参仍为双方约定的职位主键）。

**一键发布**也依赖同一详情源。若共用此接口，请按完整 `getPositionDetail` 契约实现，勿只做搜字段子集。

### 建议契约（对齐 ATS）

| 项 | 说明 |
|----|------|
| 路径 | `/position/getPositionDetail`（或双方约定等价路径） |
| 入参 | `positionId`（用户侧 / ATS 职位主键，与 SDK 传入一致） |
| 成功 | 与现有 ATS 一致的业务包络；`data` 为职位对象（或可解析出唯一职位对象） |

### 全景搜至少需要的字段

插件会把详情映射为搜条件文本；下列字段有则填、无则跳过。字典类可为 **ID**（插件内翻成中文名）或已是中文文案。

| 字段（优先） | 兼容别名 | 说明 |
|--------------|----------|------|
| `positionId` | — | 职位主键 |
| `positionName` | `jobName` | 职位名称 |
| `positionDescription` | `describe` | 职位描述 / JD 正文 |
| `positionWorkNature` | `jobState` | 工作性质 |
| `positionCategory` | `jobType` | 职能 / 职位类别 |
| `positionBreakdown` | `breakdown` | 细分职能 |
| `positionIndustry` | `industry` | 行业 |
| `positionEducation` | `education` | 学历 |
| `positionWorkExperience` | `jobYear` | 工作年限 |
| `positionKeyWord` | `keyWord` | 关键词（字符串或数组） |
| `positionSalary` | — | 薪资；常见 `最低,最高`（如 `15,25`） |
| `positionCity` | `city` | 城市 |
| `positionAge` | `age` | 年龄；常见 `最小,最大`（如 `25,30`） |
| `positionLanguage` | `language` | 语言；常见 `英语_1,粤语_2` |
| `positionOverseasExperience` | `overseasExperience` | 海外经历 |

发布场景还会用到公司名、福利、亮点、渠道列表等，完整字段以现有 ATS `getPositionDetail` 响应为准，联调时可另附样例 JSON。

### 调用关系（勿搞反）

```
ATS 页 ──SDK──▶ 插件（只传 positionId）
                  └─▶ 用户侧 / ATS 后端 getPositionDetail
```

不是「SDK 直接调用户侧接口」；也不是用户侧在 SDK `done` 里回传详情。

---

## 2. 简历原件下载地址

### 职责

按简历搜索时，ATS **不传**本地文件或 base64，只传插件可拉取的下载 URL。用户侧需能签发或提供该地址（通常在 ATS 调 SDK 前由业务接口生成）。

### 建议契约

| 项 | 说明 |
|----|------|
| 形态 | **HTTPS GET** 返回简历**原件二进制**（`Content-Type` 对应文件类型；可用 `Content-Disposition` 带文件名） |
| 给 SDK | `fileUrl`（必填；别名 `downloadUrl` / `url`）；可选 `fileName`、`headers` |
| 格式 | `pdf` / `doc` / `docx` / `txt`；建议体积 ≤ 20MB |
| 鉴权 | 扩展**不会**自动带 ATS 页 Cookie。请用短时签名 URL，或允许 ATS 经 SDK `headers` 传入 Token |
| 域名 | 下载域名须纳入扩展 `host_permissions`（联调时与插件侧确认） |

### 调用关系

```
用户侧业务接口 ──生成 fileUrl──▶ ATS 页 ──SDK──▶ 插件 GET fileUrl ──▶ 解析 / 搜
```

「对接」的是 **可下载 URL 能力**，不是再给插件一个「查简历元数据」的 JSON RPC。

### ATS 侧示例

```js
await crx.invoke('sf.openSidePanel', {
  mode: 'upload',
  fileUrl: 'https://ats.example.com/api/resume/download?id=xxx&sign=…',
  fileName: 'zhang.pdf',
  // headers: { Authorization: 'Bearer …' }, // 若不能用签名 URL
})
```

下载失败（401 / 404 / 权限域未覆盖等）在 **Side Panel 内提示**；`sf.openSidePanel` 的 `done` 只表示侧栏已打开，不表示下载或搜索结束。

---

## 联调检查清单

- [ ] 用真实 `positionId` 调详情接口，响应能解析出职位名 + 描述（至少一项非空）
- [ ] 同一 `positionId` 走 `mode:'job'` 打开侧栏后，Panel 能生成搜条件（非空）
- [ ] `fileUrl` 在无浏览器 Cookie 的环境下可用 `GET` 拉到文件（签名 URL 或 `headers`）
- [ ] 下载域已加入扩展 host 权限；文件类型与大小符合上表
- [ ] 若发布与搜共用详情接口：抽查发布探缺所需字段是否齐全

---

*文档版本：2026-09-23 · 客户后端配合项（职位详情 + 简历下载 URL）*
