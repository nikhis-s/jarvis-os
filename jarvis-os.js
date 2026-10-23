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

        print('STARK INDUSTRIES // MARK-VII SECURE SHELL', 'info');
        print('Type "help" for a list of available directives. Type "neofetch" for system telemetry.\\n');

        const exec = (cmdLine) => {
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
              print('  help         - Show directives summary');
              print('  clear        - Clear console stream');
              print('  ls [path]    - List files/folders');
              print('  cd <path>    - Change working directory');
              print('  cat <file>   - Output file content');
              print('  pwd          - Print active directory');
              print('  touch <file> - Create empty text file');
              print('  mkdir <dir>  - Create subfolder');
              print('  rm <target>  - Delete target');
              print('  echo <text>  - Echo text');
              print('  date         - Current satellite timestamp');
              print('  whoami       - Active user session');
              print('  neofetch     - Hardware & neural telemetry');
              print('  exit         - Terminate shell process');
              break;

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

            case 'neofetch':
              const ascii = [
                '          .---.          ',
                '         /     \\\\         OS: J.A.R.V.I.S. OS 7.0.1 x86_64',
                '        | () () |        Host: Stark Industries Arc Mainframe',
                '         \\\\  ^  /        Kernel: STARK_NT 7.0.1-Release',
                '          |||||          Uptime: 42 days, 13 hours',
                '          \'---\'          Shell: stark-sh 4.2',
                '         /     \\\\         Resolution: 3840x2160 (HUD Holo)',
                '        /|     |\\\\        CPU: JARVIS Neural Array @ 4.8 THz',
                '       (_|     |_)       Memory: 41.2 PB / 256 PB'
              ];
              print(ascii.join('\\n'), 'info');
              break;

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
            exec(val);
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
      width: 650,
      height: 520,
      render(el, win) {
        el.className = 'app-monitor';
        el.innerHTML = `
          <div class="monitor-section">
            <div class="monitor-title">NEURAL PROCESSING UNIT // CPU TELEMETRY</div>
            <canvas class="monitor-canvas" id="cpuChart"></canvas>
            <div class="monitor-stat"><span>Core Frequency:</span><span class="stat-val">4.80 GHz</span></div>
            <div class="monitor-stat"><span>Aggregate Load:</span><span class="stat-val" id="cpuPct">45%</span></div>
          </div>
          <div class="monitor-section">
            <div class="monitor-title">QUANTUM RAM ALLOCATION</div>
            <canvas class="monitor-canvas" id="ramChart"></canvas>
            <div class="monitor-stat"><span>Active Utilization:</span><span class="stat-val" id="ramPct">62% (158 PB / 256 PB)</span></div>
          </div>
          <div class="monitor-section" style="flex:1;">
            <div class="monitor-title">TOP CONSUMPTION PROCESSES</div>
            <div class="process-list">
              <div class="process-header"><div>PROCESS NAME</div><div>PID</div><div>CPU%</div><div>RAM</div></div>
              <div class="process-row"><div>jarvis-kernel</div><div>101</div><div>12.4%</div><div>2.1 PB</div></div>
              <div class="process-row"><div>holo-compositor</div><div>108</div><div>18.2%</div><div>8.4 PB</div></div>
              <div class="process-row"><div>stark-net-mesh</div><div>142</div><div>4.5%</div><div>1.2 PB</div></div>
              <div class="process-row"><div>biometric-eval</div><div>199</div><div>3.1%</div><div>0.8 PB</div></div>
            </div>
          </div>
        `;

        const cpuCanvas = el.querySelector('#cpuChart');
        const ramCanvas = el.querySelector('#ramChart');
        const cpuLabel = el.querySelector('#cpuPct');
        const ramLabel = el.querySelector('#ramPct');

        const initCanvas = (canvas) => {
          canvas.width = canvas.offsetWidth || 580;
          canvas.height = 110;
        };
        setTimeout(() => { initCanvas(cpuCanvas); initCanvas(ramCanvas); }, 50);

        const cpuHistory = Array(50).fill(35);
        const ramHistory = Array(50).fill(55);

        const drawChart = (canvas, data, strokeColor, fillColor) => {
          const ctx = canvas.getContext('2d');
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Grid lines
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
          ctx.lineWidth = 1;
          for (let y = 20; y < h; y += 25) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Line graph
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

          // Gradient fill under curve
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          ctx.fillStyle = fillColor;
          ctx.fill();
        };

        const interval = setInterval(() => {
          const newCpu = Math.floor(30 + Math.random() * 45);
          const newRam = Math.floor(58 + Math.random() * 10);
          cpuHistory.shift(); cpuHistory.push(newCpu);
          ramHistory.shift(); ramHistory.push(newRam);

          if (cpuLabel) cpuLabel.textContent = `${newCpu}%`;
          if (ramLabel) ramLabel.textContent = `${newRam}% (${Math.floor(256 * (newRam/100))} PB / 256 PB)`;

          drawChart(cpuCanvas, cpuHistory, '#00f0ff', 'rgba(0, 240, 255, 0.15)');
          drawChart(ramCanvas, ramHistory, '#0088ff', 'rgba(0, 136, 255, 0.15)');
        }, 800);

        win.el._intervals.push(interval);
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
