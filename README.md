# pdf-normalize

Normalize messy PDFs for fast web delivery, reliable document ingestion, and AI/RAG pipelines.

## What is normalization?

**Normalization** turns inconsistent or broken PDFs into clean, predictable files. The pipeline:

| Step | What it does | Benefit |
|------|--------------|---------|
| **Repair** | Fixes corrupt cross-reference tables, malformed objects, broken trailers | Unreadable files become parseable |
| **Linearize** | Reorders bytes so the first page loads first (PDF "fast web view") | Faster perceived load in browsers |
| **Compress** | Re-encodes with Ghostscript (ebook quality) | Smaller file size, standard structure |

You get a single, compact PDF that behaves the same across viewers and tools—no more silent failures or random parser errors.

## Why use it?

**For AI and RAG pipelines:** LLMs and retrieval systems rely on reliable text extraction. Corrupt or non-standard PDFs cause extraction failures, empty chunks, or gibberish. pdf-normalize repairs and standardizes files so your ingestion pipeline sees a consistent format, fewer parse errors, and better-quality chunks.

**For web delivery:** Linearized PDFs show the first page faster. Compressed files load quicker and cost less to store and serve.

**For document workflows:** Batch-process scanned docs, emailed attachments, or legacy exports before archiving or OCR—one tool, one pipeline.

## Install

```bash
npm install pdf-normalize
# or run without installing
npx pdf-normalize file.pdf
```

## System dependencies

Uses qpdf, Ghostscript, and Poppler (or MuPDF). On first run, missing tools are installed via your package manager (Homebrew on macOS, Scoop on Windows, apt/dnf on Linux). One-time setup only.

If auto-install fails:

- **macOS:** `brew install qpdf ghostscript poppler`
- **Linux (apt):** `sudo apt-get update && sudo apt-get install -y qpdf ghostscript poppler-utils`
- **Linux (dnf):** `sudo dnf install -y qpdf ghostscript poppler-utils`
- **Windows (Scoop):** `scoop install qpdf ghostscript poppler`

## CLI

```bash
npx pdf-normalize path/to/file.pdf
```

Writes `path/to/file.normalized.pdf` and prints progress (repaired, linearized, compressed).

**Exit codes:** `0` success | `1` error (file not found, bad path) | `2` unrecoverable PDF (still writes best-effort output)

## Library

```ts
import { normalizePDF } from "pdf-normalize";

const { pdf, metadata } = await normalizePDF("file.pdf");
console.log(metadata);
// { status: "success", pages: 22, size_before: "18.0 MB", size_after: "5.0 MB", linearized: true, text_layer: true }
```

Write to a file:

```ts
const { pdf } = await normalizePDF("file.pdf", { outputPath: "out/normalized.pdf" });
// or
const { pdf } = await normalizePDF("file.pdf");
require("fs").writeFileSync("out/normalized.pdf", pdf);
```

## License

ISC
