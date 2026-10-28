// Pass-through file-content access for extraction stages. loadFacts hashes
// every dirty file and pre-seeds a bounded text window; this provider reuses
// those bytes while lazily re-reading files beyond the memory budget.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { IO_CONCURRENCY, mapLimit } from "./asyncutil.js";

export interface FileSource {
  /** File contents, or undefined when unreadable. */
  read(file: string): Promise<string | undefined>;
}

/** Build a source over a root; `contents` pre-seeds already-read files. */
export const makeFileSource = (
  root: string,
  contents?: ReadonlyMap<string, string>,
): FileSource => {
  const inflight = new Map<string, Promise<string | undefined>>();
  return {
    read(file: string): Promise<string | undefined> {
      const cached = contents?.get(file);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = inflight.get(file);
      if (pending) return pending;
      const p = readFile(join(root, file), "utf8")
        .then(
          (text) => text,
          () => undefined,
        )
        .finally(() => inflight.delete(file));
      inflight.set(file, p);
      return p;
    },
  };
};

/** Bounded helper for "read all of these" callers. */
export const readAll = async (
  files: readonly string[],
  source: FileSource,
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  await mapLimit(files, IO_CONCURRENCY, async (file) => {
    const text = await source.read(file);
    if (text !== undefined) out.set(file, text);
  });
  return out;
};
