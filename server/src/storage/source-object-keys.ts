const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function buildSourceObjectKey(sourceId: string): string {
  const safeSourceId = validateSourceId(sourceId);
  return `private/sources/${safeSourceId}/source.txt`;
}

export function buildSourceManifestObjectKey(sourceId: string): string {
  const safeSourceId = validateSourceId(sourceId);
  return `private/sources/${safeSourceId}/manifest.json`;
}

export function buildDocumentStructureObjectKey(sourceId: string): string {
  const safeSourceId = validateSourceId(sourceId);
  return `private/sources/${safeSourceId}/document.json`;
}

function validateSourceId(sourceId: string): string {
  if (!SOURCE_ID_PATTERN.test(sourceId) || sourceId.includes("..")) {
    throw new Error("sourceId must be an opaque path-safe id");
  }
  return sourceId;
}
