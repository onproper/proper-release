#!/usr/bin/env node
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

// 1. Identify the user's machine
const platform = os.platform(); // 'darwin', 'linux', 'win32'
const arch = os.arch();         // 'arm64', 'x64'

// 2. Map Node's labels to our Go compilation labels
const goPlatform = platform === 'win32' ? 'windows' : platform;
const goArch = arch === 'x64' ? 'amd64' : arch;

const packageName = `@onproper/cli-${goPlatform}-${goArch}`;
const binaryName = goPlatform === 'windows' ? 'proper.exe' : 'proper';

try {
  // 3. Locate the dynamically downloaded optional dependency
  const packagePath = path.dirname(require.resolve(`${packageName}/package.json`));
  const binaryPath = path.join(packagePath, binaryName);
  
  // 4. Execute the binary and pass all arguments directly to it
  const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} catch (e) {
  console.error(`❌ Unsupported platform or installation failed.`);
  console.error(`Expected optional dependency: ${packageName}`);
  process.exit(1);
}