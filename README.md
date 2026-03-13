# pdf-normalizer

Normalize messy PDFs for fast web delivery and reliable document ingestion.

## Install

```bash
npm install pdf-normalizer
# or
npx pdf-normalizer file.pdf
```

## System dependencies

pdf-normalizer uses these command-line tools (they must be installed and on your PATH):

- **qpdf** — repair and linearize
- **gs** (Ghostscript) — compress
- **pdftotext** (Poppler) or **mutool** (MuPDF) — text-layer detection

We do not bundle them via npm. If any are missing, the CLI/library will exit with an error and point here.

## Installation

Install the tools for your platform, then use the package.

### macOS (Homebrew)

```bash
brew install qpdf ghostscript poppler
# or, for text detection with MuPDF instead of Poppler:
brew install qpdf ghostscript mupdf
```

### Linux

**Debian / Ubuntu (apt)**

```bash
sudo apt-get update
sudo apt-get install qpdf ghostscript poppler-utils
# or for MuPDF:
sudo apt-get install qpdf ghostscript mupdf-tools
```

**Fedora / RHEL (dnf)**

```bash
sudo dnf install qpdf ghostscript poppler-utils
# or for MuPDF:
sudo dnf install qpdf ghostscript mupdf
```

### Windows

- **qpdf:** [qpdf releases](https://github.com/qpdf/qpdf/releases) — add the `bin` folder to PATH.
- **Ghostscript:** [Ghostscript downloads](https://ghostscript.com/releases/gsdnld.html) — install and add `gs` to PATH.
- **Poppler (pdftotext):** [Poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases) — add `bin` to PATH.
- **MuPDF (mutool):** [MuPDF downloads](https://mupdf.com/releases/) — add the directory containing `mutool` to PATH.

Or with a package manager:

- **Chocolatey:** `choco install qpdf gs poppler` (or use MuPDF if available).
- **Scoop:** `scoop install qpdf ghostscript poppler` (or equivalent).

## CLI

```bash
npx pdf-normalizer path/to/file.pdf
```

Writes `path/to/file.normalized.pdf` and prints progress (repaired, linearized, compressed).

## Library

```ts
import { normalizePDF, checkRequiredBinaries } from "pdf-normalizer";

// Optional: check tools before running
await checkRequiredBinaries();

const { pdf, metadata } = await normalizePDF("file.pdf");
console.log(metadata);
// { status: "success", pages: 22, size_before: "18.0 MB", size_after: "5.0 MB", linearized: true, text_layer: true }
```

Write the result to a file:

```ts
const { pdf } = await normalizePDF("file.pdf", { outputPath: "out/normalized.pdf" });
// or
const { pdf } = await normalizePDF("file.pdf");
require("fs").writeFileSync("out/normalized.pdf", pdf);
```
