# FFmpeg Video Workbench

English README. Japanese version: [`README_jp.md`](./README_jp.md)

---

## Overview
A desktop app for running video processing tasks from a **React + Tauri** UI.
Video jobs are dispatched through Tauri to a Go worker, which runs `ffmpeg` commands. No Python required at runtime.

> [!WARNING]
> **This app will not work unless `ffmpeg` is available on the machine.**  
> Before running it, make sure `ffmpeg` is added to your `PATH` or set via `FFMPEG_PATH`.


## Main features

- Run FFmpeg-based video processing from a desktop UI without Python at runtime.
- Select a single video, multiple videos, or a folder where supported.
- Choose an output file or output folder and review the generated file location.
- Track job progress, cancel a running job, and review operation history with timestamps.
- Switch the UI language between Japanese, English, and German.


## Video operations
| Operation | Description |
|---|---|
| **Crop** | Crop one or more videos by X/Y/W/H. Supports a single file, multiple files, or a folder. |
| **Cut** | Extract one clip from a video between a start time and an end time. |
| **Trim** | Split a video into clips at a fixed interval. |
| **Merge** | Concatenate multiple mp4 files in the selected order. |
| **Loop** | Repeat one video a specified number of times. |
| **RemoveSilence** | Detect and remove silent sections to create a faster-paced video. |

Most operations export `.mp4` files with an operation-specific suffix and a timestamp in the default filename.


## Architecture
```text
React UI
        ↓ Tauri command
Tauri host (Rust)
        ↓ Go worker
ffmpeg command
        ↓
processed .mp4 output
```

## Technology choices

| Technology | Role | Why it was selected |
|---|---|---|
| **React** | Desktop UI | Reuses the existing UI ecosystem and supports a clear, testable component structure. |
| **Tauri** | Desktop shell and native bridge | Produces a smaller desktop application than Electron by using the system WebView, while Rust provides a controlled native boundary for file dialogs and worker processes. |
| **Rust** | Tauri host process | Handles native application integration, command dispatch, and packaged-resource access with strong compile-time guarantees. |
| **Go** | Video worker | Provides simple process management and efficient bounded concurrency for independent video jobs. |
| **FFmpeg** | Video processing engine | Uses a mature, widely supported codec and filter implementation instead of reimplementing video processing logic. |

The Go worker parallelizes independent batch jobs, while FFmpeg remains responsible for codec-level multithreading. Concurrency is bounded to avoid overwhelming the CPU or storage device. The trade-off is that development and packaging require both Rust and Go toolchains, and FFmpeg must still be available through `PATH`, `FFMPEG_PATH`, or the packaged runtime environment.


## Setup
```bash
npm install
npm --prefix ui install
```

Tauri development also requires Rust, Cargo, and Go to be available on `PATH`.


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
npm run tauri:dev
```


## Run with the built UI
```bash
npm run tauri:build
```


## Main scripts
| Command | Description |
|---|---|
| `npm run tauri:dev` | Start the Tauri desktop app with the React development server |
| `npm run worker:build` | Build the Go FFmpeg worker for Windows |
| `npm run react:build` | Build the renderer UI for production |
| `npm run tauri:build` | Build the Go worker and Tauri application |

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


