import { describe, expect, it } from 'vitest';
import { SPAWN_CONCURRENCY, spawnGate, trimMap } from '../src/core/asyncutil.js';
import { capacityPlan, leaseValid, semaphoreStep } from '../src/verified/generated/control.js';
describe('executed control policies',()=>{
  it('reserves a released slot for the queued waiter before a newcomer microtask',async()=>{
    let active=0,peak=0;const releases:Array<()=>void>=[];
    const work=()=>{active++;peak=Math.max(peak,active);return new Promise<void>(resolve=>releases.push(()=>{active--;resolve();}));};
    const first=Array.from({length:SPAWN_CONCURRENCY},()=>spawnGate.run(work));
    const waiting=spawnGate.run(work);releases[0]!();
    let newcomer:Promise<void>|undefined;
    queueMicrotask(()=>{newcomer=spawnGate.run(work);});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(peak).toBe(SPAWN_CONCURRENCY);
    for(const release of releases.slice(1))release();
    await new Promise<void>(resolve=>setImmediate(resolve));
    releases.at(-1)!();await Promise.all([...first,waiting,newcomer]);
    expect(active).toBe(0);
  });
  it('releases a slot even when work rejects',async()=>{
    await expect(spawnGate.run(async()=>{throw new Error('failed');})).rejects.toThrow('failed');
    expect(await spawnGate.run(async()=>42)).toBe(42);
  });
  it('caps resident caches and reports actual FIFO evictions',()=>{
    const map=new Map([['a',1],['b',2],['c',3]]),evicted:string[]=[];
    trimMap(map,1,key=>evicted.push(key));expect([...map.keys()]).toEqual(['c']);expect(evicted).toEqual(['a','b']);
    trimMap(map,0);expect(map.size).toBe(0);
  });
  it('rejects invalid inputs at generated control boundaries',()=>{
    expect(()=>semaphoreStep(4,0,3,false)).toThrow();expect(()=>capacityPlan(0,0)).toThrow();
    expect(()=>leaseValid(2 ** 32,0,1,1,true)).toThrow(RangeError);
    expect(()=>semaphoreStep(3,0xffffffff,3,false)).toThrow(RangeError);
  });
});
