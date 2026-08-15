import { describe, expect, it } from "vitest";
import {
  buildPdfDocumentSource,
  splitPdfDocumentSource
} from "./document-source.js";

describe("PDF document source", () => {
  it("retains physical PDF page boundaries in the canonical source text", () => {
    const result = buildPdfDocumentSource([
      {
        pdfPageNumber: 1,
        printedPageLabel: "1",
        text: "第一页正文。"
      },
      {
        pdfPageNumber: 2,
        printedPageLabel: "2",
        text: "第二页正文。"
      }
    ]);

    expect(result.sourceText).toBe("第一页正文。\n\n第二页正文。");
    expect(result.documentStructure).toEqual({
      schemaVersion: 1,
      format: "pdf",
      pages: [
        {
          pdfPageNumber: 1,
          startOffset: 0,
          endOffset: 6,
          printedPageLabel: "1"
        },
        {
          pdfPageNumber: 2,
          startOffset: 8,
          endOffset: 14,
          printedPageLabel: "2"
        }
      ]
    });
  });

  it("never merges reading chunks across physical PDF pages", () => {
    const result = buildPdfDocumentSource([
      { pdfPageNumber: 10, text: "很短的第十页。" },
      { pdfPageNumber: 11, text: "很短的第十一页。" }
    ]);

    const chunks = splitPdfDocumentSource(
      result.sourceText,
      result.documentStructure,
      4
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      pdfPageNumber: 10,
      text: "很短的第十页。"
    });
    expect(chunks[1]).toMatchObject({
      pdfPageNumber: 11,
      text: "很短的第十一页。"
    });
  });

  it("allows one physical PDF page to become multiple reading chunks", () => {
    const result = buildPdfDocumentSource([
      {
        pdfPageNumber: 18,
        printedPageLabel: "153",
        text: "甲".repeat(1500)
      }
    ]);

    const chunks = splitPdfDocumentSource(
      result.sourceText,
      result.documentStructure,
      4
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.pdfPageNumber === 18)).toBe(true);
    expect(chunks.every((chunk) => chunk.printedPageLabel === "153")).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("甲".repeat(1500));
  });
});
