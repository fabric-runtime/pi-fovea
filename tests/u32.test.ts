import { describe, expect, it } from 'vitest';
import { addWords, checkedU32, compareWords, discardedBits, divideSmall, divideWords,
  multiplyWords, roundedShiftRight, shiftLeft, shiftRight, subtractWords, word, wordsToNumber, type Words } from '../src/core/u32.js';
const from=(n:bigint):Words=>{const digits:number[]=[];for(;n;n>>=32n)digits.push(Number(n&0xffffffffn));return new Uint32Array(digits);};
const value=(a:Words):bigint=>{let n=0n;for(let i=a.length-1;i>=0;i--)n=(n<<32n)+BigInt(a[i]!);return n;};
let seed=0x12345678;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const wide=(n:number)=>new Uint32Array(Array.from({length:n},random));
describe('u32 limb assembly (independent BigInt oracle, not proof of the host loops)',()=>{
  it('matches exact wide arithmetic and quotient/remainder at carries and signed-bit boundaries',()=>{
    const inputs=[word(0),word(1),word(0xffffffff),from(1n<<192n),new Uint32Array([0xffffffff,0xffffffff,0xffffffff])];
    for(let i=0;i<80;i++)inputs.push(wide(i%17));
    for(let i=0;i<inputs.length;i++){
      const a=inputs[i]!,b=inputs[(i*31+3)%inputs.length]!,x=value(a),y=value(b),saved=a.slice();
      expect(value(addWords(a,b))).toBe(x+y);expect(value(multiplyWords(a,b))).toBe(x*y);
      expect(Math.sign(compareWords(a,b))).toBe(x===y?0:x<y?-1:1);
      if(x>=y)expect(value(subtractWords(a,b))).toBe(x-y);else expect(()=>subtractWords(a,b)).toThrow(RangeError);
      if(y){const d=divideWords(a,b);expect(value(d.quotient)).toBe(x/y);expect(value(d.remainder)).toBe(x%y);}
      for(const divisor of [1,65535,65536,0xffffffff]){const d=divideSmall(a,divisor);expect(value(d.quotient)).toBe(x/BigInt(divisor));expect(BigInt(d.remainder)).toBe(x%BigInt(divisor));}
      expect(a).toEqual(saved);
    }
  });
  it('packs shifts across limb boundaries without losing discarded-bit evidence',()=>{
    for(const a of [wide(1),wide(9),wide(18),word(0)])for(const shift of [0,1,15,16,31,32,33,63,191,192,193,575]){
      const x=value(a),s=BigInt(shift);
      expect(value(shiftLeft(a,shift))).toBe(x<<s);expect(value(shiftRight(a,shift))).toBe(x>>s);
      expect(discardedBits(a,shift)).toBe((x&((1n<<s)-1n))!==0n);
      const floor=x>>s,remainder=x&((1n<<s)-1n),half=shift?1n<<(s-1n):0n;
      const nearest=floor+(shift&&(remainder>half||(remainder===half&&(floor&1n)===1n))?1n:0n);
      expect(value(roundedShiftRight(a,shift,'floor'))).toBe(floor);
      expect(value(roundedShiftRight(a,shift,'ceil'))).toBe(floor+(remainder?1n:0n));
      expect(value(roundedShiftRight(a,shift,'nearest'))).toBe(nearest);
    }
  });
  it('rounds wide integers to Float64 once, including ties to even',()=>{
    const values=[0n,1n,0xffffffffn,2n**53n-1n,2n**53n+1n,2n**53n+3n,2n**100n+2n**47n,2n**100n+2n**47n+1n,2n**1024n];
    for(let i=0;i<80;i++)values.push(value(wide(i%18)));
    for(const n of values)expect(wordsToNumber(from(n))).toBe(Number(n));
  });
  it('refuses invalid u32 values, zero divisors and unbounded shifts',()=>{
    for(const bad of [-1,0.5,NaN,Infinity,2**32])expect(()=>checkedU32(bad)).toThrow(RangeError);
    expect(()=>divideWords(word(1),word(0))).toThrow(RangeError);expect(()=>divideSmall(word(1),0)).toThrow(RangeError);
    expect(()=>shiftLeft(word(1),-1)).toThrow(RangeError);expect(()=>shiftRight(word(1),65537)).toThrow(RangeError);
  });
});
