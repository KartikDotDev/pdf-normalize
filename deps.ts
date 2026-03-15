import { execFile, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';
import { delimiter } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type LinuxPm = 'apt' | 'dnf' | 'apk' | null;

function which(bin: string, pathEnv?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = pathEnv ? { ...process.env, PATH: pathEnv } : process.env;
    const cmd = platform() === 'win32' ? 'where' : 'which';
    execFile(cmd, [bin], { env }, (err: Error | null) => resolve(!err));
  });
}

function getBrewPath(): string {
  if (existsSync('/opt/homebrew/bin/brew')) return '/opt/homebrew/bin/brew';
  if (existsSync('/usr/local/bin/brew')) return '/usr/local/bin/brew';
  return 'brew';
}

async function getBrewPrefix(): Promise<string | null> {
  try {
    const brew = getBrewPath();
    const env = process.env.PATH
      ? { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` }
      : process.env;
    const { stdout } = await execFileAsync(brew, ['--prefix'], { env });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function getScoopShimsPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return home ? `${home}\\scoop\\shims` : '';
}

function getScoopExePath(): string | null {
  const scoopShimsPath = getScoopShimsPath();
  if (!scoopShimsPath) return null;
  const scoopCmd = `${scoopShimsPath}\\scoop.cmd`;
  return existsSync(scoopCmd) ? scoopCmd : null;
}

async function getToolPaths(plat: string): Promise<string> {
  if (plat === 'darwin') {
    const prefix = await getBrewPrefix();
    return prefix ? `${prefix}/bin` : '';
  }
  if (plat === 'win32') {
    return getScoopShimsPath();
  }
  return '';
}

function detectLinuxPm(): LinuxPm {
  try {
    if (existsSync('/etc/os-release')) {
      const content = readFileSync('/etc/os-release', 'utf8');
      const id = content.match(/^ID=(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') || '';
      const idLike = content.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') || '';
      const combined = `${id} ${idLike}`;
      if (/alpine/i.test(combined)) return 'apk';
      if (/fedora|rhel|centos|rocky|alma/i.test(combined)) return 'dnf';
    }
    if (existsSync('/etc/debian_version')) return 'apt';
    return 'apt';
  } catch {
    return 'apt';
  }
}

function runInstall(
  cmd: string,
  args: string[],
  opts: { shell?: boolean; env?: NodeJS.ProcessEnv }
): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      stdio: 'inherit',
      shell: opts.shell ?? false,
      env: opts.env ?? process.env,
    });
    p.on('close', (code: number | null) => resolve(code ?? 1));
  });
}

function getFallbackCommand(plat: string, linuxPm: LinuxPm): string {
  if (plat === 'darwin') {
    return 'brew install qpdf ghostscript poppler';
  }
  if (plat === 'win32') {
    return 'scoop install qpdf ghostscript poppler';
  }
  if (plat === 'linux') {
    if (linuxPm === 'apk') {
      return 'apk add qpdf ghostscript poppler-utils';
    }
    if (linuxPm === 'dnf') {
      return 'sudo dnf install -y qpdf ghostscript poppler-utils';
    }
    return 'sudo apt-get update && sudo apt-get install -y qpdf ghostscript poppler-utils';
  }
  return 'Install qpdf, ghostscript, and poppler for your platform.';
}

export interface EnsureDepsOptions {
  onProgress?: (msg: string) => void;
}

export interface EnsureDepsResult {
  path: string;
}

export async function ensureDependencies(
  options?: EnsureDepsOptions
): Promise<EnsureDepsResult> {
  const onProgress = options?.onProgress ?? (() => {});
  const plat = platform();
  const linuxPm = plat === 'linux' ? detectLinuxPm() : null;

  const pathEnv = process.env.PATH ?? '';
  const checkWhich = (bin: string) => which(bin, pathEnv);

  const hasQpdf = await checkWhich('qpdf');
  const hasGs = await checkWhich('gs');
  const hasPdftotext = await checkWhich('pdftotext');
  const hasMutool = await checkWhich('mutool');
  const hasTextTool = hasPdftotext || hasMutool;

  if (hasQpdf && hasGs && hasTextTool) {
    const prepend = await getToolPaths(plat);
    const path = prepend ? `${prepend}${delimiter}${pathEnv}` : pathEnv;
    return { path };
  }

  onProgress('Setting up PDF tools (one-time)...');

  if (plat === 'darwin') {
    const hasBrew = await checkWhich('brew');
    if (!hasBrew) {
      onProgress('  Homebrew not found. Installing...');
      const script = 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
      const code = await runInstall('/bin/bash', ['-c', script], { shell: true });
      if (code !== 0) {
        throw new Error(
          `Couldn't install tools automatically. Run this, then try again:\n  brew install qpdf ghostscript poppler`
        );
      }
    }
    onProgress('  Installing qpdf, ghostscript, poppler...');
    const brew = getBrewPath();
    const prefix = await getBrewPrefix();
    const pathWithBrew = prefix ? `${prefix}/bin${delimiter}${pathEnv}` : pathEnv;
    const brewEnv = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', NONINTERACTIVE: '1', PATH: pathWithBrew };
    const code = await runInstall(brew, ['install', 'qpdf', 'ghostscript', 'poppler'], { env: brewEnv });
    if (code !== 0) {
      throw new Error(
        `Couldn't install tools automatically. Run this, then try again:\n  brew install qpdf ghostscript poppler`
      );
    }
    const path = pathWithBrew;
    onProgress('✓ All set.');
    return { path };
  }

  if (plat === 'win32') {
    const hasScoop = await checkWhich('scoop');
    if (!hasScoop) {
      onProgress('  Scoop not found. Installing...');
      const script = 'Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; irm get.scoop.sh | iex';
      const code = await runInstall('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { env: process.env });
      if (code !== 0) {
        throw new Error(
          `Couldn't install tools automatically. Run this in PowerShell, then try again:\n  irm get.scoop.sh | iex\n  scoop install qpdf ghostscript poppler`
        );
      }
      const scoopExeAfterInstall = getScoopExePath();
      if (!scoopExeAfterInstall) {
        throw new Error(
          `Scoop was installed but scoop.cmd was not found. Open a new PowerShell window and run:\n  scoop install qpdf ghostscript poppler`
        );
      }
    }
    onProgress('  Installing qpdf, ghostscript, poppler...');
    const scoopPath = getScoopShimsPath();
    const winPath = process.env.PATH ?? '';
    const pathWithScoop = scoopPath ? `${scoopPath}${delimiter}${winPath}` : winPath;
    const scoopExe = getScoopExePath();
    const scoopEnv = { ...process.env, PATH: pathWithScoop };
    const code = scoopExe
      ? await runInstall(scoopExe, ['install', 'qpdf', 'ghostscript', 'poppler'], { shell: true, env: scoopEnv })
      : await runInstall('scoop', ['install', 'qpdf', 'ghostscript', 'poppler'], { shell: true, env: scoopEnv });
    if (code !== 0) {
      throw new Error(
        `Couldn't install tools automatically. Run this, then try again:\n  scoop install qpdf ghostscript poppler`
      );
    }
    const finalPath = pathWithScoop;
    onProgress('✓ All set.');
    return { path: finalPath };
  }

  if (plat === 'linux') {
    onProgress('  Installing qpdf, ghostscript, poppler...');
    let code = 1;
    if (linuxPm === 'apk') {
      code = await runInstall('apk', ['add', 'qpdf', 'ghostscript', 'poppler-utils'], { env: process.env });
    } else if (linuxPm === 'dnf') {
      code = await runInstall('sudo', ['dnf', 'install', '-y', 'qpdf', 'ghostscript', 'poppler-utils'], { env: process.env });
    } else {
      code = await runInstall('sudo', [
        'sh', '-c',
        'apt-get update && apt-get install -y qpdf ghostscript poppler-utils',
      ], { env: process.env });
    }
    if (code !== 0) {
      const fallback = getFallbackCommand(plat, linuxPm);
      throw new Error(
        `Couldn't install tools automatically. Run this, then try again:\n  ${fallback}`
      );
    }
    onProgress('✓ All set.');
    return { path: pathEnv };
  }

  const fallback = getFallbackCommand(plat, linuxPm);
  throw new Error(
    `Unsupported platform. Install qpdf, ghostscript, and poppler manually. Example:\n  ${fallback}`
  );
}

export function whichBin(bin: string, pathEnv?: string): Promise<boolean> {
  return which(bin, pathEnv);
}
