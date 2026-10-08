import { expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION, createAgentSession, createCodemodeExtension, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

it.each(["augment", "replace"])("Pi 1.1 loads %s mode, preserves callable tools and runs nested grep middleware", async (grepMode) => {
  expect(VERSION).toBe("1.1.0");
  const root = await mkdtemp(join(tmpdir(), "fovea-pi1-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "fovea.json"), JSON.stringify({ sync: { mode: "disabled" }, tools: { grepMode } }));
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "entry.ts"), "export function migrationProbe() { return 100; }\n");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // Restore a deterministic parent call through the authoritative session store.
  // No provider, credentials, or network is involved.
  const sessionManager = SessionManager.inMemory(root);
  sessionManager.appendMessage({ role: "assistant", api: "offline", provider: "offline", model: "fixture",
    content: [{ type: "toolCall", id: "offline-parent", name: "codemode", arguments: {} }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse", timestamp: 0 });
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["+codemode", "+grep"] });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
    additionalExtensionPaths: [new URL("../src/index.ts", import.meta.url).pathname],
    extensionFactories: [createCodemodeExtension({ mode: "only" })],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, sessionManager }));
    const errors: unknown[] = [];
    session.extensionRunner.onError(error => errors.push(error));
    await session.bindExtensions({});
    for (const name of ["fovea_sketch", "fovea_focus", "fovea_dwell", "fovea_impact", "grep"]) {
      expect(session.getActiveToolNames()).toContain(name);
      expect(session.getCallableToolNames()).toContain(name);
    }
    const projected = await session.agent.transformContext!([{ role: "system", content: "probe", toolsAdded: session.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })), timestamp: 0 }]);
    expect(projected.flatMap(message => message.role === "system" ? message.toolsAdded?.map(tool => tool.name) ?? [] : [])).toEqual(["codemode"]);
    const ctx = session.extensionRunner.createToolContext("offline-parent", undefined);
    const events: string[] = [];
    session.subscribe(event => { if (event.type === "tool_execution_start") events.push(event.toolName); });
    const grep = await ctx.executeTool("grep", { pattern: "migrationProbe", path: "entry.ts", literal: true });
    expect(grep.isError, JSON.stringify(grep.result)).toBe(false);
    expect(grep.result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("entry.ts:1:") })]));
    if (grepMode === "augment") {
      expect(grep.result.details).toMatchObject({ backend: "hybrid", foveaAppended: true });
      expect(grep.result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("fovea graph") })]));
    } else {
      expect(grep.result.details ?? {}).not.toHaveProperty("foveaAppended");
    }
    const native = await ctx.executeTool("grep", { pattern: "migration.*Probe", path: "entry.ts" });
    expect(native.isError).toBe(false);
    expect(native.result.details ?? {}).not.toHaveProperty("foveaAppended");
    expect(native.result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("entry.ts:1:") })]));
    const sketch = await ctx.executeTool("fovea_sketch", { root, maxTokens: 512 });
    expect(sketch.isError, JSON.stringify(sketch.result)).toBe(false);
    expect(sketch.result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("fovea sketch") })]));
    expect(events).toEqual(["grep", "grep", "fovea_sketch"]);
    session.setActiveToolsByName(session.getActiveToolNames().filter(name => name !== "codemode"));
    const direct = await session.agent.transformContext!([{ role: "system", content: "probe", toolsAdded: session.agent.state.tools.map(({ name, description, parameters }) => ({ name, description, parameters })), timestamp: 0 }]);
    expect(direct.flatMap(message => message.role === "system" ? message.toolsAdded?.map(tool => tool.name) ?? [] : [])).toContain("fovea_sketch");
    expect(session.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "pi-fovea-workspace")).toBe(true);
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    // The finally block repeats shutdown: activated cleanup must be idempotent.
    expect(errors).toEqual([]);
  } finally {
    if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
