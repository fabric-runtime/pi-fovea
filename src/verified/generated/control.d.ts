// Generated gdp-wired control ABI; do not edit.
export declare function semaphoreStep(active:number,waiting:number,limit:number,release:boolean):{active:number;waiting:number;admit:boolean;wake:boolean};
export declare function capacityPlan(count:number,limit:number):{keep:number;evict:boolean};
export declare function leaseValid(epoch:number,startedEpoch:number,lease:number,startedLease:number,present:boolean):boolean;
export declare function resetFocus(fresh:boolean,generationSame:boolean,keySame:boolean):boolean;
export declare function fitStep(budget:number,index:number,cost:number,selected:number,selectedCost:number):{selected:number;cost:number};
