import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seriesProofs } from "../proofs/series.ts";
import { checkProofGroups } from "./check-streams.ts";
export const checkSeries = () => checkProofGroups(seriesProofs);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-series.ts");
    console.log(`${checkSeries()} constructive-series claims proved and checked; no Lean loaded`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
