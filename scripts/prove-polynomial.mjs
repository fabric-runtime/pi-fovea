// Untrusted search only: every result must be replayed by gdp-wired's kernel.
// Multiply existing polynomial inequalities by nonnegative monomials already
// demanded by the goal, rather than enumerating every product of every row.
// Optional bounded closure follows intermediate monomials through substitutions;
// coefficient and indexed transport proofs opt in. Default budgets stay unchanged.
// Optional priority cuts are exhaustive kernel splits, never extra premises.
// A bounded degree lift allows checked intermediate products (e.g. clearing
// rational denominators) above the degree already visible in the goal.
import {canon,canonFlip,factorsOf,leafConstraints,withProducts,check} from 'gdp-wired/kernel';
import {grow,openAt} from 'gdp-wired/prove';
import {solve} from 'gdp-wired/solver';
const factors=k=>k==='1'?[]:factorsOf(k);
const divide=(whole,part)=>{
  const out=[...whole];for(const x of part){const i=out.indexOf(x);if(i<0)return;out.splice(i,1);}return out;
};
function productLeaf(goal,path,until,trace,limits){
  const rows=leafConstraints(goal,path),pairs=[],indexes=new Map(),seen=new Set();
  rows.forEach((r,i)=>{const keys=Object.keys(r.lin);if(keys.length===1&&r.lin[keys[0]]===-1)indexes.set(keys[0],i);});
  const columns=[...new Set(rows.flatMap(r=>Object.keys(r.lin)))].map(factors),degree=Math.max(0,...columns.map(a=>a.length))+limits.degreeLift;
  const monomial=fs=>{
    const key=fs.join('\u0000');if(indexes.has(key))return indexes.get(key);
    if(fs.length===1)return indexes.get(fs[0]);
    const a=monomial(fs.slice(0,-1)),b=monomial(fs.slice(-1));if(a===undefined||b===undefined)return;
    const index=rows.length+pairs.length;pairs.push([a,b]);indexes.set(key,index);return index;
  };
  const columnKeys=new Set(columns.map(fs=>fs.join('\u0000')));
  for(let round=0;round<=limits.closureRounds;round++){
    const targets=[...columns];
    for(let i=0;i<rows.length;i++){
      const own=Object.keys(rows[i].lin).map(factors),max=Math.max(...own.map(x=>x.length));
      for(const target of targets)for(const key of own){
        const rest=divide(target,key);if(!rest?.length||rest.length+max>degree)continue;
        const tag=i+':'+rest.join('\u0000');if(seen.has(tag))continue;seen.add(tag);
        const j=monomial(rest);
        if(j!==undefined){
          pairs.push([i,j]);
          if(round<limits.closureRounds)for(const fs of own){
            const next=[...fs,...rest].sort(),key=next.join('\u0000');
            if(!columnKeys.has(key)){columnKeys.add(key);columns.push(next);}
          }
        }
        if(pairs.length>limits.products||performance.now()>until){trace?.push({phase:'limit',depth:path.size,pairs:pairs.length});return;}
      }
    }
  }
  const variables=[...new Set(columns.flat())].filter(name=>!name.includes('⟦'));
  for(let i=0;i<rows.length;i++){
    const max=Math.max(...Object.keys(rows[i].lin).map(k=>factors(k).length));
    if(max>=degree)continue;
    for(const name of variables){
      const tag=i+':'+name;if(seen.has(tag))continue;seen.add(tag);
      const j=monomial([name]);if(j!==undefined)pairs.push([i,j]);
      if(pairs.length>limits.products||performance.now()>until){trace?.push({phase:'limit',depth:path.size,pairs:pairs.length});return;}
    }
  }
  const result=solve(withProducts(rows,pairs),limits.rows);
  trace?.push({phase:'leaf',depth:path.size,rows:rows.length,pairs:pairs.length,kind:result.kind});
  if(result.kind==='refuted')return {leaf:result.steps,products:pairs};
}
export function provePolynomial(goal,until,trace,options={}){
  const limits={nodes:options.nodes??64,products:options.products??1200,rows:options.rows??2000,closureRounds:options.closureRounds??0,degreeLift:options.degreeLift??0};
  if(!Number.isInteger(limits.degreeLift)||limits.degreeLift<0||limits.degreeLift>2)throw new Error('Polynomial degree lift must be 0, 1 or 2');
  let visited=0;
  function visit(path){
    if(++visited>limits.nodes||performance.now()>until)return;
    const leaf=productLeaf(goal,path,until,trace,limits);if(leaf&&check(goal,leaf,path))return leaf;
    const rows=leafConstraints(goal,path);
    const priority=options.cuts?.find(lin=>!path.has(canon(lin))&&!path.has(canonFlip(lin)));
    const open=priority??openAt(goal,path,rows).find(lin=>Object.keys(lin).some(k=>k!=='1')&&!path.has(canon(lin))&&!path.has(canonFlip(lin)));
    if(open){
      const key=canon(open);
      const yes=visit(new Map(path).set(key,{lin:open,holds:true}));if(!yes)return;
      const no=visit(new Map(path).set(key,{lin:open,holds:false}));if(!no)return;
      return {split:open,yes,no};
    }
    const names=[...new Set(rows.flatMap(r=>Object.keys(r.lin).flatMap(factors)))];
    const missing=names.find(name=>!name.includes('⟦')&&!rows.some(r=>Object.keys(r.lin).length===1&&r.lin[name]===-1));
    if(missing){
      const lin={[missing]:-1},key=canon(lin);
      if(path.has(key))return;
      const yes=visit(new Map(path).set(key,{lin,holds:true}));if(!yes)return;
      const no=visit(new Map(path).set(key,{lin,holds:false}));if(!no)return;
      return {split:lin,yes,no};
    }
    const result=grow(goal,path,{nodes:32,until});if('tree' in result)return result.tree;
    const choice=[...result.path.entries()].find(([key])=>!path.has(key));trace?.push({phase:'split',available:result.path.size,depth:path.size,kind:result.stuck,...(!choice?{witness:result.witness}: {})});if(!choice)return;
    const [key,{lin}]=choice;
    const yes=visit(new Map(path).set(key,{lin,holds:true}));if(!yes)return;
    const no=visit(new Map(path).set(key,{lin,holds:false}));if(!no)return;
    return {split:lin,yes,no};
  }
  const tree=visit(new Map());return tree&&check(goal,tree)?tree:undefined;
}
