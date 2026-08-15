import { AppError } from "./errors/app-error.js";
import { sanitizeBookshelfBundle } from "./privacy/sanitize-bookshelf.js";
import type { CloudSourceService } from "./services/cloud-source-service.js";
import type { ReadingService } from "./services/reading-service.js";
import {
  isPdfDocumentStructure,
  syncedReadingStateSchema,
  type DocumentStructure,
  type SyncedReadingState
} from "@ss/shared";

export async function handleSourceRoute(
  request: Request,
  service: CloudSourceService | undefined,
  readingService?: ReadingService
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (url.pathname.endsWith("/bootstrap")) {
    if (request.method !== "GET") {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }
    if (!readingService) {
      return json({ error: "Bookshelf recovery is unavailable." }, 503);
    }
    try {
      const snapshot = await readingService.getBookshelfSnapshot();
      const bookshelfSessions = snapshot.sessionBundles
        .filter(({ session }) => session.type === "novel")
        .map(sanitizeBookshelfBundle);
      return json(
        {
          bookshelfSessions,
          recentSessions: bookshelfSessions.slice(0, 10),
          readingRecords: snapshot.readingRecords
        },
        200,
        { "cache-control": "no-store" }
      );
    } catch {
      return json({ error: "Bookshelf recovery failed." }, 500);
    }
  }
  if (request.method !== "POST") return new Response("Not found", { status: 404, headers: corsHeaders() });
  if (!service) {
    return json({ error: "Cloud source storage is not enabled for this deployment." }, 503);
  }

  try {
    if (url.pathname.endsWith("/upload")) {
      const input = await readJson(request);
      const sourceKind = readSourceKind(input);
      const documentStructure = readOptionalDocumentStructure(input);
      const readingState = readOptionalReadingState(input);
      const paragraphCount = countParagraphs(
        typeof input.sourceText === "string" ? input.sourceText : ""
      );
      const sessionId = readOptionalString(input, "sessionId");
      const common = {
        ...(typeof input.title === "string" && input.title.trim()
          ? { title: input.title.trim() }
          : {})
      };
      const result =
        !sessionId || sessionId.startsWith("local-")
          ? await service.createNovelSessionAndUpload({
              title: common.title ?? "未命名小说",
              sourceKind,
              sourceText: readString(input, "sourceText"),
              ...(documentStructure ? { documentStructure } : {}),
              ...(readingState ? { readingState } : {})
            })
          : await service.uploadNovelSource({
              sessionId,
              ...common,
              sourceKind,
              sourceText: readString(input, "sourceText"),
              ...(documentStructure ? { documentStructure } : {}),
              ...(readingState ? { readingState } : {})
            });
      logSourceRoute({ route: "upload", sourceKind, status: 200, paragraphCount });
      return json(result);
    }
    if (url.pathname.endsWith("/state")) {
      const input = await readJson(request);
      const result = await service.updateNovelReadingState({
        sessionId: readString(input, "sessionId"),
        readingState: readReadingState(input)
      });
      logSourceRoute({ route: "state", status: 200 });
      return json({
        session: result.session,
        sourceManifest: result.sourceManifest
      });
    }
    if (url.pathname.endsWith("/restore")) {
      const input = await readJson(request);
      return json(await service.restoreNovelSource(readString(input, "sessionId")));
    }
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  } catch (error) {
    logSourceRoute({
      route: url.pathname.endsWith("/upload")
        ? "upload"
        : url.pathname.endsWith("/restore")
          ? "restore"
          : "unknown",
      status: error instanceof AppError ? 400 : 500,
      errorCode: error instanceof AppError ? error.code : "UNEXPECTED"
    });
    if (error instanceof AppError) {
      return json({ error: error.message }, 400);
    }
    return json({ error: "Source request failed" }, 500);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("INVALID_OPERATION", "请求格式无效。");
  }
  return value as Record<string, unknown>;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("INVALID_OPERATION", "请求缺少必要字段。");
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalDocumentStructure(
  input: Record<string, unknown>
): DocumentStructure | undefined {
  if (input.documentStructure === undefined) return undefined;

  if (!isPdfDocumentStructure(input.documentStructure)) {
    throw new AppError("INVALID_OPERATION", "文档结构格式无效。");
  }

  return input.documentStructure;
}

function readOptionalReadingState(input: Record<string, unknown>): SyncedReadingState | undefined {
  return input.readingState === undefined ? undefined : readReadingState(input);
}

function readReadingState(input: Record<string, unknown>): SyncedReadingState {
  const result = syncedReadingStateSchema.safeParse(input.readingState);
  if (!result.success) {
    throw new AppError("INVALID_OPERATION", "阅读状态格式无效。");
  }
  return result.data;
}

function readSourceKind(input: Record<string, unknown>): "pasted_text" | "file_import" {
  const value = input.sourceKind;
  if (value === "pasted_text" || value === "file_import") return value;
  throw new AppError("INVALID_OPERATION", "暂时只支持小说正文云端同步。");
}

function countParagraphs(sourceText: string): number {
  return sourceText
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400"
  };
}

function logSourceRoute(event: Record<string, unknown>) {
  console.log(JSON.stringify({ component: "source-route", ...event }));
}
