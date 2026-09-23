'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Eight bytes, matching the Java cache header's big-endian long.
const MAGIC=Buffer.from('TQVOICE1'),MAX_AUDIO=8*1024*1024;
class SpeechAudioCache {
  constructor(directory,{maxBytes=64*1024*1024,maxEntries=1000}={}){this.directory=directory;this.maxBytes=maxBytes;this.maxEntries=maxEntries;}
  file(key){if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid audio key');return path.join(this.directory,key+'.voice');}
  async get(key){
    const file=this.file(key);
    try{
      const stat=await fs.stat(file);if(!stat.isFile()||stat.size<544||stat.size>MAX_AUDIO+44)throw new Error('Invalid audio cache');
      const data=await fs.readFile(file),audio=data.subarray(44);
      if(!data.subarray(0,8).equals(MAGIC)||data.readUInt32BE(8)!==audio.length||!crypto.timingSafeEqual(data.subarray(12,44),crypto.createHash('sha256').update(audio).digest()))throw new Error('Damaged audio cache');
      await fs.utimes(file,new Date(),new Date()).catch(()=>{});return audio;
    }catch(error){if(error.code!=='ENOENT')await fs.unlink(file).catch(()=>{});return null;}
  }
  async put(key,audio){
    const file=this.file(key);if(!Buffer.isBuffer(audio)||audio.length<500||audio.length>MAX_AUDIO||audio.length+44>this.maxBytes)return;
    const temporary=path.join(this.directory,key+'-'+crypto.randomBytes(6).toString('hex')+'.tmp');
    try{
      await fs.mkdir(this.directory,{recursive:true});
      const header=Buffer.alloc(44);MAGIC.copy(header);header.writeUInt32BE(audio.length,8);crypto.createHash('sha256').update(audio).digest().copy(header,12);
      await fs.writeFile(temporary,Buffer.concat([header,audio]),{flag:'wx'});await fs.rename(temporary,file);await this.trim(file);
    }catch(_){/* A full or read-only disk must not stop speech. */}
    finally{await fs.unlink(temporary).catch(()=>{});}
  }
  async trim(newest){
    const names=await fs.readdir(this.directory),files=[];
    for(const name of names){
      if(!/^[a-f0-9]{64}\.voice$/.test(name))continue;
      const file=path.join(this.directory,name),stat=await fs.stat(file).catch(()=>null);
      if(stat?.isFile())files.push({file,size:stat.size,time:stat.mtimeMs});
    }
    files.sort((a,b)=>a.time-b.time);let bytes=files.reduce((sum,item)=>sum+item.size,0),count=files.length;
    for(const item of files){if(bytes<=this.maxBytes&&count<=this.maxEntries)break;if(item.file===newest)continue;if(await fs.unlink(item.file).then(()=>true,()=>false)){bytes-=item.size;count--;}}
  }
}
module.exports={SpeechAudioCache};
