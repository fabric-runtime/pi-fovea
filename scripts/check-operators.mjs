import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {operatorProofs} from '../proofs/operator-steps.mjs';
import {checkProofGroups} from './check-streams.mjs';
export const checkOperators=()=>checkProofGroups(operatorProofs);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)throw new Error('usage: node scripts/check-operators.mjs');
    console.log(`${checkOperators()} coefficient/path claims proved and checked; no Lean loaded`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
