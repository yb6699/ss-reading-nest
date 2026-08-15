import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_SESSION_PREFERENCES,
  NOVEL_SEGMENTATION_VERSION,
  isPdfDocumentStructure,
  splitPdfDocumentSource,
  type DocumentStructure,
  type ReadingPosition,
  splitNovelText,
  splitNovelTextForVersion,
  type ReadingSession,
  type SourceKind,
  type SourceManifest,
  type SyncedReadingState
} from "@ss/shared";
import { AppError } from "../errors/app-error.js";
import type { ReadingRepository } from "../repositories/reading-repository.js";
import {
  buildDocumentStructureObjectKey,
  buildSourceManifestObjectKey,
  buildSourceObjectKey
} from "../storage/source-object-keys.js";
import {
  SourceObjectNotFoundError,
  type SourceObjectStorage
} from "../storage/source-object-storage.js";

type Dependencies = {
  now: () => Date;
  id: () => string;
};

const defaultDependencies: Dependencies = {
  now: () => new Date(),
  id: () => randomUUID()
};

export class CloudSourceService {
  constructor(
    private readonly repository: ReadingRepository,
    private readonly storage: SourceObjectStorage,
    private readonly deps: Dependencies = defaultDependencies
  ) {}

  async uploadNovelSource(input: {
    sessionId: string;
    sourceText: string;
    sourceKind: Extract<SourceKind, "pasted_text" | "file_import">;
    title?: string;
    documentStructure?: DocumentStructure;
    readingState?: SyncedReadingState;
  }): Promise<{ sourceManifest: SourceManifest }> {
    const normalizedText = normalizeNovelSourceText(input.sourceText);
    const bytes = new TextEncoder().encode(normalizedText);
    const sourceId = this.deps.id();
    const objectKey = buildSourceObjectKey(sourceId);
    const manifestObjectKey = buildSourceManifestObjectKey(sourceId);
    const documentObjectKey = input.documentStructure
      ? buildDocumentStructureObjectKey(sourceId)
      : undefined;
    const paragraphCount = input.documentStructure
      ? splitPdfDocumentSource(
          normalizedText,
          input.documentStructure,
          NOVEL_SEGMENTATION_VERSION
        ).length
      : splitNovelText(normalizedText).length;
    const sourceManifest: SourceManifest = {
      sourceId,
      sourceKind: input.sourceKind,
      ...(input.title ? { title: input.title } : {}),
      contentHash: sha256Hex(bytes),
      segmentationVersion: NOVEL_SEGMENTATION_VERSION,
      paragraphCount,
      cloudSync: {
        enabled: true,
        provider: "r2",
        objectKey,
        manifestObjectKey,
        ...(documentObjectKey ? { documentObjectKey } : {}),
        uploadedAt: this.deps.now().toISOString(),
        sizeBytes: bytes.byteLength,
        mimeType: "text/plain;charset=utf-8"
      },
      ...(input.readingState
        ? { readingState: normalizeReadingState(input.readingState, this.deps.now()) }
        : {})
    };
    await this.storage.putObject({
      key: objectKey,
      bytes,
      contentType: "text/plain;charset=utf-8"
    });
    if (documentObjectKey && input.documentStructure) {
      await this.storage.putObject({
        key: documentObjectKey,
        bytes: new TextEncoder().encode(JSON.stringify(input.documentStructure)),
        contentType: "application/json"
      });
    }

    await this.storage.putObject({
      key: manifestObjectKey,
      bytes: new TextEncoder().encode(JSON.stringify(sourceManifest)),
      contentType: "application/json"
    });
    await this.repository.mutate((database) => {
      const session = database.sessions.find((item) => item.id === input.sessionId);
      if (!session) throw new AppError("SESSION_NOT_FOUND", `找不到共读 session：${input.sessionId}`);
      session.sourceManifest = structuredClone(sourceManifest);
      if (sourceManifest.readingState?.position) {
        session.userCurrentPosition = structuredClone(sourceManifest.readingState.position);
        session.lastReadAt = this.deps.now().toISOString();
      }
      session.updatedAt = this.deps.now().toISOString();
    });
    return { sourceManifest };
  }

  async createNovelSessionAndUpload(input: {
    title: string;
    sourceText: string;
    sourceKind: Extract<SourceKind, "pasted_text" | "file_import">;
    documentStructure?: DocumentStructure;
    readingState?: SyncedReadingState;
  }): Promise<{ session: ReadingSession; sourceManifest: SourceManifest }> {
    const session = await this.repository.mutate((database) => {
      const now = this.deps.now().toISOString();
      const item: ReadingSession = {
        id: this.deps.id(),
        title: input.title,
        type: "novel",
        status: "active",
        userCurrentPosition: {
          kind: "paragraph",
          index: 1,
          label: "第 1 段"
        },
        assistantSyncedPosition: null,
        liveReadingEnabled: false,
        sessionPreferences: structuredClone(DEFAULT_SESSION_PREFERENCES),
        sourceManifest: null,
        createdAt: now,
        updatedAt: now,
        lastReadAt: now
      };
      database.sessions.push(item);
      return item;
    });
    const { sourceManifest } = await this.uploadNovelSource({
      sessionId: session.id,
      sourceText: input.sourceText,
      sourceKind: input.sourceKind,
      title: input.title,
      ...(input.documentStructure
        ? { documentStructure: input.documentStructure }
        : {}),
      ...(input.readingState ? { readingState: input.readingState } : {})
    });
    return {
      session: {
        ...session,
        ...(sourceManifest.readingState?.position
          ? {
              userCurrentPosition: structuredClone(sourceManifest.readingState.position),
              lastReadAt: sourceManifest.readingState.updatedAt
            }
          : {}),
        sourceManifest
      },
      sourceManifest
    };
  }

  async updateNovelReadingState(input: {
    sessionId: string;
    readingState: SyncedReadingState;
  }): Promise<{ session: ReadingSession; sourceManifest: SourceManifest }> {
    const now = this.deps.now();
    const readingState = normalizeReadingState(input.readingState, now);
    const result = await this.repository.mutate((database) => {
      const session = database.sessions.find((item) => item.id === input.sessionId);
      if (!session) throw new AppError("SESSION_NOT_FOUND", `找不到共读 session：${input.sessionId}`);
      if (!session.sourceManifest?.cloudSync.enabled) {
        throw new AppError("INVALID_OPERATION", "这本书尚未同步到私人云端。");
      }
      session.sourceManifest.readingState = structuredClone(readingState);
      if (readingState.position) {
        session.userCurrentPosition = structuredClone(readingState.position);
        session.lastReadAt = readingState.updatedAt;
      }
      session.updatedAt = this.deps.now().toISOString();
      return {
        session: structuredClone(session),
        sourceManifest: structuredClone(session.sourceManifest)
      };
    });
    const manifestObjectKey = result.sourceManifest.cloudSync.manifestObjectKey;
    if (manifestObjectKey) {
      await this.storage.putObject({
        key: manifestObjectKey,
        bytes: new TextEncoder().encode(JSON.stringify(result.sourceManifest)),
        contentType: "application/json"
      });
    }
    return result;
  }

  async restoreNovelSource(sessionId: string): Promise<{
    sourceText: string;
    sourceManifest: SourceManifest;
    documentStructure?: DocumentStructure;
  }> {
    const sourceManifest = await this.requireCloudSourceManifest(sessionId);
    const objectKey = sourceManifest.cloudSync.objectKey;
    if (!objectKey) {
      throw new AppError("INVALID_OPERATION", "云端正文对象不存在。");
    }
    let object;
    try {
      object = await this.storage.getObject(objectKey);
    } catch (error) {
      if (error instanceof SourceObjectNotFoundError) {
        throw new AppError("INVALID_OPERATION", "云端正文对象不存在。");
      }
      throw error;
    }
    const sourceText = new TextDecoder().decode(object.bytes);
    const normalizedText = normalizeNovelSourceText(sourceText);
    const bytes = new TextEncoder().encode(normalizedText);
    if (sha256Hex(bytes) !== sourceManifest.contentHash) {
      throw new AppError("INVALID_OPERATION", "云端正文 hash 校验失败。");
    }
    let documentStructure: DocumentStructure | undefined;
    const documentObjectKey = sourceManifest.cloudSync.documentObjectKey;

    if (documentObjectKey) {
      try {
        const documentObject = await this.storage.getObject(documentObjectKey);
        const parsed = JSON.parse(
          new TextDecoder().decode(documentObject.bytes)
        ) as unknown;

        if (!isPdfDocumentStructure(parsed)) {
          throw new Error("Invalid PDF document structure");
        }

        documentStructure = parsed;
      } catch (error) {
        if (error instanceof SourceObjectNotFoundError) {
          throw new AppError("INVALID_OPERATION", "云端文档结构对象不存在。");
        }
        if (error instanceof AppError) throw error;
        throw new AppError("INVALID_OPERATION", "云端文档结构无效。");
      }
    }

    let paragraphCount: number;
    try {
      paragraphCount = countNovelParagraphsForManifest(
        normalizedText,
        sourceManifest,
        documentStructure
      );
    } catch {
      throw new AppError("INVALID_OPERATION", "云端文档结构与正文不匹配。");
    }

    if (paragraphCount !== sourceManifest.paragraphCount) {
      throw new AppError("INVALID_OPERATION", "云端正文分段数量校验失败。");
    }

    return {
      sourceText: normalizedText,
      sourceManifest,
      ...(documentStructure ? { documentStructure } : {})
    };
  }

  async getCloudSourceStatus(sessionId: string): Promise<{
    status: "available" | "missing" | "disabled";
  }> {
    const database = await this.repository.read();
    const session = database.sessions.find((item) => item.id === sessionId);
    if (!session) throw new AppError("SESSION_NOT_FOUND", `找不到共读 session：${sessionId}`);
    const objectKey = session.sourceManifest?.cloudSync.objectKey;
    if (!session.sourceManifest?.cloudSync.enabled || !objectKey) {
      return { status: "disabled" };
    }
    const head = await this.storage.headObject(objectKey);
    return { status: head.exists ? "available" : "missing" };
  }

  async deleteCloudSource(sessionId: string): Promise<{
    deleted: boolean;
    cloudSourceDeleted: boolean;
    cloudSourceDeleteError?: string;
  }> {
    const database = await this.repository.read();
    const session = database.sessions.find((item) => item.id === sessionId);
    if (!session) throw new AppError("SESSION_NOT_FOUND", `找不到共读 session：${sessionId}`);
    const cloudSync = session.sourceManifest?.cloudSync;
    if (!cloudSync?.enabled) return { deleted: false, cloudSourceDeleted: false };

    const keys = [
      cloudSync.objectKey,
      cloudSync.manifestObjectKey,
      cloudSync.documentObjectKey
    ].filter(
      (key): key is string => Boolean(key)
    );

    let deleted = false;
    const errors: string[] = [];
    for (const key of keys) {
      try {
        deleted = (await this.storage.deleteObject(key)).deleted || deleted;
      } catch (error) {
        errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      deleted,
      cloudSourceDeleted: deleted && errors.length === 0,
      ...(errors.length ? { cloudSourceDeleteError: errors.join("; ") } : {})
    };
  }

  private async requireCloudSourceManifest(sessionId: string): Promise<SourceManifest> {
    const database = await this.repository.read();
    const session = database.sessions.find((item) => item.id === sessionId);
    if (!session) throw new AppError("SESSION_NOT_FOUND", `找不到共读 session：${sessionId}`);
    if (!session.sourceManifest?.cloudSync.enabled) {
      throw new AppError("INVALID_OPERATION", "这本书尚未同步到私人云端。");
    }
    return session.sourceManifest;
  }
}

export function normalizeNovelSourceText(sourceText: string): string {
  return sourceText.replace(/\r\n?/g, "\n");
}

function countNovelParagraphsForManifest(
  sourceText: string,
  sourceManifest: SourceManifest,
  documentStructure?: DocumentStructure
): number {
  return documentStructure
    ? splitPdfDocumentSource(
        sourceText,
        documentStructure,
        sourceManifest.segmentationVersion
      ).length
    : splitNovelTextForVersion(
        sourceText,
        sourceManifest.segmentationVersion
      ).length;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeReadingState(
  input: SyncedReadingState,
  now: Date
): SyncedReadingState {
  const updatedAt = input.updatedAt || now.toISOString();
  return {
    schemaVersion: 1,
    ...(input.position ? { position: normalizePosition(input.position) } : {}),
    ...(input.annotations
      ? {
          annotations: input.annotations.slice(0, 1000).map((annotation) => ({
            pageIndex: Math.max(0, Math.trunc(annotation.pageIndex)),
            text: annotation.text.trim().slice(0, 10_000),
            ...(annotation.comment ? { comment: annotation.comment.trim().slice(0, 4_000) } : {}),
            ...(annotation.assistantSummary
              ? { assistantSummary: annotation.assistantSummary.trim().slice(0, 4_000) }
              : {}),
            createdAt: annotation.createdAt || updatedAt,
            ...(annotation.updatedAt ? { updatedAt: annotation.updatedAt } : {})
          }))
        }
      : {}),
    ...(input.checkpoint === null
      ? { checkpoint: null }
      : input.checkpoint
        ? {
            checkpoint: {
              pageIndex: Math.max(0, Math.trunc(input.checkpoint.pageIndex)),
              label: input.checkpoint.label.trim().slice(0, 100),
              summary: input.checkpoint.summary.trim().slice(0, 4_000),
              updatedAt: input.checkpoint.updatedAt || updatedAt
            }
          }
        : {}),
    updatedAt
  };
}

function normalizePosition(position: ReadingPosition): ReadingPosition {
  return {
    kind: position.kind,
    index: Math.max(1, Math.trunc(position.index)),
    ...(position.total ? { total: Math.max(1, Math.trunc(position.total)) } : {}),
    label: position.label.trim().slice(0, 100)
  };
}
