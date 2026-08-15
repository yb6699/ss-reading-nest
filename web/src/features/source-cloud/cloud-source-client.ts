import {
  READING_NEST_APP_VERSION,
  READING_NEST_RESOURCE_VERSION,
  type DocumentStructure,
  type ReadingRecord,
  type SessionBundle,
  type SourceKind,
  type SourceManifest
} from "@ss/shared";
import type { ToolCallResult } from "../../types/openai.js";
import type { UnavailableToolResult } from "../../bridge/host.js";

type FetchLike = typeof fetch;
type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<ToolCallResult | UnavailableToolResult>;
export type CloudUploadStatus = "not_started" | "success" | "failure";
export interface CloudUploadDiagnostics {
  bridgeToolAvailable: boolean;
  bridgeUploadStarted: boolean;
  bridgeUploadStatus: CloudUploadStatus;
  bridgeUploadError?: string;
  returnedCloudSyncEnabled?: boolean;
  directUploadStarted: boolean;
  directUploadStatus: CloudUploadStatus;
  directUploadError?: string;
}

export interface CloudSourceUploadResult {
  sourceManifest?: SourceManifest;
  diagnostics: CloudUploadDiagnostics;
}

export interface CloudBookshelfBootstrap {
  bookshelfSessions: Array<SessionBundle & { cacheState?: string }>;
  recentSessions: Array<SessionBundle & { cacheState?: string }>;
  readingRecords: ReadingRecord[];
}

const MAX_BRIDGE_NOVEL_UPLOAD_BYTES = 2 * 1024 * 1024;

export class CloudSourceClient {
  constructor(
    private readonly endpointBase: string,
    private readonly fetchFn: FetchLike = fetch.bind(window),
    private readonly toolCaller?: ToolCaller
  ) {}

  async uploadNovelSource(input: {
    sessionId: string;
    title?: string;
    sourceText: string;
    sourceKind?: SourceKind;
    documentStructure?: DocumentStructure;
  }): Promise<CloudSourceUploadResult> {
    const sourceKind = input.sourceKind ?? "pasted_text";
    if (hasPrivateSourceEndpoint(this.endpointBase)) {
      return this.uploadViaDirect({
        sessionId: input.sessionId,
        sourceKind,
        ...(input.title ? { title: input.title } : {}),
        sourceText: input.sourceText,
        ...(input.documentStructure
          ? { documentStructure: input.documentStructure }
          : {})
      });
    }
    if (this.toolCaller && new Blob([input.sourceText]).size <= MAX_BRIDGE_NOVEL_UPLOAD_BYTES) {
      return this.uploadViaTool({
        sessionId: input.sessionId,
        sourceKind,
        ...(input.title ? { title: input.title } : {}),
        sourceText: input.sourceText,
        ...(input.documentStructure
          ? { documentStructure: input.documentStructure }
          : {})
      });
    }
    if (this.toolCaller) {
      return {
        diagnostics: {
          bridgeToolAvailable: true,
          bridgeUploadStarted: false,
          bridgeUploadStatus: "failure",
          bridgeUploadError: "source text too large for bridge upload; use private source endpoint",
          directUploadStarted: false,
          directUploadStatus: "not_started"
        }
      };
    }
    return this.uploadViaDirect({
      sessionId: input.sessionId,
      sourceKind: "pasted_text",
      ...(input.title ? { title: input.title } : {}),
      sourceText: input.sourceText
    });
  }

  async restoreNovelSource(input: {
    sessionId: string;
  }): Promise<{
    sourceText: string;
    sourceManifest: SourceManifest;
    documentStructure?: DocumentStructure;
  }> {
    return this.post<{
      sourceText: string;
      sourceManifest: SourceManifest;
      documentStructure?: DocumentStructure;
    }>("/restore", {
      sessionId: input.sessionId
    });
  }

  async loadBookshelf(): Promise<CloudBookshelfBootstrap> {
    if (!hasPrivateSourceEndpoint(this.endpointBase)) {
      throw new Error("Private bookshelf endpoint is unavailable");
    }
    const requestUrl = `${this.endpointBase}/bootstrap`;
    let response: Response;
    try {
      response = await this.fetchFn(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store"
      });
    } catch (error) {
      throw new Error(buildFetchBlockedMessage(requestUrl, error));
    }
    const payload = (await response.json()) as CloudBookshelfBootstrap & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `书架恢复失败（HTTP ${response.status}）`);
    }
    if (!Array.isArray(payload.bookshelfSessions) || !Array.isArray(payload.readingRecords)) {
      throw new Error("书架恢复结果格式无效");
    }
    return payload;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const uploadUrl = `${this.endpointBase}${path}`;
    let response: Response;
    try {
      response = await this.fetchFn(uploadUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(buildFetchBlockedMessage(uploadUrl, error));
    }
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `云端正文请求失败（HTTP ${response.status}）`);
    }
    return payload as T;
  }

  private async uploadViaTool(input: Record<string, unknown>): Promise<CloudSourceUploadResult> {
    try {
      const result = await this.toolCaller!("upload_cloud_source", input);
      // The host returned a typed unavailable result (e.g. pure browser with no
      // host bridge). The tool was never actually invoked, so the bridge upload
      // must NOT be reported as started or successful.
      if (result && typeof result === "object" && "unavailable" in result) {
        return {
          diagnostics: {
            bridgeToolAvailable: false,
            bridgeUploadStarted: false,
            bridgeUploadStatus: "not_started",
            directUploadStarted: false,
            directUploadStatus: "not_started"
          }
        };
      }
      const sourceManifest =
        (result._meta?.sourceManifest as SourceManifest | undefined) ??
        (result.structuredContent?.sourceManifest as SourceManifest | undefined);
      return {
        ...(sourceManifest ? { sourceManifest } : {}),
        diagnostics: {
          bridgeToolAvailable: true,
          bridgeUploadStarted: true,
          bridgeUploadStatus: "success",
          returnedCloudSyncEnabled: sourceManifest?.cloudSync?.enabled === true,
          directUploadStarted: false,
          directUploadStatus: "not_started"
        }
      };
    } catch (error) {
      return {
        diagnostics: {
          bridgeToolAvailable: true,
          bridgeUploadStarted: true,
          bridgeUploadStatus: "failure",
          bridgeUploadError: sanitizeDiagnostic(error instanceof Error ? error.message : String(error)),
          directUploadStarted: false,
          directUploadStatus: "not_started"
        }
      };
    }
  }

  private async uploadViaDirect(input: Record<string, unknown>): Promise<CloudSourceUploadResult> {
    try {
      const result = await this.post<{ sourceManifest: SourceManifest }>("/upload", input);
      return {
        sourceManifest: result.sourceManifest,
        diagnostics: {
          bridgeToolAvailable: false,
          bridgeUploadStarted: false,
          bridgeUploadStatus: "not_started",
          returnedCloudSyncEnabled: result.sourceManifest?.cloudSync?.enabled === true,
          directUploadStarted: true,
          directUploadStatus: "success"
        }
      };
    } catch (error) {
      return {
        diagnostics: {
          bridgeToolAvailable: false,
          bridgeUploadStarted: false,
          bridgeUploadStatus: "not_started",
          directUploadStarted: true,
          directUploadStatus: "failure",
          directUploadError: sanitizeDiagnostic(error instanceof Error ? error.message : String(error), 1_000)
        }
      };
    }
  }
}

function hasPrivateSourceEndpoint(endpointBase: string): boolean {
  try {
    const url = new URL(endpointBase, window.location.href);
    return /\/source\/[^/]+$/.test(url.pathname);
  } catch {
    return /\/source\/[^/]+$/.test(endpointBase);
  }
}

function buildFetchBlockedMessage(uploadUrl: string, error: unknown): string {
  const urlInfo = describeUploadUrl(uploadUrl);
  const errorName = error instanceof Error ? error.name : typeof error;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const likelyBrowserBlock =
    errorName === "TypeError" ||
    /failed to fetch|load failed|networkerror|csp|content security/i.test(errorMessage);
  return [
    "云端正文请求未到达服务器",
    `resourceVersion=${READING_NEST_RESOURCE_VERSION}`,
    `appVersion=${READING_NEST_APP_VERSION}`,
    `sourceEndpointBase=${uploadUrl ? "present" : "missing"}`,
    `uploadOrigin=${urlInfo.origin}`,
    `uploadPath=${urlInfo.path}`,
    `fetchError=${sanitizeDiagnostic(errorName)}:${sanitizeDiagnostic(errorMessage)}`,
    `likelyBrowserBlock=${likelyBrowserBlock ? "yes" : "unknown"}`,
    "可能被 CSP、浏览器安全策略或网络拦截"
  ].join("；");
}

function describeUploadUrl(uploadUrl: string) {
  try {
    const url = new URL(uploadUrl, window.location.href);
    return {
      origin: url.origin,
      path: maskSourcePath(url.pathname)
    };
  } catch {
    return {
      origin: "unknown",
      path: maskSourcePath(uploadUrl)
    };
  }
}

function maskSourcePath(value: string): string {
  return value
    .replace(/\/mcp\/[^/\s"'<>]+/g, "/mcp/<token>")
    .replace(/\/source\/[^/\s"'<>]+/g, "/source/<token>");
}

function sanitizeDiagnostic(value: string, maxLength = 140): string {
  return maskSourcePath(value)
    .replace(/private\/sources\/[^/\s"'<>]+/g, "private/sources/<sourceId>")
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g, "data:image/<redacted>")
    .slice(0, maxLength);
}
