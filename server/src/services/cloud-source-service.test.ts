import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemorySourceObjectStorage } from "../storage/memory-source-object-storage.js";
import type { ReadingRepository } from "../repositories/reading-repository.js";
import { CloudSourceService } from "./cloud-source-service.js";
import {
  buildPdfDocumentSource,
  DEFAULT_SESSION_PREFERENCES,
  NOVEL_SEGMENTATION_VERSION,
  type ReadingDatabase
} from "@ss/shared";

const NOW = "2026-06-24T00:00:00.000Z";

describe("CloudSourceService", () => {
  it("uploads novel text to R2 objects and stores only metadata in D1 state", async () => {
    const { cloudSource, repository, storage, sessionId } = setup();

    const result = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: "第一段\r\n\r\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });

    expect(result.sourceManifest).toMatchObject({
      sourceKind: "pasted_text",
      title: "测试书",
      segmentationVersion: NOVEL_SEGMENTATION_VERSION,
      paragraphCount: 1,
      cloudSync: {
        enabled: true,
        provider: "r2",
        objectKey: `private/sources/${result.sourceManifest.sourceId}/source.txt`,
        manifestObjectKey: `private/sources/${result.sourceManifest.sourceId}/manifest.json`,
        uploadedAt: NOW,
        sizeBytes: new TextEncoder().encode("第一段\n\n第二段").byteLength,
        mimeType: "text/plain;charset=utf-8"
      }
    });
    expect(result.sourceManifest.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const sourceObject = await storage.getObject(result.sourceManifest.cloudSync.objectKey!);
    expect(new TextDecoder().decode(sourceObject.bytes)).toBe("第一段\n\n第二段");
    const manifestObject = await storage.getObject(
      result.sourceManifest.cloudSync.manifestObjectKey!
    );
    expect(JSON.parse(new TextDecoder().decode(manifestObject.bytes))).toMatchObject({
      sourceId: result.sourceManifest.sourceId,
      contentHash: result.sourceManifest.contentHash,
      paragraphCount: 1
    });

    const stored = JSON.stringify(await repository.read());
    expect(stored).toContain(result.sourceManifest.cloudSync.objectKey!);
    expect(stored).not.toContain("第一段");
    expect(stored).not.toContain("第二段");
  });

  it("stores, restores, and deletes PDF document structure alongside source text", async () => {
    const { cloudSource, storage, sessionId } = setup();
    const pdf = buildPdfDocumentSource([
      {
        pdfPageNumber: 18,
        printedPageLabel: "153",
        text: "第十八页正文。"
      },
      {
        pdfPageNumber: 19,
        printedPageLabel: "154",
        text: "第十九页正文。"
      }
    ]);

    const uploaded = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: pdf.sourceText,
      sourceKind: "file_import",
      title: "PDF 测试书",
      documentStructure: pdf.documentStructure
    });

    expect(uploaded.sourceManifest.cloudSync.documentObjectKey).toBe(
      `private/sources/${uploaded.sourceManifest.sourceId}/document.json`
    );
    expect(uploaded.sourceManifest.paragraphCount).toBe(2);

    const documentObject = await storage.getObject(
      uploaded.sourceManifest.cloudSync.documentObjectKey!
    );
    expect(JSON.parse(new TextDecoder().decode(documentObject.bytes))).toEqual(
      pdf.documentStructure
    );

    const restored = await cloudSource.restoreNovelSource(sessionId);
    expect(restored.sourceText).toBe(pdf.sourceText);
    expect(restored.documentStructure).toEqual(pdf.documentStructure);

    await cloudSource.deleteCloudSource(sessionId);
    await expect(
      storage.headObject(uploaded.sourceManifest.cloudSync.documentObjectKey!)
    ).resolves.toEqual({ exists: false });
  });

  it("counts numbered platform-style novel sections as separate cloud reading units", async () => {
    const { cloudSource, sessionId } = setup();

    const result = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: ["开头。", "1.", "第一节。", "2.", "第二节。"].join("\n"),
      sourceKind: "pasted_text",
      title: "平台文"
    });

    expect(result.sourceManifest.paragraphCount).toBe(3);
  });

  it("restores novel text only after hash and paragraph validation passes", async () => {
    const { cloudSource, sessionId } = setup();
    const uploaded = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: "第一段\n\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });

    const restored = await cloudSource.restoreNovelSource(sessionId);

    expect(restored.sourceText).toBe("第一段\n\n第二段");
    expect(restored.sourceManifest.contentHash).toBe(uploaded.sourceManifest.contentHash);
    expect(restored.sourceManifest.paragraphCount).toBe(1);
  });

  it("fails restore when cloud sync is disabled, source object is missing, or content mismatches", async () => {
    const { cloudSource, repository, storage, sessionId } = setup();

    await expect(cloudSource.restoreNovelSource(sessionId)).rejects.toMatchObject({
      code: "INVALID_OPERATION"
    });

    const uploaded = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: "第一段\n\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });
    await storage.deleteObject(uploaded.sourceManifest.cloudSync.objectKey!);
    await expect(cloudSource.restoreNovelSource(sessionId)).rejects.toMatchObject({
      code: "INVALID_OPERATION"
    });

    await storage.putObject({
      key: uploaded.sourceManifest.cloudSync.objectKey!,
      bytes: new TextEncoder().encode("被篡改的正文"),
      contentType: "text/plain;charset=utf-8"
    });
    await expect(cloudSource.restoreNovelSource(sessionId)).rejects.toMatchObject({
      code: "INVALID_OPERATION"
    });

    const stored = JSON.stringify(await repository.read());
    expect(stored).not.toContain("被篡改的正文");
  });

  it("reports metadata-only cloud status", async () => {
    const { cloudSource, storage, sessionId } = setup();

    await expect(cloudSource.getCloudSourceStatus(sessionId)).resolves.toEqual({
      status: "disabled"
    });
    const uploaded = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: "第一段\n\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });
    await expect(cloudSource.getCloudSourceStatus(sessionId)).resolves.toEqual({
      status: "available"
    });
    await storage.deleteObject(uploaded.sourceManifest.cloudSync.objectKey!);
    await expect(cloudSource.getCloudSourceStatus(sessionId)).resolves.toEqual({
      status: "missing"
    });

    expect(JSON.stringify(await cloudSource.getCloudSourceStatus(sessionId))).not.toMatch(
      /第一段|publicUrl|signedUrl/
    );
  });

  it("deletes cloud source objects without deleting the D1 session or returning URLs", async () => {
    const { cloudSource, repository, storage, sessionId } = setup();
    const uploaded = await cloudSource.uploadNovelSource({
      sessionId,
      sourceText: "第一段\n\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });

    const result = await cloudSource.deleteCloudSource(sessionId);

    expect(result).toMatchObject({ deleted: true, cloudSourceDeleted: true });
    await expect(storage.headObject(uploaded.sourceManifest.cloudSync.objectKey!)).resolves.toEqual({
      exists: false
    });
    await expect(
      storage.headObject(uploaded.sourceManifest.cloudSync.manifestObjectKey!)
    ).resolves.toEqual({ exists: false });
    expect((await repository.read()).sessions.some((session) => session.id === sessionId)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/第一段|publicUrl|signedUrl/);
  });


  it("reports partial cloud source delete failure without hiding missing-object behavior", async () => {
    const repository = new MemoryReadingRepository();
    const storage = new FailingDeleteStorage("private/sources/source-1/manifest.json");
    const cloudSource = new CloudSourceService(repository, storage, {
      now: () => new Date(NOW),
      id: () => "source-1"
    });
    const uploaded = await cloudSource.uploadNovelSource({
      sessionId: "session-1",
      sourceText: "第一段\n\n第二段",
      sourceKind: "pasted_text",
      title: "测试书"
    });
    await storage.deleteObject(uploaded.sourceManifest.cloudSync.objectKey!);

    const result = await cloudSource.deleteCloudSource("session-1");

    expect(result).toMatchObject({
      cloudSourceDeleted: false
    });
    expect(result.cloudSourceDeleteError).toContain("manifest");
    expect(JSON.stringify(result)).not.toMatch(/第一段|publicUrl|signedUrl/);
  });



});

function setup() {
  const repository = new MemoryReadingRepository();
  const sessionId = "session-1";
  const storage = new MemorySourceObjectStorage();
  const cloudSource = new CloudSourceService(repository, storage, {
    now: () => new Date(NOW),
    id: () => "source-1"
  });
  return { cloudSource, repository, storage, sessionId };
}

class MemoryReadingRepository implements ReadingRepository {
  private database: ReadingDatabase = {
    schemaVersion: 5,
    sessions: [
      {
        id: "session-1",
        title: "测试书",
        type: "novel",
        status: "active",
        userCurrentPosition: { kind: "paragraph", index: 1, label: "第 1 段" },
        assistantSyncedPosition: null,
        liveReadingEnabled: false,
        sessionPreferences: structuredClone(DEFAULT_SESSION_PREFERENCES),
        sourceManifest: null,
        createdAt: NOW,
        updatedAt: NOW,
        lastReadAt: NOW
      }
    ],
    quotes: [],
    reactions: [],
    bookmarks: [],
    readingRecords: []
  };

  async read(): Promise<ReadingDatabase> {
    return structuredClone(this.database);
  }

  async mutate<T>(change: (database: ReadingDatabase) => T | Promise<T>): Promise<T> {
    const result = await change(this.database);
    return result;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

class FailingDeleteStorage extends MemorySourceObjectStorage {
  constructor(private readonly failingKey: string) {
    super();
  }

  override async deleteObject(key: string): Promise<{ deleted: boolean }> {
    if (key === this.failingKey) throw new Error("manifest delete failed");
    return super.deleteObject(key);
  }
}
