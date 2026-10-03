function invoke(command, args) {
  return window.__TAURI_INTERNALS__.invoke(command, args);
}

export const tauriVideoEditor = {
  selectInputSource: (options) => invoke('select_input_source', { options }),
  selectInputFiles: (options) => invoke('select_input_files', { options }),
  selectInputDirectory: () => invoke('select_input_directory'),
  selectOutputFile: () => invoke('select_output_file'),
  selectOutputDirectory: () => invoke('select_output_directory'),
  cancelVideoJob: () => invoke('cancel_video_job'),
  getOperationLogs: () => invoke('get_operation_logs'),
  onJobProgress: (callback) => {
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return () => {};

    let unsubscribe;
    const pending = listen('video-job-progress', (event) => {
      if (event.payload?.type !== 'result') callback(event.payload);
    });
    pending.then((cleanup) => {
      unsubscribe = cleanup;
    });
    return () => {
      if (unsubscribe) unsubscribe();
      else pending.then((cleanup) => cleanup());
    };
  },
  runVideoJob: (job) => invoke('run_video_job', { job }),
};
