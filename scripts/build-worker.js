const path = require('path');
const { spawnSync } = require('child_process');

const outputName = process.platform === 'win32' ? 'worker.exe' : 'worker';
const outputPath = path.join('src-tauri', outputName);
const result = spawnSync('go', ['-C', 'worker', 'build', '-o', `../${outputPath}`, '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`Failed to run go: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
