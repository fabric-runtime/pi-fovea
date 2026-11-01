// Background scheduling for automatic analysis. Pi awaits extension hooks on
// its conversation and tool boundaries (turn_end runs inside the agent's
// finishTurn), so automatic sync, enrollment, and warm work start here and
// never hold one of those boundaries open. Explicit tool calls may still await
// the promises these primitives return.
//
// Loaded with the lazy scheduler, never at startup; keep it dependency-free.

interface Quiescent {
  pendingWork(): Promise<unknown>[];
}
const owners = new Set<WeakRef<Quiescent>>();
const LOADS = Symbol.for("pi-fovea:background-loads");
const register = (owner: Quiescent): void => {
  owners.add(new WeakRef(owner));
};

/**
 * Resolve once every tracked background job has settled, including follow-up
 * passes those jobs queue. Detached work (fenced by a reset, retirement, or
 * session change) is not tracked and cannot keep this pending.
 */
export const settleBackground = async (): Promise<void> => {
  for (let round = 0; round < 10_000; round++) {
    // The extension's lazy scheduler loads register here without importing us.
    const loads = (globalThis as { [LOADS]?: Set<Promise<unknown>> })[LOADS];
    const work: Promise<unknown>[] = [...(loads ?? [])];
    for (const ref of owners) {
      const owner = ref.deref();
      if (owner) work.push(...owner.pendingWork());
      else owners.delete(ref);
    }
    if (!work.length) return;
    await Promise.allSettled(work);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

/** Whether promise settled within ms. Never rejects; the timer never holds the process. */
export const within = (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, ms));
    timer.unref?.();
    const done = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(done, done);
  });

/** Reject when signal aborts; the underlying work continues detached. */
export const abortable = <T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(new Error(message));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(message));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

interface LaneEntry {
  kind: string;
  params: unknown;
  started: boolean;
  promise: Promise<unknown>;
}
interface Lane {
  generation: string;
  tail: Promise<unknown>;
  entries: LaneEntry[];
  runningSince?: number;
}

/**
 * Per-root serial lanes. Jobs for one root and generation never overlap; a
 * request that finds a not-yet-started job of the same kind merges into it,
 * so each lane holds at most one running job plus one queued job per kind.
 * A new generation (fresh lease or lifecycle epoch) starts a fresh lane
 * instead of queueing behind superseded, possibly stalled work.
 */
export class RootLanes implements Quiescent {
  private readonly lanes = new Map<string, Lane>();
  constructor() {
    register(this);
  }

  enqueue<P, T>(
    root: string,
    generation: string,
    kind: string,
    params: P,
    run: (params: P) => Promise<T>,
    merge: (queued: P, next: P) => void,
  ): { promise: Promise<T>; merged: boolean } {
    let lane = this.lanes.get(root);
    if (!lane || lane.generation !== generation) {
      lane = { generation, tail: Promise.resolve(), entries: [] };
      this.lanes.set(root, lane);
    }
    const waiting = lane.entries.find((entry) => entry.kind === kind && !entry.started);
    if (waiting) {
      merge(waiting.params as P, params);
      return { promise: waiting.promise as Promise<T>, merged: true };
    }
    const owner = lane;
    const entry: LaneEntry = { kind, params, started: false, promise: Promise.resolve() };
    const promise = owner.tail.then(async () => {
      entry.started = true;
      owner.runningSince = Date.now();
      try {
        return await run(entry.params as P);
      } finally {
        owner.runningSince = undefined;
        owner.entries.splice(owner.entries.indexOf(entry), 1);
        if (!owner.entries.length && this.lanes.get(root) === owner) this.lanes.delete(root);
      }
    });
    entry.promise = promise;
    owner.entries.push(entry);
    owner.tail = promise.then(
      () => {},
      () => {},
    );
    return { promise, merged: false };
  }

  /** Start time of the job currently running in root's lane, if any. */
  runningSince(root: string, generation: string): number | undefined {
    const lane = this.lanes.get(root);
    return lane?.generation === generation ? lane.runningSince : undefined;
  }

  get size(): number {
    return this.lanes.size;
  }

  /** Forget lanes; running jobs continue detached and their callers fence results. */
  clear(root?: string): void {
    if (root === undefined) this.lanes.clear();
    else this.lanes.delete(root);
  }

  pendingWork(): Promise<unknown>[] {
    return [...this.lanes.values()].map((lane) => lane.tail);
  }
}

/**
 * Single-flight runner with one coalesced follow-up. Requests during a run
 * merge into a single pending request, so a burst of turns costs at most one
 * running pass plus one queued pass. cancel() detaches the running pass so a
 * new lifecycle never waits behind superseded work.
 */
export class SingleFlight<A> implements Quiescent {
  private generation = 0;
  private running: Promise<void> | undefined;
  private pending: A | undefined;
  constructor(
    private readonly run: (request: A) => Promise<void>,
    private readonly merge: (queued: A, next: A) => A,
  ) {
    register(this);
  }

  get busy(): boolean {
    return this.running !== undefined;
  }

  request(request: A): void {
    if (this.running) {
      this.pending = this.pending === undefined ? request : this.merge(this.pending, request);
      return;
    }
    this.launch(request);
  }

  private launch(request: A): void {
    const generation = this.generation;
    this.running = Promise.resolve()
      .then(() => this.run(request))
      .catch(() => {})
      .then(() => {
        if (generation !== this.generation) return;
        this.running = undefined;
        const next = this.pending;
        this.pending = undefined;
        if (next !== undefined) this.launch(next);
      });
  }

  cancel(): void {
    this.generation++;
    this.running = undefined;
    this.pending = undefined;
  }

  pendingWork(): Promise<unknown>[] {
    return this.running ? [this.running] : [];
  }
}
