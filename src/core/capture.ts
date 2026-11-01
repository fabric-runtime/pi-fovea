// Mutation pre-image capture. It runs on Pi's tool boundary before an edit
// lands, so it stays deliberately small: one file hash, with no analysis
// runtime, journal, or graph imports. Provenance re-exports it for callers
// that already hold the full runtime.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface MutationCapture {
  root: string;
  file: string;
  absolutePath: string;
  beforeSha?: string;
}

export const hashFile = async (path: string): Promise<string | undefined> => {
  try {
    return createHash("sha1")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return undefined;
  }
};

export const repoPath = (
  root: string,
  path: string,
): { file: string; absolutePath: string } | undefined => {
  const absolutePath = resolve(root, path);
  const file = relative(resolve(root), absolutePath);
  if (!file || file === ".." || file.startsWith(`..${sep}`) || isAbsolute(file)) return undefined;
  return { file: file.split(sep).join("/"), absolutePath };
};

export const captureMutation = async (
  root: string,
  path: string,
): Promise<MutationCapture | undefined> => {
  const located = repoPath(root, path);
  if (!located) return undefined;
  return { root: resolve(root), ...located, beforeSha: await hashFile(located.absolutePath) };
};
