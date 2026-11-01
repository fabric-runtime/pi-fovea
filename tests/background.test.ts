// Automatic analysis must never hold Pi's conversation lifecycle or tool
// boundaries open. The runtime is replaced by controllable promises so a sync,
// index build, or journal write can stay pending indefinitely.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleBackground, within } from "../src/core/background.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

interface SyncCall {
  root: string;
  params: { files: string[]; budget: number };
  opts: { current?: () => boolean; preimages?: () => ReadonlyMap<string, { sha?: string }> };
  result: Deferred<Record<string, unknown>>;
}

const rt = vi.hoisted(() => ({
  baselines: new Map<string, true>(),
  calls: [] as SyncCall[],
  baselineCalls: [] as SyncCall[],
  /** Roots whose background syncs resolve clean immediately. */
  auto: new Set<string>(),
  /** Teardown: every new background sync resolves clean. */
  draining: false,
  /** Pending index builds by root; absent roots build at once. */
  builds: new Map<string, Promise<unknown>>(),
  finishes: [] as Array<(value: boolean) => void>,
  holdFinishes: false,
  resident: false,
  config: {
    sync: {
      mode: "enabled",
      budget: 1024,
      steerThreshold: 1,
      scope: "session",
      pushFocus: true,
      ackClean: false,
    },
    tools: { grepMode: "augment", grepAugmentBudget: 512, defaultBudget: 1024 },
  },
}));

vi.mock("../src/core/config.js", () => ({ loadFoveaConfig: () => rt.config }));
vi.mock("../src/core/extension-runtime.js", () => ({
  ensureState: vi.fn(async (root: string) => {
    await rt.builds.get(root);
    return { root };
  }),
  sync: vi.fn((root: string, params: SyncCall["params"], now: unknown, opts: SyncCall["opts"]) => {
    const call = { root, params, opts, result: deferred<Record<string, unknown>>() };
    if (now) {
      rt.baselineCalls.push(call);
      rt.baselines.set(root, true);
      return Promise.resolve({ structural: true, red: false, tokens: 0, details: {} });
    }
    rt.calls.push(call);
    if (rt.auto.has(root) || rt.draining) call.result.resolve(clean());
    return call.result.promise;
  }),
  syncBaselineStore: () => rt.baselines,
  resetSyncBaselines: (root?: string) =>
    root === undefined ? rt.baselines.clear() : rt.baselines.delete(root),
  evictState: () => {},
  warmSync: async () => {},
  finishMutation: () =>
    rt.holdFinishes
      ? new Promise<boolean>((resolve) => rt.finishes.push(resolve))
      : Promise.resolve(true),
  getState: (root: string) => (rt.resident ? { root } : undefined),
  getInflight: () => undefined,
  sketch: async () => ({ text: "sketch", details: {} }),
  focus: vi.fn(async () => ({ text: "fovea focus", details: { seeds: 1 } })),
  dwell: async () => ({ text: "dwell", details: {} }),
  impact: async () => ({ text: "impact", details: {} }),
  coverageSummary: () => "coverage",
}));

const clean = () => ({ structural: false, red: false, tokens: 0, details: {} });
const red = (delivery: "steer" | "next-prompt" = "steer") => ({
  structural: true,
  red: true,
  text: "Repository structure changed.\nSteer: account for this update before continuing.",
  delivery,
  tokens: 20,
  details: { version: "next" },
});

const temps: string[] = [];
const project = (): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fovea-background-")));
  writeFileSync(path.join(root, "package.json"), "{}");
  writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
  temps.push(root);
  return root;
};

beforeEach(() => {
  rt.baselines.clear();
  rt.calls.length = 0;
  rt.baselineCalls.length = 0;
  rt.auto.clear();
  rt.builds.clear();
  rt.finishes.length = 0;
  rt.holdFinishes = false;
  rt.resident = false;
  rt.draining = false;
  rt.config.tools.grepMode = "augment";
});
afterEach(async () => {
  vi.unstubAllEnvs();
  // Release anything still pending so detached work cannot leak between tests.
  rt.draining = true;
  rt.holdFinishes = false;
  for (const call of rt.calls) call.result.resolve(clean());
  for (const finish of rt.finishes) finish(true);
  await settleBackground();
  for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Handler = (event: Record<string, unknown>, ctx: Ctx) => unknown;
interface Ctx {
  cwd: string;
  hasUI: boolean;
  run: { streaming: boolean; queued: boolean };
  notes: Array<{ message: string; level: string }>;
  [key: string]: unknown;
}

const load = async (cwd: string) => {
  const { default: fovea } = await import("../src/index.js");
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  const commands = new Map<string, { handler: (args: string, ctx: Ctx) => Promise<void> }>();
  const messages: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> =
    [];
  fovea({
    on: (name: string, handler: Handler) =>
      handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) =>
      tools.set(tool.name, tool),
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: Ctx) => Promise<void> },
    ) => commands.set(name, command),
    sendMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) =>
      messages.push({ message, options }),
    appendEntry: () => {},
    exec: async () => ({ code: 0, stdout: "ast-grep 0.0.0", stderr: "" }),
  } as unknown as ExtensionAPI);
  const run = { streaming: true, queued: false };
  const notes: Ctx["notes"] = [];
  const ctx: Ctx = {
    cwd,
    hasUI: true,
    run,
    notes,
    isIdle: () => !run.streaming,
    hasPendingMessages: () => run.queued,
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "session", getBranch: () => [] },
    ui: { notify: (message: string, level: string) => notes.push({ message, level }) },
    reload: async () => {},
  };
  /** Run every handler for an event; resolves only if none blocks. */
  const emit = async (name: string, event: Record<string, unknown> = {}): Promise<unknown[]> => {
    const results: unknown[] = [];
    for (const handler of handlers.get(name) ?? []) {
      const pending = Promise.resolve(handler(event, ctx));
      expect(await within(pending, 2000), `${name} returned without waiting`).toBe(true);
      const result = await pending;
      if (result !== undefined) results.push(result);
    }
    return results;
  };
  const enter = (root: string, signal?: AbortSignal) =>
    tools.get("fovea_sketch")!.execute("enter", { root }, signal, undefined, ctx);
  const edit = (id: string, file: string) =>
    emit("tool_execution_start", { toolCallId: id, toolName: "edit", args: { path: file } });
  return { emit, enter, edit, ctx, notes, messages, commands, tools };
};

/** Let scheduled microtasks and macrotasks run without settling pending work. */
const tick = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};
const until = async (condition: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
};

describe("background sync lifecycle", () => {
  it("returns from turn_end and prompt start while a sync never settles", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    await ext.emit("turn_end");
    await until(() => rt.calls.length === 1);
    // Neither boundary waits on the stuck sync, and neither starts another.
    expect(await ext.emit("before_agent_start", { prompt: "next" })).toEqual([]);
    await ext.emit("turn_start");
    await ext.emit("turn_end");
    await tick();
    expect(rt.calls).toHaveLength(1);
    expect(ext.messages).toHaveLength(0);
  });

  it("coalesces turns into one queued pass with merged hints", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    await ext.emit("turn_end");
    await until(() => rt.calls.length === 1);
    for (const file of ["a.ts", "b.ts", "c.ts"]) {
      await ext.emit("turn_start");
      await ext.edit(`edit-${file}`, path.join(root, file));
      await ext.emit("turn_end");
    }
    await tick();
    expect(rt.calls).toHaveLength(1);
    rt.calls[0]!.result.resolve(clean());
    await until(() => rt.calls.length === 2);
    expect(rt.calls[1]!.params.files.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    rt.calls[1]!.result.resolve(clean());
    await settleBackground();
    expect(rt.calls).toHaveLength(2);
  });

  it("bounds a stalled root's backlog and keeps checking other roots", async () => {
    vi.stubEnv("FOVEA_SYNC_STALL_MS", "20");
    const stuck = project(),
      healthy = project();
    const ext = await load(stuck);
    await ext.enter(stuck);
    await ext.enter(healthy);
    rt.auto.add(healthy);
    for (let turn = 0; turn < 4; turn++) {
      await ext.edit(`edit-${turn}`, path.join(stuck, `f${turn}.ts`));
      await ext.emit("turn_end");
      await until(() => rt.calls.filter((c) => c.root === healthy).length === turn + 1);
    }
    // One running sync for the stuck root; later turns merge into one queued job.
    expect(rt.calls.filter((c) => c.root === stuck)).toHaveLength(1);
    rt.calls.find((c) => c.root === stuck)!.result.resolve(clean());
    await until(() => rt.calls.filter((c) => c.root === stuck).length === 2);
    const queued = rt.calls.filter((c) => c.root === stuck)[1]!;
    expect(queued.params.files.length).toBeGreaterThanOrEqual(3);
    queued.result.resolve(clean());
    await settleBackground();
    expect(rt.calls.filter((c) => c.root === stuck)).toHaveLength(2);
  });

  it("steers a live run, but never starts a turn or jumps queued messages", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    const deliver = async (setup: () => void, outcome = red()) => {
      setup();
      await ext.emit("turn_end");
      await until(() => rt.calls.length > 0);
      rt.calls.pop()!.result.resolve(outcome);
      await settleBackground();
      return ext.messages.pop()!;
    };
    const mirror = globalThis as { __tmustierPiQueueSteerState?: { pending: number } };
    const live = await deliver(() =>
      Object.assign(ext.ctx.run, { streaming: true, queued: false }),
    );
    expect(live.options).toEqual({ deliverAs: "steer" });
    expect(String(live.message.content)).toContain(`Root: ${root}`);
    const idle = await deliver(() => Object.assign(ext.ctx.run, { streaming: false }));
    expect(idle.options).toEqual({ deliverAs: "nextTurn" });
    const queued = await deliver(() =>
      Object.assign(ext.ctx.run, { streaming: true, queued: true }),
    );
    expect(queued.options).toEqual({ deliverAs: "nextTurn" });
    const parked = await deliver(() => {
      Object.assign(ext.ctx.run, { streaming: true, queued: false });
      mirror.__tmustierPiQueueSteerState = { pending: 1 };
    });
    delete mirror.__tmustierPiQueueSteerState;
    expect(parked.options).toEqual({ deliverAs: "nextTurn" });
    const other = await deliver(() => {}, red("next-prompt"));
    expect(other.options).toEqual({ deliverAs: "nextTurn" });
  });

  it("fences late results against session changes, resets, and shutdown", async () => {
    for (const change of ["session_start", "session_tree", "reset", "session_shutdown"]) {
      const root = project();
      const ext = await load(root);
      await ext.enter(root);
      await ext.emit("turn_end");
      await until(() => rt.calls.length === 1);
      const stale = rt.calls.pop()!;
      if (change === "reset") await ext.commands.get("fovea")!.handler("reset", ext.ctx);
      else await ext.emit(change);
      expect(stale.opts.current?.()).toBe(false);
      stale.result.resolve(red());
      // Detached work is no longer tracked, so settling cannot hang on it.
      await settleBackground();
      expect(ext.messages, change).toHaveLength(0);
    }
  });

  it("does not queue a new generation behind superseded stalled work", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    await ext.emit("turn_end");
    await until(() => rt.calls.length === 1);
    const stale = rt.calls[0]!;
    await ext.commands.get("fovea")!.handler("reset", ext.ctx);
    await ext.enter(root);
    await ext.emit("turn_end");
    await until(() => rt.calls.length === 2);
    const fresh = rt.calls[1]!;
    stale.result.resolve(red());
    fresh.result.resolve(red());
    await settleBackground();
    expect(ext.messages).toHaveLength(1);
    expect(fresh.opts.current?.()).toBe(true);
  });

  it("fences a retired root's late result", async () => {
    const first = project();
    const ext = await load(first);
    await ext.enter(first);
    await ext.emit("turn_end");
    await until(() => rt.calls.length === 1);
    const stale = rt.calls[0]!;
    // Fill the 32-root ring until the first root is retired.
    for (let i = 0; i < 32; i++) await ext.enter(project());
    expect(stale.opts.current?.()).toBe(false);
    stale.result.resolve(red());
    await settleBackground();
    expect(ext.messages).toHaveLength(0);
  });

  it("reports failures once without blocking, then recovers", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    const fail = async (message: string) => {
      await ext.emit("turn_end");
      await until(() => rt.calls.length > 0);
      rt.calls.pop()!.result.reject(new Error(message));
      await settleBackground();
    };
    await fail("probe failed");
    await fail("probe failed");
    const warnings = () => ext.notes.filter((n) => n.level === "warning");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]!.message).toContain("sync paused");
    await ext.commands.get("fovea")!.handler("status", ext.ctx);
    expect(ext.notes.at(-1)!.message).toContain("last error");
    await ext.emit("turn_end");
    await until(() => rt.calls.length > 0);
    rt.calls.pop()!.result.resolve(red());
    await settleBackground();
    expect(ext.messages).toHaveLength(1);
    await fail("probe failed");
    expect(warnings()).toHaveLength(2);
  });

  it("enrolls in the background, while explicit tools await and abort cleanly", async () => {
    const root = project();
    const build = deferred<unknown>();
    rt.builds.set(root, build.promise);
    const ext = await load(path.dirname(root));
    await ext.emit("tool_result", {
      toolName: "bash",
      toolCallId: "cd",
      input: { command: `cd ${root} && ls` },
      isError: false,
    });
    expect(rt.baselines.has(root)).toBe(false);
    // An edit that lands before the first baseline keeps its pre-image.
    await ext.edit("early", path.join(root, "a.ts"));
    writeFileSync(path.join(root, "a.ts"), "export const a = 2;\n");
    await ext.emit("tool_execution_end", { toolCallId: "early", toolName: "edit" });

    const controller = new AbortController();
    const explicit = ext.enter(root, controller.signal);
    expect(await within(explicit, 50)).toBe(false);
    controller.abort();
    await expect(explicit).rejects.toThrow("cancelled");

    const waiting = ext.enter(root);
    build.resolve(undefined);
    await expect(waiting).resolves.toMatchObject({ content: [{ text: "sketch" }] });
    expect(rt.baselineCalls).toHaveLength(1);
    const preimages = rt.baselineCalls[0]!.opts.preimages?.();
    expect(preimages?.get("a.ts")?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("does not hold an edit boundary on the provenance journal", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    rt.holdFinishes = true;
    await ext.edit("held", path.join(root, "a.ts"));
    await ext.emit("tool_execution_end", { toolCallId: "held", toolName: "edit" });
    expect(rt.finishes).toHaveLength(1);
    // The background pass waits for attribution to land before syncing.
    await ext.emit("turn_end");
    await tick();
    expect(rt.calls).toHaveLength(0);
    rt.finishes[0]!(true);
    await until(() => rt.calls.length === 1);
    expect(rt.calls[0]!.params.files).toEqual(["a.ts"]);
  });

  it("passes native grep through on a cold graph instead of building it", async () => {
    const root = project();
    const ext = await load(root);
    await ext.enter(root);
    const grep = {
      toolName: "grep",
      input: { pattern: "Symbol" },
      content: [{ type: "text", text: "native" }],
      details: {},
      isError: false,
    };
    expect(await ext.emit("tool_result", grep)).toEqual([]);
    rt.resident = true;
    expect(await ext.emit("tool_result", grep)).toMatchObject([
      { details: { foveaAppended: true } },
    ]);
  });
});
