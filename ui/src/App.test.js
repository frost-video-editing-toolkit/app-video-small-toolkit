import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

test('renders current heading and primary action', () => {
  render(<App />);

  expect(
    screen.getByRole('heading', { name: /video tools|動画ツール/i })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /run|実行/i })
  ).toBeInTheDocument();
});

test('shows operation tabs for crop, trim, merge and loop', () => {
  render(<App />);

  expect(screen.getByRole('button', { name: /crop|切り抜き/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /trim|分割/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /merge|結合/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /loop|繰り返し/i })).toBeInTheDocument();
});

test('uses Japanese labels by default for primary controls', () => {
  render(<App />);

  expect(screen.getByRole('button', { name: /実行/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ファイルを選択/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /choose files/i })).not.toBeInTheDocument();
});

test('shows flag buttons and can switch to German', () => {
  render(<App />);

  const jaButton = screen.getByRole('button', { name: /日本語/i });
  const enButton = screen.getByRole('button', { name: /english/i });
  const deButton = screen.getByRole('button', { name: /deutsch/i });

  expect(jaButton).toBeInTheDocument();
  expect(enButton).toBeInTheDocument();
  expect(deButton).toBeInTheDocument();
  expect(jaButton).toHaveTextContent(/jp/i);
  expect(enButton).toHaveTextContent(/en/i);
  expect(deButton).toHaveTextContent(/de/i);
  expect(jaButton).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(deButton);

  expect(deButton).toHaveAttribute('aria-pressed', 'true');
  expect(jaButton).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('heading', { name: /video-tools/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ausführen/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/eingabedateien/i)).toBeInTheDocument();
});

test('shows input files field on the trim tab', () => {
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /trim|分割/i }));

  expect(screen.getByLabelText(/input files|入力ファイル/i)).toBeInTheDocument();
});

test('shows a preview panel on the cut tab', () => {
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /cut|切り出し/i }));
  fireEvent.change(screen.getByLabelText(/input files|入力ファイル/i), {
    target: { value: 'C:\\videos\\input.mp4' },
  });

  expect(screen.getByText(/cut preview|切り出しプレビュー/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /set start to current time|現在位置を開始時間に設定/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /set end to current time|現在位置を終了時間に設定/i })).toBeInTheDocument();
});

test('shows simplified result details on the progress screen', async () => {
  const originalApi = window.videoEditor;
  window.videoEditor = {
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => [],
    onJobProgress: () => () => {},
    runVideoJob: async () => ({
      success: true,
      scriptMessage: 'done',
      historyLogPath: 'C:\\logs\\history.json',
      outputFile: 'C:\\videos\\done.mp4',
      outputDirectory: 'C:\\videos',
    }),
  };

  render(<App />);

  fireEvent.change(screen.getByLabelText(/input files|入力ファイル/i), {
    target: { value: 'C:\\videos\\input.mp4' },
  });
  fireEvent.change(screen.getByLabelText(/output file|出力ファイル/i), {
    target: { value: 'C:\\videos\\done.mp4' },
  });
  fireEvent.click(screen.getByRole('button', { name: /run|実行/i }));

  expect(await screen.findByText(/保存先/i)).toBeInTheDocument();
  expect(screen.getByText(/ファイル名/i)).toBeInTheDocument();
  expect(screen.queryByText(/script return:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/history log:/i)).not.toBeInTheDocument();

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('shows separate file and folder buttons and fills input files from a selected folder', async () => {
  const originalApi = window.videoEditor;
  window.videoEditor = {
    selectInputSource: async (options) => (
      options?.mode === 'folder'
        ? {
            directory: 'C:\\videos',
            files: ['C:\\videos\\clip1.mp4', 'C:\\videos\\clip2.mp4'],
          }
        : { directory: '', files: [] }
    ),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => [],
    onJobProgress: () => () => {},
    runVideoJob: async () => ({ success: true }),
  };

  render(<App />);

  expect(screen.getByRole('button', { name: /choose files|ファイルを選択/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /choose input folder|入力フォルダを選択/i })).toBeInTheDocument();
  expect(screen.queryByText(/1件以上指定可/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/mp4 一覧/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /choose input folder|入力フォルダを選択/i }));

  await waitFor(() => {
    expect(screen.getByLabelText(/input files|入力ファイル/i)).toHaveValue('C:\\videos\\clip1.mp4\nC:\\videos\\clip2.mp4');
  });
  expect(screen.getByLabelText(/input folder|入力フォルダ/i)).toHaveValue('C:\\videos');

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('allows choosing one folder file for the crop preview', async () => {
  const originalApi = window.videoEditor;
  window.videoEditor = {
    selectInputSource: async (options) => (
      options?.mode === 'folder'
        ? {
            directory: 'C:\\videos',
            files: ['C:\\videos\\clip1.mp4', 'C:\\videos\\clip2.mp4'],
          }
        : { directory: '', files: [] }
    ),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => [],
    onJobProgress: () => () => {},
    runVideoJob: async () => ({ success: true }),
  };

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /choose input folder|入力フォルダを選択/i }));

  expect(await screen.findByLabelText(/preview file|プレビュー対象ファイル/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/preview file|プレビュー対象ファイル/i), {
    target: { value: 'C:\\videos\\clip2.mp4' },
  });

  expect(screen.getByLabelText(/preview file|プレビュー対象ファイル/i)).toHaveValue('C:\\videos\\clip2.mp4');

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('cancels the running job when back is pressed on the progress screen', async () => {
  const originalApi = window.videoEditor;
  const cancelVideoJob = jest.fn(async () => true);

  window.videoEditor = {
    selectInputSource: async () => ({ files: [], directory: '' }),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => [],
    onJobProgress: () => () => {},
    cancelVideoJob,
    runVideoJob: () => new Promise(() => {}),
  };

  render(<App />);

  fireEvent.change(screen.getByLabelText(/input files|入力ファイル/i), {
    target: { value: 'C:\\videos\\input.mp4' },
  });
  fireEvent.change(screen.getByLabelText(/output file|出力ファイル/i), {
    target: { value: 'C:\\videos\\done.mp4' },
  });
  fireEvent.click(screen.getByRole('button', { name: /run|実行/i }));

  fireEvent.click(await screen.findByRole('button', { name: /back to editor|設定画面に戻る/i }));

  await waitFor(() => {
    expect(cancelVideoJob).toHaveBeenCalledTimes(1);
  });

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('shows progress updates for non-crop jobs', async () => {
  const originalApi = window.videoEditor;

  window.videoEditor = {
    selectInputSource: async () => ({ files: [], directory: '' }),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => [],
    cancelVideoJob: async () => true,
    onJobProgress: (listener) => {
      setTimeout(() => {
        listener({
          kind: 'cut',
          status: 'running',
          percent: 55,
          elapsedSeconds: 12,
          etaSeconds: 10,
          message: 'Cutting...',
        });
      }, 0);
      return () => {};
    },
    runVideoJob: () => new Promise(() => {}),
  };

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /cut|切り出し/i }));
  fireEvent.change(screen.getByLabelText(/input files|入力ファイル/i), {
    target: { value: 'C:\\videos\\input.mp4' },
  });
  fireEvent.change(screen.getByLabelText(/output file|出力ファイル/i), {
    target: { value: 'C:\\videos\\done.mp4' },
  });
  fireEvent.click(screen.getByRole('button', { name: /run|実行/i }));

  expect(await screen.findByText(/55.0%/i)).toBeInTheDocument();

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('formats legacy JST logs with the selected timezone and hides the JST suffix', async () => {
  const originalApi = window.videoEditor;

  window.videoEditor = {
    selectInputSource: async () => ({ files: [], directory: '' }),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => '',
    getOperationLogs: async () => ([
      {
        mode: 'cut',
        operation_start_time: '2026-04-19 10:00:00 JST',
        operation_end_time: '2026-04-19 10:30:00 JST',
        operation_duration: '30min0s',
        status: 'success',
      },
    ]),
    onJobProgress: () => () => {},
    runVideoJob: async () => ({ success: true }),
  };

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /view logs|ログ確認/i }));

  const timeZoneInput = await screen.findByLabelText(/display time zone|表示タイムゾーン/i);
  fireEvent.change(timeZoneInput, { target: { value: 'UTC' } });

  expect(await screen.findByText('2026-04-19 01:00:00')).toBeInTheDocument();
  expect(screen.queryByText(/JST/)).not.toBeInTheDocument();

  fireEvent.change(timeZoneInput, { target: { value: 'Asia/Tokyo' } });
  expect(await screen.findByText('2026-04-19 10:00:00')).toBeInTheDocument();

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});

test('shows input folder controls on the trim tab', () => {
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /trim|分割/i }));

  expect(screen.getByLabelText(/input folder|入力フォルダ/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /choose input folder|入力フォルダを選択/i })).toBeInTheDocument();
});

test('removeSilence can run with folder input like crop', async () => {
  const originalApi = window.videoEditor;
  const runVideoJob = jest.fn(async () => ({ success: true, outputDirectory: 'C:\\videos\\out' }));

  window.videoEditor = {
    selectInputSource: async (options) => (
      options?.mode === 'folder'
        ? {
            directory: 'C:\\videos\\in',
            files: ['C:\\videos\\in\\a.mp4', 'C:\\videos\\in\\b.mp4'],
          }
        : { directory: '', files: [] }
    ),
    selectInputFiles: async () => [],
    selectInputDirectory: async () => '',
    selectOutputFile: async () => '',
    selectOutputDirectory: async () => 'C:\\videos\\out',
    getOperationLogs: async () => [],
    onJobProgress: () => () => {},
    runVideoJob,
  };

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /removeSilence|無音除去/i }));
  fireEvent.click(screen.getByRole('button', { name: /choose input folder|入力フォルダを選択/i }));

  await waitFor(() => {
    expect(screen.getByLabelText(/input folder|入力フォルダ/i)).toHaveValue('C:\\videos\\in');
  });

  fireEvent.change(screen.getByLabelText(/output folder|出力フォルダ/i), {
    target: { value: 'C:\\videos\\out' },
  });
  fireEvent.click(screen.getByRole('button', { name: /run|実行/i }));

  await waitFor(() => {
    expect(runVideoJob).toHaveBeenCalled();
  });

  expect(runVideoJob.mock.calls[0][0]).toMatchObject({
    kind: 'removeSilence',
    inputDirectory: 'C:\\videos\\in',
    outputDirectory: 'C:\\videos\\out',
  });

  if (originalApi) {
    window.videoEditor = originalApi;
  } else {
    delete window.videoEditor;
  }
});
