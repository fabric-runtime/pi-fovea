#!/usr/bin/env node
// Check without rewriting. Only --write replaces artifacts, after all laws pass.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { version as esbuild } from 'esbuild';
import { leanInputs, verifyLeanArtifact } from './check-lean.mjs';
import { verifyPortMap } from './check-ports.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length>1 || (args.length && !['--write','--artifact'].includes(args[0]))) throw new Error('usage: node scripts/check-proofs.mjs [--write|--artifact]');
const mode=args[0]??'--check';
const receipt='src/verified/generated/manifest.json';
const outputs=['src/verified/generated/kernel.js','src/verified/generated/kernel.d.ts','src/verified/generated/control.js','src/verified/generated/control.d.ts','src/verified/generated/limbs.js','src/verified/generated/limbs.d.ts','src/verified/generated/streams.js','src/verified/generated/streams.d.ts'];
const bridge=['scripts/check-proofs.mjs','scripts/compile-gdp.mjs','scripts/check-streams.mjs','scripts/check-series.mjs','scripts/check-operators.mjs','scripts/check-transport.mjs','scripts/check-focus.mjs','scripts/check-enclosures.mjs','scripts/check-normalization.mjs','scripts/check-ports.mjs','proofs/ports.json','scripts/prove-polynomial.mjs','proofs/kernel-abi.json','proofs/kernel-types.d.ts','src/verified/policy.ts','src/core/disclosure.ts','src/core/numerics.ts','src/core/interval.ts','src/core/u32.ts','src/core/heat-certificate.ts','src/core/normalization.ts','src/substrate.ts','proofs/ledger.json',...leanInputs,'proofs/lean/receipt.json'];
const read=path=>readFileSync(resolve(root,path),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const hashes=paths=>Object.fromEntries(paths.map(path=>[path,hash(read(path))]));
function sources() {
  const base=realpathSync(root), seen=new Set();
  const visit=path=>{
    const file=realpathSync(path),rel=relative(base,file);
    if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel)) throw new Error('Proof imports must stay inside the repository');
    if(seen.has(rel)) return;
    seen.add(rel);
    const source=readFileSync(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    if(ast.parseDiagnostics.length) throw new Error(`${rel}: invalid proof source`);
    const walk=node=>{
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier){
        const spec=node.moduleSpecifier.text;
        if(['gdp-wired','gdp-wired/rationals','gdp-wired/compose'].includes(spec)) return;
        if(!spec.startsWith('./')&&!spec.startsWith('../')) throw new Error(`${rel}: unreviewed proof import ${spec}`);
        visit(resolve(dirname(file),spec));
      }
      if(ts.isIdentifier(node)&&['eval','Function','process','globalThis','fetch','require'].includes(node.text)) throw new Error(`${rel}: effectful proof source ${node.text}`);
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['fns','facts'].includes(node.expression.name.text)) throw new Error(`${rel}: assumed foreign facts are forbidden`);
      ts.forEachChild(node,walk);
    };
    walk(ast);
  };
  for(const path of ['proofs/kernel.mjs','proofs/controls.mjs','proofs/laws.mjs','proofs/heat.mjs','proofs/runtime.mjs','proofs/limbs.mjs','proofs/streams.mjs','proofs/series.mjs','proofs/operator-steps.mjs','proofs/transport.mjs','proofs/focus.mjs','proofs/enclosures.mjs','proofs/normalization.mjs']) visit(resolve(root,path));
  return [...new Set([...seen,...bridge])].sort();
}
try {
  verifyLeanArtifact(root);
  verifyPortMap(root);
  const metadata={version:3,toolchain:{gdpWired:'0.30.1',esbuild,typescript:ts.version},inputs:hashes(sources())};
  if(mode==='--artifact') {
    if(JSON.stringify(JSON.parse(read(receipt)))!==JSON.stringify({...metadata,outputs:hashes(outputs)})) throw new Error('verified artifact is stale; run bun run proofs:generate');
    console.log('verified kernel artifact matches sources, ABI, adapters and bridge (no prover loaded)');
  } else {
    const packagePath=fileURLToPath(import.meta.resolve('gdp-wired/package.json'));
    if(JSON.parse(readFileSync(packagePath,'utf8')).version!=='0.30.1') throw new Error('Expected gdp-wired 0.30.1');
    const {checkLaws,compileKernel}=await import('./compile-gdp.mjs');
    const count=checkLaws(root);
    const files=await compileKernel(root);
    files[receipt]=JSON.stringify({...metadata,outputs:Object.fromEntries(Object.entries(files).map(([path,text])=>[path,hash(text)]))},null,2)+'\n';
    for(const [path,text] of Object.entries(files)) {
      if(mode==='--write') {mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),text);}
      else if(read(path)!==text) throw new Error(`${path}: verified artifact is stale; run bun run proofs:generate`);
    }
    console.log(`${count} laws proved and checked; executable kernels ${mode==='--write'?'generated':'reproduced byte-for-byte'}`);
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
