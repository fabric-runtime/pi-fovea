// The finite-rational operator theorem uses these checked components in order.
// Prerequisite claims remain in their original ledger families.
import { operatorIdentificationProofs } from "./operator-identification.ts";
import { cauchyProductProofs } from "./cauchy-product.ts";
import { operatorLimitProofs } from "./operator-limit.ts";
import { operatorLawNames } from "./operator-steps.ts";
import { focusLawNames } from "./focus.ts";
export const operatorIdentityProofs = [
  ...operatorIdentificationProofs,
  ...cauchyProductProofs,
  ...operatorLimitProofs,
];
const prerequisites = new Set([...operatorLawNames, ...focusLawNames]);
export const operatorIdentityLawNames = [
  ...new Set(operatorIdentityProofs.flatMap((p) => p.laws.map((l) => l.name))),
].filter((name) => !prerequisites.has(name));
