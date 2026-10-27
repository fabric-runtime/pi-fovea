import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operatorIdentityProofs, operatorIdentityLawNames } from "../proofs/operator-identity.ts";
import { checkProofGroups } from "./check-streams.ts";
export function checkOperatorIdentity(): number {
  checkProofGroups(operatorIdentityProofs, { ms: 300000 });
  return operatorIdentityLawNames.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-operator-identity.ts");
    console.log(`${checkOperatorIdentity()} finite-rational operator claims proved and checked`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
