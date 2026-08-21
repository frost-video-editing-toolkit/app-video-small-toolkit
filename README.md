# FFmpeg Video Workbench

English README. Japanese version: [`README.md`](./README.md)

---

## Overview
A desktop app for running video processing tasks from a **React + Electron** UI.  
All video work is executed by `ffmpeg` commands called from the Electron main process (TypeScript). No Python required at runtime.

> [!WARNING]
> **This app will not work unless `ffmpeg` is available on the machine.**  
> Before running it, make sure `ffmpeg` is added to your `PATH` or set via `FFMPEG_PATH`.

## Operations available in the UI
| Operation | Description |
|---|---|
| **Crop** | Crop by X/Y/W/H — supports single file, multiple files, or a folder |
| **Cut** | Extract a clip between start and end time |
| **Trim** | Auto-split a video by a fixed interval |
| **Merge** | Concatenate multiple mp4 files in order |
| **Loop** | Repeat a single video a specified number of times |
| **RemoveSilence** | Detect and remove silent parts for faster pacing |

## Architecture
```text
React UI (Renderer)
        ↓ IPC
Electron Main Process (TypeScript)
        ↓ child_process.spawn()
ffmpeg command
        ↓
processed .mp4 output
```

## Setup
```bash
npm install
npm --prefix ui install
```

## First thing to check
This app directly depends on the `ffmpeg` command.  
**If `ffmpeg` is not installed and available, crop/cut/merge and the other video actions will fail.**

## ffmpeg requirement
Make sure `ffmpeg` is available in one of these ways:

1. Added to your system `PATH`
2. Or set through the `FFMPEG_PATH` environment variable

```powershell
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
```

### Quick command list (Windows PowerShell)

#### 1. Install ffmpeg with winget
```powershell
winget install --id Gyan.FFmpeg -e
ffmpeg -version
```

#### 2. Point directly to ffmpeg.exe
```powershell
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
ffmpeg -version
```

#### 3. Verify that it is available
```powershell
ffmpeg -version
where.exe ffmpeg
```

> If `ffmpeg` is still not recognized, restart VS Code or your terminal.

### Setup with a batch file
A distributable Windows helper is also included:

- [setup-ffmpeg-windows.bat](setup-ffmpeg-windows.bat)

Running this file will guide users through checking `ffmpeg`, installing it with `winget`, and saving `FFMPEG_PATH` if needed.

## Run in development
```bash
npm run dev
```

## Run with the built UI
```bash
npm run react:build
npm run start
```

## Main scripts
| Command | Description |
|---|---|
| `npm run dev` | Start React dev server + Electron + TypeScript watch together |
| `npm run electron:build` | Compile the Electron TypeScript files |
| `npm run react:build` | Build the renderer UI for production |
| `npm run start` | Launch Electron with the built UI |
| `npm run dist:win` | Build a Windows x64 installer |
| `npm run dist:win:all` | Build Windows x64 + ia32 installers |
| `npm run dist:mac` | Build a macOS package |
| `npm run dist:dir` | Build an unpacked directory (for quick testing) |

---

## record_script (separate download and run)
`record_script/` is a standalone **Python script**, independent of the desktop app.  
Use it when you need to send automatic key inputs to a game window — for example, while recording a game.

### Download
Download the `record_script/` folder from the repository.

```
record_script/
├── direct-game-input.py   # main script
├── requirements.txt       # dependencies
└── README.md              # detailed usage
```

### Install dependencies
```bash
pip install -r record_script/requirements.txt
```

### Run
```bash
python record_script/direct-game-input.py
```

> **Note**: Windows only. Administrator privileges may be required.  
> See [`record_script/README.md`](./record_script/README.md) for full details.


