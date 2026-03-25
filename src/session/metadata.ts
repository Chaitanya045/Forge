import { dirname } from "node:path";

import type { SessionCatalogMetadata } from "./entries";

import { fsMkdir, fsReadFile, fsWriteFile } from "../tools/system/fs";
import { sessionCatalogMetadataSchema } from "./entries";
import { getSessionMetadataFilePath } from "./paths";

export async function readSessionCatalogMetadata(
  sessionId: string
): Promise<SessionCatalogMetadata | undefined> {
  const path = getSessionMetadataFilePath(sessionId);

  let content: string;
  try {
    content = await fsReadFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  const validated = sessionCatalogMetadataSchema.safeParse(parsed);
  if (!validated.success) {
    return undefined;
  }

  const normalizedTitle = validated.data.title?.trim();
  if (!normalizedTitle) {
    return undefined;
  }

  return {
    title: normalizedTitle,
  };
}

export async function writeSessionCatalogMetadata(
  sessionId: string,
  metadata: SessionCatalogMetadata
): Promise<void> {
  const path = getSessionMetadataFilePath(sessionId);
  const normalizedTitle = metadata.title?.trim();

  await fsMkdir(dirname(path), { recursive: true });
  await fsWriteFile(
    path,
    `${JSON.stringify(normalizedTitle ? { title: normalizedTitle } : {})}\n`,
    "utf8"
  );
}
