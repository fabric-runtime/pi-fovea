// Positive 192-fractional-bit intervals. All endpoints own unsigned u32 limbs.
import { addWords, compareWords, divideSmall, divideWords, multiplyWords, roundedShiftRight,
  shiftLeft, shiftRight, subtractWords, word, wordsToNumber, type Words } from './u32.js';
export const FIXED_BITS=192;
const ONE=word(1);
export const ZERO=word(0), SCALE=shiftLeft(ONE,FIXED_BITS);
export type Interval=readonly [Words,Words];
export interface NumericBounds {lower:number;upper:number;value:number;}
const view=new DataView(new ArrayBuffer(8));
const raw=(x:number):readonly [number,number]=>{view.setFloat64(0,x);return [view.getUint32(0),view.getUint32(4)];};
const fromRaw=(hi:number,lo:number):number=>{view.setUint32(0,hi);view.setUint32(4,lo);return view.getFloat64(0);};
export const nextUp=(x:number):number=>{
  if(Number.isNaN(x)||x===Infinity)return x;
  if(x===0)return Number.MIN_VALUE;
  const [hi,lo]=raw(x);
  return x>0?(lo===0xffffffff?fromRaw(hi+1,0):fromRaw(hi,lo+1)):(lo===0?fromRaw(hi-1,0xffffffff):fromRaw(hi,lo-1));
};
export const nextDown=(x:number):number=>-nextUp(-x);
export const dyadic=(x:number):{n:Words;e:number}=>{
  if(!Number.isFinite(x)||x<0)throw new RangeError('Expected finite nonnegative dyadic');
  const [hi,lo]=raw(x),exponent=(hi>>>20)&2047;
  return {n:new Uint32Array([lo,(hi&0xfffff)+(exponent?0x100000:0)]),e:exponent?exponent-1075:-1074};
};
/** Scaling by a power of two happens exactly in the exponent, not in Float64. */
export const fixed=(x:number,powerOfTwo=0):Interval=>{
  if(!Number.isSafeInteger(powerOfTwo)||Math.abs(powerOfTwo)>4096)throw new RangeError('Invalid fixed-point exponent');
  const {n,e}=dyadic(x),shift=e+FIXED_BITS+powerOfTwo;
  if(shift>=0){const exact=shiftLeft(n,shift);return [exact,exact];}
  return [shiftRight(n,-shift),roundedShiftRight(n,-shift,'ceil')];
};
export const ceilDivide=(n:Words,d:Words):Words=>{
  const {quotient,remainder}=divideWords(n,d);
  return compareWords(remainder,ZERO)>0?addWords(quotient,ONE):quotient;
};
export const add=(a:Interval,b:Interval):Interval=>[addWords(a[0],b[0]),addWords(a[1],b[1])];
export const mul=(a:Interval,b:Interval):Interval=>[
  shiftRight(multiplyWords(a[0],b[0]),FIXED_BITS),
  roundedShiftRight(multiplyWords(a[1],b[1]),FIXED_BITS,'ceil')];
export const divide=(a:Interval,b:Interval):Interval=>{
  if(compareWords(b[0],ZERO)<=0)throw new RangeError('Positive interval denominator required');
  return [divideWords(shiftLeft(a[0],FIXED_BITS),b[1]).quotient,ceilDivide(shiftLeft(a[1],FIXED_BITS),b[0])];
};
export const byInt=(a:Interval,n:number):Interval=>{
  const lower=divideSmall(a[0],n),upper=divideSmall(a[1],n);
  return [lower.quotient,upper.remainder?addWords(upper.quotient,ONE):upper.quotient];
};
export const enclose=(a:Interval):NumericBounds=>{
  const lower=Math.max(0,nextDown(wordsToNumber(a[0])/2**FIXED_BITS)),upper=nextUp(wordsToNumber(a[1])/2**FIXED_BITS);
  return {lower,upper,value:lower+(upper-lower)/2};
};
/** Enclose positive-minus-negative endpoints without rounded Float64 cancellation. */
export const signedBounds=(positive:Interval,negative:Interval):{lower:number;upper:number}=>{
  const difference=(a:Words,b:Words):number=>compareWords(a,b)>=0?wordsToNumber(subtractWords(a,b))/2**FIXED_BITS:-wordsToNumber(subtractWords(b,a))/2**FIXED_BITS;
  return {lower:nextDown(difference(positive[0],negative[1])),upper:nextUp(difference(positive[1],negative[0]))};
};
/** Upper bound for a decreasing-ratio geometric tail, in fixed-point units. */
export const geometricTail=(next:Words,ratio:Words):Words|undefined=>compareWords(ratio,SCALE)<0?ceilDivide(shiftLeft(next,FIXED_BITS),subtractWords(SCALE,ratio)):undefined;
