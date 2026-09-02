const path = require('path');
const fs = require('fs');
const https = require('https');
const AdmZip = require('adm-zip');

const electronBinDir = path.join(__dirname, '..', 'electron_bin');
const LINUX_EXECUTABLES = ['electron', 'chrome-sandbox', 'chrome_crashpad_handler'];

function resolveElectronVersion(env = process.env) {
  const packageJson = require('../package.json');
  const version = env.HOSTRA_ELECTRON_VERSION || packageJson.hostra?.electronVersion;

  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Electron version must be an exact version');
  }

  return version;
}

function normalizeExecutablePermissions(
  targetDir,
  platform = process.platform,
  fileSystem = fs
) {
  if (platform !== 'linux') return;

  for (const relativePath of LINUX_EXECUTABLES) {
    const executablePath = path.join(targetDir, relativePath);
    if (!fileSystem.existsSync(executablePath)) continue;
    const mode = fileSystem.statSync(executablePath).mode & 0o7777;
    fileSystem.chmodSync(executablePath, mode | 0o111);
  }
}

function extractElectronArchive(zip, targetDir, platform = process.platform, fileSystem = fs) {
  zip.extractAllTo(targetDir, true, true);
  normalizeExecutablePermissions(targetDir, platform, fileSystem);
}

function downloadFile(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume();
        if (!response.headers.location || redirects >= 5) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).href;
        downloadFile(nextUrl, destPath, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Electron download returned HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destPath);
      response.once('error', reject);
      file.once('error', reject);
      response.pipe(file);
      file.once('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function downloadElectron() {
  console.log('Starting Electron binary download...');
  console.log(`Target directory: ${electronBinDir}`);

  if (!fs.existsSync(electronBinDir)) {
    fs.mkdirSync(electronBinDir, { recursive: true });
  }

  const platform = process.platform;
  const arch = process.arch;
  console.log(`Platform: ${platform}, Arch: ${arch}`);

  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'electron-'));

  try {
    const version = resolveElectronVersion();
    console.log(`Electron version: ${version}`);

    const mirrorBase = process.env.HOSTRA_MIRROR || 'https://npmmirror.com/mirrors/electron/';
    console.log(`Using mirror: ${mirrorBase}`);

    const platformMap = { win32: 'win32', darwin: 'darwin', linux: 'linux' };
    const archMap = { x64: 'x64', arm64: 'arm64', ia32: 'ia32' };

    const targetPlatform = platformMap[platform] || platform;
    const targetArch = archMap[arch] || arch;

    const zipName = `electron-v${version}-${targetPlatform}-${targetArch}.zip`;
    const zipUrl = `${mirrorBase}v${version}/${zipName}`;
    const zipPath = path.join(tempDir, zipName);

    console.log(`Downloading: ${zipUrl}`);
    await downloadFile(zipUrl, zipPath);
    console.log(`Downloaded to: ${zipPath}`);

    console.log(`Extracting to: ${electronBinDir}`);
    const zip = new AdmZip(zipPath);
    extractElectronArchive(zip, electronBinDir);

    console.log('Electron binary download completed successfully!');
  } catch (error) {
    console.error('Failed to download Electron:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  downloadElectron();
}

module.exports = {
  downloadElectron,
  extractElectronArchive,
  normalizeExecutablePermissions,
  resolveElectronVersion
};
