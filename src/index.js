/**
 * @ivva/ivva-crx-sdk — 客户页唯一对接入口
 * 协议：window.postMessage ↔ 扩展 Content Script（ivva-web / ivva-crx）
 * 不做页面业务注入；UI 与执行在 CRX。
 */

const SOURCE_WEB = 'ivva-web'
const SOURCE_CRX = 'ivva-crx'
const PROTOCOL_V = 1

/** @type {Record<string, string>} */
export const COMMAND_ALIASES = {
  setIvvaToken: 'auth.setToken',
  getChanneLoginStatus: 'channel.loginStatus',
  getChannePositionStatus: 'position.channelStatus',
  updateChannePositionStatus: 'position.channelStatus',
  uploadChannePositionStatus: 'position.channelStatus',
  refresh: 'position.channelStatus',
  toPositonDetail: 'position.openExternal',
  toPositionDetail: 'position.openExternal',
  openSidePanel: 'sf.openSidePanel',
  openPanel: 'sf.openSidePanel',
  sidePanel: 'sf.openSidePanel',
  positionRelease: 'position.publish',
  positionUpdate: 'position.publish',
  positionUpload: 'position.publish',
  updatePlugin: 'crx.updatePlugin',
}

/** @type {Record<string, number>} */
export const DEFAULT_TIMEOUT_MS = {
  'auth.setToken': 15000,
  'channel.loginStatus': 60000,
  'position.channelStatus': 180000,
  'position.openExternal': 60000,
  'sf.openSidePanel': 15000,
  'position.publish': 600000,
  'crx.getCapabilities': 8000,
  'crx.updatePlugin': 120000,
  default: 15000,
}

/**
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
  const raw = String(command || '').trim()
  if (!raw) return ''
  return COMMAND_ALIASES[raw] || raw
}

function newTaskId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/**
 * @param {unknown} err
 * @param {object} [envelope]
 */
export class IvvaCrxError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, action?: string, envelope?: object }} [opts]
   */
  constructor(message, opts = {}) {
    super(message)
    this.name = 'IvvaCrxError'
    this.code = opts.code || 'REQUEST_FAIL'
    this.action = opts.action || 'retry'
    this.envelope = opts.envelope || null
  }
}

/**
 * @typedef {object} CreateClientOptions
 * @property {'sf-test'|'sf'|string} [profile] 期望的扩展分包；与 announce.profile 不一致则报错
 * @property {string} [expectedExtensionId] 可选，强制校验 extensionId
 * @property {number} [timeoutMs] 默认超时（可被命令表覆盖）
 * @property {number} [readyTimeoutMs] ready() 等待 announce 超时，默认 8000
 */

/**
 * @param {CreateClientOptions} [options]
 */
export function createClient(options = {}) {
  const profile = options.profile
  const expectedExtensionId = options.expectedExtensionId || ''
  const defaultTimeoutMs = options.timeoutMs
  const readyTimeoutMs = options.readyTimeoutMs ?? 8000

  /** @type {Map<string, any>} */
  const pending = new Map()
  /** @type {object|null} */
  let cachedCaps = null
  /** @type {Array<(c: object|null) => void>} */
  let announceWaiters = []
  let listening = false
  /** @type {string|null} */
  let memoryToken = null

  function ensureListener() {
    if (listening || typeof window === 'undefined') return
    listening = true
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const msg = event.data
      if (!msg || msg.source !== SOURCE_CRX) return

      if (msg.event === 'announce' && msg.data) {
        cachedCaps = {
          ...msg.data,
          extensionId: msg.extensionId || msg.data.extensionId,
        }
        const waiters = announceWaiters
        announceWaiters = []
        waiters.forEach((w) => w(cachedCaps))
        return
      }

      if (!msg.taskId) return
      const p = pending.get(msg.taskId)
      if (!p) return

      if (msg.event === 'progress') {
        if (p.timeoutMs > 0) {
          clearTimeout(p.timer)
          p.timer = setTimeout(() => {
            pending.delete(msg.taskId)
            p.reject(
              new IvvaCrxError(`crx timeout: ${p.type}`, {
                code: 'TIMEOUT',
                action: 'retry',
              }),
            )
          }, p.timeoutMs)
        }
        return
      }

      // detach 首包：继续等
      if (
        msg.event === 'done' &&
        msg.data &&
        typeof msg.data === 'object' &&
        msg.data.accepted === true &&
        msg.data.detached === true &&
        msg.data.final !== true
      ) {
        p.detachAck = msg
        if (p.timeoutMs > 0) {
          clearTimeout(p.timer)
          p.timer = setTimeout(() => {
            pending.delete(msg.taskId)
            // 无 final 时把 detach ack 当作结果（兼容旧路径）
            p.resolve(p.detachAck || msg)
          }, p.timeoutMs)
        }
        return
      }

      clearTimeout(p.timer)
      pending.delete(msg.taskId)
      if (msg.event === 'fail') {
        p.reject(
          new IvvaCrxError(msg.error?.message || `crx fail: ${p.type}`, {
            code: msg.error?.code || 'FAIL',
            action: msg.error?.action || 'retry',
            envelope: msg,
          }),
        )
        return
      }
      p.resolve(msg)
    })
  }

  function pingAnnounce() {
    try {
      window.dispatchEvent(new Event('ivva-crx-ping-announce'))
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * @param {number} [waitMs]
   * @returns {Promise<object>}
   */
  function ready(waitMs = readyTimeoutMs) {
    ensureListener()
    if (cachedCaps) {
      assertProfile(cachedCaps)
      return Promise.resolve(cachedCaps)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        announceWaiters = announceWaiters.filter((w) => w !== onCap)
        reject(
          new IvvaCrxError('未检测到招聘助手扩展，请安装或刷新页面', {
            code: 'NOT_INSTALLED',
            action: 'upgrade',
          }),
        )
      }, waitMs)
      const onCap = (caps) => {
        clearTimeout(timer)
        try {
          assertProfile(caps)
          resolve(caps)
        } catch (e) {
          reject(e)
        }
      }
      announceWaiters.push(onCap)
      pingAnnounce()
    })
  }

  /**
   * @param {object|null} caps
   */
  function assertProfile(caps) {
    if (!caps) {
      throw new IvvaCrxError('扩展未就绪', { code: 'NOT_INSTALLED', action: 'upgrade' })
    }
    if (expectedExtensionId && caps.extensionId && caps.extensionId !== expectedExtensionId) {
      throw new IvvaCrxError(
        `扩展 id 不匹配：期望 ${expectedExtensionId}，实际 ${caps.extensionId}`,
        { code: 'PROFILE_MISMATCH', action: 'none' },
      )
    }
    if (profile && caps.profile && caps.profile !== profile) {
      throw new IvvaCrxError(
        `扩展环境不匹配：期望 profile=${profile}，实际 ${caps.profile}`,
        { code: 'PROFILE_MISMATCH', action: 'none' },
      )
    }
  }

  /**
   * @returns {Promise<object>}
   */
  async function getCapabilities() {
    const caps = await ready()
    try {
      const env = await invoke('crx.getCapabilities', {}, { timeoutMs: 8000 })
      if (env?.event === 'done' && env.data && typeof env.data === 'object') {
        cachedCaps = { ...caps, ...env.data }
        return cachedCaps
      }
    } catch (_) {
      /* 用 announce 即可 */
    }
    return caps
  }

  /**
   * @param {string} token
   */
  async function setToken(token) {
    memoryToken = token == null ? null : String(token)
    return invoke('auth.setToken', { token: memoryToken || '' })
  }

  function getToken() {
    return memoryToken
  }

  /**
   * 等待终态（忽略 progress）
   * @param {string} command
   * @param {Record<string, unknown>} [payload]
   * @param {{ timeoutMs?: number }} [opts]
   */
  function invoke(command, payload = {}, opts = {}) {
    ensureListener()
    const type = normalizeCommand(command)
    if (!type) {
      return Promise.reject(
        new IvvaCrxError('command 不能为空', { code: 'BAD_REQUEST', action: 'none' }),
      )
    }

    const timeoutMs =
      opts.timeoutMs ??
      defaultTimeoutMs ??
      DEFAULT_TIMEOUT_MS[type] ??
      DEFAULT_TIMEOUT_MS.default

    let safePayload = {}
    try {
      safePayload = payload ? JSON.parse(JSON.stringify(payload)) : {}
    } catch (e) {
      return Promise.reject(
        new IvvaCrxError(`payload 无法序列化: ${e?.message || e}`, {
          code: 'BAD_REQUEST',
          action: 'none',
        }),
      )
    }

    // 旧别名 → channelStatus 时补 action
    if (
      type === 'position.channelStatus' &&
      !safePayload.action &&
      (command === 'updateChannePositionStatus' ||
        command === 'uploadChannePositionStatus')
    ) {
      safePayload.action = 'update'
    } else if (type === 'position.channelStatus' && !safePayload.action && command === 'refresh') {
      safePayload.action = 'refresh'
    } else if (
      type === 'position.channelStatus' &&
      !safePayload.action &&
      command === 'getChannePositionStatus'
    ) {
      safePayload.action = 'get'
    }

    const taskId = newTaskId()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(taskId)
        reject(
          new IvvaCrxError(`crx timeout: ${type}`, {
            code: 'TIMEOUT',
            action: 'retry',
          }),
        )
      }, timeoutMs)

      pending.set(taskId, { resolve, reject, timer, type, timeoutMs })

      window.postMessage(
        {
          source: SOURCE_WEB,
          v: PROTOCOL_V,
          taskId,
          type,
          event: 'start',
          payload: safePayload,
        },
        '*',
      )
    })
  }

  /** 语法糖：职位发布 */
  function publish(positionIdOrPayload, opts) {
    const payload =
      typeof positionIdOrPayload === 'object' && positionIdOrPayload
        ? positionIdOrPayload
        : { positionId: positionIdOrPayload }
    return invoke('position.publish', payload, opts)
  }

  return {
    ready,
    getCapabilities,
    setToken,
    getToken,
    invoke,
    publish,
    normalizeCommand,
  }
}

export default { createClient, normalizeCommand, COMMAND_ALIASES, DEFAULT_TIMEOUT_MS, IvvaCrxError }

/** @deprecated 旧名兼容 */
export { IvvaCrxError as SfCrxError }
