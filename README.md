# ⚡ J.A.R.V.I.S. Operating System

[![Vercel Deployment](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Version](https://img.shields.io/badge/Version-7.0.1-00f0ff?style=for-the-badge)](https://github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-0088ff?style=for-the-badge)](LICENSE)
[![Theme: Stark HUD](https://img.shields.io/badge/Theme-Stark%20HUD-ffaa00?style=for-the-badge)](https://github.com)

> *"Welcome Monish Sir. All systems nominal. Telemetry online."*

**J.A.R.V.I.S. OS** is a fully responsive, holographic web-based operating system inspired by the Stark Industries Mark-series HUD interfaces. Built with pure HTML5, vanilla JavaScript, CSS custom properties, and Web Audio API synthesis — with zero heavy runtime frameworks and zero external audio dependencies.

---

## 🌟 Key Features

### 🖥️ 1. Stark Boot & Security Layer
* **BIOS POST Sequence**: Real-time diagnostic stream checking quantum RAM, neural accelerators, and mesh adapters with Web Audio synthesizer chords.
* **Biometric Login Gate**: 
  * Rotating Arc Reactor avatar core.
  * Holographic laser scanline animation.
  * **Master Passcode**: `151627` (strictly enforced with animated card-shake and audible alert denial on incorrect input).

### 🪟 2. Multi-Window Compositor (`JARVIS.WM`)
* **Full Window Lifecycle**: Open, minimize, maximize / restore, cascade offsets, and smooth close.
* **Drag & Resize**: Smooth dragging across viewport boundaries and interactive bottom-right resize grip.
* **Dynamic Z-Index Stacking**: Click anywhere on a window to focus and elevate.

### 🚀 3. Native App Suite
* 📟 **Terminal (`stark-sh`)**: Working command-line shell with persistent history (`↑` / `↓`), directory-aware prompts, and 14+ built-in directives including:
  * `neofetch` (Iron Man ASCII telemetry), `help`, `ls`, `cd`, `pwd`, `cat`, `touch`, `mkdir`, `rm`, `echo`, `date`, `whoami`, `clear`, `exit`.
* 📁 **File Manager**: In-memory virtual filesystem (`JARVIS.FS`) with drive navigation, breadcrumb path jumping, and double-click file opening.
* 📊 **Diagnostics / System Monitor**: Dual HTML5 canvas charts tracking CPU load and quantum RAM allocation in real time, plus a dynamic process list.
* ✏️ **Notepad / Text Editor**: Code and notes editor with synced line numbering, character/word counters, and virtual file saving.
* 🧮 **Calculator**: Matrix math interface with operations history and audio-feedback keys.
* ⚙️ **Settings**: Holographic color switcher that dynamically remaps the primary `--cyan` variable across all cards, windows, and glow filters.

### 🔊 4. Synthesized Audio Engine (`JARVIS.Audio`)
* Powered by the **Web Audio API** — generates futuristic UI bleeps, boot arpeggios, access granted chimes, and alert tones directly in the browser. Zero `.mp3` or `.wav` assets required. Includes global mute control.

---

## 🚀 Live Demo & Deployment

### Deploy to Vercel in 1 Click

You can deploy this repository instantly to Vercel without any build setup:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

#### Via Vercel CLI:
```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Deploy directly from the project directory
cd jarvis-os
vercel
```

---

## 💻 Local Quickstart

### Option A: Direct Browser Launch
Simply double-click `index.html` or run:
```bash
# Windows
start index.html

# macOS
open index.html

# Linux
xdg-open index.html
```

### Option B: Local HTTP Server (Recommended)
```bash
# Using Python
python -m http.server 3000

# Using Node.js
npx serve .
```
Navigate to `http://localhost:3000` in any modern web browser.

---

## ⌨️ Desktop Hotkey (Windows)

For Windows users, you can bind a global hotkey to pop open the OS from anywhere:
1. Run `hotkey_listener.py` with `pythonw.exe`.
2. Press **`Ctrl + Alt + P`** anywhere on your computer to open the OS immediately.

---

## 🔐 Credentials

| User | Passcode |
| :--- | :--- |
| **Monish Sir** | `151627` |

---

## 🛠️ Tech Stack

* **Frontend**: HTML5, Vanilla JavaScript (ES6+), CSS3 (Holographic Variables & Grid System)
* **Audio**: Web Audio API Oscillator & Gain Nodes
* **Graphics**: HTML5 Canvas 2D Telemetry Engines
* **Icons**: [Lucide Icons](https://lucide.dev)
* **Fonts**: Orbitron, Rajdhani, Share Tech Mono (Google Fonts)
* **Deployment**: Vercel Static Hosting (`vercel.json`)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
