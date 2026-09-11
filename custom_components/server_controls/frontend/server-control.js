// Server Controls panel.
//
// Restores the /hassio/system page that was removed from the Home Assistant
// frontend. Ported from home-assistant/frontend hassio/src/system/* at release
// 20251201.0. The Supervisor endpoints used by that page still exist; only the
// panel was removed.
//
// Only <ha-card> and the vendored <mwc-button> are used as custom elements.
// Everything else from the original page (<ha-settings-row>, <ha-bar>,
// <ha-ansi-to-html>, <ha-select>, <ha-button-menu>, dialogs) is rendered as
// plain HTML/CSS using the HA theme variables, because those components are
// lazy loaded by the frontend and are not guaranteed to be registered when a
// custom panel mounts.

import { LitElement, html, css } from "./lit-all.min.js";

// Version stamp — logged on every load. If you don't see this exact string in
// the browser console after refreshing the panel, the browser is serving a
// cached older file. Bump the date suffix any time you want to verify a fresh
// deploy.
console.info("[server-control] panel module loaded — build 2026-09-10-layout");

// HA's frontend has already registered some Material Web Components by the time
// our custom panel loads. Our bundled mwc-button.js inlines its own copies of
// those deps and would throw "already been used" on customElements.define().
// Wrap define() to skip duplicates; mwc-button itself will register cleanly.
const _origDefine = customElements.define.bind(customElements);
customElements.define = function (name, ...rest) {
  try {
    return _origDefine(name, ...rest);
  } catch (e) {
    if (String(e).includes("already been used")) return;
    throw e;
  }
};

// ============================================================================
// ANSI -> DOM parser  (faithful port of ha-ansi-to-html.ts parseLineToColoredPre)
// ============================================================================

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\[(.*?)[@-~]|\].*?(?:\x07|\x1b\\))/g;

function parseAnsiToFragment(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;

  const lines = text.split("\n");
  for (const line of lines) {
    const lineDiv = document.createElement("div");
    let i = 0;
    let match;
    const state = {
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      foregroundColor: null,
      backgroundColor: null,
    };

    const addPart = (content) => {
      const span = document.createElement("span");
      if (state.bold) span.classList.add("bold");
      if (state.italic) span.classList.add("italic");
      if (state.underline) span.classList.add("underline");
      if (state.strikethrough) span.classList.add("strikethrough");
      if (state.foregroundColor !== null)
        span.classList.add(`fg-${state.foregroundColor}`);
      if (state.backgroundColor !== null)
        span.classList.add(`bg-${state.backgroundColor}`);
      span.appendChild(document.createTextNode(content));
      lineDiv.appendChild(span);
    };

    const re = new RegExp(ANSI_RE.source, "g");
    while ((match = re.exec(line)) !== null) {
      const j = match.index;
      const sub = line.substring(i, j);
      if (sub) addPart(sub);
      i = j + match[0].length;
      if (match[1] === undefined) continue;
      match[1].split(";").forEach((cc) => {
        switch (parseInt(cc, 10)) {
          case 0: state.bold = false; state.italic = false; state.underline = false; state.strikethrough = false; state.foregroundColor = null; state.backgroundColor = null; break;
          case 1: state.bold = true; break;
          case 3: state.italic = true; break;
          case 4: state.underline = true; break;
          case 9: state.strikethrough = true; break;
          case 22: state.bold = false; break;
          case 23: state.italic = false; break;
          case 24: state.underline = false; break;
          case 29: state.strikethrough = false; break;
          case 30: state.foregroundColor = null; break;
          case 31: state.foregroundColor = "red"; break;
          case 32: state.foregroundColor = "green"; break;
          case 33: state.foregroundColor = "yellow"; break;
          case 34: state.foregroundColor = "blue"; break;
          case 35: state.foregroundColor = "magenta"; break;
          case 36: state.foregroundColor = "cyan"; break;
          case 37: state.foregroundColor = "white"; break;
          case 39: state.foregroundColor = null; break;
          case 40: state.backgroundColor = "black"; break;
          case 41: state.backgroundColor = "red"; break;
          case 42: state.backgroundColor = "green"; break;
          case 43: state.backgroundColor = "yellow"; break;
          case 44: state.backgroundColor = "blue"; break;
          case 45: state.backgroundColor = "magenta"; break;
          case 46: state.backgroundColor = "cyan"; break;
          case 47: state.backgroundColor = "white"; break;
          case 49: state.backgroundColor = null; break;
        }
      });
    }
    const tail = line.substring(i);
    if (tail) addPart(tail);
    frag.appendChild(lineDiv);
  }
  return frag;
}

// ============================================================================
// Helpers
// ============================================================================

function bytesToString(value, decimals = 2) {
  // Faithful port of src/util/bytes-to-string.ts:
  //   bytesToString(0) → "0 Bytes"
  //   parseFloat strips trailing zeros from .toFixed (e.g. "1.50" → 1.5)
  //   supports the full SI ladder up to YB
  if (value == null || value === 0) return "0 Bytes";
  const k = 1024;
  const d = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / k ** i).toFixed(d))} ${sizes[i]}`;
}

function roundOneDecimal(n) {
  return Math.round((n || 0) * 10) / 10;
}

function extractApiErrorMessage(err) {
  if (typeof err === "object" && err !== null) {
    if (typeof err.body === "object" && err.body)
      return err.body.message || "Unknown error, see supervisor logs";
    return err.body || err.message || String(err);
  }
  return String(err);
}

const IGNORED_STATUS = new Set([502, 503, 504]);
function ignoreSupervisorError(err) {
  if (err && err.status_code && IGNORED_STATUS.has(err.status_code)) return true;
  if (
    err && err.message &&
    (err.message.includes("ERR_CONNECTION_CLOSED") ||
     err.message.includes("ERR_CONNECTION_RESET"))
  ) return true;
  return false;
}

const LOG_PROVIDERS = [
  { key: "supervisor", name: "Supervisor" },
  { key: "core",       name: "Core" },
  { key: "host",       name: "Host" },
  { key: "dns",        name: "DNS" },
  { key: "audio",      name: "Audio" },
  { key: "multicast",  name: "Multicast" },
];

// localStorage key for the static-ish supervisor data (versions, hostname, IP,
// OS info). Stats and logs are NEVER cached — they always fetch fresh because
// they change continuously. Bump the suffix if the cached shape ever changes.
const CACHE_KEY = "ha-server-control-cache-v1";

// ============================================================================
// Panel element
// ============================================================================

class HaPanelServerControl extends LitElement {
  static get properties() {
    return {
      hass:             { attribute: false },
      narrow:           { type: Boolean },
      route:            { attribute: false },
      panel:            { attribute: false },
      _coreInfo:        { state: true },
      _supervisorInfo:  { state: true },
      _hostInfo:        { state: true },
      _osInfo:          { state: true },
      _info:            { state: true },
      _networkInfo:     { state: true },
      _coreStats:       { state: true },
      _supervisorStats: { state: true },
      _logProvider:     { state: true },
      _logContent:      { state: true },
      _logError:        { state: true },
      _logMenuOpen:     { state: true },
      _hostMenuOpen:    { state: true },
      _hardwareDialog:  { state: true },
      _datadiskDialog:  { state: true },
      _expandedDevices: { state: true },
      _hwFilter:        { state: true },
      _datadiskTarget:  { state: true },
      _datadiskMoving:  { state: true },
      _busy:            { state: true },
      _actionResult:    { state: true },
      _loadError:       { state: true },
    };
  }

  constructor() {
    super();
    this._logProvider = "supervisor";
    this._logContent = undefined;
    this._logsCache = {};
    this._logMenuOpen = false;
    this._hostMenuOpen = false;
    this._hardwareDialog = null;
    this._datadiskDialog = null;
    this._expandedDevices = new Set();
    this._hwFilter = "";
    this._datadiskTarget = null;
    this._datadiskMoving = false;
    this._ddSelectOpen = false;
    this._busy = {};
    this._actionResult = {};
    this._loadError = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Click-outside handler: closes any open dropdown when the user clicks
    // outside it. Mirrors how upstream's <ha-select>/<ha-button-menu> auto-close.
    this._onWindowClick = (e) => {
      if (
        !this._logMenuOpen &&
        !this._hostMenuOpen &&
        !this._ddSelectOpen
      )
        return;
      const path = e.composedPath();
      if (this._logMenuOpen) {
        const dropdown = this.renderRoot?.querySelector(".ha-select-host");
        if (dropdown && !path.includes(dropdown)) this._logMenuOpen = false;
      }
      if (this._hostMenuOpen) {
        const hostMenu = this.renderRoot?.querySelector(".host-menu-host");
        if (hostMenu && !path.includes(hostMenu)) this._hostMenuOpen = false;
      }
      if (this._ddSelectOpen) {
        const ddSel = this.renderRoot?.querySelector(".ha-dd-select-host");
        if (ddSel && !path.includes(ddSel)) this._ddSelectOpen = false;
      }
    };
    // Escape key: close the topmost dialog/menu (matches HA dialog behavior).
    this._onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (this._datadiskDialog && !this._datadiskMoving) {
        this._closeDatadiskDialog();
      } else if (this._hardwareDialog !== null) {
        this._closeHardwareDialog();
      } else if (this._hostMenuOpen) {
        this._hostMenuOpen = false;
      } else if (this._logMenuOpen) {
        this._logMenuOpen = false;
      }
    };
    window.addEventListener("click", this._onWindowClick);
    window.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onWindowClick) {
      window.removeEventListener("click", this._onWindowClick);
    }
    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
    }
  }

  // HA attaches the element to the DOM BEFORE setting the `hass` property,
  // so connectedCallback is too early — this.hass is still undefined there.
  // Wait for the first reactive update where hass becomes defined, then load.
  willUpdate(changedProps) {
    super.willUpdate(changedProps);
    if (
      changedProps.has("hass") &&
      this.hass &&
      !this._initialLoadStarted
    ) {
      this._initialLoadStarted = true;
      // Paint cached values immediately so the cards aren't blank for a second.
      this._loadFromCache();
      // Then fetch fresh data in the background — when it arrives, the cards
      // re-render with current values.
      this._loadAll();
    }
  }

  // ---- Cache (static-ish values only) -------------------------------------

  _loadFromCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c._coreInfo)       this._coreInfo = c._coreInfo;
      if (c._supervisorInfo) this._supervisorInfo = c._supervisorInfo;
      if (c._hostInfo)       this._hostInfo = c._hostInfo;
      if (c._osInfo)         this._osInfo = c._osInfo;
      if (c._info)           this._info = c._info;
      if (c._networkInfo)    this._networkInfo = c._networkInfo;
      // Restore per-provider log cache. Logs are large but append-only —
      // showing slightly-stale content immediately is far better than a
      // spinner. Fresh content arrives in the background and replaces it.
      if (c._logs && typeof c._logs === "object") {
        this._logsCache = c._logs;
        const cached = this._logsCache[this._logProvider];
        if (cached && typeof cached.content === "string") {
          this._logContent = cached.content;
        }
      }
    } catch (_) { /* ignore corrupt cache */ }
  }

  _saveCache() {
    try {
      // Cap each cached log to last 128KB so the whole cache stays well
      // under localStorage's ~5MB-per-origin quota even with many providers.
      const LOG_CAP = 128 * 1024;
      const trimmedLogs = {};
      if (this._logsCache && typeof this._logsCache === "object") {
        for (const [provider, entry] of Object.entries(this._logsCache)) {
          if (!entry || typeof entry.content !== "string") continue;
          trimmedLogs[provider] = {
            content:
              entry.content.length > LOG_CAP
                ? entry.content.slice(-LOG_CAP)
                : entry.content,
            timestamp: entry.timestamp || Date.now(),
          };
        }
      }
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        _coreInfo:       this._coreInfo,
        _supervisorInfo: this._supervisorInfo,
        _hostInfo:       this._hostInfo,
        _osInfo:         this._osInfo,
        _info:           this._info,
        _networkInfo:    this._networkInfo,
        _logs:           trimmedLogs,
      }));
    } catch (_) { /* quota or disabled storage — non-fatal */ }
  }

  // ---- Supervisor API helpers ---------------------------------------------

  _supervisorWS(endpoint, method = "get", data, timeout) {
    const msg = { type: "supervisor/api", endpoint, method };
    if (data !== undefined) msg.data = data;
    if (timeout !== undefined) msg.timeout = timeout;
    return this.hass.callWS(msg);
  }

  async _loadAll() {
    this._loadError = null;
    const calls = [
      ["_coreInfo",         "/core/info"],
      ["_supervisorInfo",   "/supervisor/info"],
      ["_hostInfo",         "/host/info"],
      ["_osInfo",           "/os/info"],
      ["_info",             "/info"],
      ["_networkInfo",      "/network/info"],
      ["_coreStats",        "/core/stats"],
      ["_supervisorStats",  "/supervisor/stats"],
    ];
    const results = await Promise.allSettled(
      calls.map(([, ep]) => this._supervisorWS(ep))
    );
    let allFailed = true;
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        this[calls[idx][0]] = r.value;
        allFailed = false;
      }
    });
    if (allFailed) {
      this._loadError =
        "Failed to load supervisor data. The supervisor API may be unreachable.";
    } else {
      // Persist fresh static-ish values for instant repaint on next visit.
      this._saveCache();
    }
    this._loadLogs();
  }

  async _loadLogs() {
    this._logError = null;
    try {
      const provider = this._logProvider;
      const path = provider.includes("_")
        ? `hassio/addons/${provider}/logs`
        : `hassio/${provider}/logs`;
      const resp = await this.hass.callApiRaw("GET", path);
      const content = await resp.text();
      this._logContent = content;
      // Persist per-provider so next visit shows logs instantly. Fresh
      // fetch still happens in the background then; that's fine — append-
      // only logs only ever gain entries, and stale-while-revalidate is
      // strictly better UX than a spinner on every page load.
      this._logsCache = this._logsCache || {};
      this._logsCache[provider] = { content, timestamp: Date.now() };
      this._saveCache();
    } catch (err) {
      this._logError = `Failed to fetch ${this._logProvider} logs: ${extractApiErrorMessage(err)}`;
      // Don't blank out _logContent on error — keep showing whatever
      // cached content we already had. The error banner above the log
      // makes it clear the data may be stale.
      if (this._logContent === undefined) this._logContent = "";
    }
  }

  // ---- Action runner -------------------------------------------------------

  async _runAction(actionKey, asyncFn) {
    this._busy = { ...this._busy, [actionKey]: true };
    this._actionResult = { ...this._actionResult, [actionKey]: null };
    let resultKind = "success";
    try {
      await asyncFn();
    } catch (err) {
      resultKind = "error";
      if (
        this.hass.connection &&
        this.hass.connection.connected &&
        !ignoreSupervisorError(err)
      ) {
        // Use HA themed alert dialog if available, else native alert.
        const title = `${actionKey.replace(/_/g, " ")} failed`;
        const text = extractApiErrorMessage(err);
        if (customElements.get("dialog-box")) {
          this.dispatchEvent(
            new CustomEvent("show-dialog", {
              detail: {
                dialogTag: "dialog-box",
                dialogImport: () =>
                  customElements.whenDefined("dialog-box").then(() => undefined),
                dialogParams: {
                  title,
                  text,
                  confirmText: "OK",
                  confirm: () => {},
                },
                addHistory: true,
              },
              bubbles: true,
              composed: true,
            })
          );
        } else {
          alert(`${title}\n${text}`);
        }
      }
    } finally {
      this._busy = { ...this._busy, [actionKey]: false };
      this._actionResult = { ...this._actionResult, [actionKey]: resultKind };
      // Auto-clear the success/error indicator after 2s, matching upstream
      // <ha-progress-button>'s _setResult timeout.
      setTimeout(() => {
        this._actionResult = { ...this._actionResult, [actionKey]: null };
      }, 2000);
    }
  }

  // ---- HA themed dialog helpers ------------------------------------------
  // HA's root listens for the bubbling "show-dialog" event and renders the
  // requested dialog component. We use it to invoke HA's globally-registered
  // <dialog-box> for confirm and prompt flows, matching upstream's
  // showConfirmationDialog / showPromptDialog from
  // src/dialogs/generic/show-dialog-box.ts.

  // Use HA's built-in dialog-box if available; fall back to native confirm.
  async _confirm(title, text, confirmText = "Confirm", destructive = false) {
    // HA exposes a "show-dialog" event. We dispatch a request for "dialog-box"
    // (HA's generic confirm/prompt component, registered globally). If HA's
    // root doesn't pick it up within a short window we fall back to native.
    const dialogPromise = new Promise((resolve) => {
      let resolved = false;
      const wrapResolve = (v) => {
        if (!resolved) {
          resolved = true;
          resolve(v);
        }
      };
      if (!customElements.get("dialog-box")) {
        wrapResolve(window.confirm(`${title}\n\n${text}`));
        return;
      }
      this.dispatchEvent(
        new CustomEvent("show-dialog", {
          detail: {
            dialogTag: "dialog-box",
            dialogImport: () =>
              customElements.whenDefined("dialog-box").then(() => undefined),
            dialogParams: {
              confirmation: true,
              title,
              text,
              confirmText,
              dismissText: "Cancel",
              destructive,
              confirm: () => wrapResolve(true),
              cancel: () => wrapResolve(false),
            },
            addHistory: true,
          },
          bubbles: true,
          composed: true,
        })
      );
      // If dialog-box isn't registered, customElements.whenDefined() never
      // resolves and the user never sees a dialog. Detect that case after
      // 200ms and fall back to native confirm.
      setTimeout(() => {
        if (resolved) return;
        if (!customElements.get("dialog-box")) {
          wrapResolve(window.confirm(`${title}\n\n${text}`));
        }
      }, 200);
    });
    return dialogPromise;
  }

  async _prompt(title, inputLabel, defaultValue = "") {
    const dialogPromise = new Promise((resolve) => {
      let resolved = false;
      const wrapResolve = (v) => {
        if (!resolved) {
          resolved = true;
          resolve(v);
        }
      };
      if (!customElements.get("dialog-box")) {
        wrapResolve(window.prompt(`${title}\n${inputLabel}`, defaultValue));
        return;
      }
      this.dispatchEvent(
        new CustomEvent("show-dialog", {
          detail: {
            dialogTag: "dialog-box",
            dialogImport: () =>
              customElements.whenDefined("dialog-box").then(() => undefined),
            dialogParams: {
              prompt: true,
              title,
              inputLabel,
              inputType: "string",
              defaultValue,
              confirmText: "Update",
              dismissText: "Cancel",
              confirm: (value) => wrapResolve(value),
              cancel: () => wrapResolve(null),
            },
            addHistory: true,
          },
          bubbles: true,
          composed: true,
        })
      );
      setTimeout(() => {
        if (resolved) return;
        if (!customElements.get("dialog-box")) {
          const v = window.prompt(`${title}\n${inputLabel}`, defaultValue);
          wrapResolve(v);
        }
      }, 200);
    });
    return dialogPromise;
  }

  // ---- Action handlers ----------------------------------------------------

  _restartCore = async () => {
    const ok = await this._confirm(
      "Restart Home Assistant Core?",
      "The interface will disconnect briefly while Core restarts.",
      "Restart",
      true
    );
    if (!ok) return;
    this._runAction("restart_core", () =>
      this.hass.callService("homeassistant", "restart")
    );
  };

  _reloadSupervisor = () => {
    this._runAction("reload_supervisor", async () => {
      await this._supervisorWS("/supervisor/reload", "post");
      this._supervisorInfo = await this._supervisorWS("/supervisor/info");
    });
  };

  _restartSupervisor = async () => {
    const ok = await this._confirm(
      "Restart Supervisor?",
      "Add-ons will continue running but the supervisor itself will restart.",
      "Restart",
      true
    );
    if (!ok) return;
    this._runAction("restart_supervisor", () =>
      this._supervisorWS("/supervisor/restart", "post", undefined, null)
    );
  };

  _rebootHost = async () => {
    const ok = await this._confirm(
      "Reboot host?",
      "This will reboot the entire physical/virtual machine running Home Assistant.",
      "Reboot",
      true
    );
    if (!ok) return;
    this._runAction("reboot_host", () =>
      this._supervisorWS("/host/reboot", "post", undefined, null)
    );
  };

  _shutdownHost = async () => {
    const ok = await this._confirm(
      "Shutdown host?",
      "You will need physical/console access to power it back on.",
      "Shutdown",
      true
    );
    if (!ok) return;
    this._runAction("shutdown_host", () =>
      this._supervisorWS("/host/shutdown", "post", undefined, null)
    );
  };

  _changeHostname = async () => {
    const cur = this._hostInfo?.hostname || "";
    const next = await this._prompt(
      "Change hostname",
      "New hostname",
      cur
    );
    if (next == null || next === "" || next === cur) return;
    this._runAction("change_hostname", async () => {
      await this._supervisorWS("/host/options", "post", { hostname: next });
      this._hostInfo = await this._supervisorWS("/host/info");
    });
  };

  _toggleBeta = async () => {
    const cur = this._supervisorInfo?.channel;
    let target;
    if (cur === "beta") {
      target = "stable";
    } else if (cur === "stable") {
      const ok = await this._confirm(
        "Join the beta channel?",
        "This switches the supervisor and add-ons to beta builds. May be unstable. Take a backup first.",
        "Join",
        false
      );
      if (!ok) return;
      target = "beta";
    } else {
      return; // dev channel — no toggle
    }
    this._runAction("toggle_beta", async () => {
      await this._supervisorWS("/supervisor/options", "post", { channel: target });
      await this._supervisorWS("/supervisor/reload", "post");
      this._supervisorInfo = await this._supervisorWS("/supervisor/info");
    });
  };

  _advancedNotice = () => {
    // Fallback for the IP "Change" button — no replacement dialog yet.
    this._showAlert(
      "Change network configuration",
      "Network configuration is only available via the supervisor CLI:\n\n" +
        "  ha network info\n" +
        "  ha network update <interface> --ipv4-method=...\n\n" +
        "Run from a Terminal add-on or SSH session."
    );
  };

  // Themed alert dialog — same fireEvent pattern as _confirm, but no
  // confirmation/prompt flag → renders as a single-button info dialog.
  _showAlert(title, text) {
    if (customElements.get("dialog-box")) {
      this.dispatchEvent(
        new CustomEvent("show-dialog", {
          detail: {
            dialogTag: "dialog-box",
            dialogImport: () =>
              customElements.whenDefined("dialog-box").then(() => undefined),
            dialogParams: {
              title,
              text,
              confirmText: "OK",
              confirm: () => {},
            },
            addHistory: true,
          },
          bubbles: true,
          composed: true,
        })
      );
    } else {
      alert(`${title}\n\n${text}`);
    }
  }

  // Mirrors hassio-host-info's _handleMenuAction. Dispatches by data-action
  // attribute on the ha-list-item that was clicked.
  _handleHostMenuAction = async (ev) => {
    const action =
      ev.currentTarget?.dataset?.action ||
      ev.target?.dataset?.action ||
      ev.target?.action;
    this._hostMenuOpen = false;
    switch (action) {
      case "hardware":
        await this._showHardware();
        break;
      case "import_from_usb":
        await this._importFromUsb();
        break;
      case "move_datadisk":
        await this._moveDatadisk();
        break;
    }
  };

  async _showHardware() {
    let info;
    try {
      info = await this._supervisorWS("/hardware/info");
    } catch (err) {
      this._showAlert(
        "Failed to get hardware list",
        extractApiErrorMessage(err)
      );
      return;
    }
    // Match upstream <dialog-hassio-hardware>: open a structured dialog with
    // search input + expansion panel per device. Done by setting state which
    // triggers our dialog template in render().
    this._hwFilter = "";
    this._expandedDevices = new Set();
    this._hardwareDialog = info?.devices || [];
  }

  async _importFromUsb() {
    // Match upstream <hassio-host-info>._importFromUSB exactly:
    // call the API silently, no success dialog, only show error dialog if
    // the request failed.
    try {
      await this._supervisorWS("/os/config/sync", "post", undefined, null);
      // upstream fires "supervisor-collection-refresh" event so the
      // surrounding panel re-fetches host info. We just refetch directly.
      try {
        this._hostInfo = await this._supervisorWS("/host/info");
      } catch (_) { /* non-fatal */ }
    } catch (err) {
      this._showAlert(
        "Failed to import from USB",
        extractApiErrorMessage(err)
      );
    }
  }

  async _moveDatadisk() {
    let list;
    try {
      list = await this._supervisorWS("/os/datadisk/list");
    } catch (err) {
      this._showAlert(
        "Failed to list data disks",
        extractApiErrorMessage(err)
      );
      return;
    }
    // Match upstream <dialog-hassio-datadisk>: structured dialog with
    // description + ha-select of devices + Cancel/Move buttons.
    this._datadiskTarget = null;
    this._datadiskMoving = false;
    this._datadiskDialog = list || { devices: [], disks: [] };
  }

  _closeHardwareDialog = () => {
    this._hardwareDialog = null;
    this._hwFilter = "";
    this._expandedDevices = new Set();
  };

  _closeDatadiskDialog = () => {
    if (this._datadiskMoving) return; // can't close while moving
    this._datadiskDialog = null;
    this._datadiskTarget = null;
  };

  _toggleDeviceExpand = (devName) => {
    const next = new Set(this._expandedDevices);
    if (next.has(devName)) next.delete(devName);
    else next.add(devName);
    this._expandedDevices = next;
  };

  _onHwFilterChange = (e) => {
    this._hwFilter = e.target.value || "";
  };

  _onDatadiskTargetChange = (device) => {
    this._datadiskTarget = device;
  };

  async _confirmMoveDatadisk() {
    if (!this._datadiskTarget) return;
    this._datadiskMoving = true;
    try {
      await this._supervisorWS(
        "/os/datadisk/move",
        "post",
        { device: this._datadiskTarget },
        null
      );
      // On success the host typically reboots; close the dialog.
      this._datadiskDialog = null;
      this._datadiskTarget = null;
      this._datadiskMoving = false;
    } catch (err) {
      this._datadiskMoving = false;
      // Only show error if connection is still up (matches upstream behavior).
      if (this.hass.connection?.connected && !ignoreSupervisorError(err)) {
        this._showAlert(
          "Failed to move data disk",
          extractApiErrorMessage(err)
        );
        this._datadiskDialog = null;
      }
    }
  }

  _toggleLogMenu = (e) => {
    e.stopPropagation();
    this._logMenuOpen = !this._logMenuOpen;
    if (this._logMenuOpen) this._hostMenuOpen = false;
  };

  _toggleHostMenu = (e) => {
    e.stopPropagation();
    this._hostMenuOpen = !this._hostMenuOpen;
    if (this._hostMenuOpen) this._logMenuOpen = false;
  };

  _selectLogProvider = (key) => {
    this._logProvider = key;
    this._logMenuOpen = false;
    // Show cached log for this provider instantly if we have one — fresh
    // fetch will replace it shortly. Only show the loading spinner if we
    // truly have no prior content to display.
    const cached = this._logsCache && this._logsCache[key];
    if (cached && typeof cached.content === "string") {
      this._logContent = cached.content;
    } else {
      this._logContent = undefined;
    }
    this._loadLogs();
  };

  _refreshLogs = () => {
    this._runAction("refresh_logs", () => this._loadLogs());
  };

  // ---- Render: utility templates ------------------------------------------

  // Mirrors upstream <ha-progress-button>: shows a spinner inside the button
  // while busy, and a green check / red octagon for ~2s after the action
  // completes. The overlay sits on top of the button label using absolute
  // positioning so the button width doesn't change.
  _renderProgressButton({ actionKey, label, classes = "", onClick, title }) {
    const busy = !!this._busy[actionKey];
    const result = this._actionResult?.[actionKey];
    const overlay =
      busy
        ? html`<span class="pb-overlay"
            ><span class="pb-spinner"></span></span>`
        : result === "success"
          ? html`<span class="pb-overlay pb-success"
              ><svg viewBox="0 0 24 24" width="20" height="20"
                ><path
                  fill="currentColor"
                  d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"
                ></path></svg
            ></span>`
          : result === "error"
            ? html`<span class="pb-overlay pb-error"
                ><svg viewBox="0 0 24 24" width="20" height="20"
                  ><path
                    fill="currentColor"
                    d="M2.2 16.06L3.88 12L2.2 7.94l4.06-1.68L7.94 2.2L12 3.88l4.06-1.68l1.68 4.06l4.06 1.68L20.12 12l1.68 4.06l-4.06 1.68l-1.68 4.06L12 20.12l-4.06 1.68l-1.68-4.06zM13 17v-2h-2v2zm0-4V7h-2v6z"
                  ></path></svg
              ></span>`
            : "";
    return html`
      <span class="progress-btn">
        <mwc-button
          raised
          class=${classes}
          ?disabled=${busy || !!result}
          @click=${onClick}
          title=${title || ""}
        >
          <span class="pb-label" ?hidden=${busy || !!result}>${label}</span>
        </mwc-button>
        ${overlay}
      </span>
    `;
  }

  _renderRow(heading, description, action) {
    return html`
      <div class="settings-row">
        <div class="row-text">
          <div class="row-heading">${heading}</div>
          <div class="row-description">${description}</div>
        </div>
        ${action ? html`<div class="row-action">${action}</div>` : ""}
      </div>
    `;
  }

  _renderMetric(description, value, tooltip) {
    const v = roundOneDecimal(value);
    let barCls = "metric-bar";
    if (v > 50) barCls += " warn";
    if (v > 85) barCls += " crit";
    return html`
      <div class="settings-row metric-row">
        <div class="row-heading">${description}</div>
        <div class="metric-content" title=${tooltip || ""}>
          <span class="metric-value">${v} %</span>
          <div class="metric-track">
            <div class=${barCls} style="width: ${Math.min(100, Math.max(0, v))}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Render: cards ------------------------------------------------------

  _renderCoreCard() {
    const c = this._coreInfo || {};
    const m = this._coreStats;
    return html`
      <ha-card outlined header="Core" class="info-card">
        <div class="card-content">
          <div>
            ${this._renderRow("Current version", c.version ? html`core-${c.version}` : "")}
            ${this._renderRow("Newest version", c.version_latest ? html`core-${c.version_latest}` : "")}
          </div>
          <div>
            ${this._renderMetric("CPU usage", m?.cpu_percent)}
            ${this._renderMetric(
              "RAM usage",
              m?.memory_percent,
              m ? `${bytesToString(m.memory_usage)} / ${bytesToString(m.memory_limit)}` : ""
            )}
          </div>
        </div>
        <div class="card-actions info-card-actions actions-end">
          ${this._renderProgressButton({
            actionKey: "restart_core",
            label: "Restart Core",
            classes: "danger",
            onClick: this._restartCore,
            title: "Restart Home Assistant Core",
          })}
        </div>
      </ha-card>
    `;
  }

  _renderSupervisorCard() {
    const s = this._supervisorInfo || {};
    const m = this._supervisorStats;
    let channelAction = null;
    if (s.channel === "beta") {
      channelAction = this._renderProgressButton({
        actionKey: "toggle_beta",
        label: "Leave beta",
        onClick: this._toggleBeta,
        title: "Leave the beta channel",
      });
    } else if (s.channel === "stable") {
      channelAction = this._renderProgressButton({
        actionKey: "toggle_beta",
        label: "Join beta",
        onClick: this._toggleBeta,
        title: "Join the beta channel",
      });
    }
    return html`
      <ha-card outlined header="Supervisor" class="info-card">
        <div class="card-content">
          <div>
            ${this._renderRow("Current version", s.version ? html`supervisor-${s.version}` : "")}
            ${this._renderRow("Newest version", s.version_latest ? html`supervisor-${s.version_latest}` : "")}
            ${this._renderRow("Channel", s.channel || "", channelAction)}
            ${s.supported === false
              ? html`<ha-alert alert-type="warning">Your installation is unsupported.</ha-alert>`
              : ""}
            ${s.healthy === false
              ? html`<ha-alert alert-type="error">Your installation is unhealthy.</ha-alert>`
              : ""}
          </div>
          <div class="metrics-block">
            ${this._renderMetric("CPU usage", m?.cpu_percent)}
            ${this._renderMetric(
              "RAM usage",
              m?.memory_percent,
              m ? `${bytesToString(m.memory_usage)} / ${bytesToString(m.memory_limit)}` : ""
            )}
          </div>
        </div>
        <div class="card-actions info-card-actions actions-between">
          ${this._renderProgressButton({
            actionKey: "reload_supervisor",
            label: "Reload Supervisor",
            onClick: this._reloadSupervisor,
            title: "Reload Supervisor",
          })}
          ${this._renderProgressButton({
            actionKey: "restart_supervisor",
            label: "Restart Supervisor",
            onClick: this._restartSupervisor,
            title: "Restart Supervisor",
          })}
        </div>
      </ha-card>
    `;
  }

  _renderHostCard() {
    const h = this._hostInfo || {};
    const features = h.features || [];
    const isHaos = features.includes("haos");
    const docker = this._info?.docker;
    const primaryIp =
      (this._networkInfo?.interfaces || []).find((i) => i.primary)?.ipv4
        ?.address?.[0] || "";
    const usedSpacePct =
      h.disk_total > 0
        ? roundOneDecimal((h.disk_used / h.disk_total) * 100)
        : 0;
    // When data hasn't loaded yet, render the standard Host card layout
    // (hostname/IP/OS rows present) so the skeleton looks correct. Once
    // _hostInfo arrives, feature flags determine which rows to show.
    const haveData = !!this._hostInfo;

    return html`
      <ha-card outlined header="Host" class="info-card">
        <div class="card-content">
          <div>
            ${!haveData || features.includes("hostname")
              ? this._renderRow(
                  "Hostname",
                  h.hostname || "",
                  html`<mwc-button
                    class="plain small"
                    @click=${this._changeHostname}
                    ?disabled=${!!this._busy.change_hostname}
                  >Change</mwc-button>`
                )
              : ""}
            ${!haveData || features.includes("network")
              ? this._renderRow(
                  "IP address",
                  primaryIp,
                  html`<mwc-button
                    class="plain small"
                    @click=${this._advancedNotice}
                  >Change</mwc-button>`
                )
              : ""}
            ${this._renderRow("Operating System", h.operating_system || "")}
            ${haveData && !isHaos && docker
              ? this._renderRow("Docker version", docker)
              : ""}
            ${h.deployment
              ? this._renderRow("Deployment", h.deployment)
              : ""}
          </div>
          <div>
            ${h.disk_life_time !== null && h.disk_life_time !== undefined
              ? this._renderRow("Lifetime used", `${h.disk_life_time} %`)
              : ""}
            ${this._renderMetric(
              "Used space",
              usedSpacePct,
              haveData ? `${h.disk_used} GB / ${h.disk_total} GB` : ""
            )}
          </div>
        </div>
        <div class="card-actions info-card-actions actions-between">
          ${!haveData || features.includes("reboot")
            ? this._renderProgressButton({
                actionKey: "reboot_host",
                label: "Reboot Host",
                classes: "danger",
                onClick: this._rebootHost,
              })
            : ""}
          ${!haveData || features.includes("shutdown")
            ? this._renderProgressButton({
                actionKey: "shutdown_host",
                label: "Shutdown Host",
                classes: "danger",
                onClick: this._shutdownHost,
              })
            : ""}
          <div class="host-menu-host ${this._hostMenuOpen ? "open" : ""}">
            <button
              class="host-menu-trigger"
              type="button"
              aria-label="More host options"
              aria-haspopup="menu"
              aria-expanded=${this._hostMenuOpen ? "true" : "false"}
              @click=${this._toggleHostMenu}
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path
                  fill="currentColor"
                  d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z"
                ></path>
              </svg>
            </button>
            ${this._hostMenuOpen
              ? html`<div
                  class="host-menu-popover"
                  role="menu"
                  @click=${(e) => e.stopPropagation()}
                >
                  <div
                    class="host-menu-item"
                    role="menuitem"
                    data-action="hardware"
                    @click=${this._handleHostMenuAction}
                  >Hardware</div>
                  ${isHaos
                    ? html`
                        <div
                          class="host-menu-item"
                          role="menuitem"
                          data-action="import_from_usb"
                          @click=${this._handleHostMenuAction}
                        >Import from USB</div>
                        <div
                          class="host-menu-item"
                          role="menuitem"
                          data-action="move_datadisk"
                          @click=${this._handleHostMenuAction}
                        >Move datadisk</div>
                      `
                    : ""}
                </div>`
              : ""}
          </div>
        </div>
      </ha-card>
    `;
  }

  _renderLogCard() {
    return html`
      <ha-card outlined class="log-card">
        ${this._logError
          ? html`<ha-alert alert-type="error">${this._logError}</ha-alert>`
          : ""}
        ${this.hass?.userData?.showAdvanced
          ? html`<div class="log-controls">
          <div class="ha-select-host ${this._logMenuOpen ? "open" : ""}">
            <div class="ha-select-anchor" @click=${this._toggleLogMenu}>
              <label class="ha-select-label">Log provider</label>
              <span class="ha-select-value">${
                LOG_PROVIDERS.find((p) => p.key === this._logProvider)?.name ||
                this._logProvider
              }</span>
              <svg class="ha-select-arrow" viewBox="0 0 24 24" width="24" height="24">
                <path d="M7 10l5 5 5-5z" fill="currentColor"></path>
              </svg>
            </div>
            ${this._logMenuOpen
              ? html`
                  <div class="ha-select-menu" @click=${(e) => e.stopPropagation()}>
                    ${LOG_PROVIDERS.map(
                      (p) => html`
                        <div
                          class="ha-select-item ${p.key === this._logProvider
                            ? "selected"
                            : ""}"
                          @click=${() => this._selectLogProvider(p.key)}
                        >
                          ${p.name}
                        </div>
                      `
                    )}
                  </div>
                `
              : ""}
          </div>
        </div>`
          : ""}
        <div class="card-content log-content">
          ${this._logContent === undefined
            ? html`<div class="loading">Loading logs…</div>`
            : html`<pre class="log-pre"></pre>`}
        </div>
        <div class="card-actions">
          ${this._renderProgressButton({
            actionKey: "refresh_logs",
            label: "Refresh",
            onClick: this._refreshLogs,
          })}
        </div>
      </ha-card>
    `;
  }

  // ---- Lifecycle: post-render DOM update for log content ------------------

  updated(changedProps) {
    super.updated(changedProps);
    // Render parsed ANSI into the <pre> imperatively (matches ha-ansi-to-html
    // which manipulates the DOM directly rather than producing reactive output).
    if (this._logContent !== undefined) {
      const pre = this.renderRoot?.querySelector(".log-pre");
      if (pre) {
        pre.innerHTML = "";
        pre.appendChild(parseAnsiToFragment(this._logContent));
      }
    }
  }

  render() {
    if (!this.hass) return html``;
    return html`
      <div class="page">
        <div class="content">
          ${this._loadError
            ? html`<ha-alert alert-type="error">${this._loadError}</ha-alert>`
            : ""}
          <div class="card-group">
            ${this._renderCoreCard()}
            ${this._renderSupervisorCard()}
            ${this._renderHostCard()}
          </div>
          ${this._renderLogCard()}
        </div>
      </div>
      ${this._hardwareDialog !== null ? this._renderHardwareDialog() : ""}
      ${this._datadiskDialog !== null ? this._renderDatadiskDialog() : ""}
    `;
  }

  // ---- Dialog: Hardware ---------------------------------------------------
  // Faithful port of <dialog-hassio-hardware> from
  //   hassio/src/dialogs/hardware/dialog-hassio-hardware.ts
  // Title "Hardware", search input filters by name/by_id/dev_path/attributes,
  // each device renders as an expansion panel with subsystem, device path,
  // by_id, and YAML-formatted attributes. Click backdrop or X to close.
  _renderHardwareDialog() {
    const filter = (this._hwFilter || "").toLowerCase();
    const all = this._hardwareDialog || [];
    const devices = all
      .filter((d) => {
        if (!filter) return true;
        return (
          (d.by_id || "").toLowerCase().includes(filter) ||
          (d.name || "").toLowerCase().includes(filter) ||
          (d.dev_path || "").toLowerCase().includes(filter) ||
          JSON.stringify(d.attributes || {}).toLowerCase().includes(filter)
        );
      })
      .slice() // don't mutate
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return html`
      <div class="ha-dlg-scrim" @click=${this._closeHardwareDialog}>
        <div class="ha-dlg" @click=${(e) => e.stopPropagation()}
             role="dialog" aria-labelledby="hwdlg-title" aria-modal="true">
          <div class="ha-dlg-header">
            <h2 id="hwdlg-title">Hardware</h2>
            <button
              class="ha-dlg-close"
              aria-label="Close"
              @click=${this._closeHardwareDialog}
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path
                  fill="currentColor"
                  d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
                ></path>
              </svg>
            </button>
            <input
              class="ha-dlg-search"
              type="search"
              placeholder="Search"
              .value=${this._hwFilter || ""}
              @input=${this._onHwFilterChange}
            />
          </div>
          <div class="ha-dlg-content">
            ${devices.map((d) => this._renderDeviceExpansion(d))}
          </div>
        </div>
      </div>
    `;
  }

  _renderDeviceExpansion(d) {
    const expanded = this._expandedDevices.has(d.name);
    return html`
      <div class="ha-exp ${expanded ? "open" : ""}" outlined>
        <div
          class="ha-exp-summary"
          role="button"
          tabindex="0"
          @click=${() => this._toggleDeviceExpand(d.name)}
        >
          <div class="ha-exp-summary-text">
            <div class="ha-exp-header">${d.name}</div>
            ${d.by_id
              ? html`<div class="ha-exp-secondary">${d.by_id}</div>`
              : ""}
          </div>
          <svg class="ha-exp-chevron" viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"
            ></path>
          </svg>
        </div>
        ${expanded
          ? html`<div class="ha-exp-body">
              <div class="device-property">
                <span>Subsystem:</span>
                <span>${d.subsystem || ""}</span>
              </div>
              <div class="device-property">
                <span>Device path:</span>
                <code>${d.dev_path || ""}</code>
              </div>
              ${d.by_id
                ? html`<div class="device-property">
                    <span>ID:</span>
                    <code>${d.by_id}</code>
                  </div>`
                : ""}
              <div class="attributes">
                <span>Attributes:</span>
                <pre>${this._formatAttributes(d.attributes || {})}</pre>
              </div>
            </div>`
          : ""}
      </div>
    `;
  }

  // YAML-ish formatter for attributes (matches upstream's `dump(attrs, {indent:2})`
  // using js-yaml, but we don't have that lib — close enough rendering).
  _formatAttributes(obj) {
    if (!obj || typeof obj !== "object") return String(obj || "");
    const lines = [];
    for (const [k, v] of Object.entries(obj)) {
      lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
    return lines.join("\n");
  }

  // ---- Dialog: Move Data Disk --------------------------------------------
  // Faithful port of <dialog-hassio-datadisk> from
  //   hassio/src/dialogs/datadisk/dialog-hassio-datadisk.ts
  // Title "Move Data Disk", description with current path and ETA, ha-select
  // of devices, Cancel + Move buttons. Spinner shown during move.
  _renderDatadiskDialog() {
    const data = this._datadiskDialog || {};
    const devices = data.devices || [];
    const current = this._osInfo?.data_disk || "(default)";
    // Estimate move time matching upstream: assume 30 MB/s + 4× startup time.
    const usedMB = (this._hostInfo?.disk_used || 0) * 1000;
    const startupS = this._hostInfo?.startup_time || 60;
    const moveTime = Math.ceil((usedMB / 60 / 30 + (startupS * 4) / 60) / 10) * 10;

    return html`
      <div class="ha-dlg-scrim" @click=${this._closeDatadiskDialog}>
        <div class="ha-dlg ha-dlg-narrow"
             @click=${(e) => e.stopPropagation()}
             role="dialog" aria-labelledby="dddlg-title" aria-modal="true">
          <div class="ha-dlg-header">
            <h2 id="dddlg-title">
              ${this._datadiskMoving ? "Moving Data Disk" : "Move Data Disk"}
            </h2>
            ${!this._datadiskMoving
              ? html`<button
                  class="ha-dlg-close"
                  aria-label="Close"
                  @click=${this._closeDatadiskDialog}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24">
                    <path
                      fill="currentColor"
                      d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
                    ></path>
                  </svg>
                </button>`
              : ""}
          </div>
          <div class="ha-dlg-content ha-dlg-content-padded">
            ${this._datadiskMoving
              ? html`
                  <div class="dd-spinner-wrap">
                    <div class="dd-spinner"></div>
                  </div>
                  <p class="dd-progress-text">
                    Home Assistant will restart when the data disk move
                    completes. This may take several minutes.
                  </p>
                `
              : devices.length > 0
                ? html`
                    <p>
                      Currently the data is stored on
                      <code>${current}</code>. Moving will copy the data to a
                      new disk and reboot the host. Estimated time:
                      <strong>${moveTime} minutes</strong>.
                    </p>
                    ${this._renderDatadiskSelect(devices)}
                  `
                : devices.length === 0 && data.devices !== undefined
                  ? html`<p>No additional disks found.</p>`
                  : html`<p>Loading devices...</p>`}
          </div>
          ${!this._datadiskMoving
            ? html`<div class="ha-dlg-actions">
                <mwc-button class="plain" @click=${this._closeDatadiskDialog}
                  >Cancel</mwc-button
                >
                <mwc-button
                  raised
                  ?disabled=${!this._datadiskTarget}
                  @click=${this._confirmMoveDatadisk}
                  >Move</mwc-button
                >
              </div>`
            : ""}
        </div>
      </div>
    `;
  }

  // Custom MDC-style filled select for the datadisk picker (same pattern as
  // the log provider dropdown — works without requiring <ha-select>).
  _renderDatadiskSelect(devices) {
    const open = this._ddSelectOpen;
    return html`
      <div class="ha-select-host ${open ? "open" : ""} ha-dd-select-host">
        <div class="ha-select-anchor" @click=${this._toggleDdSelect}>
          <label class="ha-select-label">Select target device</label>
          <span class="ha-select-value">${this._datadiskTarget || ""}</span>
          <svg class="ha-select-arrow" viewBox="0 0 24 24" width="24" height="24">
            <path d="M7 10l5 5 5-5z" fill="currentColor"></path>
          </svg>
        </div>
        ${open
          ? html`<div class="ha-select-menu" @click=${(e) => e.stopPropagation()}>
              ${devices.map(
                (dev) => html`<div
                  class="ha-select-item ${dev === this._datadiskTarget
                    ? "selected"
                    : ""}"
                  @click=${() => this._pickDdDevice(dev)}
                >
                  ${dev}
                </div>`
              )}
            </div>`
          : ""}
      </div>
    `;
  }

  _toggleDdSelect = (e) => {
    e?.stopPropagation();
    this._ddSelectOpen = !this._ddSelectOpen;
    this.requestUpdate();
  };

  _pickDdDevice = (dev) => {
    this._datadiskTarget = dev;
    this._ddSelectOpen = false;
  };

  static get styles() {
    return css`
      :host {
        display: block;
        height: calc(
          100vh - var(--safe-area-inset-top, 0px) - var(--safe-area-inset-bottom, 0px)
        );
        overflow: hidden;
        font-family: var(--ha-font-family-body);
        font-size: var(--ha-font-size-m);
        font-weight: var(--ha-font-weight-normal);
        line-height: var(--ha-line-height-normal);
      }
      .page {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      /* --- Layout: card grid (verbatim from upstream hassio-style.ts) --- */
      .content {
        margin: 8px;
        color: var(--primary-text-color);
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: auto;
      }
      .card-group {
        flex: none;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        grid-gap: 8px;
      }
      @media screen and (min-width: 640px) {
        .card-group { grid-template-columns: repeat(auto-fit, minmax(300px, 0.5fr)); }
      }
      @media screen and (min-width: 1020px) {
        .card-group { grid-template-columns: repeat(auto-fit, minmax(300px, 0.333fr)); }
      }
      @media screen and (min-width: 1300px) {
        .card-group { grid-template-columns: repeat(auto-fit, minmax(300px, 0.25fr)); }
      }

      /* --- Cards --- */
      ha-card.info-card {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      ha-card.log-card {
        margin-top: 8px;
        width: 100%;
        flex: 1;
        min-height: 240px;
        display: flex;
        flex-direction: column;
      }
      .log-content {
        min-height: 0;
      }
      .card-content {
        padding: 0 16px 16px 16px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        flex: 1;
      }
      /* Match upstream hassio-supervisor-info.ts CSS exactly. ha-card's slot
         CSS adds padding: var(--ha-space-2) (8px) all around, which we keep.
         These overrides apply ONLY to the info-card actions row (Core/Sup/Host)
         where upstream removes the divider and sets fixed 48px height + flex.
         The log card uses ha-card's defaults (divider on top, no flex). */
      .info-card-actions {
        height: 48px;
        border-top: none;
        display: flex;
        align-items: center;
      }
      .actions-end     { justify-content: flex-end; }
      .actions-between { justify-content: space-between; }

      /* --- Settings-row replica (mirrors <ha-settings-row>) --- */
      .settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0;
        height: 54px;
        width: 100%;
      }
      .settings-row.metric-row {
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        height: 54px;        /* matches upstream ha-settings-row override */
        padding: 0;
      }
      .row-text {
        flex: 1;
        min-width: 0;
        padding: 8px 16px 8px 0;  /* mirrors upstream ha-settings-row .body */
      }
      .row-heading {
        color: var(--primary-text-color);
        font-size: var(--ha-font-size-m, 14px);
        line-height: var(--ha-line-height-normal, 1.6);
      }
      .row-description {
        color: var(--secondary-text-color);
        font-size: var(--ha-font-size-s, 12px);
        line-height: normal;
        padding-top: 4px;        /* matches upstream .body > .secondary */
        white-space: normal;
      }
      .row-action mwc-button { --mdc-typography-button-font-size: 0.825rem; }

      /* --- Metric-bar replica (mirrors <supervisor-metric>+<ha-bar>) --- */
      .metric-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 4px;
      }
      .metric-value {
        width: 48px;
        padding-right: 4px;
        flex-shrink: 0;
        color: var(--secondary-text-color);
        font-size: 12px;
      }
      /* Mirrors <ha-bar> exactly: 12px tall, --ha-bar-border-radius corners,
         --ha-bar-background-color track (falls back to secondary background)
         with --ha-bar-primary-color fill (set per-bar via .ok/.warn/.crit). */
      .metric-track {
        flex: 1;
        height: 12px;
        background: var(
          --ha-bar-background-color,
          var(--secondary-background-color)
        );
        border-radius: var(
          --ha-bar-border-radius,
          var(--ha-border-radius-sm, 4px)
        );
        overflow: hidden;
      }
      .metric-bar {
        height: 100%;
        background: var(--hassio-bar-ok-color, var(--success-color));
        transition: width 0.3s ease;
      }
      .metric-bar.warn { background: var(--hassio-bar-warning-color, var(--warning-color)); }
      .metric-bar.crit { background: var(--hassio-bar-critical-color, var(--error-color)); }

      /* --- Buttons -------------------------------------------------------
         Goal: make <mwc-button> visually match upstream <ha-button> in its
         original /hassio/system rendering:
           - <mwc-button raised>             → filled pill, BRAND/primary color
           - <mwc-button raised class="danger"> → filled pill, ERROR red
           - <mwc-button class="plain">      → small inline plain text (no fill)
         Pill shape comes from --mdc-shape-small set to half the height.
         Modern HA's ha-button uses MIXED CASE, NOT uppercase — Material 3 style.
         mwc-button defaults to Material 1 uppercase which we explicitly disable. */
      mwc-button {
        --mdc-typography-button-font-weight: 500;
        --mdc-typography-button-letter-spacing: normal;
        --mdc-typography-button-text-transform: none;
        white-space: nowrap;
      }
      mwc-button[raised] {
        --mdc-shape-small: 20px;             /* full pill: half of 40px height */
        --mdc-theme-primary: var(--primary-color);
        --mdc-theme-on-primary: var(--text-primary-color, #ffffff);
        --mdc-button-horizontal-padding: 16px;  /* matches upstream ha-button */
        height: 40px;
      }
      mwc-button[raised].danger {
        --mdc-theme-primary: var(--error-color);
      }
      mwc-button.plain {
        --mdc-theme-primary: var(--primary-text-color);
        --mdc-typography-button-font-size: 0.825rem;
        --mdc-button-horizontal-padding: 8px;
      }
      /* Mirrors upstream <ha-button appearance="plain" size="small">:
         32px tall, 12px H-padding, --ha-font-size-s (12px) label font.
         Used on the Hostname/IP "Change" buttons in the Host card. */
      mwc-button.plain.small {
        --mdc-button-height: 32px;
        height: 32px;
        --mdc-button-horizontal-padding: 12px;
        --mdc-typography-button-font-size: var(--ha-font-size-s, 12px);
      }

      /* --- Progress button overlay (mirrors <ha-progress-button>) ---
         Spinner appears centered while action is in progress; check / error
         icon replaces label for ~2s after completion. The wrapper is
         display:inline-block + position:relative so the overlay sits on top
         of the button label without affecting button width. */
      .progress-btn {
        position: relative;
        display: inline-block;
      }
      .progress-btn .pb-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        color: var(--text-primary-color, #fff);
      }
      .progress-btn .pb-success { color: var(--success-color, #43a047); }
      .progress-btn .pb-error { color: var(--error-color, #e53935); }
      .progress-btn .pb-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: pb-spin 0.85s linear infinite;
      }
      @keyframes pb-spin {
        to { transform: rotate(360deg); }
      }
      .pb-label[hidden] { visibility: hidden; }
      /* --- Host menu (custom popover, no ha-button-menu/ha-menu deps) ---
         Mirrors upstream <ha-button-menu> + <ha-icon-button> + <ha-list-item>:
         48x48 circular icon button trigger (hover-ring + active-ring),
         elevated 200px-min popover anchored bottom-right of the trigger,
         48px-tall menu items with 20px H-padding and the same primary-text
         hover/active state-layer as <ha-list-item>. */
      .host-menu-host {
        position: relative;
        display: inline-flex;
      }
      .host-menu-trigger {
        width: 48px;
        height: 48px;
        background: transparent;
        border: none;
        color: var(--secondary-text-color);
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.15s ease;
      }
      .host-menu-trigger:hover {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
      }
      .host-menu-trigger:active,
      .host-menu-host.open .host-menu-trigger {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.12);
      }
      .host-menu-popover {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 200px;
        background: var(
          --card-background-color,
          var(--ha-card-background, #1c1c1c)
        );
        border-radius: 4px;
        box-shadow:
          0px 5px 5px -3px rgba(0, 0, 0, 0.2),
          0px 8px 10px 1px rgba(0, 0, 0, 0.14),
          0px 3px 14px 2px rgba(0, 0, 0, 0.12);
        z-index: 9;
        padding: 8px 0;
        max-height: 304px;
        overflow-y: auto;
        font-family: var(--ha-font-family-body);
      }
      .host-menu-item {
        height: 48px;
        display: flex;
        align-items: center;
        padding: 0 20px;
        cursor: pointer;
        font-size: var(--ha-font-size-m, 14px);
        line-height: 1.5;
        color: var(--primary-text-color);
        white-space: nowrap;
        user-select: none;
      }
      .host-menu-item:hover {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.04);
      }
      .host-menu-item:active {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
      }

      /* --- Modal dialog (mirrors <ha-dialog>) -----------------------------
         Scrim is a full-viewport backdrop with a 50% black tint; clicking it
         closes the dialog (scrimClickAction). Panel is a centered card,
         max-width 560px and max-height 80vh, with a sticky header and
         scrollable content body. Z-index 100 ensures it floats above
         everything else (cards, log, dropdowns). */
      .ha-dlg-scrim {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: var(--ha-dialog-scrim-backdrop-filter, none);
        -webkit-backdrop-filter: var(--ha-dialog-scrim-backdrop-filter, none);
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: dlg-fade-in 0.15s ease;
      }
      @keyframes dlg-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .ha-dlg {
        background: var(
          --ha-dialog-surface-background,
          var(--card-background-color, #1c1c1c)
        );
        color: var(--primary-text-color);
        border-radius: var(--ha-border-radius-lg, 12px);
        box-shadow:
          0 11px 15px -7px rgba(0, 0, 0, 0.2),
          0 24px 38px 3px rgba(0, 0, 0, 0.14),
          0 9px 46px 8px rgba(0, 0, 0, 0.12);
        width: min(90vw, 560px);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: var(--ha-font-family-body);
      }
      .ha-dlg-narrow {
        width: min(90vw, 480px);
      }
      .ha-dlg-header {
        position: relative;
        padding: 18px 56px 16px 18px;
        flex-shrink: 0;
      }
      .ha-dlg-header h2 {
        margin: 0;
        font-size: var(--ha-font-size-xl, 20px);
        font-weight: var(--ha-font-weight-medium, 500);
        line-height: var(--ha-line-height-condensed, 1.2);
        color: var(--primary-text-color);
      }
      .ha-dlg-close {
        position: absolute;
        top: 10px;
        right: 16px;
        width: 40px;
        height: 40px;
        background: transparent;
        border: none;
        color: var(--primary-text-color);
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.15s ease;
      }
      .ha-dlg-close:hover {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
      }
      .ha-dlg-close:active {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.12);
      }
      .ha-dlg-search {
        display: block;
        margin: 8px 16px 0;
        width: calc(100% - 32px);
        height: 40px;
        padding: 0 12px;
        background: var(
          --ha-color-form-background,
          var(--mdc-text-field-fill-color, rgba(255, 255, 255, 0.05))
        );
        border: none;
        border-bottom: 1px solid
          var(--mdc-text-field-idle-line-color, rgba(255, 255, 255, 0.42));
        border-radius: 4px 4px 0 0;
        color: var(--primary-text-color);
        font: inherit;
        outline: none;
        box-sizing: border-box;
      }
      .ha-dlg-search:focus {
        border-bottom-color: var(--primary-color);
        border-bottom-width: 2px;
      }
      .ha-dlg-content {
        flex: 1;
        overflow-y: auto;
        padding: 8px 16px 16px;
      }
      .ha-dlg-content-padded {
        padding: 0 24px 16px;
      }
      .ha-dlg-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 8px 16px 16px;
        flex-shrink: 0;
      }

      /* --- Custom expansion panel (mirrors <ha-expansion-panel outlined>)
         Outlined card with header that toggles open/close. Chevron rotates
         180deg when expanded. Body contains device details. */
      .ha-exp {
        margin: 4px 0;
        border: 1px solid var(--divider-color);
        border-radius: var(--ha-border-radius-md, 8px);
        overflow: hidden;
        background: var(--ha-card-background, transparent);
      }
      .ha-exp-summary {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        cursor: pointer;
        user-select: none;
      }
      .ha-exp-summary:hover {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.04);
      }
      .ha-exp-summary-text {
        flex: 1;
        min-width: 0;
      }
      .ha-exp-header {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--primary-text-color);
      }
      .ha-exp-secondary {
        font-size: var(--ha-font-size-s, 12px);
        color: var(--secondary-text-color);
        margin-top: 2px;
        word-break: break-all;
      }
      .ha-exp-chevron {
        flex-shrink: 0;
        color: var(--secondary-text-color);
        transition: transform 0.2s ease;
      }
      .ha-exp.open .ha-exp-chevron {
        transform: rotate(180deg);
      }
      .ha-exp-body {
        padding: 0 16px 16px;
        font-size: var(--ha-font-size-m, 14px);
      }
      .device-property {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin: 6px 0;
        word-break: break-all;
      }
      .device-property > span:first-child {
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }
      .device-property code,
      .ha-exp-body code,
      .ha-exp-body pre {
        background-color: var(--markdown-code-background-color, rgba(255, 255, 255, 0.05));
        border-radius: var(--ha-border-radius-sm, 4px);
        font-family: var(--ha-font-family-code, monospace);
      }
      .device-property code,
      .ha-exp-body code {
        font-size: var(--ha-font-size-s, 12px);
        padding: 0.2em 0.4em;
      }
      .attributes {
        margin-top: 12px;
      }
      .attributes pre {
        padding: 16px;
        overflow: auto;
        line-height: 1.45;
        margin: 8px 0 0;
        font-size: var(--ha-font-size-s, 12px);
      }

      /* --- Datadisk move dialog spinner -------------------------------- */
      .dd-spinner-wrap {
        display: flex;
        justify-content: center;
        margin: 32px 0;
      }
      .dd-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid var(--divider-color);
        border-top-color: var(--primary-color);
        border-radius: 50%;
        animation: pb-spin 0.85s linear infinite;
      }
      .dd-progress-text {
        text-align: center;
        color: var(--secondary-text-color);
      }
      .ha-dd-select-host {
        margin-top: 8px;
      }

      /* --- Log viewer --- */
      .log-controls {
        padding: 16px 16px 4px 16px;
      }

      /* --- ha-select replica (Material filled select) ----------------------
         Matches the upstream <ha-select> rendered by hassio-supervisor-log.ts.
         The original is a Material 1 mwc-select 'filled' variant with a
         floating label. Heights, paddings, transitions, and color states are
         taken from mwc-select.css and ha-select.ts.  */
      .ha-select-host {
        position: relative;
        width: 100%;
        margin-bottom: 4px;
        font-family: var(--ha-font-family-body);
      }
      .ha-select-anchor {
        height: 56px;
        background: var(
          --ha-color-form-background,
          var(--mdc-text-field-fill-color, rgba(255, 255, 255, 0.05))
        );
        border-radius: 4px 4px 0 0;
        position: relative;
        cursor: pointer;
        box-sizing: border-box;
        padding: 0 12px 0 16px;
        display: flex;
        align-items: center;
        transition: background-color 15ms linear;
      }
      .ha-select-anchor::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 1px;
        background: var(--mdc-text-field-idle-line-color, rgba(255, 255, 255, 0.42));
        transition: background-color 0.15s, height 0.15s;
      }
      .ha-select-anchor:hover {
        background: var(
          --ha-color-form-background-hover,
          var(--mdc-text-field-fill-color, rgba(255, 255, 255, 0.08))
        );
      }
      .ha-select-anchor:hover::after {
        background: var(--mdc-text-field-hover-line-color, rgba(255, 255, 255, 0.87));
      }
      .ha-select-host.open .ha-select-anchor::after {
        background: var(--primary-color);
        height: 2px;
      }
      .ha-select-label {
        position: absolute;
        top: 8px;
        left: 16px;
        font-size: 12px;
        line-height: 1;
        color: var(--secondary-text-color);
        pointer-events: none;
        transition: color 0.15s;
      }
      .ha-select-host.open .ha-select-label {
        color: var(--primary-color);
      }
      .ha-select-value {
        flex: 1;
        padding-top: 18px;       /* visual centering below floated label */
        font-size: 16px;
        line-height: 1;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ha-select-arrow {
        color: var(--secondary-text-color);
        margin-top: 18px;
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }
      .ha-select-host.open .ha-select-arrow {
        transform: rotate(180deg);
        color: var(--primary-color);
      }

      /* Menu popup --------------------------------------------------------- */
      .ha-select-menu {
        position: absolute;
        top: calc(100% + 1px);
        left: 0;
        right: 0;
        background: var(
          --card-background-color,
          var(--ha-card-background, #1c1c1c)
        );
        border-radius: 4px;
        box-shadow:
          0px 5px 5px -3px rgba(0, 0, 0, 0.2),
          0px 8px 10px 1px rgba(0, 0, 0, 0.14),
          0px 3px 14px 2px rgba(0, 0, 0, 0.12);
        z-index: 8;
        padding: 8px 0;
        max-height: 304px;
        overflow-y: auto;
      }
      /* List items mirror <ha-list-item>: 48px height, 20px side padding,
         hover/selected backgrounds use Material list-item conventions. */
      .ha-select-item {
        height: 48px;
        display: flex;
        align-items: center;
        padding: 0 20px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1.5;
        color: var(--primary-text-color);
        position: relative;
      }
      .ha-select-item:hover {
        background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.04);
      }
      .ha-select-item.selected {
        color: var(--primary-color);
        background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.12);
      }
      .ha-select-item.selected:hover {
        background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.16);
      }
      .log-pre {
        white-space: pre-wrap;
        overflow-wrap: break-word;
        margin: 0;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        font-family: var(--ha-font-family-code, ui-monospace, "SFMono-Regular", monospace);
        font-size: var(--ha-font-size-m, 14px);
        line-height: 1.4;
        color: var(--primary-text-color);
      }

      /* ANSI color spans (port of ha-ansi-to-html.ts CSS) */
      .log-pre .bold { font-weight: bold; }
      .log-pre .italic { font-style: italic; }
      .log-pre .underline { text-decoration: underline; }
      .log-pre .strikethrough { text-decoration: line-through; }
      .log-pre .underline.strikethrough { text-decoration: underline line-through; }
      .log-pre .fg-red    { color: var(--error-color); }
      .log-pre .fg-green  { color: var(--success-color); }
      .log-pre .fg-yellow { color: var(--warning-color); }
      .log-pre .fg-blue   { color: var(--info-color); }
      .log-pre .fg-magenta{ color: rgb(118, 38, 113); }
      .log-pre .fg-cyan   { color: rgb(44, 181, 233); }
      .log-pre .fg-white  { color: rgb(204, 204, 204); }
      .log-pre .bg-black  { background-color: rgb(0, 0, 0); }
      .log-pre .bg-red    { background-color: var(--error-color); }
      .log-pre .bg-green  { background-color: var(--success-color); }
      .log-pre .bg-yellow { background-color: var(--warning-color); }
      .log-pre .bg-blue   { background-color: var(--info-color); }
      .log-pre .bg-magenta{ background-color: rgb(118, 38, 113); }
      .log-pre .bg-cyan   { background-color: rgb(44, 181, 233); }
      .log-pre .bg-white  { background-color: rgb(204, 204, 204); }

      .loading {
        padding: 24px;
        color: var(--secondary-text-color);
        text-align: center;
      }
    `;
  }
}

// Dynamically import the mwc-button bundle so the customElements.define patch
// is in effect for its inlined deps. Then register our panel element.
import("./mwc-button.js")
  .catch((e) => console.error("server-control: mwc-button bundle failed:", e))
  .finally(() => {
    customElements.define("ha-panel-server-control", HaPanelServerControl);
  });
