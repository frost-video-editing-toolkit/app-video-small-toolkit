# FFmpeg Video Workbench

**日本語版 README** です。英語版は [`README.en.md`](./README.en.md) を参照してください。

---

## 概要
`React + Electron` の UI から動画処理を実行するデスクトップアプリです。  
動画処理は **Node.js / TypeScript から `ffmpeg` コマンドを呼び出す構成**で、実行時に Python は不要です。

> [!WARNING]
> **このアプリは `ffmpeg` が使える環境でないと動作しません。**  
> 初回起動前に、必ず `ffmpeg` を `PATH` に追加するか、`FFMPEG_PATH` を設定してください。

## UI から実行できる処理
| 操作 | 説明 |
|---|---|
| **Crop** | 指定した X/Y/W/H で動画を切り抜く（1ファイル・複数ファイル・フォルダ対応） |
| **Cut** | 開始〜終了時間で1本を切り出す |
| **Trim** | 指定間隔で動画を自動分割する |
| **Merge** | 複数の mp4 を順番に連結する |
| **Loop** | 同一動画を指定回数繰り返して書き出す |
| **RemoveSilence** | 無音区間を検出・削除する |

## アーキテクチャ
```text
React UI (Renderer)
        ↓ IPC
Electron Main Process (TypeScript)
        ↓ child_process.spawn()
ffmpeg command
        ↓
処理済み動画 (.mp4)
```

## セットアップ
```bash
npm install
npm --prefix ui install
```

## 最初に確認すること
このアプリは `ffmpeg` コマンドを直接利用します。  
**`ffmpeg` が未導入のままだと、動画の切り抜き・切り出し・結合などは実行できません。**

## ffmpeg の準備
このアプリは `ffmpeg` コマンドを使用します。次のいずれかで利用可能にしてください。

1. `ffmpeg` を PATH に追加する
2. または `FFMPEG_PATH` 環境変数で実行ファイルのパスを指定する

```powershell
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
```

### すぐ使うためのコマンド集（Windows PowerShell）

#### 1. winget で ffmpeg を入れる
```powershell
winget install --id Gyan.FFmpeg -e
ffmpeg -version
```

#### 2. ffmpeg.exe の場所を直接指定する
```powershell
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
ffmpeg -version
```

#### 3. 認識されているか確認する
```powershell
ffmpeg -version
where.exe ffmpeg
```

> `ffmpeg` が見つからない場合は、VS Code やターミナルを再起動してください。

### バッチファイルでセットアップする
Windows ユーザー向けに、すぐ配布できるバッチファイルも用意しています。

- [setup-ffmpeg-windows.bat](setup-ffmpeg-windows.bat)

このファイルを実行すると、`ffmpeg` の確認、`winget` による導入、`FFMPEG_PATH` の保存をまとめて案内できます。

## 開発起動
```bash
npm run dev
```

## 本番ビルド済み UI で起動
```bash
npm run react:build
npm run start
```

## 主なコマンド
| コマンド | 説明 |
|---|---|
| `npm run dev` | React 開発サーバー + Electron + TypeScript watch を同時起動 |
| `npm run electron:build` | Electron 側 TypeScript をビルド |
| `npm run react:build` | React UI を本番ビルド |
| `npm run start` | ビルド済み UI を Electron で起動 |
| `npm run dist:win` | Windows 向け x64 インストーラーを作成 |
| `npm run dist:win:all` | Windows 向け x64 + ia32 インストーラーを作成 |
| `npm run dist:mac` | macOS 向けパッケージを作成 |
| `npm run dist:dir` | インストーラーなしの展開済みフォルダを作成（動作確認用） |

---

## ====record_script（別途ダウンロード・実行）====
`record_script/` はデスクトップアプリとは独立した **Python スクリプト**です。  
ツクールゲームなどの録画を行うためのEnterキー自動押下でのページ送り等に活用できます。


### ダウンロード

リポジトリから `record_script/` フォルダごとダウンロードしてください。

```
record_script/
├── direct-game-input.py   # メインスクリプト
├── requirements.txt       # 依存パッケージ
└── README.md              # 詳細な使い方
```

### 依存パッケージのインストール
```bash
pip install -r record_script/requirements.txt
```

### 実行
```bash
python record_script/direct-game-input.py
```

> **注意**: Windows 専用です。管理者権限が必要な場合があります。  
> 詳細は [`record_script/README.md`](./record_script/README.md) を参照してください。

