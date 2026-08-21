const fs = require('fs');
const path = require('path');

const root = process.cwd();
const releaseDir = path.join(root, 'release');

if (!fs.existsSync(releaseDir)) {
  console.error('release directory not found:', releaseDir);
  process.exit(1);
}

const dirs = fs.readdirSync(releaseDir)
  .filter(name => /win.*unpacked/i.test(name))
  .map(name => path.join(releaseDir, name));

if (dirs.length === 0) {
  console.error('No win-unpacked folders found in', releaseDir);
  process.exit(1);
}

dirs.forEach(dir => {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.exe'));
  if (files.length === 0) {
    console.warn('No EXE files found in', dir);
    return;
  }

  // pick first non-updater exe
  const exe = files.find(f => !/updater/i.test(f)) || files[0];
  const arch = /ia32|x86|win32/i.test(dir) ? 'x86' : 'x64';
  const targetName = `VideoEditingToolkit-${arch}.exe`;
  const targetPath = path.join(root, targetName);

  try {
    fs.copyFileSync(path.join(dir, exe), targetPath);
    console.log(`Copied ${exe} from ${dir} -> ${targetName}`);
  } catch (err) {
    console.error('Failed to copy exe from', dir, err.message);
  }
});

console.log('Done.');
