import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export async function readUtf8File(
  path: string,
  label: string,
  maximumBytes = DEFAULT_MAX_BYTES
): Promise<string> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    throw new Error(`${label} not found at ${path}`, { cause: error });
  }
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${path}`);
  if (metadata.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte safety limit`);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`could not read ${label} at ${path}`, { cause: error });
  }
}

export async function readOptionalUtf8File(path: string): Promise<string | null> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return null;
    if (metadata.size > DEFAULT_MAX_BYTES) {
      throw new Error(`optional file ${path} exceeds the safety limit`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function writeUtf8File(
  path: string,
  content: string,
  options: { readonly force: boolean }
): Promise<"created" | "unchanged" | "replaced"> {
  await mkdir(dirname(path), { recursive: true });
  const existing = await readOptionalUtf8File(path);
  if (existing === content) return "unchanged";
  if (existing !== null && !options.force) {
    throw new Error(`refusing to overwrite ${path}; rerun with --force after checking the target`);
  }
  await writeFile(path, content, "utf8");
  return existing === null ? "created" : "replaced";
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
