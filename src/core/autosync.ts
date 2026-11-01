// Automatic background sync. Pi awaits extension hooks on its conversation
// and tool boundaries (turn_end runs inside the agent's finishTurn), so the
// extension only *requests* work here and returns. Loaded on first enrollment,
// never at startup: it does nothing until a root is observed.
//
// Every job runs in a per-root lane keyed by (lifecycle epoch, root lease):
// jobs for one root never overlap, a queued job absorbs later requests of its
// kind, and a reset, retirement, or session change detaches old lanes so their
// late results are fenced rather than delivered.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { envInt } from "./asyncutil.js";
import { abortable, RootLanes, SingleFlight, within } from "./background.js";
import type { FoveaConfig } from "./config.js";
import type { ExecutionRoots } from "./roots.js";
import type { RepoState } from "./state.js";
import type { SyncPreimages } from "./sync.js";

type Preimages = SyncPreimages extends ReadonlyMap<infer K, infer V> ? Map<K, V> : never;

export interface AutoSyncHost {
  pi: Pick<ExtensionAPI, "sendMessage">;
  roots: ExecutionRoots;
  epoch: () => number;
  currentLease: (root: string, epoch: number, lease: number | undefined) => boolean;
  targetConfig: (root: string, ctx: ExtensionContext) => FoveaConfig;
  /** Shared context allowance of one pass (the session cwd's sync budget). */
  passBudget: (ctx: ExtensionContext) => number;
  /** Edit pre-images captured while a root's first baseline is pending. */
  establishing: Map<string, Preimages>;
  /** Provenance journal writes still landing; attribution waits for them. */
  pendingFinishes: Set<Promise<unknown>>;
  baselineReady: (root: string) => boolean;
  /** Drop root-local session and baseline state after a fenced result. */
  forget: (root: string) => void;
  ensureState: (root: string) => Promise<RepoState>;
  sync: typeof import("./sync.js").sync;
  warmSync: typeof import("./sync.js").warmSync;
}

const syncRuns = (config: FoveaConfig): boolean => config.sync.mode !== "disabled";
/** How long a pass waits on one root before moving on to the next. */
const stallMs = (): number => envInt("FOVEA_SYNC_STALL_MS", 10_000, 1, 600_000);

/** pi-queue-steer mirrors `{ pending, paused, blocked }` on globalThis so
 *  peers can yield the native steer/follow-up lane without a package
 *  dependency or listener-order race (same snapshot pi-ledger reads). */
const queueSteerPending = (): number => {
  const state = (globalThis as { __tmustierPiQueueSteerState?: { pending?: unknown } })
    .__tmustierPiQueueSteerState;
  return typeof state?.pending === "number" && Number.isFinite(state.pending)
    ? Math.max(0, state.pending)
    : 0;
};

/** Background results arrive at arbitrary times, so delivery never starts a
 *  turn. A live run absorbs a steer at its next turn boundary; an idle agent,
 *  queued user messages, or parked queue-steer rows own the next slot, so the
 *  update rides `nextTurn` instead of restarting or jumping ahead of them. */
export const syncDelivery = (
  ctx: ExtensionContext,
  nextPrompt: boolean,
): { deliverAs: "nextTurn" } | { deliverAs: "steer" } => {
  if (nextPrompt || queueSteerPending() > 0) return { deliverAs: "nextTurn" };
  const probe = ctx as Partial<Pick<ExtensionContext, "isIdle" | "hasPendingMessages">>;
  try {
    const streaming = typeof probe.isIdle === "function" && !probe.isIdle();
    const queued = typeof probe.hasPendingMessages === "function" && probe.hasPendingMessages();
    return streaming && !queued ? { deliverAs: "steer" } : { deliverAs: "nextTurn" };
  } catch {
    return { deliverAs: "nextTurn" };
  }
};

interface PassRequest {
  ctx: ExtensionContext;
  files: string[];
  epoch: number;
}
interface RootSync {
  ctx: ExtensionContext;
  files: Set<string>;
  budget: number;
  allowance: number;
  label: string;
}

export const createAutoSync = (host: AutoSyncHost) => {
  const { roots, establishing } = host;
  const lanes = new RootLanes();
  const generation = (epoch: number, lease: number | undefined): string =>
    `${epoch}:${lease ?? "-"}`;
  let lastSyncError: string | undefined;
  let pollCursor = 0;

  const notify = (
    ctx: ExtensionContext,
    epoch: number,
    message: string,
    level: "info" | "warning",
  ): void => {
    if (epoch !== host.epoch()) return;
    try {
      if (ctx.hasUI) ctx.ui.notify(message, level);
    } catch {
      // A replaced session's context may refuse UI calls; the epoch fence
      // already covers the common case.
    }
  };
  const reportSyncError = (
    ctx: ExtensionContext,
    epoch: number,
    root: string,
    error: unknown,
  ): void => {
    const message = `${root}: ${error instanceof Error ? error.message : error}`;
    if (message !== lastSyncError) notify(ctx, epoch, `fovea: sync paused: ${message}`, "warning");
    lastSyncError = message;
  };

  /** Establish root's first sync baseline in its lane (coalesced per generation). */
  const establish = (
    root: string,
    ctx: ExtensionContext,
    epoch: number,
    lease: number | undefined,
  ): Promise<void> => {
    const cfg = host.targetConfig(root, ctx);
    if (!syncRuns(cfg) || host.baselineReady(root)) return Promise.resolve();
    const current = () => host.currentLease(root, epoch, lease);
    const changed = () => new Error("Fovea workspace changed during indexing");
    if (!establishing.has(root)) establishing.set(root, new Map());
    const preimages = establishing.get(root)!;
    return lanes.enqueue(
      root,
      generation(epoch, lease),
      "baseline",
      undefined,
      async () => {
        if (!current()) throw changed();
        if (!host.baselineReady(root)) {
          const state = await host.ensureState(root);
          if (!current()) throw changed();
          await host.sync(
            root,
            {
              files: [],
              budget: cfg.sync.budget,
              steerThreshold: cfg.sync.steerThreshold,
              scope: cfg.sync.scope,
              sessionId: ctx.sessionManager.getSessionId(),
            },
            state,
            { current, preimages: () => preimages },
          );
        }
        if (!current()) throw changed();
        if (host.baselineReady(root) && establishing.get(root) === preimages)
          establishing.delete(root);
      },
      () => {},
    ).promise;
  };

  const syncRoot = async (
    root: string,
    epoch: number,
    lease: number,
    params: RootSync,
  ): Promise<number> => {
    const current = () => host.currentLease(root, epoch, lease);
    const { ctx } = params;
    if (!current()) return 0;
    try {
      if (host.pendingFinishes.size)
        await within(Promise.allSettled([...host.pendingFinishes]), stallMs());
      const cfg = host.targetConfig(root, ctx);
      const outcome = await host.sync(
        root,
        {
          files: [...params.files],
          budget: params.budget,
          steerThreshold: cfg.sync.steerThreshold,
          pushFocus: cfg.sync.pushFocus,
          scope: cfg.sync.scope,
          sessionId: ctx.sessionManager.getSessionId(),
        },
        undefined,
        { probe: "cheap", current, preimages: () => establishing.get(root) },
      );
      if (!current()) {
        if (!roots.has(root)) host.forget(root);
        return 0;
      }
      lastSyncError = undefined;
      if (host.baselineReady(root)) establishing.delete(root);
      if (outcome.red && outcome.text) {
        const content = (params.label + outcome.text).slice(0, params.allowance * 4 - 1) + "\n";
        host.pi.sendMessage(
          {
            customType: "pi-fovea-sync",
            content,
            display: cfg.sync.mode === "enabled",
            details: { ...outcome.details, root, agentOrigin: ctx.cwd },
          },
          syncDelivery(ctx, outcome.delivery === "next-prompt"),
        );
        return Math.ceil(content.length / 4);
      }
      if (
        outcome.structural &&
        !outcome.details.baseline &&
        !outcome.details.deferred &&
        !outcome.details.outsideAttention &&
        cfg.sync.ackClean
      )
        notify(ctx, epoch, `fovea: checked ${root}; no new action is needed.`, "info");
      return 0;
    } catch (error) {
      if (current()) reportSyncError(ctx, epoch, root, error);
      return 0;
    }
  };

  // One pass visits observed roots in rotation under a shared context
  // allowance. Clean roots spend nothing; rotate after exhaustion instead of
  // dividing one meaningful update into 32 tiny allowances. A root whose lane
  // stalls past the bound no longer holds the pass (or spends its allowance);
  // its late result is still delivered, fenced, by its own job.
  const runPass = async ({ ctx, files, epoch }: PassRequest): Promise<void> => {
    if (epoch !== host.epoch()) return;
    const targets = roots.list();
    let remaining = Math.max(0, host.passBudget(ctx));
    const start = targets.length ? pollCursor % targets.length : 0;
    for (let i = 0; i < targets.length; i++) {
      if (remaining < 128 || epoch !== host.epoch()) break;
      const at = (start + i) % targets.length,
        root = targets[at]!;
      pollCursor = (at + 1) % targets.length;
      const lease = roots.lease(root);
      if (lease === undefined) continue;
      let cfg: FoveaConfig;
      try {
        cfg = host.targetConfig(root, ctx);
      } catch (error) {
        reportSyncError(ctx, epoch, root, error);
        continue;
      }
      if (!syncRuns(cfg)) continue;
      const label = `Root: ${root}\n`;
      const allowance = Math.min(cfg.sync.budget, remaining);
      const budget = allowance - Math.ceil(label.length / 4) - 1;
      if (budget < 64) continue;
      const rels = files.flatMap((file) => {
        const owner = roots.owner(ctx.cwd, file);
        return owner?.root === root ? [owner.path] : [];
      });
      const gen = generation(epoch, lease);
      const stall = stallMs();
      const since = lanes.runningSince(root, gen);
      const job = lanes.enqueue(
        root,
        gen,
        "sync",
        { ctx, files: new Set(rels), budget, allowance, label } satisfies RootSync,
        (params) => syncRoot(root, epoch, lease, params),
        (queued, next) => {
          queued.ctx = next.ctx;
          for (const file of next.files) queued.files.add(file);
        },
      );
      // A lane already stalled past the bound costs this pass no further wait.
      const wait = since !== undefined && Date.now() - since >= stall ? 0 : stall;
      if (await within(job.promise, wait)) remaining -= await job.promise;
    }
  };
  const passes = new SingleFlight<PassRequest>(runPass, (queued, next) => ({
    ctx: next.ctx,
    epoch: next.epoch,
    files: [...new Set([...queued.files, ...next.files])],
  }));

  return {
    /** Explicit tools await the baseline they need; abort detaches the wait. */
    bind: (
      root: string,
      ctx: ExtensionContext,
      epoch: number,
      lease: number | undefined,
      signal: AbortSignal | undefined,
    ): Promise<void> =>
      abortable(establish(root, ctx, epoch, lease), signal, "Fovea analysis cancelled"),
    /** Automatic enrollment never holds Pi's tool boundary open. */
    enroll(
      root: string,
      ctx: ExtensionContext,
      epoch: number,
      lease: number | undefined,
      peer: boolean,
    ): void {
      void establish(root, ctx, epoch, lease).catch((error: unknown) => {
        if (peer || !host.currentLease(root, epoch, lease)) return;
        notify(
          ctx,
          epoch,
          `fovea: workspace analysis unavailable: ${error instanceof Error ? error.message : error}`,
          "warning",
        );
      });
    },
    /** Prepare the next verdict's ingredients after an edit, in root's lane. */
    warm(root: string, files: string[], budget: number): void {
      const lease = roots.lease(root);
      if (lease === undefined) return;
      void lanes
        .enqueue(
          root,
          generation(host.epoch(), lease),
          "warm",
          { files, budget },
          (params) => host.warmSync(root, params),
          (queued, next) => {
            queued.files = [...new Set([...queued.files, ...next.files])];
          },
        )
        .promise.catch(() => {});
    },
    request(ctx: ExtensionContext, files: string[], epoch: number): void {
      passes.request({ ctx, files, epoch });
    },
    retire(root: string): void {
      lanes.clear(root);
    },
    cancel(): void {
      passes.cancel();
      lanes.clear();
      lastSyncError = undefined;
    },
    status(): string {
      const busy = passes.busy || lanes.size > 0;
      return `background ${busy ? `busy: ${lanes.size} root lane(s)` : "idle"}${lastSyncError ? `; last error ${lastSyncError}` : ""}`;
    },
  };
};

export type AutoSync = ReturnType<typeof createAutoSync>;
