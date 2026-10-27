// Generated runtime ABI; do not edit.
export declare function compareWordArrays(a: Uint32Array, b: Uint32Array): number;
export declare function addWordArrays(a: Uint32Array, b: Uint32Array): Uint32Array;
export declare function subtractWordArrays(a: Uint32Array, b: Uint32Array): Uint32Array;
export declare function multiplyAddRow(
  factor: number,
  source: Uint32Array,
  accumulator: Uint32Array,
): Uint32Array;
export declare function divideArraySmall(
  a: Uint32Array,
  divisor: number,
): {
  quotient: Uint32Array;
  remainder: number;
};
