// Extraction against the cross-language minimonorepo fixture.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAstGrep } from "../src/core/astgrep.js";
import {
  extractCalls,
  extractImports,
  extractLiterals,
  extractSymbols,
} from "../src/core/extract.js";
import { compileMethods, extractAnchors, extractFileRoutes } from "../src/core/anchors.js";
import type { SymbolRec } from "../src/core/types.js";

const FIXTURE = new URL("./fixtures/mini", import.meta.url).pathname;
const CODE = [
  "server/main.go",
  "server/users.go",
  "server/config.go",
  "web/api.ts",
  "web/types.ts",
  "web/api.test.ts",
  "web/airports.controller.ts",
  "web/server-switcher.ts",
  "worker/jobs.py",
  "worker/search.rs",
];
const ECO = [
  "server/mux.go",
  "server/SpringUsersController.java",
  "worker/urls.py",
  "server/routes.rb",
  "server/router.ex",
  "server/App.kt",
  "web/api.ts",
  "worker/jobs.py",
];
const FILE_ROUTES = [
  "app/api/orders/route.ts",
  "app/(shop)/reports/page.tsx",
  "pages/api/health.ts",
  "src/routes/channels/[name]/+server.ts",
  "server/api/session.get.ts",
];
const ALL = [...CODE, "openapi.yaml"];

const enclosing =
  (syms: SymbolRec[]) =>
  (file: string, line: number): string | undefined => {
    let best: SymbolRec | undefined;
    for (const s of syms.filter((x) => x.file === file)) {
      if (s.line <= line && (!best || s.line > best.line)) best = s;
    }
    return best ? `${best.name}@${best.file}` : `file:${file}`;
  };

describe.skipIf(!hasAstGrep())("extraction (ast-grep present)", () => {
  it("extracts symbols across Go, TypeScript and Python via outline", async () => {
    const syms = await extractSymbols(CODE, FIXTURE);
    const byId = new Map(syms.map((s) => [`${s.name}@${s.file}`, s]));
    expect(byId.get("GetUserHandler@server/users.go")?.kind).toBe("function");
    expect(byId.get("GetUserHandler@server/users.go")?.sig).toContain("func GetUserHandler");
    expect(byId.get("Router@server/main.go")?.kind).toBe("class");
    expect(byId.get("Router.db@server/main.go")?.kind).toBe("field");
    expect(byId.get("Router.GET@server/main.go")?.kind).toBe("method");
    expect(byId.get("LoadUser@server/users.go")?.kind).toBe("function");
    // Rust path: struct + impl methods land with Type.method names.
    expect(syms.some((s) => s.file === "worker/search.rs" && /UserSearch/.test(s.name))).toBe(true);
    expect(byId.get("loadUser@web/api.ts")?.kind).toBe("function");
    expect(byId.get("User@web/api.ts")?.kind).toBe("interface");
    expect(byId.get("User.id@web/api.ts")?.kind).toBe("field");
    expect(byId.get("UserName@web/types.ts")?.kind).toBe("type");
    expect(byId.get("sync_users@worker/jobs.py")?.kind).toBe("function");
    expect(byId.get("fetch_all@worker/jobs.py")).toBeTruthy();

    expect(byId.get("AirportsController@web/airports.controller.ts")).toMatchObject({
      line: 5,
      sig: "export class AirportsController {",
    });
    expect(byId.get("AirportsController.search@web/airports.controller.ts")).toMatchObject({
      line: 7,
      sig: "search(@Query('q') q?: string): string[] {",
    });
    expect(byId.get("AirportsController.find@web/airports.controller.ts")?.line).toBe(12);
    expect(byId.get("ClientConnection.switchingServers@web/server-switcher.ts")).toMatchObject({
      line: 2,
      sig: "private switchingServers = false",
    });
    expect(byId.get("ClientConnection.connectToServer@web/server-switcher.ts")?.line).toBe(4);
    expect(byId.get("Router.GET@server/main.go")?.line).toBe(21);
    expect(byId.get("User.id@web/api.ts")?.line).toBe(4);
    expect(byId.get("UserSearch.new@worker/search.rs")?.line).toBe(9);
    expect(byId.get("UserSearch.fetch@worker/search.rs")?.line).toBe(13);
    expect(
      byId.get("AirportsController.search@web/airports.controller.ts")?.lineApproximate,
    ).not.toBe(true);
  });

  it("extracts imports across languages", async () => {
    const imps = await extractImports(CODE, FIXTURE);
    const has = (file: string, spec: string) =>
      imps.some((i) => i.file === file && i.spec === spec);
    expect(has("web/api.ts", "./types")).toBe(true);
    expect(has("web/api.test.ts", "./api")).toBe(true);
    expect(has("server/main.go", "github.com/acme/app/server")).toBe(true);
    expect(has("worker/jobs.py", "os")).toBe(true);
  });

  it("extracts call sites with callee names", async () => {
    const calls = await extractCalls(CODE, FIXTURE);
    const has = (file: string, callee: string) =>
      calls.some((c) => c.file === file && c.callee === callee);
    expect(has("server/users.go", "LoadUser")).toBe(true);
    expect(has("server/users.go", "SaveUser")).toBe(true);
    expect(has("web/api.ts", "fetch")).toBe(true);
  });

  it("extracts literals from code and config files", async () => {
    const lits = await extractLiterals(ALL, FIXTURE);
    const texts = lits.map((l) => `${l.text}@${l.file}`);
    expect(texts).toContain("/api/users/${id}@web/api.ts");
    expect(texts).toContain("/api/users/:id@server/main.go");
    expect(texts).toContain("/api/users/{id}@openapi.yaml");
    expect(texts).toContain("DATABASE_URL@server/config.go");
    expect(texts).toContain("DATABASE_URL@worker/jobs.py");
  });

  it("discovers route anchors from the default pack and binds handlers", async () => {
    const syms = await extractSymbols(CODE, FIXTURE);
    const anchors = await extractAnchors(CODE, FIXTURE, enclosing(syms));
    const labels = anchors.map((a) => `${a.id} -> ${a.nodeId}`);
    expect(labels.some((l) => l.startsWith("GET /api/users/{*}"))).toBe(true);
    expect(labels.some((l) => l.startsWith("POST /api/users"))).toBe(true);
    const get = anchors.find((a) => a.id.startsWith("GET "))!;
    expect(get.file).toBe("server/main.go");
    // NestJS style: single quotes + @Controller prefix composed into the path.
    expect(labels.some((l) => l.startsWith("GET /api/airports/search"))).toBe(true);
    expect(labels.some((l) => l.startsWith("GET /api/airports/{*}"))).toBe(true);
  });

  it("covers ecosystem route shapes: mux/chi/Spring/Django/Rails/Phoenix/Ktor", async () => {
    const syms = await extractSymbols(ECO, FIXTURE);
    const ids = new Set((await extractAnchors(ECO, FIXTURE, enclosing(syms))).map((a) => a.id));
    // Go 1.22 ServeMux carries the verb inside the pattern string.
    expect(ids.has("GET /healthz")).toBe(true);
    expect(ids.has("POST /v2/shutdown")).toBe(true);
    // chi: verb is the first string argument.
    expect(ids.has("GET /api/metrics")).toBe(true);
    // Spring: class @RequestMapping prefix + method @GetMapping suffix.
    expect(ids.has("GET /api/spring/ping")).toBe(true);
    expect(ids.has("POST /api/spring/save")).toBe(true);
    // Django urlconf mounts every verb → ANY.
    expect(ids.has("ANY /jobs")).toBe(true);
    // Rails macros, both quote styles; match() mounts every verb too.
    expect(ids.has("GET /up")).toBe(true);
    expect(ids.has("GET /mystatus")).toBe(true);
    expect(ids.has("ANY /webhook")).toBe(true);
    // Phoenix bare macros inside a scope (scope prefix is not composed).
    expect(ids.has("GET /elixir-health")).toBe(true);
    expect(ids.has("POST /elixir-events")).toBe(true);
    // Ktor trailing-lambda DSL.
    expect(ids.has("GET /ktor-ping")).toBe(true);
    expect(ids.has("POST /ktor-hook")).toBe(true);
    // Template literal client call (any-quote capture becomes this shape too).
    expect(ids.has("GET /api/orders/{*}")).toBe(true);
    // Python f-string client call.
    expect(ids.has("GET /api/jobs/{*}")).toBe(true);
    // Django regex url has no declarable path — must NOT anchor junk.
    expect([...ids].some((id) => id.includes("legacy"))).toBe(false);
  });

  it("derives anchors from file-convention routers (Next/SvelteKit/Nuxt)", async () => {
    const drafts = await extractFileRoutes(FILE_ROUTES, FIXTURE);
    const byId = new Map(drafts.map((d) => [d.id, d]));
    expect(byId.get("GET /api/orders")?.kind).toBe("route");
    expect(byId.has("POST /api/orders")).toBe(true);
    expect(byId.get("ANY /reports")?.kind).toBe("page");
    expect(byId.get("GET /channels/{*}")?.kind).toBe("route");
    expect(byId.get("GET /api/session")?.file).toBe("server/api/session.get.ts");
    expect(byId.has("ANY /api/health")).toBe(true);
  });

  it("normalizes variable items whose name inlined a huge C initializer", async () => {
    // aws-lc-sys 0.41-0.43 curve25519_tables.h: ast-grep outline --view=expanded
    // inlines the whole 260,027-char k25519Precomp initializer into the item
    // name. identifierRe() escaped it into a RegExp and V8 aborted the build
    // with SyntaxError "Regular expression too large".
    const root = mkdtempSync(join(tmpdir(), "fovea-biginit-"));
    try {
      const pad = "    0x10, 0x2024, 0x30ff, 0x40a5,\n".repeat(Math.ceil(320_000 / 32));
      writeFileSync(
        join(root, "tables.h"),
        "static const int tiny_ok[3] = { 1, 2, 3 };\n\n" +
          "static const long big_table[] = {\n" +
          pad +
          "};\n\n" +
          "static long use_tables(void) { return big_table[0] + tiny_ok[1]; }\n",
      );
      const syms = await extractSymbols(["tables.h"], root);
      const byId = new Map(syms.map((s) => [`${s.name}@${s.file}`, s]));
      expect(byId.get("big_table@tables.h")?.kind).toBe("decl");
      expect(byId.get("tiny_ok@tables.h")?.kind).toBe("decl");
      expect(byId.get("use_tables@tables.h")?.kind).toBe("function");
      for (const s of syms) {
        expect(s.name.length).toBeLessThanOrEqual(256);
        expect(s.name).not.toMatch(/[\s{}]/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Regression (issue #1): pack `methods` strings canonically use "(?i:…)"
// inline-flag groups — ES2025 RegExp modifiers that Node < 23 (V8 < 12.5)
// cannot even parse. compileMethods rewrites them to a trailing flag.
describe("compileMethods", () => {
  it("rewrites inline (?i:…) groups as case-insensitive plain groups", () => {
    const re = compileMethods("^(?i:get|post|put)$");
    expect(re.flags).toContain("i");
    expect(re.test("GET")).toBe(true);
    expect(re.test("put")).toBe(true);
    expect(re.test("getter")).toBe(false);
  });

  it("passes flag-free patterns through case-sensitively", () => {
    const re = compileMethods("^(get|post)$");
    expect(re.test("get")).toBe(true);
    expect(re.test("GET")).toBe(false);
  });
});

describe.skipIf(!hasAstGrep())("pre-modifier engine simulation", () => {
  it("extracts pack anchors when RegExp rejects inline-flag groups", async () => {
    const RealRegExp = globalThis.RegExp;
    const INLINE_FLAG_GROUP = /\(\?[ims-]+:/;
    class LegacyRegExp extends RealRegExp {
      constructor(source: string | RegExp, flags?: string) {
        if (typeof source === "string" && INLINE_FLAG_GROUP.test(source)) {
          throw new SyntaxError(`Invalid regular expression: /${source}/: Invalid group`);
        }
        super(source, flags);
      }
    }
    globalThis.RegExp = LegacyRegExp as unknown as typeof RegExp;
    try {
      const syms = await extractSymbols(CODE, FIXTURE);
      const anchors = await extractAnchors(CODE, FIXTURE, enclosing(syms));
      expect(anchors.some((a) => a.id.startsWith("GET /api/users/{*}"))).toBe(true);
      expect(anchors.some((a) => a.id.startsWith("GET /api/airports/search"))).toBe(true);
    } finally {
      globalThis.RegExp = RealRegExp;
    }
  });
});
