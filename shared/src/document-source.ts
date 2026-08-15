import type { PdfDocumentStructure } from "./models.js";
import { splitNovelTextForVersion } from "./novel-segmentation.js";

export interface ParsedPdfPageText {
  pdfPageNumber: number;
  text: string;
  printedPageLabel?: string;
}

export interface PdfReadingChunk {
  text: string;
  pdfPageNumber: number;
  printedPageLabel?: string;
}

/**
 * Builds one canonical sourceText while retaining each physical PDF page
 * as a stable character range into that text.
 */
export function buildPdfDocumentSource(pages: ParsedPdfPageText[]): {
  sourceText: string;
  documentStructure: PdfDocumentStructure;
} {
  const normalizedPages = pages.map((page) => ({
    ...page,
    text: normalizePageText(page.text)
  }));

  let sourceText = "";
  const mappings: PdfDocumentStructure["pages"] = [];

  for (const page of normalizedPages) {
    if (sourceText.length > 0) sourceText += "\n\n";

    const startOffset = sourceText.length;
    sourceText += page.text;
    const endOffset = sourceText.length;

    mappings.push({
      pdfPageNumber: page.pdfPageNumber,
      startOffset,
      endOffset,
      ...(page.printedPageLabel
        ? { printedPageLabel: page.printedPageLabel }
        : {})
    });
  }

  return {
    sourceText,
    documentStructure: {
      schemaVersion: 1,
      format: "pdf",
      pages: mappings
    }
  };
}

/**
 * Reconstructs reading chunks page by page.
 *
 * A physical PDF page may produce multiple reading chunks, but a reading
 * chunk can never span more than one PDF page.
 */
export function splitPdfDocumentSource(
  sourceText: string,
  documentStructure: PdfDocumentStructure,
  segmentationVersion: number
): PdfReadingChunk[] {
  if (!isPdfDocumentStructure(documentStructure)) {
    throw new Error("Invalid PDF document structure");
  }

  if (
    documentStructure.pages.some(
      (page) =>
        page.startOffset > sourceText.length ||
        page.endOffset > sourceText.length
    )
  ) {
    throw new Error("PDF document structure points outside source text");
  }

  return documentStructure.pages.flatMap((page) => {
    const pageText = sourceText
      .slice(page.startOffset, page.endOffset)
      .trim();

    if (!pageText) return [];

    return splitNovelTextForVersion(pageText, segmentationVersion).map((text) => ({
      text,
      pdfPageNumber: page.pdfPageNumber,
      ...(page.printedPageLabel
        ? { printedPageLabel: page.printedPageLabel }
        : {})
    }));
  });
}

export function isPdfDocumentStructure(value: unknown): value is PdfDocumentStructure {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.format !== "pdf" ||
    !Array.isArray(candidate.pages)
  ) {
    return false;
  }

  return candidate.pages.every((page) => {
    if (!page || typeof page !== "object") return false;

    const item = page as Record<string, unknown>;
    return (
      Number.isInteger(item.pdfPageNumber) &&
      Number(item.pdfPageNumber) >= 1 &&
      Number.isInteger(item.startOffset) &&
      Number(item.startOffset) >= 0 &&
      Number.isInteger(item.endOffset) &&
      Number(item.endOffset) >= Number(item.startOffset) &&
      (item.printedPageLabel === undefined ||
        typeof item.printedPageLabel === "string")
    );
  });
}

function normalizePageText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}
