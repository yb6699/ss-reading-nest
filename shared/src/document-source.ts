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

function normalizePageText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}
