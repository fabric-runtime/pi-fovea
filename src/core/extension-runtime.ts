// Loaded only by an operation that actually needs repository analysis.
export { ensureState, evictState, getInflight, getState } from "./state.js";
export { coverageSummary, dwell, focus, impact, sketch } from "./ops.js";
export { finishMutation } from "./provenance.js";
export { resetSyncBaselines, sync, syncBaselineStore, warmSync } from "./sync.js";
