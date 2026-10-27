import type { E, Law, Machine } from "gdp-wired/machine";
import type { Fold, Instances, Loop, StepLaw } from "gdp-wired/kernel";
import type { Lin } from "gdp-wired/solver";
import type { Term } from "gdp-wired";

export interface PolynomialOptions {
  nodes?: number;
  products?: number;
  rows?: number;
  closureRounds?: number;
  degreeLift?: number;
  cuts?: Lin[];
}

export type ProofClaim = Law | StepLaw;
export type SupportMap = Record<string, string[]>;

interface ProofOptions<Claim extends ProofClaim> {
  name: string;
  laws: Claim[];
  polynomial?: boolean | string[];
  supports?: SupportMap;
  instances?: (claim: ProofClaim) => Instances;
  search?: (claim: ProofClaim) => PolynomialOptions & { ms?: number };
}

interface ProofModes {
  machine?: Machine;
  fold?: Fold;
  loop?: Loop;
  from?: string;
  steps?: boolean;
  inputs?: boolean;
  using?: string[];
  rank?: E | E[];
}

type Mode<Selected extends keyof ProofModes> = {
  [Key in Exclude<keyof ProofModes, Selected>]?: never;
};

export type MachineProof = ProofOptions<Law> & Mode<"machine"> & { machine: Machine };
export type FoldProof = ProofOptions<Law> & Mode<"fold"> & { fold: Fold };
export type LoopProof = ProofOptions<Law> & Mode<"loop" | "rank"> & { loop: Loop; rank: E | E[] };
export type ConsequenceProof = ProofOptions<Law> &
  Mode<"from" | "inputs" | "using"> & {
    from: string;
    inputs?: boolean;
    using?: string[];
  };
export type TransitionProof = ProofOptions<StepLaw> &
  Mode<"from" | "steps"> & {
    from: string;
    steps: true;
  };
export type ProofGroup = MachineProof | FoldProof | LoopProof | ConsequenceProof | TransitionProof;

export interface SignedCell {
  p: Term;
  n: Term;
}
export interface SignedCells {
  at(key: Term): SignedCell;
  sum(f: (cell: SignedCell) => Term): Term;
}
export interface SignedBuffers {
  phase: Term;
  A: SignedCells;
  B: SignedCells;
}
