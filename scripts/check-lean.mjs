#!/usr/bin/env node
// Full checking requires the pinned mathlib checkout. Artifact checking does not
// load Lean. A receipt records a past check; it is not a proof of TypeScript.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const receiptPath='proofs/lean/receipt.json';
const allowedAxioms=new Set(['propext','Classical.choice','Quot.sound']);
export const leanInputs=['scripts/check-lean.mjs','proofs/lean/toolchain.json','proofs/lean/ledger.json',
  'proofs/lean/Fovea/Arithmetic.lean','proofs/lean/Fovea/Analysis.lean','proofs/lean/Fovea/Intervals.lean'];
const read=(base,path)=>readFileSync(resolve(base,path),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
function metadata(base){
  const toolchain=JSON.parse(read(base,'proofs/lean/toolchain.json'));
  if(toolchain.version!==1||toolchain.lean!=='4.19.0'||toolchain.elanToolchain!=='leanprover/lean4:v4.19.0'||
    toolchain.mathlib!=='c44e0c8ee63ca166450922a373c7409c5d26b00b'||JSON.stringify(toolchain.modules)!=='["Arithmetic","Analysis","Intervals"]')
    throw new Error('Unreviewed Lean toolchain');
  const ledger=JSON.parse(read(base,'proofs/lean/ledger.json'));
  const declarations=[];
  const modules=readdirSync(resolve(base,'proofs/lean/Fovea')).filter(p=>p.endsWith('.lean')).sort();
  if(JSON.stringify(modules)!==JSON.stringify(toolchain.modules.map(m=>`${m}.lean`).sort()))throw new Error('Lean source inventory mismatch');
  for(const module of toolchain.modules){
    const source=read(base,`proofs/lean/Fovea/${module}.lean`);
    // Development safety guard, not a sandbox for adversarial Lean metaprograms.
    if(/\b(?:sorry|admit|axiom|unsafe|native_decide|implemented_by|extern|run_cmd)\b|#eval/.test(source))throw new Error(`${module}: prohibited Lean escape`);
    for(const match of source.matchAll(/^theorem (\w+)/gm))declarations.push({name:`Fovea.${match[1]}`,module,scope:module==='Arithmetic'?'algorithm-model':'mathematics'});
  }
  if(JSON.stringify(ledger)!==JSON.stringify(declarations)||new Set(ledger.map(x=>x.name)).size!==ledger.length)
    throw new Error('Lean theorem inventory mismatch');
  return {version:1,toolchain,correspondence:'not-proved',inputs:Object.fromEntries(leanInputs.map(p=>[p,hash(read(base,p))])),theorems:ledger};
}
export function verifyLeanArtifact(base=root){
  const expected=metadata(base),receipt=JSON.parse(read(base,receiptPath));
  const {axioms,...stored}=receipt;
  if(JSON.stringify(stored)!==JSON.stringify(expected)||!axioms||Object.keys(axioms).length!==expected.theorems.length||
    expected.theorems.some(({name})=>!Array.isArray(axioms[name])||axioms[name].some(a=>!allowedAxioms.has(a))))
    throw new Error('Lean artifact is stale or unaudited; run check:lean --write with the pinned mathlib checkout');
  return expected.theorems.length;
}
const run=(command,args,cwd,env)=>{
  const p=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  if(p.error||p.status!==0)throw new Error(`${command} failed: ${p.error?.message??p.stderr??''}\n${p.stdout??''}`);
  return p.stdout;
};
function check(write){
  const expected=metadata(root),mathlib=process.env.FOVEA_MATHLIB_ROOT;
  if(!mathlib)throw new Error('Set FOVEA_MATHLIB_ROOT to the pinned mathlib checkout; see docs/proofs.md');
  const cwd=resolve(mathlib),env={...process.env,ELAN_TOOLCHAIN:expected.toolchain.elanToolchain};
  if(run('git',['rev-parse','HEAD'],cwd,env).trim()!==expected.toolchain.mathlib||run('git',['status','--porcelain','--untracked-files=no'],cwd,env).trim())
    throw new Error('mathlib must be the clean pinned revision');
  const version=run('lake',['env','lean','--version'],cwd,env);
  if(!version.startsWith(`Lean (version ${expected.toolchain.lean},`))throw new Error('Unexpected Lean compiler');
  const temp=mkdtempSync(join(tmpdir(),'fovea-lean-'));
  try{
    const search=run('lake',['env','printenv','LEAN_PATH'],cwd,env).trim();
    const compileEnv={...env,LEAN_PATH:[temp,...search.split(delimiter).filter(Boolean).map(p=>resolve(cwd,p))].join(delimiter)};
    mkdirSync(join(temp,'Fovea'));
    for(const module of expected.toolchain.modules)run('lean',['--root',resolve(root,'proofs/lean'),'-o',join(temp,'Fovea',`${module}.olean`),resolve(root,'proofs/lean/Fovea',`${module}.lean`)],cwd,compileEnv);
    const audit=expected.toolchain.modules.map(m=>`import Fovea.${m}`).join('\n')+'\n'+expected.theorems.map(({name})=>`#print axioms ${name}`).join('\n')+'\n';
    writeFileSync(join(temp,'Audit.lean'),audit);
    const report=run('lean',['--root',temp,join(temp,'Audit.lean')],cwd,compileEnv),axioms={};
    for(const {name} of expected.theorems){
      const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const match=report.match(new RegExp(`'${escaped}' depends on axioms: \\[([^\\]]*)\\]`));
      if(match)axioms[name]=match[1].split(',').map(s=>s.trim()).filter(Boolean).sort();
      else if(report.includes(`'${name}' does not depend on any axioms`))axioms[name]=[];
      else throw new Error(`Missing axiom audit for ${name}`);
      if(axioms[name].some(a=>!allowedAxioms.has(a)))throw new Error(`${name}: unapproved axioms ${axioms[name].join(',')}`);
    }
    const receipt={...expected,axioms},text=JSON.stringify(receipt,null,2)+'\n';
    if(write)writeFileSync(resolve(root,receiptPath),text);
    else if(read(root,receiptPath)!==text)throw new Error('Lean artifact is stale; run check:lean --write');
    console.log(`${expected.theorems.length} Lean theorems checked; standard axioms only; TypeScript correspondence not claimed`);
  }finally{rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length>1||(args.length&&!['--write','--artifact'].includes(args[0])))throw new Error('usage: node scripts/check-lean.mjs [--write|--artifact]');
    if(args[0]==='--artifact')console.log(`${verifyLeanArtifact()} Lean theorem receipts match (no compiler loaded; correspondence not claimed)`);
    else check(args[0]==='--write');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
