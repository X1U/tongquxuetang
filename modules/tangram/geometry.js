(function(root){
  'use strict';
  const shapes=[[[0,0],[4,0],[0,4]],[[0,0],[4,0],[0,4]],[[0,0],[2,2],[-2,2]],[[0,0],[2,0],[0,2]],[[0,0],[2,0],[0,2]],[[0,0],[2,0],[2,2],[0,2]],[[0,0],[2,0],[4,2],[2,2]]];
  const labels=['大三角一','大三角二','中三角','小三角一','小三角二','正方形','平行四边形'];
  const colors=['#de765c','#e5aa46','#7a9f67','#65a7b2','#a18cbb','#dc8cac','#8195ce'];
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const signed=p=>p.reduce((a,v,i)=>a+v[0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*v[1],0)/2;
  const area=p=>Math.abs(signed(p));
  const ccw=p=>signed(p)<0?[...p].reverse():p;
  const center=p=>p.reduce((c,v)=>[c[0]+v[0]/p.length,c[1]+v[1]/p.length],[0,0]);
  function polygon(piece,scale=1){
    const source=shapes[piece.id],c=center(source),r=piece.angle*Math.PI/180,co=Math.cos(r),si=Math.sin(r);
    return ccw(source.map(v=>{const x=(v[0]-c[0])*(piece.flip?-1:1)*scale,y=(v[1]-c[1])*scale;return [piece.x+x*co-y*si,piece.y+x*si+y*co];}));
  }
  function intersection(subject,clip){
    let output=ccw(subject);clip=ccw(clip);
    for(let i=0;i<clip.length&&output.length;i++){
      const a=clip[i],b=clip[(i+1)%clip.length],input=output;output=[];
      let s=input[input.length-1],ds=cross(a,b,s);
      for(const e of input){const de=cross(a,b,e);if((de>=-1e-8)!==(ds>=-1e-8)){const t=ds/(ds-de);output.push([s[0]+t*(e[0]-s[0]),s[1]+t*(e[1]-s[1])]);}if(de>=-1e-8)output.push(e);s=e;ds=de;}
    }
    return output;
  }
  function overlap(a,b){return area(intersection(a,b));}
  function metrics(pieces,target,scale=1){
    const polys=pieces.map(p=>polygon(p,scale)),total=target.reduce((sum,p)=>sum+area(p),0);
    let inside=0,duplicate=0;
    for(let i=0;i<polys.length;i++){for(const t of target)inside+=overlap(polys[i],t);for(let j=0;j<i;j++)duplicate+=overlap(polys[i],polys[j]);}
    const standard=pieces.length===7&&new Set(pieces.map(p=>p.id)).size===7&&pieces.every(p=>Number.isInteger(p.id)&&p.id>=0&&p.id<7);
    return {inside,duplicate,total,outside:Math.max(0,total-inside),complete:standard&&inside>=total*(1-.003)&&duplicate<=total*.0015};
  }
  function bounds(polys){const points=polys.flat();return {minX:Math.min(...points.map(v=>v[0])),maxX:Math.max(...points.map(v=>v[0])),minY:Math.min(...points.map(v=>v[1])),maxY:Math.max(...points.map(v=>v[1]))};}
  function fit(raw){
    const b=bounds(raw),scale=Math.min(48,470/(b.maxX-b.minX),390/(b.maxY-b.minY));
    const dx=300-(b.minX+b.maxX)/2*scale,dy=225-(b.minY+b.maxY)/2*scale;
    return {scale,target:raw.map(p=>ccw(p.map(v=>[v[0]*scale+dx,v[1]*scale+dy])))};
  }
  function poseFor(id,target,scale=1){
    const c=center(target);
    for(const flip of [false,true])for(let angle=0;angle<360;angle+=45){
      const p={id,x:c[0],y:c[1],angle,flip},poly=polygon(p,scale);
      if(Math.abs(area(target)-area(poly))<1e-5&&overlap(poly,target)>area(poly)-1e-5)return p;
    }
    throw Error('Invalid tangram shape '+id);
  }
  // Remove shared edge intervals, including partial edges, to draw only the silhouette.
  function outline(polys){
    const edges=polys.flatMap((p,i)=>p.map((a,k)=>({a,b:p[(k+1)%p.length],i}))),result=[];
    for(const e of edges){const vx=e.b[0]-e.a[0],vy=e.b[1]-e.a[1],len=vx*vx+vy*vy;let intervals=[[0,1]];
      for(const f of edges){if(f.i===e.i||Math.abs(cross(e.a,e.b,f.a))>1e-5||Math.abs(cross(e.a,e.b,f.b))>1e-5)continue;
        const values=[f.a,f.b].map(p=>((p[0]-e.a[0])*vx+(p[1]-e.a[1])*vy)/len),lo=Math.max(0,Math.min(...values)),hi=Math.min(1,Math.max(...values));if(hi<=lo+1e-7)continue;
        intervals=intervals.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([x,y])=>y>x+1e-7));
      }
      for(const [a,b] of intervals)result.push([[e.a[0]+a*vx,e.a[1]+a*vy],[e.a[0]+b*vx,e.a[1]+b*vy]]);
    }return result;
  }
  function validLayout(raw){
    if(raw.length!==7)return false;
    for(let i=0;i<7;i++){poseFor(i,raw[i]);for(let j=0;j<i;j++)if(overlap(raw[i],raw[j])>1e-7)return false;}
    const links=raw.map(()=>new Set());
    const touches=(a,p)=>p.some((b,k)=>{const c=p[(k+1)%p.length];return Math.abs(cross(b,c,a))<1e-6&&(a[0]-b[0])*(a[0]-c[0])+(a[1]-b[1])*(a[1]-c[1])<=1e-6;});
    for(let i=0;i<7;i++)for(let j=0;j<i;j++)if(raw[i].some(a=>touches(a,raw[j]))||raw[j].some(a=>touches(a,raw[i]))){links[i].add(j);links[j].add(i);}
    const seen=new Set([0]),queue=[0];while(queue.length){for(const j of links[queue.shift()])if(!seen.has(j)){seen.add(j);queue.push(j);}}
    return seen.size===7;
  }
  const api={shapes,labels,colors,area,center,polygon,intersection,overlap,metrics,bounds,fit,poseFor,outline,validLayout};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TangramGeometry=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
