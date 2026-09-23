(() => {
  'use strict';
  // Measure the same markup used on screen. Split oversized text at character/token boundaries.
  function paginate(units,target,render){
    const width=target.clientWidth,height=target.clientHeight;
    if(width<1||height<1)return [];
    const measure=document.createElement('div');measure.className=target.className+' poetry-measure';
    measure.setAttribute('aria-hidden','true');measure.style.width=width+'px';target.appendChild(measure);
    const gap=Number.parseFloat(getComputedStyle(target).rowGap)||0;
    const pages=[];let page=[],used=0;
    function flush(){if(page.length){pages.push(page);page=[];used=0;}}
    const fragment=(unit,from,to)=>({unit,from,to});
    function size(piece){measure.innerHTML=render(piece);return measure.firstElementChild.getBoundingClientRect().height;}
    try{
      for(const unit of units){
        let from=0;
        while(from<unit.parts.length){
          let piece=fragment(unit,from,unit.parts.length),needed=size(piece);
          if(page.length&&used+gap+needed>height+.25)flush();
          if(needed>height+.25){
            let low=1,high=unit.parts.length-from,best=0;
            while(low<=high){const count=(low+high)>>1,candidate=fragment(unit,from,from+count);if(size(candidate)<=height+.25){best=count;low=count+1;}else high=count-1;}
            if(!best)throw new Error('Poetry viewport is too small for a readable fragment');
            piece=fragment(unit,from,from+best);needed=size(piece);
          }
          if(page.length)used+=gap;
          page.push(piece);used+=needed;from=piece.to;
          if(from<unit.parts.length)flush();
        }
      }
      flush();return pages;
    }finally{measure.remove();}
  }
  function anchor(pages,index){const first=pages[index]?.[0];return first?{key:first.unit.key,offset:first.from}:null;}
  function locate(pages,wanted){if(!wanted)return 0;const index=pages.findIndex(page=>page.some(piece=>piece.unit.key===wanted.key&&piece.from<=wanted.offset&&piece.to>wanted.offset));return Math.max(0,index);}
  window.PoetryPagination=Object.freeze({paginate,anchor,locate});
})();
