import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGE_OPTIONS } from './i18n/languageOptions';
import { I18N } from './i18n/translations';
import './App.css';

const OPERATION_DETAILS = {
  crop: {
    label: { ja: '切り抜き', en: 'crop', de: 'Zuschneiden' },
    description: {
      ja: '1本/複数/フォルダ指定の動画を同じ設定で切り抜きます。',
      en: 'Crop one file, multiple selected files, or all videos in a folder using one crop setting.',
      de: 'Schneide eine Datei, mehrere ausgewählte Dateien oder alle Videos in einem Ordner mit einer Zuschneideeinstellung zu.',
    },
    outputSuffix: 'cropped'
  },
  cut: {
    label: { ja: '切り出し', en: 'cut', de: 'Ausschneiden' },
    description: {
      ja: '開始時間と終了時間で1本を切り出します。',
      en: 'Cut one clip by start and end time.',
      de: 'Schneide einen Clip nach Start- und Endzeit.',
    },
    outputSuffix: 'cut'
  },
  trim: {
    label: { ja: '分割', en: 'trim', de: 'Teilen' },
    description: {
      ja: '指定間隔で動画を自動分割します（例: 01:00:00）。',
      en: 'Split a video by interval (e.g. 01:00:00).',
      de: 'Teile ein Video nach einem Intervall (z. B. 01:00:00).',
    },
    outputSuffix: 'trim-split'
  },
  merge: {
    label: { ja: '結合', en: 'merge', de: 'Zusammenfügen' },
    description: {
      ja: '複数の mp4 を順番に連結します。',
      en: 'Merge multiple mp4 files in order.',
      de: 'Füge mehrere mp4-Dateien in der Reihenfolge zusammen.',
    },
    outputSuffix: 'merged'
  },
  loop: {
    label: { ja: '繰り返し', en: 'loop', de: 'Wiederholen' },
    description: {
      ja: '同じ動画を指定回数繰り返して書き出します。',
      en: 'Repeat a video by a specified count.',
      de: 'Wiederhole ein Video eine bestimmte Anzahl von Malen.',
    },
    outputSuffix: 'loop'
  },
  removeSilence: {
    label: { ja: '無音除去', en: 'removeSilence', de: 'Stille entfernen' },
    description: {
      ja: '無音区間を検出して自動で詰め、テンポの良い動画にします。',
      en: 'Detect and remove silent parts to keep faster pacing.',
      de: 'Erkenne und entferne stille Abschnitte, um ein schnelleres Tempo beizubehalten.',
    },
    outputSuffix: 'nosilence'
  },
};

const browserPreviewApi = {
  selectInputSource: async () => ({ files: [], directory: '' }),
  selectInputFiles: async () => [],
  selectInputDirectory: async () => '',
  selectOutputFile: async () => '',
  selectOutputDirectory: async () => '',
  cancelVideoJob: async () => false,
  getOperationLogs: async () => [],
  onJobProgress: () => () => {},
  runVideoJob: async () => ({
    success: false,
    command: '',
    stdout: '',
    stderr: 'Electron 経由でアプリを起動してから実行してください。',
    scriptMessage: 'browser-preview: 実行できません。',
  }),
};

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateOnly(date = new Date()) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatDateTime(date = new Date()) {
  return `${formatDateOnly(date)}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function splitDirAndName(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return { dir, fileName };
}

function splitBaseAndExt(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return {
    base: dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName,
    ext: dotIndex >= 0 ? fileName.slice(dotIndex) : '.mp4',
  };
}

function buildDefaultOutputPath(operation, inputFiles, repeatCount = 3) {
  const nowDate = formatDateOnly();
  const nowDateTime = formatDateTime();

  if (operation === 'merge') {
    const first = inputFiles[0] || '';
    const { dir } = splitDirAndName(first);
    const fileName = `${nowDateTime}-merged.mp4`;
    return dir ? `${dir}\\${fileName}` : fileName;
  }

  if (operation === 'loop') {
    const first = inputFiles[0] || 'input.mp4';
    const { dir, fileName } = splitDirAndName(first);
    const { base } = splitBaseAndExt(fileName || 'input.mp4');
    const loopName = `${nowDate}-${base}-${Math.max(1, repeatCount)}x.mp4`;
    return dir ? `${dir}\\${loopName}` : loopName;
  }

  const first = inputFiles[0];
  if (!first) return `${OPERATION_DETAILS[operation].outputSuffix}.mp4`;

  const { dir, fileName } = splitDirAndName(first);
  const { base, ext } = splitBaseAndExt(fileName);
  const nextName = `${nowDateTime}-${base}-${OPERATION_DETAILS[operation].outputSuffix}${ext}`;

  return dir ? `${dir}\\${nextName}` : nextName;
}

function buildDefaultOutputDirectory(inputFiles) {
  const first = inputFiles[0];
  if (!first) return '';
  const { dir } = splitDirAndName(first);
  return dir;
}

function buildInputSummary(inputFiles, inputDirectory) {
  const count = inputFiles.length;
  const hasDirectoryInput = Boolean(inputDirectory && inputDirectory.trim());
  const hasFileInput = count > 0;

  return {
    count,
    hasDirectoryInput,
    hasFileInput,
    primaryInputFile: count >= 1 ? inputFiles[0] : '',
    isBatchForCrop: hasDirectoryInput || count >= 2,
    hasAnyInput: hasDirectoryInput || hasFileInput,
  };
}

function buildResultSummary(result, language) {
  if (!result) {
    return { saveLocation: '', fileName: '' };
  }

  const firstOutput = result.outputFile || (Array.isArray(result.outputFiles) ? result.outputFiles[0] : '') || '';
  const saveLocation = result.outputDirectory || (firstOutput ? splitDirAndName(firstOutput).dir : '');

  if (Array.isArray(result.outputFiles) && result.outputFiles.length > 1) {
    return {
      saveLocation,
      fileName: language === 'ja' ? `${result.outputFiles.length}件` : `${result.outputFiles.length} files`,
    };
  }

  return {
    saveLocation,
    fileName: firstOutput ? splitDirAndName(firstOutput).fileName : '',
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

function toFileUrl(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }
  return encodeURI(normalized);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTimeZoneOptions() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    // Fall through to defaults when not supported.
  }

  return [
    'UTC',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
  ];
}

function parseLogTimestamp(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(JST|UTC))?$/i
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second = '00', zone = 'JST'] = match;
  const offsetHours = zone.toUpperCase() === 'UTC' ? 0 : 9;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - offsetHours,
    Number(minute),
    Number(second)
  );

  const parsed = new Date(utcMs);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLogTimestamp(value, timeZone) {
  if (!value) return '-';

  const date = parseLogTimestamp(value);
  if (!date) {
    return String(value).replace(/\s+JST$/i, '').trim();
  }

  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const pick = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
  } catch {
    return String(value).replace(/\s+JST$/i, '').trim();
  }
}

function buildVideoJob(operation, payload) {
  const {
    inputFiles,
    inputDirectory,
    outputFile,
    outputDirectory,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    startTime,
    endTime,
    repeatCount,
    splitInterval,
    noiseThresholdDb,
    minSilenceDuration,
  } = payload;

  const inputSummary = buildInputSummary(inputFiles, inputDirectory);

  if (operation === 'crop') {
    return {
      kind: 'crop',
      inputFile: !inputSummary.hasDirectoryInput && inputSummary.count === 1 ? inputSummary.primaryInputFile : undefined,
      inputFiles: !inputSummary.hasDirectoryInput && inputSummary.count >= 2 ? inputFiles : undefined,
      inputDirectory: inputSummary.hasDirectoryInput ? inputDirectory : undefined,
      outputFile: outputFile || undefined,
      outputDirectory: outputDirectory || undefined,
      crop: {
        x: toNumber(cropX, 0),
        y: toNumber(cropY, 0),
        width: toNumber(cropWidth, 1280),
        height: toNumber(cropHeight, 720),
      },
    };
  }

  if (operation === 'cut') {
    return {
      kind: 'cut',
      inputFile: inputFiles[0],
      outputFile,
      startTime: startTime || '00:00:00',
      endTime: endTime || '',
    };
  }

  if (operation === 'trim') {
    return {
      kind: 'trim',
      inputFile: !inputSummary.hasDirectoryInput && inputSummary.count === 1 ? inputSummary.primaryInputFile : undefined,
      inputFiles: !inputSummary.hasDirectoryInput && inputSummary.count >= 2 ? inputFiles : undefined,
      inputDirectory: inputSummary.hasDirectoryInput ? inputDirectory : undefined,
      outputDirectory,
      splitInterval: splitInterval || '01:00:00',
    };
  }

  if (operation === 'loop') {
    return {
      kind: 'loop',
      inputFile: inputFiles[0],
      outputFile,
      repeatCount: Math.max(1, toNumber(repeatCount, 3)),
    };
  }

  if (operation === 'removeSilence') {
    return {
      kind: 'removeSilence',
      inputFile: !inputSummary.hasDirectoryInput && inputSummary.count === 1 ? inputSummary.primaryInputFile : undefined,
      inputFiles: !inputSummary.hasDirectoryInput && inputSummary.count >= 2 ? inputFiles : undefined,
      inputDirectory: inputSummary.hasDirectoryInput ? inputDirectory : undefined,
      outputFile: inputSummary.isBatchForCrop ? undefined : outputFile,
      outputDirectory: inputSummary.isBatchForCrop ? outputDirectory : undefined,
      noiseThresholdDb: toNumber(noiseThresholdDb, -32),
      minSilenceDuration: Math.max(0.1, toNumber(minSilenceDuration, 0.45)),
    };
  }

  return {
    kind: 'merge',
    inputFiles,
    outputFile,
  };
}

function App() {
  const api = useMemo(() => {
    if (typeof window !== 'undefined' && window.videoEditor) {
      return window.videoEditor;
    }
    return browserPreviewApi;
  }, []);

  const [language, setLanguage] = useState('ja');
  const [page, setPage] = useState('editor');
  const [operation, setOperation] = useState('crop');
  const [inputText, setInputText] = useState('');
  const [inputDirectory, setInputDirectory] = useState('');
  const [outputFile, setOutputFile] = useState('');
  const [outputDirectory, setOutputDirectory] = useState('');
  const [cropX, setCropX] = useState('0');
  const [cropY, setCropY] = useState('0');
  const [cropWidth, setCropWidth] = useState('1280');
  const [cropHeight, setCropHeight] = useState('720');
  const [startTime, setStartTime] = useState('00:00:05');
  const [endTime, setEndTime] = useState('00:00:30');
  const [splitInterval, setSplitInterval] = useState('01:00:00');
  const [repeatCount, setRepeatCount] = useState('3');
  const [noiseThresholdDb, setNoiseThresholdDb] = useState('-32');
  const [minSilenceDuration, setMinSilenceDuration] = useState('0.45');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [operationLogs, setOperationLogs] = useState([]);
  const [logTimeZone, setLogTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo');
  const [previewMeta, setPreviewMeta] = useState({ videoWidth: 0, videoHeight: 0, loading: false, error: '' });
  const [cropPreviewFile, setCropPreviewFile] = useState('');
  const [dragOverlay, setDragOverlay] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;

    try {
      return window.localStorage.getItem('video-editor-dark-mode') === '1';
    } catch {
      return false;
    }
  });
  const previewVideoRef = useRef(null);
  const previewStageRef = useRef(null);
  const dragStateRef = useRef(null);
  const cancelRequestedRef = useRef(false);

  const t = I18N[language];
  const inputFiles = useMemo(() => splitLines(inputText), [inputText]);
  const inputSummary = useMemo(() => buildInputSummary(inputFiles, inputDirectory), [inputFiles, inputDirectory]);
  const details = OPERATION_DETAILS[operation];
  const supportsFolderInput = operation === 'crop' || operation === 'trim' || operation === 'removeSilence';
  const usesOutputDirectory = operation === 'trim' || ((operation === 'crop' || operation === 'removeSilence') && inputSummary.isBatchForCrop);
  const cropPreviewInputFile = useMemo(() => {
    if (operation !== 'crop' && operation !== 'cut' && operation !== 'trim' && operation !== 'merge' && operation !== 'loop' && operation !== 'removeSilence') return '';
    return cropPreviewFile || inputSummary.primaryInputFile || '';
  }, [operation, cropPreviewFile, inputSummary.primaryInputFile]);
  const cropPreviewSrc = useMemo(() => toFileUrl(cropPreviewInputFile), [cropPreviewInputFile]);
  const timeZoneOptions = useMemo(() => {
    const options = getTimeZoneOptions();
    if (options.includes(logTimeZone)) return options;
    return [logTimeZone, ...options];
  }, [logTimeZone]);

  const cropRectStyle = useMemo(() => {
    if (!previewMeta.videoWidth || !previewMeta.videoHeight) {
      return { display: 'none' };
    }

    const x = toNumber(cropX, 0);
    const y = toNumber(cropY, 0);
    const width = toNumber(cropWidth, previewMeta.videoWidth);
    const height = toNumber(cropHeight, previewMeta.videoHeight);

    const leftPx = clamp(x, 0, previewMeta.videoWidth);
    const topPx = clamp(y, 0, previewMeta.videoHeight);
    const widthPx = clamp(width, 1, previewMeta.videoWidth - leftPx);
    const heightPx = clamp(height, 1, previewMeta.videoHeight - topPx);

    return {
      left: `${(leftPx / previewMeta.videoWidth) * 100}%`,
      top: `${(topPx / previewMeta.videoHeight) * 100}%`,
      width: `${(widthPx / previewMeta.videoWidth) * 100}%`,
      height: `${(heightPx / previewMeta.videoHeight) * 100}%`,
    };
  }, [previewMeta.videoWidth, previewMeta.videoHeight, cropX, cropY, cropWidth, cropHeight]);

  const resultSummary = useMemo(() => buildResultSummary(result, language), [result, language]);

  const canRun = (() => {
    if (operation === 'crop') {
      if (!inputSummary.hasAnyInput) return false;
      return usesOutputDirectory ? outputDirectory.trim() : outputFile.trim() || outputDirectory.trim();
    }

    if (operation === 'trim') {
      return inputSummary.hasAnyInput && outputDirectory.trim() && splitInterval.trim();
    }

    if (operation === 'removeSilence') {
      if (!inputSummary.hasAnyInput) return false;
      return usesOutputDirectory ? outputDirectory.trim() : outputFile.trim();
    }

    if (!outputFile.trim()) return false;
    if (operation === 'merge') return inputSummary.count >= 2;
    return inputSummary.hasFileInput;
  })();

  useEffect(() => {
    if (!api.onJobProgress) return undefined;

    const unsubscribe = api.onJobProgress((payload) => {
      if (!payload) return;
      setJobProgress(payload);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [api]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem('video-editor-dark-mode', darkMode ? '1' : '0');
    } catch {
      // Ignore storage errors (private mode / policy restrictions).
    }
  }, [darkMode]);

  useEffect(() => {
    if ((operation !== 'crop' && operation !== 'cut' && operation !== 'trim' && operation !== 'merge' && operation !== 'loop' && operation !== 'removeSilence') || inputFiles.length === 0) {
      setCropPreviewFile('');
      return;
    }

    setCropPreviewFile((prev) => (prev && inputFiles.includes(prev) ? prev : inputFiles[0]));
  }, [operation, inputFiles]);

  useEffect(() => {
    setPreviewMeta((prev) => ({ ...prev, error: '', loading: Boolean(cropPreviewSrc) }));
  }, [cropPreviewSrc]);

  function getRenderedVideoRect(videoEl) {
    const elW = videoEl.clientWidth;
    const elH = videoEl.clientHeight;
    const vidW = videoEl.videoWidth;
    const vidH = videoEl.videoHeight;
    if (!vidW || !vidH) return null;
    const elAspect = elW / elH;
    const vidAspect = vidW / vidH;
    let rendW, rendH, rendX, rendY;
    if (elAspect >= vidAspect) {
      rendH = elH;
      rendW = elH * vidAspect;
      rendX = (elW - rendW) / 2;
      rendY = 0;
    } else {
      rendW = elW;
      rendH = elW / vidAspect;
      rendX = 0;
      rendY = (elH - rendH) / 2;
    }
    return { x: rendX, y: rendY, width: rendW, height: rendH };
  }

  function handlePreviewMouseDown(e) {
    if (operation !== 'crop') return;
    if (!previewMeta.videoWidth || !previewMeta.videoHeight) return;
    e.preventDefault();
    const stage = previewStageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const startX = e.clientX - stageRect.left;
    const startY = e.clientY - stageRect.top;
    dragStateRef.current = { stageRect, startX, startY };
    setDragOverlay({ leftPct: (startX / stageRect.width) * 100, topPct: (startY / stageRect.height) * 100, widthPct: 0, heightPct: 0 });

    function onMouseMove(me) {
      const ds = dragStateRef.current;
      if (!ds) return;
      const cx = Math.min(Math.max(me.clientX - ds.stageRect.left, 0), ds.stageRect.width);
      const cy = Math.min(Math.max(me.clientY - ds.stageRect.top, 0), ds.stageRect.height);
      const minX = Math.min(cx, ds.startX);
      const minY = Math.min(cy, ds.startY);
      const maxX = Math.max(cx, ds.startX);
      const maxY = Math.max(cy, ds.startY);
      setDragOverlay({
        leftPct: (minX / ds.stageRect.width) * 100,
        topPct: (minY / ds.stageRect.height) * 100,
        widthPct: ((maxX - minX) / ds.stageRect.width) * 100,
        heightPct: ((maxY - minY) / ds.stageRect.height) * 100,
      });
    }

    function onMouseUp(me) {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      const ds = dragStateRef.current;
      dragStateRef.current = null;
      setDragOverlay(null);
      if (!ds) return;
      const video = previewVideoRef.current;
      if (!video) return;
      const rendRect = getRenderedVideoRect(video);
      if (!rendRect) return;
      const videoElRect = video.getBoundingClientRect();
      const videoElOffsetX = videoElRect.left - ds.stageRect.left;
      const videoElOffsetY = videoElRect.top - ds.stageRect.top;
      const cx = Math.min(Math.max(me.clientX - ds.stageRect.left, 0), ds.stageRect.width);
      const cy = Math.min(Math.max(me.clientY - ds.stageRect.top, 0), ds.stageRect.height);
      const rawMinX = Math.min(cx, ds.startX) - videoElOffsetX - rendRect.x;
      const rawMinY = Math.min(cy, ds.startY) - videoElOffsetY - rendRect.y;
      const rawMaxX = Math.max(cx, ds.startX) - videoElOffsetX - rendRect.x;
      const rawMaxY = Math.max(cy, ds.startY) - videoElOffsetY - rendRect.y;
      const scaleX = previewMeta.videoWidth / rendRect.width;
      const scaleY = previewMeta.videoHeight / rendRect.height;
      const vidX = Math.round(Math.max(rawMinX * scaleX, 0));
      const vidY = Math.round(Math.max(rawMinY * scaleY, 0));
      const vidW = Math.round(Math.min((rawMaxX - rawMinX) * scaleX, previewMeta.videoWidth - vidX));
      const vidH = Math.round(Math.min((rawMaxY - rawMinY) * scaleY, previewMeta.videoHeight - vidY));
      if (vidW > 0 && vidH > 0) {
        setCropX(String(vidX));
        setCropY(String(vidY));
        setCropWidth(String(vidW));
        setCropHeight(String(vidH));
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function formatVideoTimecode(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    const wholeSeconds = Math.floor(seconds);
    const frames = Math.round((seconds - wholeSeconds) * 100);
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(wholeSeconds).padStart(2, '0');
    return frames > 0 ? `${hh}:${mm}:${ss}.${String(frames).padStart(2, '0')}` : `${hh}:${mm}:${ss}`;
  }

  function applyPreviewTime(kind) {
    const video = previewVideoRef.current;
    if (!video) return;
    const timecode = formatVideoTimecode(video.currentTime);
    if (kind === 'start') {
      setStartTime(timecode);
      return;
    }
    setEndTime(timecode);
  }

  function applyInputSelection(selectedFiles = [], selectedDirectory = '') {
    if (selectedFiles.length > 0) {
      setInputText(selectedFiles.join('\n'));
    }

    if (supportsFolderInput) {
      setInputDirectory(selectedDirectory || '');
    }

    const baseDirectory = selectedDirectory || buildDefaultOutputDirectory(selectedFiles);
    if (operation === 'trim' || ((operation === 'crop' || operation === 'removeSilence') && (Boolean(selectedDirectory) || selectedFiles.length >= 2))) {
      if (!outputDirectory.trim() && baseDirectory) {
        setOutputDirectory(baseDirectory);
      }
      return;
    }

    if (selectedFiles.length > 0) {
      setOutputFile(buildDefaultOutputPath(operation, selectedFiles, toNumber(repeatCount, 3)));
    }
  }

  async function handleBrowseInput() {
    let selectedFiles = [];

    if (api.selectInputSource) {
      const selection = await api.selectInputSource({
        mode: 'files',
        multiple: operation === 'merge' || operation === 'crop' || operation === 'trim' || operation === 'removeSilence',
        defaultPath: inputDirectory || buildDefaultOutputDirectory(inputFiles) || '',
      });

      selectedFiles = Array.isArray(selection?.files) ? selection.files : [];
    } else {
      selectedFiles = await api.selectInputFiles({ multiple: operation === 'merge' || operation === 'crop' || operation === 'trim' || operation === 'removeSilence' });
    }

    if (!selectedFiles || selectedFiles.length === 0) return;
    applyInputSelection(selectedFiles, '');
  }

  async function handleBrowseInputDirectory() {
    let selectedFiles = [];
    let selectedDirectory = '';

    if (api.selectInputSource) {
      const selection = await api.selectInputSource({
        mode: 'folder',
        defaultPath: inputDirectory || buildDefaultOutputDirectory(inputFiles) || '',
      });

      selectedFiles = Array.isArray(selection?.files) ? selection.files : [];
      selectedDirectory = selection?.directory || '';
    } else {
      selectedDirectory = await api.selectInputDirectory({ defaultPath: inputDirectory || '' });
    }

    if ((!selectedFiles || selectedFiles.length === 0) && !selectedDirectory) return;
    applyInputSelection(selectedFiles, selectedDirectory);
  }

  async function handleBrowseOutput() {
    if (usesOutputDirectory) {
      const suggested = outputDirectory.trim() || buildDefaultOutputDirectory(inputFiles);
      const selected = await api.selectOutputDirectory({ defaultPath: suggested || '' });
      if (selected) {
        setOutputDirectory(selected);
      }
      return;
    }

    const suggested = outputFile.trim() || buildDefaultOutputPath(operation, inputFiles, toNumber(repeatCount, 3));
    const selected = await api.selectOutputFile({ defaultPath: suggested || `${operation}_output.mp4` });
    if (selected) {
      setOutputFile(selected);
    }
  }

  async function handleLoadLogs() {
    if (showLogs) {
      setShowLogs(false);
      return;
    }

    setLoadingLogs(true);
    try {
      const logs = await api.getOperationLogs();
      if (Array.isArray(logs)) {
        setOperationLogs(logs.slice().reverse());
      } else {
        setOperationLogs([]);
      }
      setShowLogs(true);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleRun() {
    const job = buildVideoJob(operation, {
      inputFiles,
      inputDirectory,
      outputFile,
      outputDirectory,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      startTime,
      endTime,
      repeatCount,
      splitInterval,
      noiseThresholdDb,
      minSilenceDuration,
    });

    cancelRequestedRef.current = false;
    setRunning(true);
    setPage('progress');
    setResult(null);
    setJobProgress(null);

    try {
      const nextResult = await api.runVideoJob(job);
      if (cancelRequestedRef.current) return;
      setResult(nextResult);
    } catch (error) {
      if (cancelRequestedRef.current) return;
      setResult({
        success: false,
        command: '',
        stdout: '',
        stderr: error.message,
      });
      setJobProgress((prev) => (prev ? { ...prev, status: 'failed', etaSeconds: null } : prev));
    } finally {
      setRunning(false);
    }
  }

  function handleBackToEditor() {
    if (running && api.cancelVideoJob) {
      cancelRequestedRef.current = true;
      void api.cancelVideoJob().catch(() => false);
    }

    setRunning(false);
    setResult(null);
    setJobProgress(null);
    setPage('editor');
  }

  if (page === 'progress') {
    return (
      <main className={`simple-shell app-surface lang-${language}${darkMode ? ' dark' : ''}`}>
        <section className="simple-card app-card">
          <div className="top-row">
            <h1>{t.processingTitle}</h1>
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => setDarkMode((v) => !v)} title={darkMode ? 'Light mode' : 'Dark mode'} aria-pressed={darkMode}>
                {darkMode ? '☀️' : '🌙'}
              </button>
              <button type="button" className="secondary-button" onClick={handleBackToEditor}>
                {t.backToEditor}
              </button>
              <div className="inline-actions language-selector" aria-label="Language selector">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={`secondary-button language-button lang-${option.code} ${language === option.code ? 'active' : ''}`}
                    onClick={() => setLanguage(option.code)}
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={language === option.code}
                  >
                    <span className="language-button-text">{option.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="muted">{t.processingHint}</p>

          <div className="result-box progress-box">
            <h2>{t.progress}</h2>
            <p className="muted">
              {jobProgress?.message || (running ? t.progressStatusRunning : t.progressStatusDone)}
            </p>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobProgress?.percent || 0}>
              <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, jobProgress?.percent || 0))}%` }} />
            </div>
            <div className="progress-stats">
              <span>{t.progressPercent}: {(jobProgress?.percent || 0).toFixed(1)}%</span>
              <span>{t.elapsedTime}: {formatDuration(jobProgress?.elapsedSeconds ?? 0)}</span>
              <span>{t.remainingTime}: {jobProgress?.status === 'completed' ? '0m 0s' : formatDuration(jobProgress?.etaSeconds)}</span>
            </div>
          </div>

          <div className={`result-box ${result?.success ? 'success' : result ? 'error' : ''}`}>
            <h2>{t.result}</h2>
            {!result && <p className="muted">{running ? t.running : t.noResult}</p>}
            {result && (
              <>
                <p><strong>{result.success ? t.done : t.failed}</strong></p>
                {resultSummary.saveLocation && <p>{t.saveLocation}: {resultSummary.saveLocation}</p>}
                {resultSummary.fileName && <p>{t.fileName}: {resultSummary.fileName}</p>}
              </>
            )}
          </div>

          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={handleBackToEditor}>
              {t.back}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`simple-shell app-surface lang-${language}${darkMode ? ' dark' : ''}`}>
      <section className="simple-card app-card">
        <div className="top-row">
          <h1>{t.title}</h1>
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => setDarkMode((v) => !v)} title={darkMode ? 'Light mode' : 'Dark mode'} aria-pressed={darkMode}>
              {darkMode ? '☀️' : '🌙'}
            </button>
            <div className="inline-actions language-selector" aria-label="Language selector">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                className={`secondary-button language-button lang-${option.code} ${language === option.code ? 'active' : ''}`}
                onClick={() => setLanguage(option.code)}
                title={option.label}
                aria-label={option.label}
                aria-pressed={language === option.code}
              >
                <span className="language-button-flag" aria-hidden="true">{option.flag}</span>
                <span className="language-button-text">{option.shortLabel}</span>
              </button>
            ))}
            </div>
          </div>
        </div>

        <p className="muted">{t.subtitle}</p>

        <div className="mode-buttons">
          {Object.entries(OPERATION_DETAILS).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={`mode-button ${operation === key ? 'active' : ''}`}
              onClick={() => {
                setOperation(key);

                if (key === 'trim' || ((key === 'crop' || key === 'removeSilence') && inputSummary.isBatchForCrop)) {
                  if (!outputDirectory.trim()) {
                    setOutputDirectory(buildDefaultOutputDirectory(inputFiles));
                  }
                  return;
                }

                setOutputFile(buildDefaultOutputPath(key, inputFiles, toNumber(repeatCount, 3)));
              }}
            >
              {item.label[language]}
            </button>
          ))}
        </div>

        <p className="muted">{details.description[language]}</p>

        <>
          <label className="field-label" htmlFor="input-files">{t.inputFiles}</label>
          <textarea
            id="input-files"
            rows={operation === 'merge' || operation === 'crop' || operation === 'trim' || operation === 'removeSilence' ? 5 : 3}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={operation === 'merge' || operation === 'crop' || operation === 'trim' || operation === 'removeSilence' ? 'C:\\videos\\part1.mp4\nC:\\videos\\part2.mp4' : 'C:\\videos\\input.mp4'}
          />
        </>

        {supportsFolderInput ? (
          <>
            <label className="field-label" htmlFor="input-directory">{t.inputFolder}</label>
            <input
              id="input-directory"
              value={inputDirectory}
              onChange={(event) => setInputDirectory(event.target.value)}
              placeholder="C:\\videos\\input-folder"
            />
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={handleBrowseInput}>{t.chooseInput}</button>
              <button type="button" className="secondary-button" onClick={handleBrowseInputDirectory}>{t.chooseInputFolder}</button>
            </div>
          </>
        ) : (
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={handleBrowseInput}>{t.chooseInput}</button>
          </div>
        )}

        {!usesOutputDirectory && (
          <>
            <label className="field-label" htmlFor="output-file">{t.outputFileLabel}</label>
            <input
              id="output-file"
              value={outputFile}
              onChange={(event) => setOutputFile(event.target.value)}
              placeholder="C:\\videos\\output.mp4"
            />
          </>
        )}

        {usesOutputDirectory && (
          <>
            <label className="field-label" htmlFor="output-directory">{t.outputFolderLabel}</label>
            <input
              id="output-directory"
              value={outputDirectory}
              onChange={(event) => setOutputDirectory(event.target.value)}
              placeholder="C:\\videos\\output-folder"
            />
          </>
        )}

        <div className="inline-actions">
          <button type="button" className="secondary-button" onClick={handleBrowseOutput}>
            {usesOutputDirectory ? t.chooseFolder : t.chooseOutput}
          </button>
        </div>

        {operation === 'crop' && (
          <div className="field-grid">
            <label>
              <span>{t.cropXLabel}</span>
              <input value={cropX} onChange={(event) => setCropX(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              <span>{t.cropYLabel}</span>
              <input value={cropY} onChange={(event) => setCropY(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              <span>{t.cropWidthLabel}</span>
              <input value={cropWidth} onChange={(event) => setCropWidth(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              <span>{t.cropHeightLabel}</span>
              <input value={cropHeight} onChange={(event) => setCropHeight(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        )}

        {(operation === 'crop' || operation === 'cut' || operation === 'trim' || operation === 'merge' || operation === 'loop' || operation === 'removeSilence') && (
          <div className="result-box crop-preview-box">
            <h2>{operation === 'cut' ? t.cutPreviewTitle : operation === 'trim' ? t.trimPreviewTitle : operation === 'merge' ? t.mergePreviewTitle : operation === 'loop' ? t.loopPreviewTitle : operation === 'removeSilence' ? t.removeSilencePreviewTitle : t.cropPreviewTitle}</h2>
            <p className="muted">{operation === 'cut' ? t.cutPreviewHint : operation === 'trim' ? t.trimPreviewHint : operation === 'merge' ? t.mergePreviewHint : operation === 'loop' ? t.loopPreviewHint : operation === 'removeSilence' ? t.removeSilencePreviewHint : t.cropPreviewHint}</p>

            {!cropPreviewSrc && <p className="muted">{t.cropPreviewNoFile}</p>}

            {cropPreviewSrc && (
              <>
                {inputFiles.length > 1 && (
                  <>
                    <label className="field-label" htmlFor="crop-preview-file">{t.cropPreviewFile}</label>
                    <select
                      id="crop-preview-file"
                      value={cropPreviewInputFile}
                      onChange={(event) => setCropPreviewFile(event.target.value)}
                    >
                      {inputFiles.map((filePath) => (
                        <option key={filePath} value={filePath}>
                          {splitDirAndName(filePath).fileName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {operation === 'crop' && <p className="muted crop-preview-drag-hint">{t.cropPreviewDragHint}</p>}
                <div
                  className="crop-preview-stage"
                  ref={previewStageRef}
                  onMouseDown={handlePreviewMouseDown}
                  style={{ cursor: operation === 'crop' && previewMeta.videoWidth ? 'crosshair' : 'default' }}
                >
                  <video
                    ref={previewVideoRef}
                    className="crop-preview-video"
                    src={cropPreviewSrc}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      setPreviewMeta({
                        videoWidth: video.videoWidth || 0,
                        videoHeight: video.videoHeight || 0,
                        loading: false,
                        error: '',
                      });
                    }}
                    onError={() => {
                      setPreviewMeta({ videoWidth: 0, videoHeight: 0, loading: false, error: t.cropPreviewError });
                    }}
                  />
                  {operation === 'crop' && <div className="crop-overlay" style={cropRectStyle} />}
                  {operation === 'crop' && dragOverlay && (
                    <div
                      className="crop-drag-select"
                      style={{
                        left: `${dragOverlay.leftPct}%`,
                        top: `${dragOverlay.topPct}%`,
                        width: `${dragOverlay.widthPct}%`,
                        height: `${dragOverlay.heightPct}%`,
                      }}
                    />
                  )}
                </div>

                {operation === 'cut' && (
                  <div className="inline-actions">
                    <button type="button" className="secondary-button" onClick={() => applyPreviewTime('start')}>
                      {t.setStartFromPreview}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => applyPreviewTime('end')}>
                      {t.setEndFromPreview}
                    </button>
                    <span className="muted">{t.previewCurrentTime}: {formatVideoTimecode(previewVideoRef.current?.currentTime ?? 0)}</span>
                  </div>
                )}

                {previewMeta.loading && <p className="muted">{t.cropPreviewLoading}</p>}
                {previewMeta.error && <p className="muted">{previewMeta.error}</p>}
                {previewMeta.videoWidth > 0 && previewMeta.videoHeight > 0 && (
                  <p className="muted">{t.sourceSizeLabel}: {previewMeta.videoWidth}x{previewMeta.videoHeight}</p>
                )}
              </>
            )}
          </div>
        )}

        {operation === 'cut' && (
          <div className="field-grid">
            <label>
              <span>{t.startTimeLabel}</span>
              <input value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="00:00:05" />
            </label>
            <label>
              <span>{t.endTimeLabel}</span>
              <input value={endTime} onChange={(event) => setEndTime(event.target.value)} placeholder="00:00:30" />
            </label>
          </div>
        )}

        {operation === 'trim' && (
          <div className="field-grid">
            <label>
              <span>{t.splitIntervalLabel}</span>
              <input
                value={splitInterval}
                onChange={(event) => setSplitInterval(event.target.value)}
                placeholder="01:00:00"
              />
            </label>
          </div>
        )}

        {operation === 'loop' && (
          <div className="field-grid">
            <label>
              <span>{t.repeatCountLabel}</span>
              <input
                value={repeatCount}
                onChange={(event) => {
                  const next = event.target.value;
                  setRepeatCount(next);

                  const first = inputFiles[0];
                  if (!first) return;
                  const { dir, fileName } = splitDirAndName(first);
                  const { base } = splitBaseAndExt(fileName || 'input.mp4');
                  const count = Math.max(1, toNumber(next, 3));
                  const nextName = `${formatDateOnly()}-${base}-${count}x.mp4`;
                  setOutputFile(dir ? `${dir}\\${nextName}` : nextName);
                }}
                inputMode="numeric"
              />
            </label>
          </div>
        )}

        {operation === 'removeSilence' && (
          <div className="field-grid">
            <label>
              <span>{t.noiseThresholdLabel}</span>
              <input
                value={noiseThresholdDb}
                onChange={(event) => setNoiseThresholdDb(event.target.value)}
                inputMode="decimal"
                placeholder="-32"
              />
            </label>
            <label>
              <span>{t.minSilenceLabel}</span>
              <input
                value={minSilenceDuration}
                onChange={(event) => setMinSilenceDuration(event.target.value)}
                inputMode="decimal"
                placeholder="0.45"
              />
            </label>
          </div>
        )}

        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={handleRun} disabled={!canRun || running}>
            {running ? t.running : t.run}
          </button>
          <button type="button" className="secondary-button" onClick={handleLoadLogs} disabled={loadingLogs}>
            {loadingLogs ? t.loadingLogs : showLogs ? t.hideLogViewer : t.logViewer}
          </button>
        </div>

        {showLogs && (
          <div className="result-box">
            <h2>{t.logViewer}</h2>
            <label className="field-label" htmlFor="log-timezone">{t.logTimeZone}</label>
            <input
              id="log-timezone"
              list="log-timezone-options"
              value={logTimeZone}
              onChange={(event) => setLogTimeZone(event.target.value)}
              placeholder="Asia/Tokyo"
            />
            <datalist id="log-timezone-options">
              {timeZoneOptions.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <p className="muted">{t.logTimeZoneHint}</p>
            {operationLogs.length === 0 && <p className="muted">{t.noLogs}</p>}
            {operationLogs.length > 0 && (
              <div className="log-table-wrap">
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>{t.logMode}</th>
                      <th>{t.logStart}</th>
                      <th>{t.logEnd}</th>
                      <th>{t.logDuration}</th>
                      <th>{t.logStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationLogs.map((log, index) => (
                      <tr key={`${log.operation_start_time || 'log'}-${index}`}>
                        <td>{log.mode || '-'}</td>
                        <td>{formatLogTimestamp(log.operation_start_time, logTimeZone)}</td>
                        <td>{formatLogTimestamp(log.operation_end_time, logTimeZone)}</td>
                        <td>{log.operation_duration || '-'}</td>
                        <td>
                          <span className={`status-pill ${log.status === 'success' ? 'success' : log.status === 'failed' ? 'failed' : ''}`}>
                            {log.status || '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </section>
    </main>
  );
}

export default App;
