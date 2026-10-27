import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {focusProofs} from '../proofs/focus.mjs';
import {checkProofGroups} from './check-streams.mjs';
export const checkFocus=()=>checkProofGroups(focusProofs,{ms:30000});
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)throw new Error('usage: node scripts/check-focus.mjs');
    console.log(`${checkFocus()} indexed-focus claims proved and checked; no Lean loaded`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
