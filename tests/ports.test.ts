import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
const { verifyPortMap } = await vi.importActual<{
  verifyPortMap: (root: string) => Record<string, number>;
}>("../scripts/check-ports.ts");
const root = fileURLToPath(new URL("../", import.meta.url)),
  temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fovea-ports-"));
  temporary.push(dir);
  mkdirSync(join(dir, "proofs/lean"), { recursive: true });
  for (const path of ["proofs/ports.json", "proofs/ledger.json", "proofs/lean/ledger.json"])
    writeFileSync(join(dir, path), readFileSync(join(root, path)));
  return dir;
}
describe("honest Lean portability inventory", () => {
  it("tracks all 28 claims without claiming full equivalence", () => {
    expect(verifyPortMap(root)).toEqual({
      "runtime-specialization": 6,
      "constructive-rational": 18,
      open: 4,
    });
  });
  it.each(["missing", "duplicate", "unknown evidence", "false equivalence"] as const)(
    "rejects %s coverage",
    (kind) => {
      const dir = fixture(),
        file = join(dir, "proofs/ports.json"),
        rows = JSON.parse(readFileSync(file, "utf8"));
      if (kind === "missing") rows.pop();
      if (kind === "duplicate") rows[1] = rows[0];
      if (kind === "unknown evidence") rows[0].claims = ["invented-proof"];
      if (kind === "false equivalence") rows[0].equivalent = true;
      writeFileSync(file, JSON.stringify(rows));
      expect(() => verifyPortMap(dir)).toThrow();
    },
  );
});
