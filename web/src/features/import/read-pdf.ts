import type { ParsedPdfPageText } from "@ss/shared";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.mjs?worker&inline";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsPromise: Promise<PdfJsModule> | undefined;
let workerConfigured = false;

export interface ParsedPdfDocument {
  title: string;
  pages: ParsedPdfPageText[];
}

export async function readPdf(file: File): Promise<ParsedPdfDocument> {
  const pdfjsLib = await loadPdfJs();

  const bytes = new Uint8Array(await file.arrayBuffer());

  const loadingTask = pdfjsLib.getDocument({
    data: bytes
  });

  const document = await loadingTask.promise;

  try {
    const pages: ParsedPdfPageText[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();

      pages.push({
        pdfPageNumber: pageNumber,
        text: extractPageText(textContent.items)
      });

      page.cleanup();
    }

    return {
      title: stripPdfExtension(file.name),
      pages
    };
  } finally {
    await document.cleanup();
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import("pdfjs-dist");
  const pdfjsLib = await pdfJsPromise;

  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfJsWorker();
    workerConfigured = true;
  }

  return pdfjsLib;
}

function extractPageText(items: readonly unknown[]) {
  const parts: string[] = [];

  for (const item of items) {
    if (!isPdfTextItem(item)) continue;

    parts.push(item.str);

    if (item.hasEOL) {
      parts.push("\n");
    }
  }

  return normalizeExtractedText(parts.join(""));
}

function isPdfTextItem(
  value: unknown
): value is { str: string; hasEOL?: boolean } {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.str === "string" &&
    (candidate.hasEOL === undefined ||
      typeof candidate.hasEOL === "boolean")
  );
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripPdfExtension(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").trim() || "未命名 PDF";
}
