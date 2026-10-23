/**
 * J.A.R.V.I.S. Operating System - Stark Industries Core Runtime
 * High-performance HUD window compositor, virtual filesystem, shell, and applications.
 */

(function () {
  'use strict';

  window.JARVIS = window.JARVIS || {};

  /* ==========================================================================
     1. AUDIO SYSTEM (Synthesizer via Web Audio API)
     ========================================================================== */
  JARVIS.Audio = {
    ctx: null,
    enabled: true,

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    beep(freq = 600, duration = 0.08, type = 'sine', vol = 0.05) {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {}
    },

    bootChord() {
      if (!this.enabled) return;
      [261.63, 329.63, 392.0, 523.25, 659.25, 1046.5].forEach((freq, idx) => {
        setTimeout(() => this.beep(freq, 0.35, 'triangle', 0.06), idx * 75);
      });
    },

    loginChime() {
      if (!this.enabled) return;
      [440, 554.37, 659.25, 880, 1318.5].forEach((freq, idx) => {
        setTimeout(() => this.beep(freq, 0.28, 'sine', 0.08), idx * 80);
      });
    },

    click() {
      this.beep(1200, 0.025, 'sine', 0.03);
    },

    error() {
      this.beep(160, 0.15, 'sawtooth', 0.12);
      setTimeout(() => this.beep(130, 0.2, 'sawtooth', 0.12), 120);
    }
  };

  /* ==========================================================================
     2. TOAST NOTIFICATIONS
     ========================================================================== */
  JARVIS.Notify = {
    show(title, msg, duration = 4000) {
      const container = document.getElementById('notifications');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'notification-toast';
      toast.innerHTML = `
        <div class="notif-header">
          <span class="notif-title">${title}</span>
          <button class="notif-close" title="Dismiss">✕</button>
        </div>
        <div class="notif-body">${msg}</div>
      `;

      container.appendChild(toast);
      JARVIS.Audio.beep(880, 0.06, 'sine', 0.04);

      let timer = null;
      const remove = () => {
        if (timer) clearTimeout(timer);
        toast.classList.add('removing');
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 320);
      };

      toast.querySelector('.notif-close').onclick = (e) => {
        e.stopPropagation();
        remove();
      };

      if (duration > 0) timer = setTimeout(remove, duration);
    }
  };

  /* ==========================================================================
     3. VIRTUAL FILE SYSTEM
     ========================================================================== */
  JARVIS.FS = {
    cwd: '/home/stark',
    root: {
      type: 'dir',
      name: '',
      children: {
        home: {
          type: 'dir',
          name: 'home',
          children: {
            stark: {
              type: 'dir',
              name: 'stark',
              children: {
                Documents: {
                  type: 'dir',
                  name: 'Documents',
                  children: {
                    'project_proposal.md': {
                      type: 'file',
                      name: 'project_proposal.md',
                      size: 612,
                      content: '# J.A.R.V.I.S. Senior Thesis Capstone\\n\\n## Mission Brief\\nAutonomous distributed operating framework with decentralized consensus, real-time edge telemetry and neural-linked biometric identity layers.\\n\\n## Architecture Specs\\n- Core: Stark Microkernel v7.0.1\\n- HUD Rendering: Hardware Accelerated Canvas\\n- Security: Zero-Trust SHA-3 Quantum Proofing\\n- Advisors: Prof. Tony Stark, Dr. Bruce Banner'
                    },
                    'research_notes.txt': {
                      type: 'file',
                      name: 'research_notes.txt',
                      size: 284,
                      content: 'Edge ML Optimization Protocols:\\n1. Quantization: 8-bit integer weights for latency reduction\\n2. Swarm mesh synchronizer: Zero packet loss via UDP multicast\\n3. Arc Reactor thermal dispersion models nominal.'
                    }
                  }
                },
                Projects: {
                  type: 'dir',
                  name: 'Projects',
                  children: {
                    'mark-85': { type: 'dir', name: 'mark-85', children: {} },
                    'holographic-hud': { type: 'dir', name: 'holographic-hud', children: {} }
                  }
                },
                Downloads: { type: 'dir', name: 'Downloads', children: {} }
              }
            }
          }
        },
        system: {
          type: 'dir',
          name: 'system',
          children: {
            'config.sys': {
              type: 'file',
              name: 'config.sys',
              size: 142,
              content: 'JARVIS_VERSION=7.0.1\\nKERNEL=STARK_NT\\nSECURITY_LEVEL=ALPHA_OMEGA\\nNEURAL_CORES=128\\nQUANTUM_CACHE=256PB'
            },
            'boot.log': {
              type: 'file',
              name: 'boot.log',
              size: 198,
              content: 'STARK INDUSTRIES BIOS v7.0.1 [VERIFIED]\\nNPU Cores: 128/128 Active\\nQuantum Memory Mapped [256 PB]\\nWindow Compositor Initialized\\nStatus: ALL SYSTEMS NOMINAL'
            }
          }
        }
      }
    },

    resolve(path) {
      if (!path) return this.cwd;
      let target = path.trim();
      if (!target.startsWith('/')) {
        target = (this.cwd === '/' ? '' : this.cwd) + '/' + target;
      }
      const raw = target.split('/');
      const stack = [];
      for (const segment of raw) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
          if (stack.length > 0) stack.pop();
        } else {
          stack.push(segment);
        }
      }
      return '/' + stack.join('/');
    },

    getNode(path) {
      const normalized = this.resolve(path);
      if (normalized === '/') return this.root;
      const parts = normalized.split('/').filter(Boolean);
      let curr = this.root;
      for (const p of parts) {
        if (!curr || curr.type !== 'dir' || !curr.children || !curr.children[p]) {
          return null;
        }
        curr = curr.children[p];
      }
      return curr;
    },

    ls(path) {
      const node = this.getNode(path || this.cwd);
      if (!node) throw new Error('Directory not found');
      if (node.type === 'file') return [{ name: node.name, type: 'file', size: node.size }];
      return Object.keys(node.children).map(k => ({
        name: k,
        type: node.children[k].type,
        size: node.children[k].size || 0
      }));
    },

    cd(path) {
      const target = this.resolve(path);
      const node = this.getNode(target);
      if (!node) throw new Error('Directory not found: ' + path);
      if (node.type !== 'dir') throw new Error('Not a directory: ' + path);
      this.cwd = target;
      return this.cwd;
    },

    cat(path) {
      const node = this.getNode(path);
      if (!node) throw new Error('File not found: ' + path);
      if (node.type === 'dir') throw new Error('Target is a directory: ' + path);
      return node.content || '';
    },

    touch(path, content = '') {
      const resolved = this.resolve(path);
      const parts = resolved.split('/').filter(Boolean);
      const fileName = parts.pop();
      const parent = this.getNode('/' + parts.join('/'));
      if (!parent || parent.type !== 'dir') throw new Error('Invalid path');
      parent.children[fileName] = {
        type: 'file',
        name: fileName,
        content: content,
        size: content.length
      };
      return true;
    },

    mkdir(path) {
      const resolved = this.resolve(path);
      const parts = resolved.split('/').filter(Boolean);
      const dirName = parts.pop();
      const parent = this.getNode('/' + parts.join('/'));
      if (!parent || parent.type !== 'dir') throw new Error('Parent directory missing');
      if (parent.children[dirName]) throw new Error('Directory exists');
      parent.children[dirName] = { type: 'dir', name: dirName, children: {} };
      return true;
    },

    rm(path) {
      const resolved = this.resolve(path);
      const parts = resolved.split('/').filter(Boolean);
      const name = parts.pop();
      const parent = this.getNode('/' + parts.join('/'));
      if (!parent || !parent.children[name]) throw new Error('Item not found');
      delete parent.children[name];
      return true;
    },

    pwd() {
      return this.cwd;
    }
  };

  /* ==========================================================================
     3b. FORMATTERS + PYTHON CORE BRIDGE (JARVIS.Core)
     ========================================================================== */
  JARVIS.Utils = {
    bytes(value) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
      const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
      let amount = Number(value);
      let index = 0;
      while (Math.abs(amount) >= 1024 && index < units.length - 1) {
        amount /= 1024;
        index++;
      }
      return `${amount.toFixed(1)} ${units[index]}`;
    },

    duration(seconds) {
      if (seconds === null || seconds === undefined) return 'n/a';
      let total = Math.max(0, Math.floor(Number(seconds) || 0));
      const days = Math.floor(total / 86400);
      total %= 86400;
      const hours = Math.floor(total / 3600);
      total %= 3600;
      const minutes = Math.floor(total / 60);
      const secs = total % 60;
      const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      return days ? `${days}d ${clock}` : clock;
    },

    escapeHtml(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };

  JARVIS.Core = {
    defaultUrl: 'http://127.0.0.1:8765',
    baseUrl: 'http://127.0.0.1:8765',
    passcode: '151627',
    token: null,
    tokenExpiry: 0,
    state: 'offline',
    online: false,
    lastError: '',
    health: null,
    status: null,
    telemetryData: null,
    processData: null,
    _listeners: new Set(),
    _pollTimer: null,
    _inflight: null,
    _started: false,
    _failures: 0,

    init() {
      if (this._started) return this;
      this._started = true;
      this.baseUrl = (window.JARVIS_CORE_URL || localStorage.getItem('jarvis-core-url') || this.defaultUrl).replace(/\/+$/, '');
      this.passcode = localStorage.getItem('jarvis-core-passcode') || this.passcode;
      this.bindTray();
      this.updateTray();
      this.poll(true);
      this._pollTimer = setInterval(() => this.poll(), 5000);
      return this;
    },

    setBaseUrl(url) {
      const clean = String(url || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(clean)) throw new Error('Core URL must start with http:// or https://');
      this.baseUrl = clean;
      localStorage.setItem('jarvis-core-url', clean);
      this.token = null;
      this.tokenExpiry = 0;
      this.state = 'probing';
      this.updateTray();
      this.poll(true);
      return clean;
    },

    setPasscode(passcode) {
      const clean = String(passcode || '').trim();
      if (!clean) throw new Error('A core passcode is required');
      this.passcode = clean;
      localStorage.setItem('jarvis-core-passcode', clean);
      this.token = null;
      this.tokenExpiry = 0;
      return clean;
    },

    snapshot() {
      return {
        state: this.state,
        online: this.online,
        baseUrl: this.baseUrl,
        error: this.lastError,
        health: this.health,
        status: this.status,
        telemetry: this.telemetryData,
        processes: this.processData
      };
    },

    subscribe(listener) {
      this._listeners.add(listener);
      try {
        listener(this.snapshot());
      } catch (e) {}
      return () => this._listeners.delete(listener);
    },

    emit() {
      const snap = this.snapshot();
      this._listeners.forEach(listener => {
        try {
          listener(snap);
        } catch (e) {}
      });
      this.updateTray();
    },

    bindTray() {
      const tray = document.getElementById('tray-core');
      if (!tray || tray.dataset.bound === 'true') return;
      tray.dataset.bound = 'true';
      tray.onclick = () => {
        JARVIS.Audio.click();
        JARVIS.WM.open('core');
      };
    },

    updateTray() {
      const tray = document.getElementById('tray-core');
      const label = document.getElementById('core-label');
      if (!tray || !label) return;
      tray.classList.remove('online', 'offline', 'probing');
      tray.classList.add(this.state);
      if (this.state === 'online') {
        label.textContent = 'CORE // ONLINE';
        tray.title = `Python core ${this.health ? this.health.version : ''} at ${this.baseUrl}`;
      } else if (this.state === 'probing') {
        label.textContent = 'CORE // LINK';
        tray.title = `Probing Python core at ${this.baseUrl}`;
      } else {
        label.textContent = 'CORE // OFFLINE';
        tray.title = this.lastError || `Python core not reachable at ${this.baseUrl}`;
      }
    },

    describeError(error) {
      if (!error) return 'Unknown core error';
      if (error.name === 'AbortError') return 'Core request timed out';
      if (error instanceof TypeError && /fetch/i.test(error.message || '')) {
        if (window.location.protocol === 'https:' && this.baseUrl.startsWith('http://')) {
          return 'Browser blocked the HTTP core link from an HTTPS page. Run the HUD locally or use a tunnel.';
        }
        return `Python core unreachable at ${this.baseUrl}. Run: python run_jarvis_core.py`;
      }
      return error.message || String(error);
    },

    async request(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);
      const headers = Object.assign({}, options.headers || {});
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.auth) {
        await this.ensureToken();
        headers.Authorization = `Bearer ${this.token}`;
      }
      try {
        const response = await fetch(this.baseUrl + path, {
          method: options.method || 'GET',
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
          cache: 'no-store'
        });
        const text = await response.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = text;
          }
        }
        if (!response.ok) {
          const detail = data && data.detail ? data.detail : `HTTP ${response.status}`;
          const error = new Error(detail);
          error.status = response.status;
          throw error;
        }
        return data;
      } finally {
        clearTimeout(timeout);
      }
    },

    async ensureToken(force = false) {
      if (!force && this.token && this.tokenExpiry > Date.now() / 1000 + 30) {
        return this.token;
      }
      const data = await this.request('/api/auth/login', {
        method: 'POST',
        body: { passcode: this.passcode }
      });
      this.token = data.token;
      this.tokenExpiry = Number(data.expires_at) || (Date.now() / 1000 + 3600);
      return this.token;
    },

    async login(passcode) {
      if (passcode) this.setPasscode(passcode);
      this.token = null;
      this.tokenExpiry = 0;
      const data = await this.ensureToken(true);
      this.state = 'online';
      this.online = true;
      this.lastError = '';
      this.updateTray();
      return data;
    },

    async poll(deep = false) {
      if (this._inflight) return this._inflight;
      if (!this.online) this.state = 'probing';
      this.updateTray();
      this._inflight = (async () => {
        try {
          const health = await this.request('/api/health', { timeout: 3000 });
          this.health = health;
          this.online = true;
          this.state = 'online';
          this.lastError = '';
          this._failures = 0;
          const [telemetry, processes, status] = await Promise.all([
            this.request('/api/telemetry', { timeout: 4000 }).catch(() => this.telemetryData),
            this.request('/api/processes?limit=6', { timeout: 4000 }).catch(() => this.processData),
            deep ? this.request('/api/status', { timeout: 4000 }).catch(() => this.status) : Promise.resolve(this.status)
          ]);
          if (telemetry) this.telemetryData = telemetry;
          if (processes) this.processData = processes;
          if (status) this.status = status;
        } catch (error) {
          this._failures++;
          this.online = false;
          this.state = 'offline';
          this.lastError = this.describeError(error);
        }
        this._inflight = null;
        this.emit();
      })();
      return this._inflight;
    },

    async telemetry() {
      const data = await this.request('/api/telemetry', { timeout: 4000 });
      this.telemetryData = data;
      this.online = true;
      this.state = 'online';
      this.emit();
      return data;
    },

    async processes(limit = 8) {
      const data = await this.request(`/api/processes?limit=${encodeURIComponent(limit)}`, { timeout: 4000 });
      this.processData = data;
      return data;
    },

    async command(command, cwd = '/home/operator') {
      const send = () => this.request('/api/command', {
        method: 'POST',
        auth: true,
        timeout: 10000,
        body: { command, cwd }
      });
      try {
        const result = await send();
        this.online = true;
        this.state = 'online';
        this.lastError = '';
        this.updateTray();
        return result;
      } catch (error) {
        if (error.status === 401) {
          await this.ensureToken(true);
          return send();
        }
        throw error;
      }
    },

    async neofetch() {
      return this.request('/api/neofetch', { timeout: 4000 });
    },

    docsUrl() {
      return `${this.baseUrl}/api/docs`;
    }
  };

  /* ==========================================================================
     4. WINDOW COMPOSITING MANAGER (JARVIS.WM)
     ========================================================================== */
  JARVIS.WM = {
    windows: new Map(),
    nextZ: 100,
    winCounter: 1,

    open(appId, opts = {}) {
      const app = JARVIS.Apps[appId];
      if (!app) return null;

      const winId = 'win-' + (this.winCounter++);
      const w = opts.width || app.width || 680;
      const h = opts.height || app.height || 460;

      const offset = ((this.winCounter - 2) % 8) * 32;
      let left = Math.min(window.innerWidth - w - 40, 70 + offset);
      let top = Math.min(window.innerHeight - h - 80, 50 + offset);
      left = Math.max(20, left);
      top = Math.max(20, top);

      const winEl = document.createElement('div');
      winEl.className = 'jarvis-window focused';
      winEl.dataset.winId = winId;
      winEl.dataset.app = appId;
      winEl.style.left = left + 'px';
      winEl.style.top = top + 'px';
      winEl.style.width = w + 'px';
      winEl.style.height = h + 'px';
      winEl.style.zIndex = ++this.nextZ;
      winEl._intervals = [];
      winEl._cleanups = [];

      winEl.innerHTML = `
        <div class="window-titlebar">
          <div class="titlebar-left">
            <i data-lucide="${app.icon}" class="titlebar-icon"></i>
            <span class="titlebar-title">${app.name}</span>
          </div>
          <div class="titlebar-controls">
            <button class="window-ctrl-btn min-btn" title="Minimize">─</button>
            <button class="window-ctrl-btn max-btn" title="Maximize">□</button>
            <button class="window-ctrl-btn close-btn" title="Close">✕</button>
          </div>
        </div>
        <div class="window-content"></div>
        <div class="window-resize-handle"></div>
      `;

      document.getElementById('windows-layer').appendChild(winEl);

      const winObj = {
        id: winId,
        appId: appId,
        el: winEl,
        title: app.name,
        isMax: false,
        prevRect: { left, top, width: w, height: h }
      };

      this.windows.set(winId, winObj);

      // Drag setup
      const titlebar = winEl.querySelector('.window-titlebar');
      this._setupDrag(winObj, titlebar);

      // Resize setup
      const resizeHandle = winEl.querySelector('.window-resize-handle');
      this._setupResize(winObj, resizeHandle);

      // Controls
      winEl.querySelector('.min-btn').onclick = (e) => { e.stopPropagation(); this.minimize(winId); };
      winEl.querySelector('.max-btn').onclick = (e) => { e.stopPropagation(); this.maximize(winId); };
      winEl.querySelector('.close-btn').onclick = (e) => { e.stopPropagation(); this.close(winId); };
      winEl.onmousedown = () => this.focus(winId);

      // Mount Application Content
      const contentEl = winEl.querySelector('.window-content');
      app.render(contentEl, winObj, opts);

      JARVIS.Taskbar.add(winId, app.name, app.icon);
      this.focus(winId);

      if (window.lucide && lucide.createIcons) lucide.createIcons();
      JARVIS.Audio.click();
      return winId;
    },

    close(winId) {
      const win = this.windows.get(winId);
      if (!win) return;
      if (win.el._intervals) {
        win.el._intervals.forEach(clearInterval);
      }
      if (win.el._cleanups) {
        win.el._cleanups.forEach(cleanup => {
          try {
            cleanup();
          } catch (e) {}
        });
      }
      if (win.el.parentNode) win.el.parentNode.removeChild(win.el);
      this.windows.delete(winId);
      JARVIS.Taskbar.remove(winId);

      // Focus topmost remaining
      let topWin = null;
      for (const w of this.windows.values()) {
        if (!w.el.classList.contains('minimized')) {
          if (!topWin || parseInt(w.el.style.zIndex) > parseInt(topWin.el.style.zIndex)) {
            topWin = w;
          }
        }
      }
      if (topWin) this.focus(topWin.id);
    },

    minimize(winId) {
      const win = this.windows.get(winId);
      if (!win) return;
      win.el.classList.add('minimized');
      win.el.classList.remove('focused');
      JARVIS.Taskbar.setActive(null);
    },

    maximize(winId) {
      const win = this.windows.get(winId);
      if (!win) return;
      const el = win.el;
      if (win.isMax) {
        el.style.left = win.prevRect.left + 'px';
        el.style.top = win.prevRect.top + 'px';
        el.style.width = win.prevRect.width + 'px';
        el.style.height = win.prevRect.height + 'px';
        el.classList.remove('maximized');
        win.isMax = false;
        el.querySelector('.max-btn').textContent = '□';
      } else {
        win.prevRect = {
          left: parseInt(el.style.left, 10),
          top: parseInt(el.style.top, 10),
          width: el.offsetWidth,
          height: el.offsetHeight
        };
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.width = '100vw';
        el.style.height = 'calc(100vh - 50px)';
        el.classList.add('maximized');
        win.isMax = true;
        el.querySelector('.max-btn').textContent = '❐';
      }
      this.focus(winId);
    },

    focus(winId) {
      const win = this.windows.get(winId);
      if (!win) return;

      if (win.el.classList.contains('minimized')) {
        win.el.classList.remove('minimized');
      }

      win.el.style.zIndex = ++this.nextZ;
      this.windows.forEach(w => w.el.classList.remove('focused'));
      win.el.classList.add('focused');
      JARVIS.Taskbar.setActive(winId);
    },

    _setupDrag(win, bar) {
      const el = win.el;
      bar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.window-ctrl-btn') || win.isMax) return;
        e.preventDefault();
        this.focus(win.id);

        const startX = e.clientX - (parseInt(el.style.left, 10) || 0);
        const startY = e.clientY - (parseInt(el.style.top, 10) || 0);

        const move = (ev) => {
          let left = ev.clientX - startX;
          let top = ev.clientY - startY;
          left = Math.max(-el.offsetWidth + 100, Math.min(window.innerWidth - 80, left));
          top = Math.max(0, Math.min(window.innerHeight - 80, top));
          el.style.left = left + 'px';
          el.style.top = top + 'px';
        };

        const stop = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', stop);
        };

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
      });
    },

    _setupResize(win, handle) {
      const el = win.el;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.focus(win.id);

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;

        const move = (ev) => {
          const w = Math.max(340, startW + (ev.clientX - startX));
          const h = Math.max(240, startH + (ev.clientY - startY));
          el.style.width = w + 'px';
          el.style.height = h + 'px';
        };

        const stop = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', stop);
        };

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
      });
    }
  };

  /* ==========================================================================
     5. TASKBAR & SYSTEM TRAY
     ========================================================================== */
  JARVIS.Taskbar = {
    add(winId, title, icon) {
      const container = document.getElementById('running-apps');
      const btn = document.createElement('div');
      btn.className = 'taskbar-app';
      btn.dataset.winId = winId;
      btn.innerHTML = `<i data-lucide="${icon}" style="width:14px;height:14px"></i><span>${title}</span>`;
      btn.onclick = () => {
        const win = JARVIS.WM.windows.get(winId);
        if (!win) return;
        if (win.el.classList.contains('focused') && !win.el.classList.contains('minimized')) {
          JARVIS.WM.minimize(winId);
        } else {
          JARVIS.WM.focus(winId);
        }
      };
      container.appendChild(btn);
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    },

    remove(winId) {
      const btn = document.querySelector(`.taskbar-app[data-win-id="${winId}"]`);
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    },

    setActive(winId) {
      document.querySelectorAll('.taskbar-app').forEach(b => {
        if (b.dataset.winId === winId) b.classList.add('active');
        else b.classList.remove('active');
      });
    },

    initClock() {
      const clockEl = document.getElementById('tray-clock');
      const dateEl = document.getElementById('tray-date');
      const update = () => {
        const d = new Date();
        if (clockEl) {
          clockEl.textContent = d.toTimeString().split(' ')[0];
        }
        if (dateEl) {
          const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          dateEl.textContent = `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`;
        }
      };
      update();
      setInterval(update, 1000);
    }
  };

  /* ==========================================================================
     6. START & CONTEXT MENUS
     ========================================================================== */
  JARVIS.Menus = {
    init() {
      const startBtn = document.getElementById('start-btn');
      const startMenu = document.getElementById('start-menu');
      const contextMenu = document.getElementById('context-menu');
      const searchInput = document.getElementById('start-search');

      // Start menu toggle
      startBtn.onclick = (e) => {
        e.stopPropagation();
        JARVIS.Audio.click();
        const isOpen = startMenu.style.display === 'flex';
        startMenu.style.display = isOpen ? 'none' : 'flex';
        if (!isOpen && searchInput) {
          searchInput.value = '';
          searchInput.focus();
          this.filterStart('');
        }
      };

      // Search in start menu
      if (searchInput) {
        searchInput.oninput = (e) => this.filterStart(e.target.value.toLowerCase());
      }

      // Start tile click
      document.querySelectorAll('.start-app-tile').forEach(tile => {
        tile.onclick = () => {
          const app = tile.dataset.app;
          if (app) JARVIS.WM.open(app);
          startMenu.style.display = 'none';
        };
      });

      // Power button
      const powerBtn = document.getElementById('power-btn');
      if (powerBtn) {
        powerBtn.onclick = () => {
          if (confirm('TERMINATE ALL JARVIS PROCESSES AND DISENGAGE?')) {
            document.body.innerHTML = `
              <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#03080e;color:#00f0ff;font-family:'Orbitron',sans-serif;letter-spacing:3px;flex-direction:column;gap:16px;">
                <div style="font-size:2rem;font-weight:900;">SYSTEM SHUTDOWN</div>
                <div style="font-family:'Share Tech Mono';color:#5a8a9f;">ALL NEURAL CORES OFFLINE. GOODBYE, SIR.</div>
              </div>
            `;
            setTimeout(() => window.location.reload(), 2500);
          }
        };
      }

      // Desktop Context Menu
      const desktop = document.getElementById('desktop');
      desktop.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.jarvis-window') || e.target.closest('#taskbar')) return;
        e.preventDefault();
        JARVIS.Audio.click();
        contextMenu.style.display = 'block';
        contextMenu.style.left = Math.min(window.innerWidth - 220, e.clientX) + 'px';
        contextMenu.style.top = Math.min(window.innerHeight - 200, e.clientY) + 'px';
      });

      // Context menu action clicks
      contextMenu.querySelectorAll('.ctx-item').forEach(item => {
        item.onclick = () => {
          const act = item.dataset.action;
          contextMenu.style.display = 'none';
          if (act === 'open-term') JARVIS.WM.open('terminal');
          else if (act === 'new-file') JARVIS.WM.open('editor', { newFile: true });
          else if (act === 'core') JARVIS.WM.open('core');
          else if (act === 'monitor') JARVIS.WM.open('monitor');
          else if (act === 'settings') JARVIS.WM.open('settings');
          else if (act === 'refresh') {
            JARVIS.Notify.show('SYSTEM REFRESSED', 'Compositor and visual telemetry recalibrated.');
          }
        };
      });

      // Dismiss menus on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#start-menu') && !e.target.closest('#start-btn')) {
          startMenu.style.display = 'none';
        }
        contextMenu.style.display = 'none';
      });
    },

    filterStart(q) {
      document.querySelectorAll('.start-app-tile').forEach(t => {
        const text = t.textContent.toLowerCase();
        t.style.display = text.includes(q) ? 'flex' : 'none';
      });
    }
  };

  /* ==========================================================================
     7. APP SUITE DEFINITIONS
     ========================================================================== */
  JARVIS.Apps = {
    // ----------------------------------------------------
    // Terminal Application
    // ----------------------------------------------------
    terminal: {
      name: 'Terminal // Shell',
      icon: 'terminal',
      width: 720,
      height: 480,
      render(el, win) {
        el.className = 'app-terminal';
        el.innerHTML = `
          <div class="term-output"></div>
          <div class="term-input-line">
            <span class="term-prompt">stark@jarvis:${JARVIS.FS.cwd}$</span>
            <input type="text" class="term-input" spellcheck="false" autocomplete="off" />
          </div>
        `;

        const output = el.querySelector('.term-output');
        const input = el.querySelector('.term-input');
        const prompt = el.querySelector('.term-prompt');
        const history = [];
        let historyIdx = -1;

        const print = (text, type = '') => {
          const div = document.createElement('div');
          if (type) div.className = `term-line-${type}`;
          div.textContent = text;
          output.appendChild(div);
          output.scrollTop = output.scrollHeight;
        };

        const runCore = async (directive) => {
          if (!JARVIS.Core.online) {
            await JARVIS.Core.poll();
          }
          if (!JARVIS.Core.online) {
            print(`Python core offline // ${JARVIS.Core.lastError}`, 'warn');
            print('Start it with: python run_jarvis_core.py', 'warn');
            return false;
          }
          try {
            const result = await JARVIS.Core.command(directive, '/home/operator');
            (result.output || []).forEach(line => print(line));
            if (result.exit_code) print(`[exit code ${result.exit_code}]`, 'error');
            return true;
          } catch (error) {
            print(`core error: ${JARVIS.Core.describeError(error)}`, 'error');
            return false;
          }
        };

        print('STARK INDUSTRIES // MARK-VII SECURE SHELL', 'info');
        print('Local shell + Python core bridge online. Type "help" for directives.\\n');

        const exec = async (cmdLine) => {
          const trimmed = cmdLine.trim();
          if (!trimmed) return;
          history.push(trimmed);
          historyIdx = history.length;

          print(`stark@jarvis:${JARVIS.FS.cwd}$ ${trimmed}`);
          const parts = trimmed.split(/\\s+/);
          const cmd = parts[0].toLowerCase();
          const args = parts.slice(1);

          switch (cmd) {
            case 'help':
              print('Available commands:');
              print('  help              - Show directives summary');
              print('  clear             - Clear console stream');
              print('  ls [path]         - List local VFS files/folders');
              print('  cd <path>         - Change local working directory');
              print('  cat <file>        - Output local file content');
              print('  pwd               - Print active directory');
              print('  touch <file>      - Create empty text file');
              print('  mkdir <dir>       - Create subfolder');
              print('  rm <target>       - Delete local target');
              print('  echo <text>       - Echo text');
              print('  date              - Current satellite timestamp');
              print('  whoami            - Active user session');
              print('  sysinfo           - Python core hardware telemetry');
              print('  ps [limit]        - Python core process monitor');
              print('  metrics           - Prometheus metrics from the core');
              print('  core              - Show Python core link status');
              print('  core auth <code>  - Authenticate with the core');
              print('  core exec <cmd>   - Execute a directive in the core');
              print('  core url [url]    - Show or set the core endpoint');
              print('  neofetch          - Real telemetry (falls back offline)');
              print('  exit              - Terminate shell process');
              break;

            case 'sysinfo':
              await runCore('sysinfo');
              break;

            case 'ps':
              await runCore('ps' + (args[0] ? ' ' + args[0] : ''));
              break;

            case 'metrics':
              await runCore('metrics');
              break;

            case 'core': {
              const sub = (args[0] || 'status').toLowerCase();
              if (sub === 'auth') {
                const pass = args[1] || JARVIS.Core.passcode;
                if (!pass) {
                  print('Usage: core auth <passcode>', 'warn');
                  break;
                }
                try {
                  await JARVIS.Core.login(pass);
                  print('CORE AUTHENTICATED // bearer token acquired', 'info');
                  JARVIS.Notify.show('PYTHON CORE', 'Bearer token acquired. Authenticated directives unlocked.');
                } catch (error) {
                  print(`core auth failed: ${JARVIS.Core.describeError(error)}`, 'error');
                }
                break;
              }
              if (sub === 'exec') {
                const directive = args.slice(1).join(' ');
                if (!directive) {
                  print('Usage: core exec <directive>', 'warn');
                  break;
                }
                await runCore(directive);
                break;
              }
              if (sub === 'url') {
                if (args[1]) {
                  try {
                    JARVIS.Core.setBaseUrl(args[1]);
                    print(`core endpoint set to ${JARVIS.Core.baseUrl}`, 'info');
                  } catch (error) {
                    print(error.message, 'error');
                  }
                } else {
                  print(`core endpoint: ${JARVIS.Core.baseUrl}`, 'info');
                }
                break;
              }
              if (sub === 'help') {
                print('core status        - Probe link and print metadata');
                print('core auth <code>   - Exchange passcode for a bearer token');
                print('core exec <cmd>    - Run a whitelisted core directive');
                print('core url [url]     - Show or persist the endpoint');
                break;
              }
              await JARVIS.Core.poll(true);
              if (!JARVIS.Core.online) {
                print(`core offline: ${JARVIS.Core.lastError}`, 'error');
                print('Start it with: python run_jarvis_core.py', 'warn');
                break;
              }
              const snap = JARVIS.Core.snapshot();
              print(`CORE LINK ACTIVE // ${snap.baseUrl}`, 'info');
              print(`version  : ${snap.health ? snap.health.version : 'n/a'}`);
              print(`python   : ${snap.health ? snap.health.python_version : 'n/a'}`);
              print(`platform : ${snap.health ? snap.health.platform : 'n/a'}`);
              print(`telemetry: ${snap.health ? snap.health.telemetry_source : 'n/a'} // uptime ${JARVIS.Utils.duration(snap.health ? snap.health.uptime_seconds : null)}`);
              print(`commands : ${snap.status ? snap.status.command_count : 'n/a'} // processes ${snap.status ? snap.status.process_count : 'n/a'}`);
              break;
            }

            case 'clear':
              output.innerHTML = '';
              break;

            case 'pwd':
              print(JARVIS.FS.pwd());
              break;

            case 'whoami':
              print('commander@stark-mainframe (Security: Level 9)');
              break;

            case 'date':
              print(new Date().toString());
              break;

            case 'echo':
              print(args.join(' '));
              break;

            case 'ls':
              try {
                const list = JARVIS.FS.ls(args[0] || '');
                const formatted = list.map(item => (item.type === 'dir' ? `[DIR]  ${item.name}/` : `[FILE] ${item.name} (${item.size} B)`));
                print(formatted.join('\\n') || '(empty directory)');
              } catch (err) {
                print(err.message, 'error');
              }
              break;

            case 'cd':
              try {
                JARVIS.FS.cd(args[0] || '/home/stark');
                prompt.textContent = `stark@jarvis:${JARVIS.FS.cwd}$`;
              } catch (err) {
                print(err.message, 'error');
              }
              break;

            case 'cat':
              if (!args[0]) {
                print('Usage: cat <filename>', 'warn');
              } else {
                try {
                  print(JARVIS.FS.cat(args[0]));
                } catch (err) {
                  print(err.message, 'error');
                }
              }
              break;

            case 'touch':
              if (!args[0]) {
                print('Usage: touch <filename>', 'warn');
              } else {
                try {
                  JARVIS.FS.touch(args[0], '');
                  print(`Created file: ${args[0]}`);
                } catch (err) {
                  print(err.message, 'error');
                }
              }
              break;

            case 'mkdir':
              if (!args[0]) {
                print('Usage: mkdir <dirname>', 'warn');
              } else {
                try {
                  JARVIS.FS.mkdir(args[0]);
                  print(`Created directory: ${args[0]}`);
                } catch (err) {
                  print(err.message, 'error');
                }
              }
              break;

            case 'rm':
              if (!args[0]) {
                print('Usage: rm <target>', 'warn');
              } else {
                try {
                  JARVIS.FS.rm(args[0]);
                  print(`Deleted: ${args[0]}`);
                } catch (err) {
                  print(err.message, 'error');
                }
              }
              break;

            case 'neofetch': {
              let rendered = false;
              if (JARVIS.Core.online) {
                try {
                  const card = await JARVIS.Core.neofetch();
                  print((card.lines || []).join('\\n'), 'info');
                  rendered = true;
                } catch (e) {}
              }
              if (!rendered) {
                const ascii = [
                  '          .---.          ',
                  '         /     \\\\         OS: J.A.R.V.I.S. OS 7.0.1 x86_64',
                  '        | () () |        Host: Stark Industries Arc Mainframe',
                  '         \\\\  ^  /        Python Core: OFFLINE // simulated card',
                  '          |||||          Uptime: 42 days, 13 hours',
                  '          \'---\'          Shell: stark-sh 4.2',
                  '         /     \\\\         Resolution: 3840x2160 (HUD Holo)',
                  '        /|     |\\\\        CPU: JARVIS Neural Array @ 4.8 THz',
                  '       (_|     |_)       Memory: 41.2 PB / 256 PB'
                ];
                print(ascii.join('\\n'), 'info');
              }
              break;
            }

            case 'exit':
              JARVIS.WM.close(win.id);
              break;

            default:
              print(`command not found: ${cmd}. Type "help" for valid directives.`, 'error');
          }
        };

        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            const val = input.value;
            input.value = '';
            exec(val).catch(error => print(error.message, 'error'));
          } else if (e.key === 'ArrowUp') {
            if (historyIdx > 0) {
              historyIdx--;
              input.value = history[historyIdx] || '';
            }
          } else if (e.key === 'ArrowDown') {
            if (historyIdx < history.length - 1) {
              historyIdx++;
              input.value = history[historyIdx] || '';
            } else {
              historyIdx = history.length;
              input.value = '';
            }
          }
        };

        el.onclick = () => input.focus();
        setTimeout(() => input.focus(), 50);
      }
    },

    // ----------------------------------------------------
    // File Manager
    // ----------------------------------------------------
    files: {
      name: 'File Manager // VFS',
      icon: 'folder',
      width: 760,
      height: 500,
      render(el) {
        el.className = 'app-files';
        el.innerHTML = `
          <div class="files-sidebar">
            <div style="font-family:'Orbitron';font-size:0.75rem;color:var(--cyan);margin-bottom:12px;letter-spacing:1.5px;">SYSTEM DRIVES</div>
            <div class="files-sidebar-item active" data-path="/home/stark">
              <i data-lucide="home" style="width:14px;height:14px"></i> /home/stark
            </div>
            <div class="files-sidebar-item" data-path="/home/stark/Documents">
              <i data-lucide="folder" style="width:14px;height:14px"></i> Documents
            </div>
            <div class="files-sidebar-item" data-path="/home/stark/Projects">
              <i data-lucide="folder" style="width:14px;height:14px"></i> Projects
            </div>
            <div class="files-sidebar-item" data-path="/system">
              <i data-lucide="cpu" style="width:14px;height:14px"></i> /system
            </div>
          </div>
          <div class="files-main">
            <div class="files-breadcrumb">
              PATH: <span id="filesCurrentPath">/home/stark</span>
            </div>
            <div class="files-grid" id="filesGrid"></div>
          </div>
        `;

        const grid = el.querySelector('#filesGrid');
        const pathLabel = el.querySelector('#filesCurrentPath');
        let currentDir = '/home/stark';

        const refresh = (dir) => {
          currentDir = dir;
          pathLabel.innerHTML = '';
          const parts = dir.split('/').filter(Boolean);

          const rootSpan = document.createElement('span');
          rootSpan.textContent = '/';
          rootSpan.onclick = () => refresh('/');
          pathLabel.appendChild(rootSpan);

          let accum = '';
          parts.forEach(p => {
            accum += '/' + p;
            const target = accum;
            const slash = document.createTextNode(' > ');
            const seg = document.createElement('span');
            seg.textContent = p;
            seg.onclick = () => refresh(target);
            pathLabel.appendChild(slash);
            pathLabel.appendChild(seg);
          });

          grid.innerHTML = '';

          try {
            const items = JARVIS.FS.ls(dir);
            if (dir !== '/') {
              const back = document.createElement('div');
              back.className = 'file-item';
              back.innerHTML = `
                <div class="file-icon" style="color:var(--amber);"><i data-lucide="corner-left-up"></i></div>
                <div class="file-name">..</div>
              `;
              back.ondblclick = () => {
                const up = dir.substring(0, dir.lastIndexOf('/')) || '/';
                refresh(up);
              };
              grid.appendChild(back);
            }

            items.forEach(item => {
              const fileEl = document.createElement('div');
              fileEl.className = 'file-item';
              const isDir = item.type === 'dir';
              const iconName = isDir ? 'folder' : (item.name.endsWith('.md') ? 'file-code' : 'file-text');
              const iconColor = isDir ? 'var(--amber)' : 'var(--cyan)';

              fileEl.innerHTML = `
                <div class="file-icon" style="color:${iconColor};"><i data-lucide="${iconName}"></i></div>
                <div class="file-name">${item.name}</div>
              `;

              fileEl.ondblclick = () => {
                const fullPath = (dir === '/' ? '' : dir) + '/' + item.name;
                if (isDir) {
                  refresh(fullPath);
                } else {
                  JARVIS.WM.open('editor', { filePath: fullPath });
                }
              };

              grid.appendChild(fileEl);
            });
          } catch (e) {
            grid.innerHTML = `<div style="color:var(--red);padding:20px;">${e.message}</div>`;
          }

          if (window.lucide && lucide.createIcons) lucide.createIcons();
        };

        el.querySelectorAll('.files-sidebar-item').forEach(btn => {
          btn.onclick = () => {
            el.querySelectorAll('.files-sidebar-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            refresh(btn.dataset.path);
          };
        });

        refresh(currentDir);
      }
    },

    // ----------------------------------------------------
    // System Diagnostics / Monitor
    // ----------------------------------------------------
    monitor: {
      name: 'Diagnostics // System Monitor',
      icon: 'activity',
      width: 680,
      height: 560,
      render(el, win) {
        el.className = 'app-monitor';
        el.innerHTML = `
          <div class="monitor-section monitor-core-head">
            <div class="monitor-title">PYTHON CORE // <span id="monState" class="monitor-core-state">PROBING</span></div>
            <div class="monitor-stat"><span>Endpoint:</span><span class="stat-val" id="monEndpoint">${JARVIS.Utils.escapeHtml(JARVIS.Core.baseUrl)}</span></div>
            <div class="monitor-stat"><span>Telemetry Source:</span><span class="stat-val" id="monSource">simulated // waiting for core</span></div>
          </div>
          <div class="monitor-section">
            <div class="monitor-title">NEURAL PROCESSING UNIT // CPU TELEMETRY</div>
            <canvas class="monitor-canvas" id="cpuChart"></canvas>
            <div class="monitor-stat"><span>Core Frequency:</span><span class="stat-val" id="cpuFreq">n/a</span></div>
            <div class="monitor-stat"><span>Aggregate Load:</span><span class="stat-val" id="cpuPct">0%</span></div>
            <div class="monitor-stat"><span>Load Average:</span><span class="stat-val" id="cpuLoad">n/a</span></div>
          </div>
          <div class="monitor-section">
            <div class="monitor-title">QUANTUM RAM ALLOCATION</div>
            <canvas class="monitor-canvas" id="ramChart"></canvas>
            <div class="monitor-stat"><span>Active Utilization:</span><span class="stat-val" id="ramPct">0%</span></div>
            <div class="monitor-stat"><span>Disk Capacity:</span><span class="stat-val" id="diskPct">n/a</span></div>
            <div class="monitor-stat"><span>Network I/O:</span><span class="stat-val" id="netRate">n/a</span></div>
          </div>
          <div class="monitor-section" style="flex:1;">
            <div class="monitor-title">TOP CONSUMPTION PROCESSES</div>
            <div class="process-list" id="monProcesses">
              <div class="process-header"><div>PROCESS NAME</div><div>PID</div><div>CPU%</div><div>RAM</div></div>
              <div class="process-row"><div>waiting for python core...</div><div>--</div><div>--</div><div>--</div></div>
            </div>
          </div>
        `;

        const cpuCanvas = el.querySelector('#cpuChart');
        const ramCanvas = el.querySelector('#ramChart');
        const cpuLabel = el.querySelector('#cpuPct');
        const ramLabel = el.querySelector('#ramPct');
        const freqLabel = el.querySelector('#cpuFreq');
        const loadLabel = el.querySelector('#cpuLoad');
        const diskLabel = el.querySelector('#diskPct');
        const netLabel = el.querySelector('#netRate');
        const stateLabel = el.querySelector('#monState');
        const sourceLabel = el.querySelector('#monSource');
        const endpointLabel = el.querySelector('#monEndpoint');
        const processList = el.querySelector('#monProcesses');

        const initCanvas = (canvas) => {
          if (!canvas) return;
          canvas.width = canvas.offsetWidth || 580;
          canvas.height = 110;
        };
        setTimeout(() => { initCanvas(cpuCanvas); initCanvas(ramCanvas); }, 50);

        const cpuHistory = Array(50).fill(0);
        const ramHistory = Array(50).fill(0);

        const drawChart = (canvas, data, strokeColor, fillColor) => {
          if (!canvas) return;
          if (!canvas.width) canvas.width = canvas.offsetWidth || 580;
          const ctx = canvas.getContext('2d');
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
          ctx.lineWidth = 1;
          for (let y = 20; y < h; y += 25) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          ctx.beginPath();
          const step = w / (data.length - 1);
          data.forEach((val, idx) => {
            const x = idx * step;
            const y = h - (val / 100) * h;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          ctx.fillStyle = fillColor;
          ctx.fill();
        };

        const pushSample = (cpuPercent, ramPercent) => {
          cpuHistory.shift();
          cpuHistory.push(cpuPercent);
          ramHistory.shift();
          ramHistory.push(ramPercent);
          drawChart(cpuCanvas, cpuHistory, '#00f0ff', 'rgba(0, 240, 255, 0.15)');
          drawChart(ramCanvas, ramHistory, '#0088ff', 'rgba(0, 136, 255, 0.15)');
        };

        const renderProcesses = (processes) => {
          if (!processList || !processes || !processes.processes) return;
          const rows = processes.processes.map(process => `
            <div class="process-row">
              <div>${JARVIS.Utils.escapeHtml(process.name)}</div>
              <div>${process.pid}</div>
              <div>${Number(process.cpu_percent || 0).toFixed(1)}%</div>
              <div>${JARVIS.Utils.bytes(process.memory_rss)}</div>
            </div>
          `).join('');
          processList.innerHTML = `
            <div class="process-header"><div>PROCESS NAME</div><div>PID</div><div>CPU%</div><div>RAM</div></div>
            ${rows || '<div class="process-row"><div>no processes returned</div><div>--</div><div>--</div><div>--</div></div>'}
          `;
        };

        const applyTelemetry = (data, processes) => {
          if (!data) return false;
          const cpu = data.cpu || {};
          const memory = data.memory || {};
          const disk = data.disk || {};
          const network = data.network || {};
          const cpuPercent = Number(cpu.percent || 0);
          const ramPercent = Number(memory.percent || 0);

          if (cpuLabel) cpuLabel.textContent = `${cpuPercent.toFixed(1)}%`;
          if (ramLabel) ramLabel.textContent = `${JARVIS.Utils.bytes(memory.used)} / ${JARVIS.Utils.bytes(memory.total)} (${ramPercent.toFixed(1)}%)`;
          if (freqLabel) freqLabel.textContent = cpu.frequency_mhz ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz` : 'n/a';
          if (loadLabel) loadLabel.textContent = (cpu.load_average || []).map(v => Number(v).toFixed(2)).join(', ') || 'n/a';
          if (diskLabel) diskLabel.textContent = `${JARVIS.Utils.bytes(disk.used)} / ${JARVIS.Utils.bytes(disk.total)} (${Number(disk.percent || 0).toFixed(1)}%)`;
          if (netLabel) netLabel.textContent = `up ${JARVIS.Utils.bytes(network.upload_bps)}/s // down ${JARVIS.Utils.bytes(network.download_bps)}/s`;
          if (sourceLabel) sourceLabel.textContent = `${data.source || 'unknown'} // Python ${data.python_version || '?'}`;
          renderProcesses(processes);
          pushSample(cpuPercent, ramPercent);
          return true;
        };

        const simulate = () => {
          const cpuPercent = Math.floor(30 + Math.random() * 45);
          const ramPercent = Math.floor(58 + Math.random() * 10);
          if (cpuLabel) cpuLabel.textContent = `${cpuPercent}%`;
          if (ramLabel) ramLabel.textContent = `${ramPercent}% (simulated)`;
          if (freqLabel) freqLabel.textContent = '4.80 GHz (simulated)';
          if (loadLabel) loadLabel.textContent = 'simulated';
          if (diskLabel) diskLabel.textContent = 'simulated';
          if (netLabel) netLabel.textContent = 'simulated';
          if (sourceLabel) sourceLabel.textContent = 'simulated // python core offline';
          pushSample(cpuPercent, ramPercent);
        };

        const setStatus = (snap) => {
          if (!stateLabel) return;
          stateLabel.textContent = (snap.state || 'offline').toUpperCase();
          stateLabel.classList.remove('online', 'offline', 'probing');
          stateLabel.classList.add(snap.state || 'offline');
          if (endpointLabel) endpointLabel.textContent = snap.baseUrl || 'n/a';
          if (!snap.online && sourceLabel) sourceLabel.textContent = snap.error || 'python core offline';
        };

        const unsubscribe = JARVIS.Core.subscribe(snap => {
          setStatus(snap);
          if (snap.telemetry) applyTelemetry(snap.telemetry, snap.processes);
        });
        win.el._cleanups.push(unsubscribe);
        setTimeout(() => JARVIS.Core.poll(), 100);

        const interval = setInterval(() => {
          const snap = JARVIS.Core.snapshot();
          if (snap.telemetry) {
            applyTelemetry(snap.telemetry, snap.processes);
          } else {
            simulate();
          }
        }, 1200);

        win.el._intervals.push(interval);
      }
    },

    // ----------------------------------------------------
    // Python Core Bridge / Control Center
    // ----------------------------------------------------
    core: {
      name: 'Python Core // Bridge',
      icon: 'cpu',
      width: 780,
      height: 600,
      render(el, win) {
        el.className = 'app-core';
        el.innerHTML = `
          <div class="core-hero">
            <div class="core-orb"><i data-lucide="cpu"></i></div>
            <div class="core-hero-copy">
              <div class="core-kicker">PYTHON CORE // FASTAPI + PSUTIL</div>
              <div class="core-title"><span id="coreStateDot" class="core-dot offline"></span><span id="coreStateText">PROBING LINK</span></div>
              <div class="core-sub" id="coreSub">Connecting to the local intelligence service...</div>
            </div>
            <button class="core-btn" id="coreRefreshBtn" type="button">REFRESH</button>
          </div>

          <div class="core-metrics">
            <div class="core-metric">
              <span>CPU</span>
              <strong id="coreCpu">--</strong>
              <small id="coreCpuSub">waiting for telemetry</small>
            </div>
            <div class="core-metric">
              <span>MEMORY</span>
              <strong id="coreMem">--</strong>
              <small id="coreMemSub">waiting for telemetry</small>
            </div>
            <div class="core-metric">
              <span>DISK</span>
              <strong id="coreDisk">--</strong>
              <small id="coreDiskSub">waiting for telemetry</small>
            </div>
            <div class="core-metric">
              <span>NETWORK</span>
              <strong id="coreNet">--</strong>
              <small id="coreNetSub">waiting for telemetry</small>
            </div>
          </div>

          <div class="core-columns">
            <section class="core-panel">
              <div class="core-panel-title">CORE METADATA</div>
              <div class="core-kv"><span>Endpoint</span><code id="coreEndpoint">${JARVIS.Utils.escapeHtml(JARVIS.Core.baseUrl)}</code></div>
              <div class="core-kv"><span>Version</span><code id="coreVersion">--</code></div>
              <div class="core-kv"><span>Python</span><code id="corePython">--</code></div>
              <div class="core-kv"><span>Platform</span><code id="corePlatform">--</code></div>
              <div class="core-kv"><span>Host</span><code id="coreHost">--</code></div>
              <div class="core-kv"><span>Uptime</span><code id="coreUptime">--</code></div>
              <div class="core-kv"><span>Directives</span><code id="coreCommandCount">--</code></div>
              <div class="core-kv"><span>Telemetry</span><code id="coreSource">--</code></div>
              <div class="core-auth-row">
                <input id="corePasscode" type="password" placeholder="CORE PASSCODE" autocomplete="off">
                <button class="core-btn primary" id="coreAuthBtn" type="button">AUTH</button>
                <button class="core-btn" id="coreDocsBtn" type="button">DOCS</button>
              </div>
              <div class="core-note" id="coreNote"></div>
            </section>

            <section class="core-panel">
              <div class="core-panel-title">TOP PROCESSES</div>
              <div class="core-process-list" id="coreProcesses">
                <div class="core-process-head"><span>PROCESS</span><span>PID</span><span>CPU</span><span>RSS</span></div>
                <div class="core-process-row"><span>waiting for core...</span><span>--</span><span>--</span><span>--</span></div>
              </div>
            </section>
          </div>

          <section class="core-panel core-console-panel">
            <div class="core-panel-title">DIRECTIVE CONSOLE</div>
            <div class="core-console" id="coreConsole"></div>
            <div class="core-run-row">
              <span class="core-prompt">&gt;</span>
              <input id="coreDirective" type="text" placeholder="sysinfo  |  ps  |  neofetch  |  core" autocomplete="off" spellcheck="false">
              <button class="core-btn primary" id="coreRunBtn" type="button">RUN</button>
            </div>
          </section>
        `;

        const stateDot = el.querySelector('#coreStateDot');
        const stateText = el.querySelector('#coreStateText');
        const subText = el.querySelector('#coreSub');
        const endpointEl = el.querySelector('#coreEndpoint');
        const versionEl = el.querySelector('#coreVersion');
        const pythonEl = el.querySelector('#corePython');
        const platformEl = el.querySelector('#corePlatform');
        const hostEl = el.querySelector('#coreHost');
        const uptimeEl = el.querySelector('#coreUptime');
        const commandCountEl = el.querySelector('#coreCommandCount');
        const sourceEl = el.querySelector('#coreSource');
        const noteEl = el.querySelector('#coreNote');
        const cpuEl = el.querySelector('#coreCpu');
        const cpuSubEl = el.querySelector('#coreCpuSub');
        const memEl = el.querySelector('#coreMem');
        const memSubEl = el.querySelector('#coreMemSub');
        const diskEl = el.querySelector('#coreDisk');
        const diskSubEl = el.querySelector('#coreDiskSub');
        const netEl = el.querySelector('#coreNet');
        const netSubEl = el.querySelector('#coreNetSub');
        const processEl = el.querySelector('#coreProcesses');
        const consoleEl = el.querySelector('#coreConsole');
        const directiveInput = el.querySelector('#coreDirective');
        const passcodeInput = el.querySelector('#corePasscode');
        let cwd = '/home/operator';

        const log = (text, type = '') => {
          const line = document.createElement('div');
          line.className = `core-console-line ${type}`.trim();
          line.textContent = text;
          consoleEl.appendChild(line);
          consoleEl.scrollTop = consoleEl.scrollHeight;
        };

        const renderProcesses = (processes) => {
          if (!processes || !processes.processes) return;
          const rows = processes.processes.map(process => `
            <div class="core-process-row">
              <span>${JARVIS.Utils.escapeHtml(process.name)}</span>
              <span>${process.pid}</span>
              <span>${Number(process.cpu_percent || 0).toFixed(1)}%</span>
              <span>${JARVIS.Utils.bytes(process.memory_rss)}</span>
            </div>
          `).join('');
          processEl.innerHTML = `
            <div class="core-process-head"><span>PROCESS</span><span>PID</span><span>CPU</span><span>RSS</span></div>
            ${rows || '<div class="core-process-row"><span>no processes returned</span><span>--</span><span>--</span><span>--</span></div>'}
          `;
        };

        const render = (snap) => {
          const online = !!snap.online;
          if (stateDot) {
            stateDot.classList.remove('online', 'offline', 'probing');
            stateDot.classList.add(snap.state || 'offline');
          }
          if (stateText) stateText.textContent = online ? 'LINK ACTIVE' : (snap.state === 'probing' ? 'PROBING LINK' : 'CORE OFFLINE');
          if (subText) {
            subText.textContent = online
              ? `${snap.health.service || 'jarvis-core'} // Python ${snap.health.python_version || '?'} // ${snap.health.telemetry_source || 'telemetry'}`
              : (snap.error || 'Python core not reachable.');
          }
          if (endpointEl) endpointEl.textContent = snap.baseUrl || 'n/a';
          if (versionEl) versionEl.textContent = snap.health ? snap.health.version : '--';
          if (pythonEl) pythonEl.textContent = snap.health ? snap.health.python_version : '--';
          if (platformEl) platformEl.textContent = snap.health ? snap.health.platform : '--';
          if (hostEl) hostEl.textContent = snap.health ? snap.health.hostname : '--';
          if (uptimeEl) uptimeEl.textContent = snap.health ? JARVIS.Utils.duration(snap.health.uptime_seconds) : '--';
          if (commandCountEl) commandCountEl.textContent = snap.status ? snap.status.command_count : '--';
          if (sourceEl) sourceEl.textContent = snap.health ? snap.health.telemetry_source : '--';

          if (snap.telemetry) {
            const telemetry = snap.telemetry;
            const cpu = telemetry.cpu || {};
            const memory = telemetry.memory || {};
            const disk = telemetry.disk || {};
            const network = telemetry.network || {};
            if (cpuEl) cpuEl.textContent = `${Number(cpu.percent || 0).toFixed(1)}%`;
            if (cpuSubEl) cpuSubEl.textContent = cpu.frequency_mhz ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz // ${cpu.physical_cores || '?'}C / ${cpu.logical_cores || '?'}T` : 'frequency n/a';
            if (memEl) memEl.textContent = `${Number(memory.percent || 0).toFixed(1)}%`;
            if (memSubEl) memSubEl.textContent = `${JARVIS.Utils.bytes(memory.used)} / ${JARVIS.Utils.bytes(memory.total)}`;
            if (diskEl) diskEl.textContent = `${Number(disk.percent || 0).toFixed(1)}%`;
            if (diskSubEl) diskSubEl.textContent = `${JARVIS.Utils.bytes(disk.used)} / ${JARVIS.Utils.bytes(disk.total)}`;
            if (netEl) netEl.textContent = `${JARVIS.Utils.bytes(network.upload_bps)}/s`;
            if (netSubEl) netSubEl.textContent = `down ${JARVIS.Utils.bytes(network.download_bps)}/s`;
          } else {
            [cpuEl, memEl, diskEl, netEl].forEach(node => { if (node) node.textContent = '--'; });
          }

          renderProcesses(snap.processes);

          if (noteEl) {
            if (online) {
              noteEl.innerHTML = 'Bearer token is minted on demand for write and command endpoints. Tokens are HMAC signed and short lived.';
            } else {
              noteEl.innerHTML = 'Start the local core:<br><code>python -m pip install -r requirements.txt</code><br><code>python run_jarvis_core.py</code>';
            }
          }
        };

        const refresh = async (announce = true) => {
          await JARVIS.Core.poll(true);
          if (announce) {
            if (JARVIS.Core.online) log(`CORE LINK ACTIVE // ${JARVIS.Core.baseUrl}`, 'info');
            else log(`CORE OFFLINE // ${JARVIS.Core.lastError}`, 'error');
          }
          render(JARVIS.Core.snapshot());
        };

        const runDirective = async () => {
          const directive = directiveInput.value.trim();
          if (!directive) return;
          log(`> ${directive}`);
          directiveInput.value = '';
          if (!JARVIS.Core.online) await JARVIS.Core.poll();
          if (!JARVIS.Core.online) {
            log(`Python core offline // ${JARVIS.Core.lastError}`, 'error');
            log('Start it with: python run_jarvis_core.py', 'warn');
            return;
          }
          try {
            const result = await JARVIS.Core.command(directive, cwd);
            (result.output || []).forEach(line => log(line));
            if (result.cwd) cwd = result.cwd;
            if (result.exit_code) log(`[exit code ${result.exit_code}]`, 'error');
          } catch (error) {
            log(JARVIS.Core.describeError(error), 'error');
          }
        };

        el.querySelector('#coreRefreshBtn').onclick = () => refresh(true);
        el.querySelector('#coreRunBtn').onclick = () => runDirective();
        el.querySelector('#coreDocsBtn').onclick = () => {
          if (!JARVIS.Core.online) {
            JARVIS.Notify.show('CORE OFFLINE', 'Start the Python core before opening the API docs.');
            return;
          }
          window.open(JARVIS.Core.docsUrl(), '_blank', 'noopener');
        };
        el.querySelector('#coreAuthBtn').onclick = async () => {
          const passcode = passcodeInput.value || JARVIS.Core.passcode;
          try {
            await JARVIS.Core.login(passcode);
            passcodeInput.value = '';
            log('CORE AUTHENTICATED // bearer token acquired', 'info');
            JARVIS.Notify.show('PYTHON CORE', 'Authenticated directives unlocked.');
            await refresh(false);
          } catch (error) {
            log(`AUTH FAILED // ${JARVIS.Core.describeError(error)}`, 'error');
          }
        };
        directiveInput.onkeydown = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            runDirective();
          }
        };

        const unsubscribe = JARVIS.Core.subscribe(render);
        win.el._cleanups.push(unsubscribe);

        log('PYTHON CORE BRIDGE // READY', 'info');
        log('Directives: sysinfo, ps, neofetch, core, metrics', 'muted');
        log('Writes and commands use a short-lived HMAC bearer token.', 'muted');
        JARVIS.Core.poll(true).then(() => render(JARVIS.Core.snapshot()));
      }
    },

    // ----------------------------------------------------
    // Notepad / Text Editor
    // ----------------------------------------------------
    editor: {
      name: 'Text Editor // Scratchpad',
      icon: 'file-text',
      width: 680,
      height: 460,
      render(el, win, opts = {}) {
        el.className = 'app-editor';
        el.innerHTML = `
          <div class="editor-toolbar">
            <button class="editor-toolbar-btn" id="edNew">NEW</button>
            <button class="editor-toolbar-btn" id="edSave">SAVE FILE</button>
            <button class="editor-toolbar-btn" id="edStats">WORD COUNT</button>
            <span style="font-family:'Share Tech Mono';font-size:0.75rem;color:var(--text-muted);margin-left:auto;" id="edStatus">UNSAVED</span>
          </div>
          <div class="editor-body">
            <div class="editor-line-numbers" id="edLineNums">1</div>
            <textarea class="editor-textarea" id="edArea" spellcheck="false" placeholder="INITIALIZE DOCUMENT ENTRY..."></textarea>
          </div>
        `;

        const area = el.querySelector('#edArea');
        const lines = el.querySelector('#edLineNums');
        const status = el.querySelector('#edStatus');

        let currentPath = opts.filePath || '/home/stark/Documents/untitled.txt';
        if (opts.filePath) {
          try {
            area.value = JARVIS.FS.cat(opts.filePath);
            status.textContent = opts.filePath;
          } catch (e) {}
        }

        const updateLines = () => {
          const count = area.value.split('\\n').length;
          let nums = '';
          for (let i = 1; i <= count; i++) nums += i + '\\n';
          lines.textContent = nums;
        };

        area.oninput = updateLines;
        area.onscroll = () => { lines.scrollTop = area.scrollTop; };
        updateLines();

        el.querySelector('#edNew').onclick = () => {
          area.value = '';
          updateLines();
          status.textContent = 'NEW SCRATCHPAD';
        };

        el.querySelector('#edSave').onclick = () => {
          try {
            JARVIS.FS.touch(currentPath, area.value);
            status.textContent = `SAVED: ${currentPath}`;
            JARVIS.Notify.show('FILE SYNCHRONIZED', `Saved buffer to ${currentPath}`);
          } catch (e) {
            JARVIS.Notify.show('SAVE FAILED', e.message);
          }
        };

        el.querySelector('#edStats').onclick = () => {
          const words = area.value.trim() ? area.value.trim().split(/\\s+/).length : 0;
          const chars = area.value.length;
          const lineCount = area.value.split('\\n').length;
          JARVIS.Notify.show('TELEMETRY STATS', `Words: ${words} | Characters: ${chars} | Lines: ${lineCount}`);
        };
      }
    },

    // ----------------------------------------------------
    // Calculator
    // ----------------------------------------------------
    calc: {
      name: 'Calculator // Math Matrix',
      icon: 'calculator',
      width: 340,
      height: 480,
      render(el) {
        el.className = 'app-calc';
        el.innerHTML = `
          <div class="calc-display">
            <div class="calc-expr" id="calcExpr"></div>
            <div class="calc-result" id="calcRes">0</div>
          </div>
          <div class="calc-buttons">
            <button class="calc-btn clear" data-val="C">C</button>
            <button class="calc-btn op" data-val="+/-">±</button>
            <button class="calc-btn op" data-val="%">%</button>
            <button class="calc-btn op" data-val="/">÷</button>

            <button class="calc-btn" data-val="7">7</button>
            <button class="calc-btn" data-val="8">8</button>
            <button class="calc-btn" data-val="9">9</button>
            <button class="calc-btn op" data-val="*">×</button>

            <button class="calc-btn" data-val="4">4</button>
            <button class="calc-btn" data-val="5">5</button>
            <button class="calc-btn" data-val="6">6</button>
            <button class="calc-btn op" data-val="-">−</button>

            <button class="calc-btn" data-val="1">1</button>
            <button class="calc-btn" data-val="2">2</button>
            <button class="calc-btn" data-val="3">3</button>
            <button class="calc-btn op" data-val="+">+</button>

            <button class="calc-btn" style="grid-column: span 2;" data-val="0">0</button>
            <button class="calc-btn" data-val=".">.</button>
            <button class="calc-btn equals" data-val="=">=</button>
          </div>
        `;

        const exprEl = el.querySelector('#calcExpr');
        const resEl = el.querySelector('#calcRes');
        let current = '0';
        let expression = '';

        el.querySelectorAll('.calc-btn').forEach(btn => {
          btn.onclick = () => {
            JARVIS.Audio.click();
            const val = btn.dataset.val;

            if (val === 'C') {
              current = '0';
              expression = '';
            } else if (val === '=') {
              try {
                const evalStr = (expression + current).replace(/×/g, '*').replace(/÷/g, '/');
                current = String(eval(evalStr));
                expression = '';
              } catch (e) {
                current = 'ERR';
              }
            } else if (['+', '-', '*', '/'].includes(val)) {
              expression += current + ' ' + (val === '*' ? '×' : val === '/' ? '÷' : val) + ' ';
              current = '0';
            } else if (val === '+/-') {
              current = String(-parseFloat(current || 0));
            } else if (val === '%') {
              current = String(parseFloat(current || 0) / 100);
            } else {
              if (current === '0' && val !== '.') current = val;
              else current += val;
            }

            exprEl.textContent = expression;
            resEl.textContent = current;
          };
        });
      }
    },

    // ----------------------------------------------------
    // System Settings & Customization
    // ----------------------------------------------------
    settings: {
      name: 'System // Preferences',
      icon: 'settings',
      width: 620,
      height: 440,
      render(el) {
        el.className = 'app-settings';
        el.innerHTML = `
          <div class="settings-sidebar">
            <div class="settings-nav-item active" data-tab="theme">THEME HUD</div>
            <div class="settings-nav-item" data-tab="specs">CORE SPECS</div>
            <div class="settings-nav-item" data-tab="sound">AUDIO MATRIX</div>
          </div>
          <div class="settings-panel" id="settingsPanel">
            <div class="settings-group-title">HOLOGRAPHIC ACCENT PALETTE</div>
            <p style="font-family:'Share Tech Mono';color:var(--text-muted);font-size:0.85rem;margin-bottom:1.5rem;">
              Select a quantum tint to dynamically alter the HUD luminescence spectrum across all modules.
            </p>
            <div style="display:flex;gap:14px;margin-bottom:2rem;">
              <button class="color-swatch" style="background:#00f0ff;border-color:#00f0ff;" data-color="#00f0ff" title="Arc Cyan"></button>
              <button class="color-swatch" style="background:#00ff88;border-color:#00ff88;" data-color="#00ff88" title="Vibranium Green"></button>
              <button class="color-swatch" style="background:#ffaa00;border-color:#ffaa00;" data-color="#ffaa00" title="Stark Amber"></button>
              <button class="color-swatch" style="background:#ff3344;border-color:#ff3344;" data-color="#ff3344" title="Mark VII Crimson"></button>
              <button class="color-swatch" style="background:#b344ff;border-color:#b344ff;" data-color="#b344ff" title="Tesseract Purple"></button>
            </div>
            <div class="settings-row">
              <span class="settings-label">Global Audio FX</span>
              <button class="card-action-btn" id="setToggleAudio" style="padding:4px 12px;background:rgba(0,240,255,0.1);border:1px solid var(--cyan);color:var(--cyan);font-family:'Share Tech Mono';cursor:pointer;">
                ${JARVIS.Audio.enabled ? 'STATUS: ACTIVE' : 'STATUS: MUTED'}
              </button>
            </div>
          </div>
        `;

        el.querySelectorAll('.color-swatch').forEach(swatch => {
          swatch.onclick = () => {
            const color = swatch.dataset.color;
            document.documentElement.style.setProperty('--cyan', color);
            JARVIS.Notify.show('HUD SPECTRUM SHIFT', `Primary quantum glow remapped to ${color}`);
            JARVIS.Audio.click();
          };
        });

        const toggleBtn = el.querySelector('#setToggleAudio');
        if (toggleBtn) {
          toggleBtn.onclick = () => {
            JARVIS.Audio.enabled = !JARVIS.Audio.enabled;
            toggleBtn.textContent = JARVIS.Audio.enabled ? 'STATUS: ACTIVE' : 'STATUS: MUTED';
            JARVIS.Notify.show('AUDIO SYNTHESIZER', JARVIS.Audio.enabled ? 'Audio telemetry enabled' : 'Muted');
          };
        }
      }
    }
  };

  /* ==========================================================================
     8. BOOT SEQUENCE & AUTHENTICATION
     ========================================================================== */
  JARVIS.Boot = {
    start() {
      const bootScreen = document.getElementById('boot-screen');
      const bootLog = document.getElementById('boot-log');
      const progressBar = document.getElementById('boot-progress-bar');
      const loginScreen = document.getElementById('login-screen');
      const osViewport = document.getElementById('os-viewport');

      JARVIS.Audio.bootChord();

      const logLines = [
        'INITIALIZING STARK INDUSTRIES BIOS v7.0.1...',
        'CPU: JARVIS Neural Processing Unit (128 Cores) [ONLINE]',
        'MEM: Quantum Solid RAM Mapping (256 PB) [VERIFIED]',
        'GPU: Holographic Vector Renderer Array [SYNCED]',
        'NET: Campus Neural Mesh Interface [CONNECTED]',
        'SEC: Zero-Trust Cryptographic Layer [ARMED]',
        'ALL SUBSYSTEMS NOMINAL // STANDBY FOR AUTH'
      ];

      let lineIdx = 0;
      const logInterval = setInterval(() => {
        if (lineIdx < logLines.length) {
          const div = document.createElement('div');
          div.textContent = `> ${logLines[lineIdx]}`;
          div.style.marginBottom = '4px';
          bootLog.appendChild(div);
          bootLog.scrollTop = bootLog.scrollHeight;
          JARVIS.Audio.beep(800 + lineIdx * 100, 0.04, 'sine', 0.02);
          lineIdx++;
        }
      }, 250);

      let pct = 0;
      const progressInterval = setInterval(() => {
        pct += 2.5;
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (pct >= 100) {
          clearInterval(progressInterval);
          clearInterval(logInterval);

          setTimeout(() => {
            bootScreen.style.opacity = '0';
            bootScreen.style.transition = 'opacity 0.6s ease';
            setTimeout(() => {
              bootScreen.style.display = 'none';
              loginScreen.style.display = 'flex';
              JARVIS.Audio.beep(1200, 0.1, 'triangle', 0.08);
            }, 600);
          }, 400);
        }
      }, 50);

      // Login handler
      const loginBtn = document.getElementById('login-btn');
      const loginPass = document.getElementById('login-password');
      const loginStatus = document.getElementById('login-status');
      const scanLine = document.querySelector('.login-scan-line');

      const authenticate = () => {
        const entered = loginPass.value;

        if (entered !== '151627') {
          JARVIS.Audio.error();
          loginStatus.textContent = 'ACCESS DENIED // INVALID PASSPHRASE';
          loginStatus.style.color = 'var(--red)';
          loginPass.value = '';
          loginPass.focus();
          
          const card = document.querySelector('.login-card');
          if (card) {
            card.style.animation = 'none';
            void card.offsetWidth;
            card.style.animation = 'shakeCard 0.4s ease';
          }
          return;
        }

        loginStatus.textContent = 'VERIFYING BIOMETRICS & NEURAL SIGNATURE...';
        loginStatus.style.color = 'var(--cyan)';
        if (scanLine) scanLine.style.display = 'block';
        JARVIS.Audio.beep(550, 0.3, 'sine', 0.08);

        setTimeout(() => {
          loginStatus.textContent = 'ACCESS GRANTED // WELCOME OPERATOR';
          loginStatus.style.color = 'var(--green)';
          JARVIS.Audio.loginChime();

          setTimeout(() => {
            loginScreen.style.opacity = '0';
            loginScreen.style.transition = 'opacity 0.5s ease';
            setTimeout(() => {
              loginScreen.style.display = 'none';
              osViewport.style.display = 'flex';
              JARVIS.InitDesktop();
            }, 500);
          }, 700);
        }, 1200);
      };

      if (loginBtn) loginBtn.onclick = authenticate;
      if (loginPass) {
        loginPass.onkeydown = (e) => {
          if (e.key === 'Enter') authenticate();
        };
      }
    }
  };

  /* ==========================================================================
     9. DESKTOP INITIALIZATION
     ========================================================================== */
  JARVIS.InitDesktop = function () {
    JARVIS.Taskbar.initClock();
    JARVIS.Menus.init();
    JARVIS.Core.init();

    // Bind desktop icon launchers
    document.querySelectorAll('.desktop-icon').forEach(icon => {
      icon.ondblclick = () => {
        const appId = icon.dataset.app;
        if (appId) JARVIS.WM.open(appId);
      };
      icon.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
        icon.classList.add('selected');
        JARVIS.Audio.click();
      };
    });

    document.getElementById('desktop').addEventListener('click', (e) => {
      if (!e.target.closest('.desktop-icon')) {
        document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
      }
    });

    // Auto-open Terminal on startup
    setTimeout(() => {
      JARVIS.WM.open('terminal');
      JARVIS.Notify.show('J.A.R.V.I.S. ONLINE', 'Autonomous defense and project hub workspace ready.');
    }, 400);

    if (window.lucide && lucide.createIcons) lucide.createIcons();
  };

  /* ==========================================================================
     10. ENTRY POINT
     ========================================================================== */
  window.addEventListener('DOMContentLoaded', () => {
    JARVIS.Boot.start();
  });

})();
