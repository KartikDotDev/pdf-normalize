#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { basename, join, dirname } from 'path';
import { normalizePDF } from './index';

const args = process.argv.slice(2);
const inputPath = args[0];
if (!inputPath) {
  console.error('Usage: pdf-normalizer <file.pdf>');
  process.exit(1);
}

normalizePDF(inputPath, {
  onProgress: (step) => {
    if (step === 'repair') console.log('✓ repaired');
    else if (step === 'linearize') console.log('✓ linearized');
    else if (step === 'compress') console.log('✓ compressed');
  },
})
  .then((result) => {
    const dir = dirname(inputPath);
    const base = basename(inputPath, '.pdf') || basename(inputPath);
    const outPath = join(dir, `${base}.normalized.pdf`);
    writeFileSync(outPath, result.pdf);
    console.log(`Wrote ${outPath}`);
    if (result.metadata.status === 'hard_fail') process.exit(2);
    process.exit(0);
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
