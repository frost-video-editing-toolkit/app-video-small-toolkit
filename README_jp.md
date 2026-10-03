# FFmpeg Video Workbench

**日本語版 README** です。英語版は [`README.md`](./README.md) を参照してください。

---

## 概要
`React + Tauri` の UI から動画処理を実行するデスクトップアプリです。
動画処理は Tauri 経由で Go ワーカーに渡し、Go から `ffmpeg` コマンドを呼び出します。実行時に Python は不要です。

> [!WARNING]
> **このアプリは `ffmpeg` が使える環境でないと動作しません。**  
> 初回起動前に、必ず `ffmpeg` を `PATH` に追加するか、`FFMPEG_PATH` を設定してください。

## 主な機能

- Python を実行時に必要とせず、デスクトップ UI から FFmpeg の動画処理を実行できます。
- 対応する処理では、1本の動画・複数の動画・フォルダ単位で入力できます。
- 出力ファイルまたは出力フォルダを指定し、処理後の保存先を確認できます。
- 処理の進捗表示、実行中のキャンセル、タイムスタンプ付きの実行履歴に対応しています。
- UI の表示言語を日本語・英語・ドイツ語から切り替えられます。

## 動画処理の一覧
| 操作 | 説明 |
|---|---|
| **Crop（切り抜き）** | X/Y/W/H を指定して動画を切り抜きます。1本・複数本・フォルダに対応します。 |
| **Cut（切り出し）** | 開始時間から終了時間までを1本の動画から切り出します。 |
| **Trim（分割）** | 指定した間隔で動画を自動分割します。 |
| **Merge（結合）** | 複数の mp4 を選択した順番で連結します。 |
| **Loop（繰り返し）** | 1本の動画を指定回数繰り返して書き出します。 |
| **RemoveSilence（無音除去）** | 無音区間を検出・削除し、テンポのよい動画にします。 |

通常は、処理内容のサフィックスとタイムスタンプを付けた `.mp4` ファイルとして出力します。

## アーキテクチャ
```text
React UI
        ↓ Tauri command
Tauri host (Rust)
        ↓ Go worker
ffmpeg command
        ↓
処理済み動画 (.mp4)
```

## 技術選定理由

| 技術 | 役割 | 選定理由 |
|---|---|---|
| **React** | デスクトップUI | 既存のUI資産を活用でき、コンポーネント単位で整理・テストしやすいためです。 |
| **Tauri** | デスクトップシェル・ネイティブ連携 | システムのWebViewを利用するためElectronよりアプリを軽量化でき、Rustを介してファイル選択やワーカープロセスを安全に扱えるためです。 |
| **Rust** | Tauriホストプロセス | OS連携、コマンド呼び出し、パッケージ内リソースへのアクセスを、コンパイル時の型チェック付きで実装できるためです。 |
| **Go** | 動画処理ワーカー | 外部プロセスの管理が簡潔で、独立した動画処理を上限付きで並列化しやすいためです。 |
| **FFmpeg** | 動画処理エンジン | コーデックやフィルターを自作せず、実績のある広範な動画処理機能を利用できるためです。 |

複数動画の独立した処理はGo側で並列化し、コーデック単位のマルチスレッド処理はFFmpegに任せます。CPUやストレージを過剰に使用しないよう、同時実行数には上限を設けます。一方で、開発・パッケージングにはRustとGoの両方が必要で、FFmpegも `PATH`、`FFMPEG_PATH`、または同梱環境から利用できる必要があります。

## セットアップ
```bash
npm install
npm --prefix ui install
```

Tauri の開発には、Rust・Cargo・Go が `PATH` から実行できる必要があります。

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
npm run tauri:dev
```

## 本番ビルド済み UI で起動
```bash
npm run tauri:build
```

## 主なコマンド
| コマンド | 説明 |
|---|---|
| `npm run tauri:dev` | React 開発サーバーとTauriデスクトップアプリを起動 |
| `npm run worker:build` | Go製FFmpegワーカーをWindows向けにビルド |
| `npm run react:build` | React UI を本番ビルド |
| `npm run tauri:build` | GoワーカーとTauriアプリをビルド |

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

