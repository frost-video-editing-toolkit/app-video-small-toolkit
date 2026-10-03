const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-workbench-test-'));
const inputFile = path.join(tempDirectory, 'input.mp4');
const outputFile = path.join(tempDirectory, 'input-crop.mp4');

// Run an external command and turn a non-zero exit code into a test failure.
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status})\n${result.stderr || result.stdout}`);
  }
  return result;
}

// Send one JSON job to the Go worker and decode its JSON-line event protocol.
function runWorker(job) {
  const worker = run('go', ['-C', 'worker', 'run', '.'], {
    input: `${JSON.stringify(job)}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events = worker.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === 'result');
  if (!result?.success) {
    throw new Error(`worker did not report success: ${JSON.stringify(result)}`);
  }
  return events;
}

// Verify both the worker completion event and the physical output file.
function assertOutput(events, expectedOutput) {
  const completed = events.find((event) => event.type === 'completed' && event.outputFile === expectedOutput);
  if (!completed) {
    throw new Error(`missing completed output: ${expectedOutput}`);
  }
  if (!fs.existsSync(expectedOutput) || fs.statSync(expectedOutput).size === 0) {
    throw new Error(`output file was not created: ${expectedOutput}`);
  }
}

try {
  // Create a small deterministic video so the test does not need checked-in media fixtures.
  run('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x240:d=1',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:duration=1',
    '-shortest',
    '-pix_fmt', 'yuv420p',
    inputFile,
  ], { stdio: 'pipe' });

  // Exercise a single-file crop operation and its output event.
  const cropJob = {
    kind: 'crop',
    inputFile,
    outputFile,
    crop: { x: 0, y: 0, width: 160, height: 120 },
  };
  assertOutput(runWorker(cropJob), outputFile);

  // Exercise the main audio operations on a video that contains a sine-wave track.
  const volumeOutput = path.join(tempDirectory, 'input-volume.mp4');
  assertOutput(runWorker({ kind: 'volume', inputFile, outputFile: volumeOutput, audioVolume: 1.25 }), volumeOutput);
  const extractedAudio = path.join(tempDirectory, 'input-audio.mp3');
  assertOutput(runWorker({ kind: 'extractAudio', inputFile, outputFile: extractedAudio }), extractedAudio);
  const silentOutput = path.join(tempDirectory, 'input-silent.mp4');
  assertOutput(runWorker({ kind: 'removeAudio', inputFile, outputFile: silentOutput }), silentOutput);
  const normalizedOutput = path.join(tempDirectory, 'input-normalized.mp4');
  assertOutput(runWorker({ kind: 'normalizeAudio', inputFile, outputFile: normalizedOutput }), normalizedOutput);

  // Exercise speed conversion with audio pitch preservation filters.
  const speedOutput = path.join(tempDirectory, 'input-speed.mp4');
  assertOutput(runWorker({ kind: 'speed', inputFile, outputFile: speedOutput, speed: 1.5 }), speedOutput);

  // Exercise a single thumbnail and a contact sheet generated from interval frames.
  const thumbnailOutput = path.join(tempDirectory, 'input-thumbnail.jpg');
  assertOutput(runWorker({ kind: 'thumbnail', inputFile, outputFile: thumbnailOutput, thumbnailTime: '00:00:00.500' }), thumbnailOutput);
  const contactDirectory = path.join(tempDirectory, 'contact-output');
  fs.mkdirSync(contactDirectory);
  const contactOutput = path.join(contactDirectory, 'input-thumbnail.jpg');
  assertOutput(runWorker({ kind: 'contactSheet', inputFile, outputDirectory: contactDirectory, thumbnailInterval: 0.5 }), contactOutput);

  // Exercise codec/container conversion with the default H.264 settings.
  const convertOutput = path.join(tempDirectory, 'input-converted.mp4');
  assertOutput(runWorker({
    kind: 'convert',
    inputFile,
    outputFile: convertOutput,
    outputFormat: 'mp4',
    videoCodec: 'h264',
    videoBitrate: '2M',
  }), convertOutput);

  // Exercise resizing to an explicit resolution.
  const resizeOutput = path.join(tempDirectory, 'input-resized.mp4');
  assertOutput(runWorker({
    kind: 'resize',
    inputFile,
    outputFile: resizeOutput,
    resizeWidth: 160,
    resizeHeight: 120,
  }), resizeOutput);

  // Exercise time-based cutting on the generated input.
  const cutOutput = path.join(tempDirectory, 'input-cut.mp4');
  assertOutput(runWorker({
    kind: 'cut',
    inputFile,
    outputFile: cutOutput,
    startTime: '00:00:00',
    endTime: '00:00:00.500',
  }), cutOutput);

  // Exercise repeated playback and verify that it produces a file.
  const loopOutput = path.join(tempDirectory, 'input-loop.mp4');
  assertOutput(runWorker({
    kind: 'loop',
    inputFile,
    outputFile: loopOutput,
    repeatCount: 2,
  }), loopOutput);

  // Use identical file names from different folders to check collision-safe batch names.
  const firstFolder = path.join(tempDirectory, 'folder-a');
  const secondFolder = path.join(tempDirectory, 'folder-b');
  const batchOutputDirectory = path.join(tempDirectory, 'batch-output');
  fs.mkdirSync(firstFolder);
  fs.mkdirSync(secondFolder);
  fs.mkdirSync(batchOutputDirectory);
  const firstInput = path.join(firstFolder, 'movie.mp4');
  const secondInput = path.join(secondFolder, 'movie.mp4');
  fs.copyFileSync(inputFile, firstInput);
  fs.copyFileSync(inputFile, secondInput);
  const batchEvents = runWorker({
    kind: 'crop',
    inputFiles: [firstInput, secondInput],
    outputDirectory: batchOutputDirectory,
    crop: { x: 0, y: 0, width: 160, height: 120 },
  });
  const batchOutputs = batchEvents
    .filter((event) => event.type === 'completed')
    .map((event) => event.outputFile);
  if (batchOutputs.length !== 2 || new Set(batchOutputs).size !== 2) {
    throw new Error(`batch output names collided: ${JSON.stringify(batchOutputs)}`);
  }
  batchOutputs.forEach((output) => assertOutput(batchEvents, output));

  console.log('Worker integration tests passed: crop, convert, resize, cut, loop, batch output naming');
} finally {
  // Keep the repository clean even when an assertion or external command fails.
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
