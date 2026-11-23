import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNotes,frequency,KEY_PEDALS} from '../src/notes.js';
test('47-string concert tuning spans C1 to G7, seven natural notes per octave',()=>{const notes=makeNotes();assert.equal(notes.length,47);assert.equal(notes[0].midi,24);assert.equal(notes.at(-1).midi,103);assert.equal(new Set(notes.map(n=>n.id)).size,47);assert.equal(notes.filter(n=>n.letter==='C').length,7);assert.ok(notes.slice(1).every((n,i)=>n.midi>notes[i].midi));});
test('pedal sharpens all Fs across octaves and leaves C strings untouched',()=>{const normal=makeNotes(),g=makeNotes('full',KEY_PEDALS.G);g.forEach((n,i)=>assert.equal(n.midi-normal[i].midi,n.letter==='F'?1:0));const flat=makeNotes('full',{C:-1});assert.equal(flat[0].midi,23);assert.equal(flat[0].label,'C♭1');});
test('focus range preserves middle keyboard octave and concert A reference',()=>{const notes=makeNotes('focus');assert.equal(notes.length,22);assert.equal(notes[0].id,'C3');assert.equal(notes.at(-1).id,'C6');assert.equal(frequency(notes.find(n=>n.id==='A4').midi),440);});
