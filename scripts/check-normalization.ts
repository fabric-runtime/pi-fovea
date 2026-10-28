import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizationProofs } from "../proofs/normalization.ts";
import { checkProofGroups } from "./check-streams.ts";
export const checkNormalization = () => checkProofGroups(normalizationProofs, { ms: 20000 });
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-normalization.ts");
    console.log(
      `${checkNormalization()} exact-row normalization claims proved and checked; no Lean loaded`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
