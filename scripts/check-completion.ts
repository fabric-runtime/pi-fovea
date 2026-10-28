import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completionProofs } from "../proofs/completion.ts";
import { checkProofGroups } from "./check-streams.ts";
export const checkCompletion = () => checkProofGroups(completionProofs);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-completion.ts");
    console.log(
      `${checkCompletion()} constructive-completion claims proved and checked; no Lean loaded`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
