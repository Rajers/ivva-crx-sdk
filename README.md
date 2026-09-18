# @ivva/ivva-crx-sdk

客户 ATS ↔ **招聘助手 Next** 的轻量对接 SDK。

- 页内 `postMessage`（`ivva-web` / `ivva-crx`）
- **不向页面注入业务 API**
- 业务 UI 在扩展内；页面侧等待 `done` / `fail`

## 文档

| 文档 | 说明 |
|------|------|
<!-- | [docs/customer-sdk-integration.md](./docs/customer-sdk-integration.md) | 对接方案 | -->
| [docs/sdk-command-catalog.md](./docs/sdk-command-catalog.md) | 对外 API 总表（发布/上下架/状态/详情/登录态/Token/全景搜） |

## 安装

```bash
npm i github:Rajers/ivva-crx-sdk#v0.1.2
# 或跟 main：
# npm i github:Rajers/ivva-crx-sdk
```

仓库已包含预构建 `dist/`，安装后即可直接用，无需本机再 build。

## 用法（摘要）

```js
import { createClient } from '@ivva/ivva-crx-sdk'

const crx = createClient({ profile: 'sf-test' }) // 正式包用 'sf'

await crx.setToken(token)

await crx.publish({ positionId: '12345' }) // 不带 channel → 插件内选渠

await crx.invoke('position.channelStatus', {
  action: 'get',
  positionId: '12345',
})

await crx.invoke('channel.loginStatus', {
  channels: ['boss', 'lp', 'zl', 'qc'],
})

btn.addEventListener('click', () => {
  void crx.invoke('sf.openSidePanel', {}) // 全景搜索；须用户手势
})
```

## UMD（无 Node / 直接挂脚本）

仓内已带产物，也可走 jsDelivr：

```html
<script src="https://cdn.jsdelivr.net/gh/Rajers/ivva-crx-sdk@v0.1.2/dist/ivva-crx-sdk.umd.cjs"></script>
<script>
  const crx = IvvaCrxSdk.createClient({ profile: 'sf-test' })
</script>
```

- `dist/ivva-crx-sdk.js` — ESM
- `dist/ivva-crx-sdk.umd.cjs` — IIFE，全局 `IvvaCrxSdk`

改源码后本地重编：`npm run build`（需 Node + `npm i`）。

## 错误码（常见）

| code | 含义 |
|------|------|
| `NOT_INSTALLED` | 未装扩展或未 announce |
| `PROFILE_MISMATCH` | profile / extensionId 不符 |
| `TIMEOUT` | SDK 侧超时 |
| `EXTENSION_RELOADED` | 扩展热更，需刷新页面 |
