const fs = require('fs');
const path = require('path');

const root = process.cwd();
const candidates = [
  path.join(root, 'bin', 'ffmpeg'),
  path.join(root, 'bin')
];

let found = false;
for (const dir of candidates) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => /ffmpeg|ffprobe/i.test(f));
  if (files.length > 0) {
    console.log('Found ffmpeg files in', dir, files.join(', '));
    found = true;
  }
}

if (!found) {
  console.warn('\nNo ffmpeg binaries found in expected locations.\nRecommended location: bin/ffmpeg/.\nPlace platform binaries there before packaging, or make ffmpeg available through PATH or FFMPEG_PATH.');
}
else {
  console.log('FFmpeg check passed.');
}
