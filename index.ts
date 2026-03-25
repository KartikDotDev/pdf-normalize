import { execFile, spawn } from 'child_process';
import { mkdtempSync, readFileSync, statSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as pathResolve } from 'path';
import { promisify } from 'util';
import { ensureDependencies, whichBin } from './deps';

export { ensureDependencies } from './deps';

const execFileAsync = promisify(execFile);

export type NormalizeStatus = 'success' | 'partial' | 'hard_fail' | 'warning';

export interface Metadata {
  status: NormalizeStatus;
  pages?: number;
  size_before?: string;
  size_after?: string;
  linearized: boolean;
  text_layer: boolean;
  completed?: string[];
  skipped?: string[];
  reason?: string;
}

export interface NormalizeResult {
  pdf: Buffer;
  metadata: Metadata;
}

export interface NormalizeOptions {
  outputPath?: string;
  textDetectBackend?: 'pdftotext' | 'mutool';
  onProgress?: (step: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const env = opts?.env ?? process.env;
    const p = spawn(cmd, args, { cwd: opts?.cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    p.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    p.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function getPageCount(filePath: string, env: Record<string, string | undefined>): Promise<number> {
  try {
    const { stdout } = await execFileAsync('qpdf', ['--show-npages', filePath], { env });
    const n = parseInt(stdout.trim(), 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

async function detectTextLayer(
  filePath: string,
  backend: 'pdftotext' | 'mutool',
  env: Record<string, string | undefined>
): Promise<boolean> {
  const threshold = 50;
  try {
    if (backend === 'pdftotext') {
      const { stdout } = await execFileAsync('pdftotext', [filePath, '-'], { env });
      const nonWs = stdout.replace(/\s/g, '').length;
      return nonWs >= threshold;
    } else {
      const { stdout } = await execFileAsync('mutool', ['draw', '-F', 'text', filePath], { env });
      const nonWs = stdout.replace(/\s/g, '').length;
      return nonWs >= threshold;
    }
  } catch {
    return false;
  }
}

export async function normalizePDF(
  input: string | Buffer,
  options?: NormalizeOptions
): Promise<NormalizeResult> {
  const onProgress = options?.onProgress ?? (() => {});
  let sizeBefore: number;
  const tmpDir = mkdtempSync(join(tmpdir(), 'pdf-normalize-'));
  const base = join(tmpDir, 'stage');
  let current = base + '0.pdf';
  let next = base + '1.pdf';

  if (Buffer.isBuffer(input)) {
    sizeBefore = input.length;
    writeFileSync(current, input);
  } else {
    const resolvedInput = pathResolve(input);
    if (!existsSync(resolvedInput)) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(`File not found: ${resolvedInput}`);
    }
    const stat = statSync(resolvedInput);
    if (!stat.isFile()) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(`Not a file: ${resolvedInput}`);
    }
    sizeBefore = stat.size;
    copyFileSync(resolvedInput, current);
  }

  const { path: toolPath } = await ensureDependencies({ onProgress });
  const env = { ...process.env, PATH: toolPath };
  const completed: string[] = [];
  const skipped: string[] = [];
  let status: NormalizeStatus = 'success';
  let reason: string | undefined;
  let linearized = false;
  let textLayer = false;

  try {
    onProgress('validate');
    const checkResult = await run('qpdf', ['--check', current], { cwd: tmpDir, env });
    if (checkResult.code === 2) {
      status = 'hard_fail';
      reason = 'qpdf --check failed (file may be corrupt)';
      const metadata: Metadata = {
        status,
        linearized: false,
        text_layer: false,
        completed,
        skipped,
        reason,
        size_before: formatSize(sizeBefore),
      };
      const pdf = readFileSync(current);
      if (options?.outputPath) writeFileSync(options.outputPath, pdf);
      return { pdf, metadata };
    }

    onProgress('repair');
    const repairResult = await run('qpdf', [current, next], { cwd: tmpDir, env });
    if (repairResult.code === 2) {
      status = 'hard_fail';
      reason = 'qpdf repair failed';
      const metadata: Metadata = {
        status,
        linearized: false,
        text_layer: false,
        completed,
        skipped,
        reason,
        size_before: formatSize(sizeBefore),
      };
      const pdf = readFileSync(current);
      if (options?.outputPath) writeFileSync(options.outputPath, pdf);
      return { pdf, metadata };
    }
    completed.push('repair');
    const swap = current; current = next; next = swap;

    onProgress('linearize');
    const linearizeResult = await run('qpdf', ['--linearize', current, next], { cwd: tmpDir, env });
    if (linearizeResult.code !== 0) {
      status = 'partial';
      skipped.push('linearize');
      reason = reason ?? 'linearize failed';
    } else {
      completed.push('linearize');
      linearized = true;
      const swap = current; current = next; next = swap;
    }

    onProgress('compress');
    const gsOut = join(tmpDir, 'compressed.pdf');
    try {
      const gsResult = await run('gs', [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dPDFSETTINGS=/ebook',
        '-dNOPAUSE',
        '-dBATCH',
        `-sOutputFile=${gsOut}`,
        current,
      ], { cwd: tmpDir, env });
      if (gsResult.code !== 0) throw new Error('gs failed');
      completed.push('compress');
      copyFileSync(gsOut, next);
      current = next;
    } catch {
      skipped.push('compress');
      if (status === 'success') status = 'partial';
      reason = reason ?? 'compress: failed';
    }

    const textBackend = options?.textDetectBackend ?? (await whichBin('pdftotext', toolPath) ? 'pdftotext' : 'mutool');
    onProgress('text_detect');
    textLayer = await detectTextLayer(current, textBackend, env);

    const pages = await getPageCount(current, env);
    const sizeAfter = statSync(current).size;
    const metadata: Metadata = {
      status,
      pages,
      size_before: formatSize(sizeBefore),
      size_after: formatSize(sizeAfter),
      linearized,
      text_layer: textLayer,
      completed,
      skipped: skipped.length ? skipped : undefined,
      reason,
    };
    const pdf = readFileSync(current);
    if (options?.outputPath) writeFileSync(options.outputPath, pdf);
    return { pdf, metadata };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
