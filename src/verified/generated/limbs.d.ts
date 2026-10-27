// Generated u32-limb cells; do not edit.
export declare function numericWorkStep(used:number,amount:number,limit:number):{used:number;admit:boolean};
export declare function roundingIncrement(mode:number,guard:boolean,sticky:boolean,odd:boolean):number;
export declare function addCell(a:number,b:number,carry:number):{word:number;carry:number};
export declare function subtractCell(a:number,b:number,borrow:number):{word:number;borrow:number};
export declare function productCell(a:number,b:number,cell:number,carry:number):number;
export declare function validDivisionCell(previous:number,digit:number,divisor:number,quotient:number,remainder:number):boolean;
