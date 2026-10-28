import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "fovea-lean-test-"));
  temporary.push(dir);
  for (const path of ["proofs/lean", "scripts/check-lean.ts"])
    cpSync(join(root, path), join(dir, path), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dir;
};
const gate = (cwd: string, flag = "--artifact", env = process.env) =>
  spawnSync(process.execPath, ["--import", "tsx", "scripts/check-lean.ts", flag], {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    env,
  });
const change = (dir: string, path: string, mutate: (text: string) => string) => {
  const file = join(dir, path);
  writeFileSync(file, mutate(readFileSync(file, "utf8")));
};
const receipt = "proofs/lean/receipt.json";
describe("Lean model proof boundary", () => {
  it("checks the receipt without Lean or a mathlib checkout", () => {
    const dir = fixture();
    const result = gate(dir, "--artifact", {
      ...process.env,
      FOVEA_MATHLIB_ROOT: join(dir, "missing-mathlib"),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("28 Lean theorem receipts match");
    expect(result.stdout).toContain("correspondence not claimed");
  });
  it("refuses stale source without rewriting the receipt", () => {
    const dir = fixture(),
      original = readFileSync(join(dir, receipt), "utf8");
    change(dir, "proofs/lean/Fovea/Arithmetic.lean", (text) => text + "\n");
    expect(gate(dir).stderr).toContain("artifact is stale");
    expect(readFileSync(join(dir, receipt), "utf8")).toBe(original);
  });
  it.each(["unapproved-axiom", "claimed-correspondence", "missing-audit"])(
    "refuses a forged %s receipt",
    (kind) => {
      const dir = fixture();
      change(dir, receipt, (text) => {
        const value = JSON.parse(text);
        if (kind === "unapproved-axiom")
          value.axioms["Fovea.poisson_identity"].push("imaginary_axiom");
        if (kind === "claimed-correspondence") value.correspondence = "proved";
        if (kind === "missing-audit") delete value.axioms["Fovea.poisson_identity"];
        return JSON.stringify(value);
      });
      expect(gate(dir).stderr).toContain("stale or unaudited");
    },
  );
  it("refuses a renamed required theorem and unlisted module", () => {
    const dir = fixture();
    change(dir, "proofs/lean/Fovea/Arithmetic.lean", (text) =>
      text.replace("theorem value_addDigits", "theorem renamed_addDigits"),
    );
    expect(gate(dir).stderr).toContain("theorem inventory mismatch");
    writeFileSync(join(dir, "proofs/lean/Fovea/Extra.lean"), "import Mathlib.Tactic\n");
    expect(gate(dir).stderr).toContain("source inventory mismatch");
  });
  it.each([
    "axiom fabricated : False",
    "example : False := by sorry",
    "example : True := by native_decide",
  ])("refuses proof escapes: %s", (escape) => {
    const dir = fixture();
    change(dir, "proofs/lean/Fovea/Arithmetic.lean", (text) => text + "\n" + escape + "\n");
    expect(gate(dir).stderr).toContain("prohibited Lean escape");
  });
  it("requires an explicit mathlib checkout for a full proof check", () => {
    const result = gate(fixture(), "--write", { ...process.env, FOVEA_MATHLIB_ROOT: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Set FOVEA_MATHLIB_ROOT");
  });
  // The dedicated CI/release gate sets this variable and performs real Lean
  // elaboration. Ordinary affected tests keep the compiler-free boundary.
  it.skipIf(!process.env.FOVEA_MATHLIB_ROOT)(
    "rejects a false unbounded theorem before --write can update receipts",
    () => {
      const dir = fixture(),
        original = readFileSync(join(dir, receipt), "utf8");
      change(dir, "proofs/lean/Fovea/Arithmetic.lean", (text) => {
        const before = "value base xs + value base ys + carry := by";
        expect(text).toContain(before);
        return text.replace(before, "value base xs + value base ys := by");
      });
      const result = gate(dir, "--write");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("error:");
      expect(readFileSync(join(dir, receipt), "utf8")).toBe(original);
    },
    120000,
  );
});
