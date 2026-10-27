import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enclosureProofs} from '../proofs/enclosures.mjs';
import {checkProofGroups} from './check-streams.mjs';
export const checkEnclosures=()=>checkProofGroups(enclosureProofs);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)throw new Error('usage: node scripts/check-enclosures.mjs');
    console.log(`${checkEnclosures()} exact-enclosure claims proved and checked; no Lean loaded`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
