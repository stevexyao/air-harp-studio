export const LETTERS=['C','D','E','F','G','A','B'];
const SEMITONES=[0,2,4,5,7,9,11];
export const PEDAL_ORDER=['D','C','B','E','F','G','A'];
export const KEY_PEDALS={C:{},G:{F:1},D:{F:1,C:1},F:{B:-1},Am:{}};
export function makeNotes(range='full',pedals={}){
  const first=range==='focus'?3:1,count=range==='focus'?22:47;
  return Array.from({length:count},(_,index)=>{const letter=LETTERS[index%7],octave=first+Math.floor(index/7),alter=pedals[letter]||0;
    return {id:`${letter}${octave}`,letter,octave,index,midi:12*(octave+1)+SEMITONES[index%7]+alter,label:`${letter}${alter===-1?'♭':alter===1?'♯':''}${octave}`};});
}
export function frequency(midi){return 440*2**((midi-69)/12);}
