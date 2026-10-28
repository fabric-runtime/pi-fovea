import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
type PortStatus = "runtime-specialization" | "constructive-rational" | "open";
interface PortRow {
  lean: string;
  status: PortStatus;
  scope: string;
  claims: string[];
  equivalent: boolean;
}
const read = <T>(root: string, path: string): T =>
  JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
// Coverage metadata, not an equivalence oracle. No row here can remove a Lean
// obligation or mark a real-analysis theorem proved by a rational counterpart.
export function verifyPortMap(root: string) {
  const expected = read<{ name: string }[]>(root, "proofs/lean/ledger.json").map((x) => x.name),
    claims = new Set(read<string[]>(root, "proofs/ledger.json"));
  const rows = read<PortRow[]>(root, "proofs/ports.json"),
    counts = { "runtime-specialization": 0, "constructive-rational": 0, open: 0 };
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.length ||
    new Set(rows.map((x) => x.lean)).size !== rows.length
  )
    throw new Error("Port inventory must track each Lean claim exactly once");
  for (const row of rows) {
    if (
      !expected.includes(row.lean) ||
      !Object.hasOwn(counts, row.status) ||
      !row.scope ||
      !Array.isArray(row.claims) ||
      row.equivalent !== false
    )
      throw new Error(`Invalid port scope: ${row.lean}`);
    if (row.status !== "open" && !row.claims.length)
      throw new Error(`Missing port evidence: ${row.lean}`);
    for (const claim of row.claims)
      if (!claims.has(claim)) throw new Error(`Unregistered port claim: ${claim}`);
    counts[row.status]++;
  }
  return counts;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: tsx scripts/check-ports.ts");
    console.log(JSON.stringify(verifyPortMap(fileURLToPath(new URL("../", import.meta.url)))));
    console.log(
      "Coverage inventory only: constructive counterparts are not full Lean equivalence proofs.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
