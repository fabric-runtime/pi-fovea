// ABI codecs only: decisions and arithmetic come from compileJs, never duplicated here.
export const kernelBridge = `
const u32=value=>{if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>4294967295)throw new RangeError('Expected u32');return value;};
const run=(m,input)=>{for(const value of Object.values(input))u32(value);const scalars=m.step({},m.init({}),input).scalars;for(const value of Object.values(scalars))u32(value);return scalars;};
const natural=value=>{if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>4294967295)throw new RangeError('Expected u32');return value;};
const boolean=value=>{if(typeof value!=='boolean')throw new TypeError('Expected Boolean');return +value;};
export function disclosure(scope,excluded,seen,repeat,nucleus){const s=run(disclosureMachine,{scope:boolean(scope),excluded:boolean(excluded),seen:boolean(seen),repeat:boolean(repeat),nucleus:boolean(nucleus)});return {$:['Drop','Suppress','Reveal'][s['out.tag']]};}
export function shownCount(total,requested){return natural(run(counts,{total:natural(total),requested:natural(requested)})['out.shown']);}
export function remainingCount(total,requested){return natural(run(counts,{total:natural(total),requested:natural(requested)})['out.remaining']);}
export function basisStep(have,order){const s=run(basis,{have:natural(have),order:natural(order)}),tag=['Empty','Complete','First','Next'][s['out.tag']];return tag==='Next'?{$:tag,at:natural(s['out.at']),previous:natural(s['out.previous']),older:natural(s['out.older'])}:{$:tag};}
`;
// The disclosure ABI name differs from its generated machine binding.
export const controlBridge = `
const u32=value=>{if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>4294967295)throw new RangeError('Expected u32');return value;};
const run=(m,input)=>{for(const value of Object.values(input))u32(value);const scalars=m.step({},m.init({}),input).scalars;for(const value of Object.values(scalars))u32(value);return scalars;};
export function semaphoreStep(active,waiting,limit,release){const s=run(semaphore,{active,waiting,limit,release:+release});return {active:s['out.active'],waiting:s['out.waiting'],admit:!!s['out.admit'],wake:!!s['out.wake']};}
export function capacityPlan(count,limit){const s=run(capacity,{count,limit});return {keep:s['out.keep'],evict:!!s['out.evict']};}
export function leaseValid(epoch,startedEpoch,leaseValue,startedLease,present){return !!run(lease,{epoch,startedEpoch,lease:leaseValue,startedLease,present:+present})['out.valid'];}
export function resetFocus(fresh,generationSame,keySame){return !!run(focus,{fresh:+fresh,generationSame:+generationSame,keySame:+keySame})['out.reset'];}
export function fitStep(budget,index,cost,selected,selectedCost){const s=run(fit,{budget,index,cost,selected,selectedCost});return {selected:s['out.selected'],cost:s['out.cost']};}
`;
export const controlTypes=`// Generated gdp-wired control ABI; do not edit.\nexport declare function semaphoreStep(active:number,waiting:number,limit:number,release:boolean):{active:number;waiting:number;admit:boolean;wake:boolean};\nexport declare function capacityPlan(count:number,limit:number):{keep:number;evict:boolean};\nexport declare function leaseValid(epoch:number,startedEpoch:number,lease:number,startedLease:number,present:boolean):boolean;\nexport declare function resetFocus(fresh:boolean,generationSame:boolean,keySame:boolean):boolean;\nexport declare function fitStep(budget:number,index:number,cost:number,selected:number,selectedCost:number):{selected:number;cost:number};\n`;
