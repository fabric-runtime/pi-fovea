import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { residualProofs, residualNewNames } from "../proofs/residual.ts";
import { checkProofGroups } from "./check-streams.ts";

export function checkResidual(): number {
  checkProofGroups(residualProofs, { ms: 120000 });
  return residualNewNames.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-residual.ts");
    console.log(`${checkResidual()} finite binomial-residual claims proved and checked`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
