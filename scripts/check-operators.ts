import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operatorProofs } from "../proofs/operator-steps.ts";
import { checkProofGroups } from "./check-streams.ts";
export const checkOperators = () => checkProofGroups(operatorProofs);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-operators.ts");
    console.log(`${checkOperators()} coefficient/path claims proved and checked; no Lean loaded`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
