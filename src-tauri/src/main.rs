use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

#[derive(Clone, Default)]
struct AppState {
    child_pid: Arc<Mutex<Option<u32>>>,
    cancelled_pids: Arc<Mutex<HashSet<u32>>>,
    logs: Arc<Mutex<Vec<Value>>>,
}

#[tauri::command]
async fn run_video_job(
    job: Value,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_video_job_blocking(job, app, state))
        .await
        .map_err(|error| error.to_string())?
}

fn run_video_job_blocking(
    job: Value,
    app: tauri::AppHandle,
    state: AppState,
) -> Result<Value, String> {
    let started_at = Utc::now();
    let started = Instant::now();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let (program, arguments, working_directory) = if cfg!(debug_assertions) {
        let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "failed to locate repository root".to_string())?
            .to_path_buf();
        ("go".to_string(), vec!["run".to_string(), ".".to_string()], repository.join("worker"))
    } else {
        let worker = if cfg!(target_os = "windows") {
            resource_dir.join("worker.exe")
        } else {
            resource_dir.join("worker")
        };
        (worker.to_string_lossy().to_string(), Vec::new(), resource_dir)
    };

    let mut command = Command::new(program);
    command.args(arguments);
    let mut child = command
        .current_dir(working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start Go worker: {error}"))?;

    let pid = child.id();
    *state.child_pid.lock().map_err(|_| "job state is poisoned")? = Some(pid);

    let payload = serde_json::to_vec(&job).map_err(|error| error.to_string())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open worker stdin".to_string())?
        .write_all(&payload)
        .map_err(|error| error.to_string())?;

    let stderr = child.stderr.take().ok_or_else(|| "failed to open worker stderr".to_string())?;
    let stderr_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).to_string()
    });

    let stdout = child.stdout.take().ok_or_else(|| "failed to open worker stdout".to_string())?;
    let mut result = json!({"success": false});
    let mut output_files = Vec::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|error| error.to_string())?;
        if let Ok(event) = serde_json::from_str::<Value>(&line) {
            if event.get("type").and_then(Value::as_str) == Some("result") {
                result = event.clone();
            }
            if event.get("type").and_then(Value::as_str) == Some("completed") {
                if let Some(output_file) = event.get("outputFile").and_then(Value::as_str) {
                    output_files.push(output_file.to_string());
                }
            }
            let _ = app.emit("video-job-progress", event);
        }
    }

    let output = child.wait().map_err(|error| format!("Go worker failed: {error}"))?;
    let stderr = stderr_thread.join().unwrap_or_default();
    let cancelled = state.cancelled_pids.lock().map_err(|_| "job state is poisoned")?.remove(&pid);
    *state.child_pid.lock().map_err(|_| "job state is poisoned")? = None;

    if let Some(output_file) = job.get("outputFile") {
        result["outputFile"] = output_file.clone();
    }
    if let Some(output_directory) = job.get("outputDirectory") {
        result["outputDirectory"] = output_directory.clone();
    }
    if !output_files.is_empty() {
        result["outputFiles"] = json!(output_files);
        if result.get("outputFile").is_none() {
            if let Some(first_output) = result["outputFiles"].get(0) {
                result["outputFile"] = first_output.clone();
            }
        }
    }

    let status = if cancelled { "cancelled" } else if output.success() { "success" } else { "failed" };
    let end = Utc::now();
    let log = json!({
        "mode": job.get("kind").cloned().unwrap_or(Value::String("unknown".to_string())),
        "operation_start_time": started_at.to_rfc3339(),
        "operation_end_time": end.to_rfc3339(),
        "operation_duration": format!("{:.1}s", started.elapsed().as_secs_f64()),
        "status": status,
    });
    state.logs.lock().map_err(|_| "job state is poisoned")?.push(log);

    if output.success() && !cancelled {
        Ok(result)
    } else if cancelled {
        Ok(json!({"success": false, "cancelled": true, "stderr": "Job cancelled"}))
    } else {
        Err(if stderr.is_empty() { result.to_string() } else { stderr })
    }
}

#[tauri::command]
fn cancel_video_job(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let pid = *state.child_pid.lock().map_err(|_| "job state is poisoned")?;
    let Some(pid) = pid else { return Ok(false); };
    let killed = if cfg!(target_os = "windows") {
        Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status().map(|status| status.success()).unwrap_or(false)
    } else {
        Command::new("kill").args(["-TERM", &pid.to_string()]).status().map(|status| status.success()).unwrap_or(false)
    };
    if killed {
        state.cancelled_pids.lock().map_err(|_| "job state is poisoned")?.insert(pid);
    }
    Ok(killed)
}

#[tauri::command]
fn get_operation_logs(state: tauri::State<'_, AppState>) -> Result<Vec<Value>, String> {
    Ok(state.logs.lock().map_err(|_| "job state is poisoned")?.clone())
}

#[tauri::command]
fn select_input_source(options: Value) -> Value {
    let mode = options.get("mode").and_then(Value::as_str).unwrap_or("file");
    if mode == "folder" {
        return json!({
            "files": [],
            "directory": rfd::FileDialog::new().pick_folder().map(|path| path.to_string_lossy().to_string()).unwrap_or_default()
        });
    }

    let multiple = options.get("multiple").and_then(Value::as_bool).unwrap_or(false);
    let files = if multiple {
        rfd::FileDialog::new()
            .add_filter("Video", &["mp4", "mov", "mkv", "avi", "webm"])
            .pick_files()
            .unwrap_or_default()
    } else {
        rfd::FileDialog::new()
            .add_filter("Video", &["mp4", "mov", "mkv", "avi", "webm"])
            .pick_file()
            .into_iter()
            .collect()
    };

    json!({
        "files": files.into_iter().map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>(),
        "directory": ""
    })
}

#[tauri::command]
fn select_input_files(options: Value) -> Vec<String> {
    select_input_source(json!({
        "mode": "file",
        "multiple": options.get("multiple").and_then(Value::as_bool).unwrap_or(false)
    }))
    .get("files")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter_map(|value| value.as_str().map(str::to_string))
    .collect()
}

#[tauri::command]
fn select_input_directory() -> String {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn select_output_file() -> String {
    rfd::FileDialog::new()
        .add_filter("MP4 video", &["mp4"])
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn select_output_directory() -> String {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            run_video_job,
            cancel_video_job,
            get_operation_logs,
            select_input_source,
            select_input_files,
            select_input_directory,
            select_output_file,
            select_output_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

fn main() {
    run();
}
