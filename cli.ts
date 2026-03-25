#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { basename, join, dirname } from 'path';
import { normalizePDF } from './index';

function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

function parseArgs(argv: string[]): {
  files: string[];
  stdin: boolean;
  stdout: boolean;
  outDir: string | null;
  quiet: boolean;
} {
  const files: string[] = [];
  let stdin = false;
  let stdout = false;
  let outDir: string | null = null;
  let quiet = false;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--stdin' || arg === '-i') {
      stdin = true;
      i++;
    } else if (arg === '--stdout') {
      stdout = true;
      i++;
    } else if (arg === '--out-dir') {
      outDir = argv[i + 1] ?? '';
      i += 2;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      i++;
    } else if (arg.startsWith('-')) {
      i++;
    } else {
      files.push(arg);
      i++;
    }
  }
  return { files, stdin, stdout, outDir, quiet };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { files, stdin, stdout, outDir, quiet } = args;

  const useStdin = stdin || (files.length === 0 && !process.stdin.isTTY);
  type Input = { kind: 'file'; path: string } | { kind: 'stdin'; name: string };
  const inputs: Input[] = [];

  if (useStdin) {
    inputs.push({ kind: 'stdin', name: 'stdin.pdf' });
  } else if (files.length === 0) {
    console.error('Usage: pdf-normalize [options] <file.pdf> [file2.pdf ...]');
    console.error('       pdf-normalize --stdin [--stdout]');
    console.error('       cat file.pdf | pdf-normalize > normalized.pdf');
    console.error('');
    console.error('Options:');
    console.error('  --stdin, -i    Read PDF from stdin');
    console.error('  --stdout       Write normalized PDF to stdout');
    console.error('  --out-dir <dir>  Write outputs to directory (for multiple files)');
    console.error('  --quiet, -q    Suppress progress messages');
    process.exit(1);
  } else {
    for (const f of files) inputs.push({ kind: 'file', path: f });
  }

  if (stdout && inputs.length > 1) {
    console.error('--stdout only valid for single input');
    process.exit(1);
  }
  if (outDir && inputs.length > 0) {
    mkdirSync(outDir, { recursive: true });
  }

  const onProgress = quiet
    ? () => {}
    : (step: string) => {
        if (step === 'Setting up PDF tools (one-time)...') process.stderr.write('Setting up PDF tools (one-time)...\n');
        else if (step.startsWith('  ')) process.stderr.write(step + '\n');
        else if (step === '✓ All set.') process.stderr.write('✓ All set. Normalizing...\n');
        else if (step === 'repair') process.stderr.write('✓ repaired\n');
        else if (step === 'linearize') process.stderr.write('✓ linearized\n');
        else if (step === 'compress') process.stderr.write('✓ compressed\n');
      };

  let lastStatus = 0;
  for (const inp of inputs) {
    let input: string | Buffer;
    let baseName: string;
    let baseDir: string;
    if (inp.kind === 'stdin') {
      input = await readStdin();
      baseName = 'stdin';
      baseDir = process.cwd();
    } else {
      input = inp.path;
      baseName = basename(inp.path, '.pdf') || basename(inp.path);
      baseDir = dirname(inp.path);
    }

    const result = await normalizePDF(input, { onProgress });
    if (result.metadata.status === 'hard_fail') lastStatus = 2;

    if (stdout) {
      process.stdout.write(result.pdf);
    } else {
      const outPath = outDir ? join(outDir, `${baseName}.normalized.pdf`) : join(baseDir, `${baseName}.normalized.pdf`);
      writeFileSync(outPath, result.pdf);
      if (!quiet) console.log(`Wrote ${outPath}`);
    }
  }
  process.exit(lastStatus);
}

run().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
