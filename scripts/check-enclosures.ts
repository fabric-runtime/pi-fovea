import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enclosureProofs } from "../proofs/enclosures.ts";
import { checkProofGroups } from "./check-streams.ts";
export const checkEnclosures = () => checkProofGroups(enclosureProofs);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-enclosures.ts");
    console.log(`${checkEnclosures()} exact-enclosure claims proved and checked; no Lean loaded`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
