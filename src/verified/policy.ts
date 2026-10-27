import { shownCount as shown, remainingCount as remaining, basisStep } from './generated/kernel.js';

export const VERIFIED_NAT_MAX = 0xffffffff;
/** @deprecated Use VERIFIED_NAT_MAX. The numeric domain is now u32. */
export const BEND_NAT_MAX = 0xffffffff;
const natural = (value:number):number => {
  if(!Number.isInteger(value)||value<0||value>VERIFIED_NAT_MAX)throw new RangeError(`Expected u32, got ${value}`);
  return value;
};
export const shownCount=(total:number,requested:number):number=>natural(shown(natural(total),natural(requested)));
export const remainingCount=(total:number,requested:number):number=>natural(remaining(natural(total),natural(requested)));
export type BasisStep = { $:'Empty' }|{ $:'Complete' }|{ $:'First' }|{ $:'Next';at:number;previous:number;older:number };
/** Trusted u32/tag codec. All decisions are made by the generated kernel. */
export const nextBasisStep=(have:number,order:number):BasisStep=>{
  const step=basisStep(natural(have),natural(order));
  switch(step.$){
    case 'Empty':case 'Complete':case 'First':return step;
    case 'Next':return {$:'Next',at:natural(step.at),previous:natural(step.previous),older:natural(step.older)};
    default:throw new Error('Invalid basis command from verified kernel');
  }
};
