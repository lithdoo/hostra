const { download, getHostArch } = require('@electron/get');
const path = require('path');
const fs = require('fs');
const https = require('https');
const AdmZip = require('adm-zip');

const electronBinDir = path.join(__dirname, '..', 'electron_bin');

function getLatestVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://registry.npmjs.org/electron/latest', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.version);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
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
    const version = await getLatestVersion();
    console.log(`Latest Electron version: ${version}`);

    const mirrorBase = process.env.ELECHER_MIRROR || 'https://npmmirror.com/mirrors/electron/';
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
    zip.extractAllTo(electronBinDir, true);

    console.log('Electron binary download completed successfully!');
  } catch (error) {
    console.error('Failed to download Electron:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

downloadElectron();
