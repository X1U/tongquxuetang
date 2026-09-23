'use strict';
const crypto = require('node:crypto');
const hanText = text => String(text).normalize('NFKC').replace(/[^\p{Script=Han}]/gu, '');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const normalizeSound = sound => String(sound).normalize('NFC').replaceAll('ɡ', 'g').toLowerCase();
// Align matching characters so a textual variant cannot shift every following reading.
function alignCharacters(a, b) {
  const x = [...a], y = [...b], width = y.length + 1;
  const lengths = new Uint16Array((x.length + 1) * width);
  for (let i=x.length-1;i>=0;i--) for (let j=y.length-1;j>=0;j--) {
    lengths[i*width+j] = x[i]===y[j] ? 1+lengths[(i+1)*width+j+1] : Math.max(lengths[(i+1)*width+j],lengths[i*width+j+1]);
  }
  const steps=[];let i=0,j=0;
  while(i<x.length||j<y.length) {
    if(i<x.length&&j<y.length&&x[i]===y[j])steps.push({a:i++,b:j++});
    else if(j<y.length&&(i===x.length||lengths[i*width+j+1]>=lengths[(i+1)*width+j]))steps.push({a:null,b:j++});
    else steps.push({a:i++,b:null});
  }
  return steps;
}
function textChanges(a,b) {
  const x=[...a],y=[...b],changes=[];let current=null,next=0;
  for(const step of alignCharacters(a,b)) {
    if(step.a!==null&&step.b!==null) {
      if(current){current.afterContext=x.slice(step.a,step.a+5).join('');changes.push(current);current=null;}
      next=step.a+1;
    } else {
      if(!current)current={index:next,beforeContext:x.slice(Math.max(0,next-5),next).join(''),local:'',reference:''};
      if(step.a!==null){current.local+=x[step.a];next=step.a+1;}
      if(step.b!==null)current.reference+=y[step.b];
    }
  }
  if(current){current.afterContext='';changes.push(current);}
  return changes;
}
module.exports={hanText,hash,normalizeSound,alignCharacters,textChanges};
