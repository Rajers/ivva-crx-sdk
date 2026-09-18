// src/index.js
var SOURCE_WEB = "ivva-web";
var SOURCE_CRX = "ivva-crx";
var PROTOCOL_V = 1;
var COMMAND_ALIASES = {
  setIvvaToken: "auth.setToken",
  getChanneLoginStatus: "channel.loginStatus",
  getChannePositionStatus: "position.channelStatus",
  updateChannePositionStatus: "position.channelStatus",
  uploadChannePositionStatus: "position.channelStatus",
  refresh: "position.channelStatus",
  toPositonDetail: "position.openExternal",
  toPositionDetail: "position.openExternal",
  openSidePanel: "sf.openSidePanel",
  openPanel: "sf.openSidePanel",
  sidePanel: "sf.openSidePanel",
  positionRelease: "position.publish",
  positionUpdate: "position.publish",
  positionUpload: "position.publish",
  updatePlugin: "crx.updatePlugin"
};
var DEFAULT_TIMEOUT_MS = {
  "auth.setToken": 15e3,
  "channel.loginStatus": 6e4,
  "position.channelStatus": 18e4,
  "position.openExternal": 6e4,
  "sf.openSidePanel": 15e3,
  "position.publish": 6e5,
  "crx.getCapabilities": 8e3,
  "crx.updatePlugin": 12e4,
  default: 15e3
};
function normalizeCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) return "";
  return COMMAND_ALIASES[raw] || raw;
}
function newTaskId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
var IvvaCrxError = class extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, action?: string, envelope?: object }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = "IvvaCrxError";
    this.code = opts.code || "REQUEST_FAIL";
    this.action = opts.action || "retry";
    this.envelope = opts.envelope || null;
  }
};
function createClient(options = {}) {
  var _a;
  const profile = options.profile;
  const expectedExtensionId = options.expectedExtensionId || "";
  const defaultTimeoutMs = options.timeoutMs;
  const readyTimeoutMs = (_a = options.readyTimeoutMs) != null ? _a : 8e3;
  const pending = /* @__PURE__ */ new Map();
  let cachedCaps = null;
  let announceWaiters = [];
  let listening = false;
  let memoryToken = null;
  function ensureListener() {
    if (listening || typeof window === "undefined") return;
    listening = true;
    window.addEventListener("message", (event) => {
      var _a2, _b, _c;
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || msg.source !== SOURCE_CRX) return;
      if (msg.event === "announce" && msg.data) {
        cachedCaps = {
          ...msg.data,
          extensionId: msg.extensionId || msg.data.extensionId
        };
        const waiters = announceWaiters;
        announceWaiters = [];
        waiters.forEach((w) => w(cachedCaps));
        return;
      }
      if (!msg.taskId) return;
      const p = pending.get(msg.taskId);
      if (!p) return;
      if (msg.event === "progress") {
        if (p.timeoutMs > 0) {
          clearTimeout(p.timer);
          p.timer = setTimeout(() => {
            pending.delete(msg.taskId);
            p.reject(
              new IvvaCrxError(`crx timeout: ${p.type}`, {
                code: "TIMEOUT",
                action: "retry"
              })
            );
          }, p.timeoutMs);
        }
        return;
      }
      if (msg.event === "done" && msg.data && typeof msg.data === "object" && msg.data.accepted === true && msg.data.detached === true && msg.data.final !== true) {
        p.detachAck = msg;
        if (p.timeoutMs > 0) {
          clearTimeout(p.timer);
          p.timer = setTimeout(() => {
            pending.delete(msg.taskId);
            p.resolve(p.detachAck || msg);
          }, p.timeoutMs);
        }
        return;
      }
      clearTimeout(p.timer);
      pending.delete(msg.taskId);
      if (msg.event === "fail") {
        p.reject(
          new IvvaCrxError(((_a2 = msg.error) == null ? void 0 : _a2.message) || `crx fail: ${p.type}`, {
            code: ((_b = msg.error) == null ? void 0 : _b.code) || "FAIL",
            action: ((_c = msg.error) == null ? void 0 : _c.action) || "retry",
            envelope: msg
          })
        );
        return;
      }
      p.resolve(msg);
    });
  }
  function pingAnnounce() {
    try {
      window.dispatchEvent(new Event("ivva-crx-ping-announce"));
    } catch (_) {
    }
  }
  function ready(waitMs = readyTimeoutMs) {
    ensureListener();
    if (cachedCaps) {
      assertProfile(cachedCaps);
      return Promise.resolve(cachedCaps);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        announceWaiters = announceWaiters.filter((w) => w !== onCap);
        reject(
          new IvvaCrxError("\u672A\u68C0\u6D4B\u5230\u62DB\u8058\u52A9\u624B\u6269\u5C55\uFF0C\u8BF7\u5B89\u88C5\u6216\u5237\u65B0\u9875\u9762", {
            code: "NOT_INSTALLED",
            action: "upgrade"
          })
        );
      }, waitMs);
      const onCap = (caps) => {
        clearTimeout(timer);
        try {
          assertProfile(caps);
          resolve(caps);
        } catch (e) {
          reject(e);
        }
      };
      announceWaiters.push(onCap);
      pingAnnounce();
    });
  }
  function assertProfile(caps) {
    if (!caps) {
      throw new IvvaCrxError("\u6269\u5C55\u672A\u5C31\u7EEA", { code: "NOT_INSTALLED", action: "upgrade" });
    }
    if (expectedExtensionId && caps.extensionId && caps.extensionId !== expectedExtensionId) {
      throw new IvvaCrxError(
        `\u6269\u5C55 id \u4E0D\u5339\u914D\uFF1A\u671F\u671B ${expectedExtensionId}\uFF0C\u5B9E\u9645 ${caps.extensionId}`,
        { code: "PROFILE_MISMATCH", action: "none" }
      );
    }
    if (profile && caps.profile && caps.profile !== profile) {
      throw new IvvaCrxError(
        `\u6269\u5C55\u73AF\u5883\u4E0D\u5339\u914D\uFF1A\u671F\u671B profile=${profile}\uFF0C\u5B9E\u9645 ${caps.profile}`,
        { code: "PROFILE_MISMATCH", action: "none" }
      );
    }
  }
  async function getCapabilities() {
    const caps = await ready();
    try {
      const env = await invoke("crx.getCapabilities", {}, { timeoutMs: 8e3 });
      if ((env == null ? void 0 : env.event) === "done" && env.data && typeof env.data === "object") {
        cachedCaps = { ...caps, ...env.data };
        return cachedCaps;
      }
    } catch (_) {
    }
    return caps;
  }
  async function setToken(token) {
    memoryToken = token == null ? null : String(token);
    return invoke("auth.setToken", { token: memoryToken || "" });
  }
  function getToken() {
    return memoryToken;
  }
  function invoke(command, payload = {}, opts = {}) {
    var _a2, _b, _c;
    ensureListener();
    const type = normalizeCommand(command);
    if (!type) {
      return Promise.reject(
        new IvvaCrxError("command \u4E0D\u80FD\u4E3A\u7A7A", { code: "BAD_REQUEST", action: "none" })
      );
    }
    const timeoutMs = (_c = (_b = (_a2 = opts.timeoutMs) != null ? _a2 : defaultTimeoutMs) != null ? _b : DEFAULT_TIMEOUT_MS[type]) != null ? _c : DEFAULT_TIMEOUT_MS.default;
    let safePayload = {};
    try {
      safePayload = payload ? JSON.parse(JSON.stringify(payload)) : {};
    } catch (e) {
      return Promise.reject(
        new IvvaCrxError(`payload \u65E0\u6CD5\u5E8F\u5217\u5316: ${(e == null ? void 0 : e.message) || e}`, {
          code: "BAD_REQUEST",
          action: "none"
        })
      );
    }
    if (type === "position.channelStatus" && !safePayload.action && (command === "updateChannePositionStatus" || command === "uploadChannePositionStatus")) {
      safePayload.action = "update";
    } else if (type === "position.channelStatus" && !safePayload.action && command === "refresh") {
      safePayload.action = "refresh";
    } else if (type === "position.channelStatus" && !safePayload.action && command === "getChannePositionStatus") {
      safePayload.action = "get";
    }
    const taskId = newTaskId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(taskId);
        reject(
          new IvvaCrxError(`crx timeout: ${type}`, {
            code: "TIMEOUT",
            action: "retry"
          })
        );
      }, timeoutMs);
      pending.set(taskId, { resolve, reject, timer, type, timeoutMs });
      window.postMessage(
        {
          source: SOURCE_WEB,
          v: PROTOCOL_V,
          taskId,
          type,
          event: "start",
          payload: safePayload
        },
        "*"
      );
    });
  }
  function publish(positionIdOrPayload, opts) {
    const payload = typeof positionIdOrPayload === "object" && positionIdOrPayload ? positionIdOrPayload : { positionId: positionIdOrPayload };
    return invoke("position.publish", payload, opts);
  }
  return {
    ready,
    getCapabilities,
    setToken,
    getToken,
    invoke,
    publish,
    normalizeCommand
  };
}
var index_default = { createClient, normalizeCommand, COMMAND_ALIASES, DEFAULT_TIMEOUT_MS, IvvaCrxError };
export {
  COMMAND_ALIASES,
  DEFAULT_TIMEOUT_MS,
  IvvaCrxError,
  IvvaCrxError as SfCrxError,
  createClient,
  index_default as default,
  normalizeCommand
};
//# sourceMappingURL=ivva-crx-sdk.js.map
