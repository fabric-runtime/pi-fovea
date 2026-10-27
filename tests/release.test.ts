import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("release proof toolchain", () => {
  it("publishes checked artifacts without a mandatory Lean audit", () => {
    const publish = read(".github/workflows/publish.yml");
    expect(publish).not.toMatch(/setup-lean|check:lean/);
    expect(publish).toContain("bun run pack:cli");
    expect(publish).toContain("bun run check:package:cli dist/fovea-cli.tgz");
    expect(publish).toContain("bun run check:package dist/pi-fovea.tgz");
  });
  it("retains Lean only as an explicit manual audit", () => {
    const checks = read(".github/workflows/test.yml");
    expect(checks).toMatch(/lean:\s+[\s\S]*?if: github.event_name == 'workflow_dispatch'/);
    expect(checks).toContain("bun run check:lean");
  });
});
