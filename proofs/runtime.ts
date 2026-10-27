// Structural ABI of gdp-wired's generated scalar machines. These declarations
// describe the checked compiler output; they add no host arithmetic or axioms.
export interface ScalarState<Output extends string> {
  scalars: Record<Output, number>;
}

export interface RuntimeMachine<Params, Input, Output extends string> {
  init(params: Params): ScalarState<Output>;
  step(params: Params, state: ScalarState<Output>, input: Input): ScalarState<Output>;
}

export type DecisionMachine<Output extends string> = RuntimeMachine<
  Record<string, never>,
  Record<string, number>,
  Output
>;
