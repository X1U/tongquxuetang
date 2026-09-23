/* 原创诗意图：用可离线显示的矢量景物组合，不依赖远程图片。 */
window.PoetryArt = (() => {
  'use strict';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names = ['palace','tower','kitchen','beans','plum','forest','bamboo','farewell','fire','frontier','window','sunset','music','homecoming','battlefield','river','spring','birds','snow','autumn','mountains','temple','moon','flowers','history','letters','rain','banquet','stars','painting','travel','lake','geese','sea','village','trees'];
  const path = (d, fill, stroke = 'none', width = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ellipse = (x,y,rx,ry,fill) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
  const circle = (x,y,r,fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  const rect = (x,y,w,h,fill,r=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
  const group = (x,y,s,inner) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
  const cloud = (x,y,s=1) => group(x,y,s,path('M0 24C-8 7 12-4 27 6C34-15 71-11 76 10C98-5 120 9 111 26Z','#fffdf1') );
  const bird = (x,y,s=1,color='#728775') => group(x,y,s,path('M-15 5Q-6-5 0 4Q6-5 16 5','none',color,2.6));
  const butterfly = (x,y,s=1) => group(x,y,s,ellipse(-7,-2,8,11,'#e5b96f')+ellipse(7,-2,8,11,'#d9987a')+path('M0-9V12','none','#8c805e',2));
  const person = (x,y,s=1,color='#8caa97') => group(x,y,s,ellipse(0,55,19,4,'#85967b22')+path('M-12 17Q0 10 12 17L18 50Q0 56-18 50Z',color)+path('M-10 21L-23 37M10 21L22 31','none',color,8)+circle(0,2,12,'#e6bd94')+path('M-12 0Q-12-16 2-12Q14-12 12 1Q2-7-12 0','#596559')+circle(4,-14,5,'#596559')+path('M-7 53V59M7 53V59','none','#69745e',4));
  const tree = (x,y,s=1,autumn=false) => group(x,y,s,path('M0 0Q-8-52 3-122M0-53L-39-89M1-69L39-103','none','#95816a',9)+ellipse(-32,-116,49,37,autumn?'#d9a977':'#9ebaa0')+ellipse(26,-137,50,43,autumn?'#e3b979':'#adc8a9')+ellipse(53,-98,41,32,autumn?'#bcbc83':'#c0d0aa')+ellipse(-3,-87,46,36,autumn?'#c4b67c':'#abc098'));
  const pine = (x,y,s=1) => group(x,y,s,path('M0 0L-1-135','none','#8a816c',8)+path('M-9-138L-54-83H-29L-73-41H-35L-82-6H75L34-42H66L26-81H45Z','#829d88'));
  const bamboo = (x,y,s=1) => group(x,y,s,path('M0 0Q4-80 0-182M35 0Q20-90 41-157M-23 0Q-27-85-15-146','none','#809b73',6)+[-145,-102,-59,-20].map(h=>path(`M-5 ${h}H6M25 ${h+12}H36`,'none','#b7c79b',3)).join('')+path('M2-150Q-35-182-55-164Q-38-141 2-150M1-112Q38-150 68-145Q46-115 1-112M31-75Q72-100 91-81Q67-65 31-75M-21-85Q-53-112-76-98Q-54-73-21-85','#6f9669'));
  const boat = (x,y,s=1,sail=false) => group(x,y,s,path('M-58 0Q0 42 67-2Q10 12-58 0','#a9906e','#8d7a62',2)+path('M-27 31Q9 38 45 30','none','#b9ccc0',2)+(sail?path('M0-5V-105','none','#8d8068',3)+path('M-4-102Q-49-75-38-19L-4-16Z','#fcf0ce')+path('M5-86Q39-58 31-18L5-15Z','#e4d9b0'):person(0,-49,.7,'#7f9b91')+path('M18-20L64 17','none','#877d60',3)));
  const fishingBoat = (x,y,s=1) => group(x,y,s,boat(0,0,1)+path('M12-39Q64-76 115-42V49','none','#8d927a',2)+path('M-15-48L1-62L20-49Z','#c9b487'));
  const reeds = (x,y,s=1) => group(x,y,s,path('M0 0Q0-42-13-55M10 0Q17-48 26-61M-8 0Q-22-29-37-36','none','#acb58b',3)+ellipse(-14,-58,3,11,'#ccba91')+ellipse(28,-62,3,12,'#ccba91'));
  const mountain = (x,y,s=1,snow=false) => group(x,y,s,path('M-135 0L-25-184Q-8-213 8-187L145 0Z','#a9c0b4')+(snow?path('M-60-125L-25-184Q-8-213 8-187L56-122L23-137L2-112L-17-141L-35-123Z','#fbfcf5'):''));
  const house = (x,y,s=1) => group(x,y,s,rect(-54,-72,108,76,'#f1e8cc',5)+path('M-71-71L0-117L75-71Z','#9caa8b')+path('M-76-71H78','none','#6f866f',5)+rect(-11,-43,29,47,'#9da589',3)+rect(-39,-48,18,19,'#b8c3a4',3));
  const pavilion = (x,y,s=1,tall=false) => group(x,y,s,rect(-66,-86,132,90,'#ece3c8')+[-48,0,48].map(n=>rect(n-4,-78,8,81,'#9c9a75')).join('')+path('M-89-82Q-38-84 0-123Q38-84 89-82L71-69H-70Z','#7e9581')+path('M-92-82Q-45-81 0-125Q45-81 92-82','none','#6e8274',4)+path('M-72 8H72M-77 17H77','none','#c4c4a7',7)+(tall?group(0,-93,.78,pavilion(0,0,1,false)):''));
  const flower = (x,y,s=1,color='#dba598') => group(x,y,s,[-1,0,1].map(i=>ellipse(i*8,i===0?-8:0,7,9,color)).join('')+ellipse(-5,8,7,8,color)+ellipse(6,8,7,8,color)+circle(0,0,4,'#e4c270'));
  const lotus = (x,y,s=1) => group(x,y,s,ellipse(0,13,27,6,'#9dbb98')+path('M2 8L0-23','none','#91a981',2)+path('M0-10Q-30-20-20-34Q-7-34 0-15Q-13-41 1-50Q15-37 4-15Q12-35 27-35Q30-18 5-10Z','#d5a3a1'));
  const lantern = (x,y,s=1) => group(x,y,s,circle(0,0,23,'#f5deb1')+path('M-8 22H8M0 22V36','none','#b2936b',3)+path('M-9-20H9','none','#b2936b',4));
  const candle = (x,y) => rect(x-5,y-32,10,33,'#ecddbb',3)+path(`M${x} ${y-36}Q${x-12} ${y-48} ${x} ${y-61}Q${x+11} ${y-47} ${x} ${y-36}`,'#e0b577')+ellipse(x,y+3,19,4,'#c6b28a');
  const book = (x,y,s=1) => group(x,y,s,path('M0 4Q-35-13-80-2V-88Q-40-98 0-78Q39-97 81-88V-1Q40-13 0 4Z','#b7c7aa','#8d9c7d',2)+path('M0-2Q-35-22-73-11V-94Q-31-100 0-82Q33-101 74-94V-11Q33-22 0-2Z','#fff9e7')+path('M0-81V-6','none','#d6d1b5',2)+[-66,-49,-32].map(h=>path(`M-59 ${h}Q-30 ${h-3}-14 ${h+5}M14 ${h+5}Q37 ${h-4}59 ${h}`,'none','#bec7a3',3)).join(''));
  const qin = (x,y,s=1) => group(x,y,s,path('M-87 8Q-93-9-69-18H80Q96-4 87 12H-73Z','#b5a080','#95836b',2)+[-9,-5,-1,3].map(h=>path(`M-74 ${h}L79 ${h}`,'none','#f5eccf',1)).join(''));
  const pipa = (x,y,s=1) => group(x,y,s,path('M-6-85H7L8-28Q33-17 31 11Q27 43 0 43Q-28 43-31 13Q-34-13-8-29Z','#d4b586','#a18c70',2)+path('M-3-81L-4 25M3-81L4 25','none','#f8ecd1',1.8)+rect(-13,15,26,6,'#9e8d6d',2));
  const table = (x,y,s=1) => group(x,y,s,rect(-73,-8,146,14,'#baa983',6)+path('M-57 7V42M57 7V42','none','#a18f73',8));
  const sheep = (x,y,s=1) => group(x,y,s,ellipse(0,0,18,12,'#f7f2de')+circle(17,-4,8,'#d3c9ac')+path('M-9 8V20M9 9V21','none','#a69b83',3));
  const horse = (x,y,s=1) => group(x,y,s,ellipse(0,0,30,16,'#bba786')+path('M14-2L25-42L40-44L48-24L34-19L25 11Z','#bba786')+path('M-17 9L-23 35M13 10L20 35M-28-2Q-50-8-43 22','none','#9a907a',6)+path('M25-37L30-52L37-40','#918974'));
  const goose = (x,y,s=1) => group(x,y,s,ellipse(0,2,14,7,'#f5f4e7')+path('M9-1Q19-3 16-16Q22-18 24-10Q24 2 12 6','#f5f4e7')+path('M21-12L32-9L22-6Z','#c9a46c')+path('M-2 0Q-12-19-33-17Q-23-2-11 3','#ced6c4'));
  function bookCover() {
    return `<svg viewBox="0 0 280 190" xmlns="http://www.w3.org/2000/svg" fill="none">${ellipse(142,163,94,11,'#869e7020')}${circle(141,87,72,'#e8e6d1')}${cloud(158,30,.54)}${circle(82,41,17,'#e3c783')}${group(140,154,1.05,book(0,0,1))}${path('M145 141Q158 92 189 82M166 111Q165 86 174 70','none','#81986d',3)}${path('M166 112Q139 87 146 78Q169 82 166 112M178 94Q186 68 205 72Q201 92 178 94','#98b084')}${flower(188,78,.7,'#d4a494')}${bird(207,57,.55)}${rect(45,112,10,47,'#b5bca0',2)}${path('M45 112L50 100L55 112Z','#a59675')}</svg>`;
  }
  function illustration(poem) {
    const scene=poem.scene, text=poem.verses.map(v=>v.text).join(''), n=poem.number, id='poetry-art-'+poem.id;
    const winter=scene==='snow'||/白雪|大雪|霜雪|积雪/.test(text), autumn=scene==='autumn'||/秋叶|落木|落叶|木落/.test(text);
    const night=['moon','stars','window','letters','fire'].includes(scene)||(!['spring','flowers','plum','beans','kitchen','painting'].includes(scene)&&/月明|明月|月照|秋月|月光|夜泊/.test(text));
    const water=['river','farewell','sunset','lake','geese','sea','snow','rain','moon','stars','frontier','village','travel'].includes(scene);
    let art=rect(0,0,640,400,`url(#${id}-sky)`)+circle(500,scene==='sunset'?205:76,night?28:32,night?'#fff0c7':'#ead29a');
    art+=cloud(74,43,.86)+cloud(324,33,.56);
    if(night) art+=[[65,30],[232,60],[357,93],[567,153],[425,30],[155,111]].map(([x,y])=>circle(x,y,2,'#f8f1d1')).join('');
    art+=path(`M0 251Q72 ${125+n%36} 157 239Q234 119 341 235Q457 ${133+n%27} 640 232V400H0Z`,night?'#a4b6ad':'#c6d4bc');
    art+=path('M0 297Q115 199 225 272Q356 188 454 270Q550 216 640 268V400H0Z',winter?'#eff1e6':night?'#8da89d':'#aebe9f');
    art+=water?path('M0 307Q169 275 320 306Q493 343 640 279V400H0Z',winter?'#d4e0dc':'#d4e2d5')+path('M18 336Q156 313 307 341M321 365Q489 378 620 345M40 379Q120 363 195 380','none','#edf1de',3):path('M0 329Q180 291 366 327Q519 298 640 327V400H0Z',winter?'#f9f7ed':'#e3e7cc');
    switch(scene){
      case 'beans':
        art=rect(0,0,640,400,'#f4f0df')+circle(317,193,145,'#e5e8cd')+path('M220 341Q262 205 438 77M292 210Q244 125 224 105M350 149Q410 152 456 177','none','#8ca173',6);
        [[267,272,-30],[302,213,22],[360,138,24],[407,105,-15],[264,155,-30]].forEach(([x,y,r])=>{art+=`<g transform="rotate(${r} ${x} ${y})">${ellipse(x,y,31,15,'#a0b488')}</g>`;});
        [[276,156],[327,217],[380,150],[431,177],[285,283],[428,99]].forEach(([x,y])=>{art+=ellipse(x,y,13,17,'#bc7060')+ellipse(x-4,y-5,3,5,'#e8c4a0');});
        art+=ellipse(432,335,70,12,'#dfd6b8')+path('M371 317Q428 373 494 317Z','#d6bb92')+ellipse(434,318,64,15,'#f1dfbb')+[[401,318],[425,315],[448,320],[469,315]].map(([x,y])=>ellipse(x,y,9,6,'#bc7060')).join('');break;
      case 'plum':case 'flowers':
        art+=path('M123 402Q143 272 330 150Q400 104 512 110M268 198Q222 139 246 73M361 134Q375 76 369 46','none','#9b8a72',9);
        [[250,94],[257,153],[321,155],[374,97],[418,116],[478,109],[210,242],[313,213]].forEach(([x,y],i)=>{art+=flower(x,y,i%2?.83:1.15,scene==='plum'?'#d5a398':'#d9a28c');});
        art+=butterfly(442,208,1.05)+path('M232 347Q263 321 290 343Q265 363 232 347','#dcc3a1');if([287,288,289].includes(n))art+=pavilion(500,338,.52);break;
      case 'window':case 'letters':
        art=rect(0,0,640,400,'#ece5d0')+rect(53,53,303,232,'#a5bbb2',8)+circle(275,110,29,'#fff0c7')+path('M59 233Q146 148 251 230Q306 188 350 222V280H59Z','#809f93')+path('M63 56H348V279H63ZM62 196H349M170 55V279','none','#b9a782',10)+path('M47 44Q105 117 58 302L24 302Q58 161 35 45Z','#d0c7a6')+path('M363 43Q330 178 371 300L403 298Q361 185 378 43Z','#d0c7a6')+rect(0,333,640,67,'#d8cfaf');
        art+=table(453,316,1.05)+person(465,245,.95,'#9eaf9a')+candle(397,306)+book(512,309,.45);
        if(scene==='letters')art+=path('M422 302L465 296L478 311L434 318Z','#fffae9')+path('M427 302L451 311L466 298','none','#c5b79a',1.5)+bird(300,157,.6,'#edf0d8');
        if(n===311)art+=bird(127,85,.5)+bird(153,81,.5);break;
      case 'kitchen':
        art=rect(0,0,640,400,'#f1e9d6')+rect(59,59,170,155,'#c7d7bd',5)+path('M65 207Q153 137 223 192V210H65Z','#a1b799')+path('M57 58H230V216H57ZM142 61V213M60 136H227','none','#bba780',7)+rect(0,319,640,81,'#ddd4b5')+table(346,282,1.38)+person(429,203,1.24,'#9cae97')+candle(271,267);
        if([199,302,313].includes(n)) art+=path('M314 252L343 223L367 232L387 218L415 251L391 266L381 254L381 296H339V260L328 269Z','#d2ac92')+path('M362 237L361 285','none','#f7e7cc',2)+ellipse(315,258,15,10,'#b5bc96')+path('M305 238L321 275M329 246Q343 257 319 274','none','#8f9d81',2)+path('M483 313Q518 282 546 313L550 343H479Z','#c2b38e');
        else art+=path('M312 247H388L378 283H322Z','#a8b797')+ellipse(350,247,41,8,'#d8c5a0')+path('M333 230Q321 218 335 201M361 231Q351 219 364 207','none','#fff9e9',4)+ellipse(400,279,19,6,'#e0d4b5');break;
      case 'forest':
        art+=tree(112,343,1.8,autumn)+tree(561,339,1.8,autumn)+tree(443,287,.85,autumn)+path('M227 400Q278 321 329 275L340 280Q312 346 330 400Z','#e8e4c9');
        if(n===318) art+=path('M270 356L285 302L330 294L364 350Z','#a6b6a2')+path('M317 311L372 263','none','#a69475',3)+path('M356 268L370 261L363 278Z','#f8f5e8');else art+=person(314,300,.57,'#b7ae87');break;
      case 'bamboo': art+=bamboo(110,382,1.7)+bamboo(531,371,1.6)+bamboo(182,298,.7)+person(371,281,1.08,'#99ada0')+qin(308,346,.57);break;
      case 'palace':
        art+=rect(63,242,521,105,'#e8ddc0')+path('M50 243L86 218H566L592 243Z','#94a088')+pavilion(318,331,1.12,true)+tree(72,354,1.15,autumn)+tree(578,357,1.05,autumn)+path('M264 400L291 350H348L389 400Z','#cec5a7')+person(453,303,.63,'#aeb697');
        if(n===250)art+=bird(458,113,.76)+bird(487,101,.7);break;
      case 'tower':
        art+=pavilion(203,330,1.18,true)+path('M98 366H311','none','#bec5a7',9)+boat(499,345,.61,true)+tree(70,355,.9,autumn)+person(202,209,.48,'#b6a783');if(n===201)art+=flower(73,354,.6,'#dfc578')+flower(89,342,.75,'#dfc578');break;
      case 'temple':
        art+=pavilion(355,302,1.03)+house(483,310,.76)+pine(126,345,1.5)+pine(574,326,1.24)+path('M277 395L316 321H385L421 395Z','#d2cfb3')+path('M298 352H397M287 372H410','none','#e6dfc2',5)+person(322,312,.55,'#a6ac8b');
        if(n===234)art+=book(380,350,.38);if(n===274)art+=path('M30 356Q90 295 89 236Q49 254 30 356M44 321Q9 246 29 211Q61 241 44 321','#a0b591');break;
      case 'history':case 'battlefield':
        art+=pavilion(332,305,.93)+rect(170,241,61,99,'#c0baa1',9)+path('M181 260H220M181 274H215M181 288H220M181 302H213','none','#9da48e',2)+tree(100,360,1.25,true)+reeds(529,382,1.1)+person(450,308,.79,'#9dae97');
        if(n===273)art+=rect(287,293,61,53,'#c5c0a7',20)+path('M303 305V331M316 304V332M328 305V329','none','#929e89',2);
        if(n===306)art+=person(487,312,.74,'#b8ae8e');break;
      case 'rain':
        art+=house(426,277,.96)+tree(126,330,1.2)+reeds(588,375,.9)+boat(320,355,.6,false);
        for(let i=0;i<29;i++){const x=25+(i*79)%599,y=40+(i*53)%230;art+=path(`M${x} ${y}l-8 20`,'none','#819f9a55',1.8);}
        if(n===167)art+=goose(247,292,.85)+bird(540,197,.65);break;
      case 'snow':
        art+=mountain(463,302,.65,true)+pine(100,321,1.15)+path('M100 166L56 224H80L42 264H156L116 224H139Z','#f7f8f0')+reeds(63,392,.7);
        if(n===254)art+=path('M187 400Q259 358 322 297','none','#aebfb0',6)+horse(317,297,.44)+[[214,384],[234,372],[252,360],[269,348]].map(([x,y])=>ellipse(x,y,4,2,'#a7b9af')).join('');
        else if(n===319)art+=horse(377,332,1.15)+goose(343,86,.75)+goose(387,65,.66);
        else art+=fishingBoat(363,353,.86);
        for(let i=0;i<28;i++)art+=circle(20+(i*73)%605,31+(i*59)%276,2,'#fffdf1');break;
      case 'frontier':
        art+=path('M55 308V220H82V211H104V220H127V211H150V220H173V211H197V220H219V311Z','#c6baa0')+path('M108 308V273Q137 241 165 273V308Z','#8d9f92')+path('M210 228L541 274V302L210 269Z','#b7b299')+path('M278 252V183','none','#a19676',4)+path('M278 183L338 195L278 217Z','#c89478')+mountain(469,248,.52,winter)+reeds(567,389,.85);
        if([205,280,285].includes(n))art+=horse(351,336,.95);else art+=person(373,311,.86,'#a4ad8e');if(n===205)art+=sheep(493,344,.75)+sheep(535,334,.65);break;
      case 'music':
        art+=path('M45 324Q282 286 592 325V397H45Z','#e3dbc0')+table(338,301,1.3)+person(333,218,1.15,'#9bae99')+tree(92,339,1.1,autumn)+candle(417,289);
        if([251,296].includes(n))art+=pipa(331,276,.9)+boat(538,354,.67);else if(n===261)art+=path('M309 251L361 207','none','#c7aa79',10)+path('M325 237L348 219','none','#716f5b',2);else art+=qin(332,286,1);
        if(n===179)art+=butterfly(449,185,.9);if(n===266)art+=person(493,264,1.26,'#cda899')+path('M471 307Q442 235 470 199M516 302Q553 257 547 228','none','#d9b7a4',14);break;
      case 'painting':
        art=rect(0,0,640,400,'#efead7')+rect(85,53,470,274,'#ddd3b1',7)+rect(101,67,438,246,'#fff8e6',3)+rect(77,45,489,13,'#b4a180',5)+rect(77,324,489,13,'#b4a180',5)+mountain(212,250,.45)+horse(284,226,1.3)+horse(430,247,.85)+path('M113 280Q252 241 521 283','none','#cdd4b5',2)+table(422,375,.87)+rect(445,334,29,33,'#c4b38c',4)+path('M452 338L446 315M461 338L468 311','none','#82977e',4)+ellipse(373,367,20,7,'#8f9e8b');break;
      case 'banquet':
        art+=pavilion(329,306,1.85)+table(326,320,1.03)+person(211,266,1,'#91a996')+person(437,269,1,'#b9ac8b')+person(325,238,.75,'#a6b697')+book(326,309,.39)+ellipse(286,313,20,6,'#e8d4a5')+ellipse(375,313,21,7,'#c2c5a2')+lantern(210,153,.7)+lantern(445,153,.7);
        if(n===320)art+=rect(526,292,48,51,'#c1a47e',8)+ellipse(550,292,25,8,'#eddbb9')+path('M566 282L588 260M552 282L534 255','none','#a09070',4);break;
      case 'fire': art+=house(456,276,.9)+table(314,319,.82)+person(223,270,.85,'#a6ad90')+person(409,269,.85,'#b5a68a')+rect(306,317,33,31,'#b9a180',4)+path('M312 340Q302 325 325 310Q334 328 329 340Z','#d49c68')+ellipse(314,307,21,7,'#9eae97');break;
      case 'village':case 'homecoming':
        art+=house(406,305,1.03)+house(540,284,.65)+tree(117,355,1.33,autumn)+path('M289 400L386 311H418L383 400Z','#e9debb')+person(415,305,.74,'#a0b496')+person(331,334,.75,'#b7a98c')+reeds(590,394,.7);
        if(n===216)art+=sheep(247,346,.8)+sheep(270,355,.6);
        if(n===286)art+=boat(210,364,.65)+flower(102,206,.8)+flower(143,222,.7)+flower(71,259,.9);
        if(n===161)art+=path('M462 329L482 314L501 329L493 344L487 338V359H469V337Z','#b8a38a');
        if(n===297)art+=butterfly(321,240,.7)+butterfly(350,222,.6);break;
      case 'trees': art+=tree(265,359,1.92,autumn)+tree(449,341,1.05)+person(92,313,.69,'#b9ac8d');if(n===247)art+=[[218,155],[268,136],[309,175],[210,224],[362,207]].map(([x,y])=>circle(x,y,9,'#d5a370')).join('');if(n===312)art+=goose(471,357,.75)+goose(518,366,.72);break;
      case 'mountains':
        art+=mountain(351,355,1.13,winter)+mountain(80,348,.68,winter)+path('M482 397Q342 368 364 319Q410 270 370 233Q357 196 373 163','none','#eee8ce',10)+pine(547,375,.91)+person(440,367,.49,'#c2ae87')+bird(277,127,.72);
        if([256,298].includes(n))art+=path('M224 166Q251 230 224 289Q222 318 260 356','none','#ecf3e5',13);if(n===257)art+=pavilion(527,151,.43);break;
      case 'birds': art+=tree(418,361,1.53)+bird(195,129,1.2)+goose(251,237,.85)+person(124,307,.84,'#b7b78d');break;
      case 'geese': art+=reeds(114,384,1.1)+goose(245,230,1.12)+[[404,153],[443,140],[483,150],[518,132]].map(([x,y])=>bird(x,y,.7)).join('')+tree(567,299,.56,true);break;
      case 'spring': art+=tree(490,335,1.27)+house(220,290,.92)+flower(429,196,.7)+flower(530,200,.8)+bird(381,170,.73)+bird(414,182,.63)+person(303,299,.75,'#b3b48e');if(n===299)art+=ellipse(323,337,16,10,'#c4ac81');break;
      case 'autumn': art+=tree(110,359,1.5,true)+tree(537,318,.9,true)+person(249,317,.89,'#a2ad92')+boat(430,350,.62,true)+[[201,249],[254,288],[185,310],[320,331]].map(([x,y])=>path(`M${x} ${y}q16-11 20 0q-14 12-20 0`,'#d2b189')).join('')+bird(390,124,.75)+bird(427,108,.7);break;
      case 'farewell': art+=tree(106,334,1.35,autumn)+path('M0 340Q126 310 242 343L303 400H0Z','#e4e4c8')+person(163,304,.94,'#98af98')+person(223,297,1.01,'#c3ae8a')+boat(456,347,.86,true)+reeds(40,393,.75);break;
      case 'sea': art+=boat(325,346,1.25,true)+path('M10 354Q56 336 90 354T175 354M414 376Q466 354 511 376T636 376','none','#f4f4dd',5)+bird(194,167,.79);break;
      case 'lake': art+=lotus(180,352,1.14)+lotus(484,362,.95)+lotus(89,315,.6)+boat(354,318,.79)+bamboo(568,326,.87);if(n===231)art+=qin(543,363,.52);break;
      case 'travel': art+=path('M252 400Q272 316 320 274L344 274Q319 341 351 400Z','#e9debb')+person(299,309,.85,'#b3ac88')+tree(542,326,1.22,autumn)+boat(158,360,.55,true);break;
      case 'moon':case 'stars': art+=boat(298,354,.84,true)+tree(78,337,1.2,autumn)+reeds(565,383,1)+ellipse(498,330,28,3,'#f9f1cf')+ellipse(498,342,40,3,'#f2eed2')+ellipse(498,357,26,2,'#f9f1cf');if(n===223)art+=person(192,307,1,'#b0ab85')+ellipse(217,372,33,9,'#879c8133')+flower(143,319,.7);break;
      case 'sunset': art+=pavilion(490,317,.82)+boat(299,354,.83,true)+tree(79,344,1.3,true)+bird(377,146,.7)+bird(410,129,.7);break;
      default: art+=tree(88,344,1.33,autumn)+boat(358,351,.88,n%2===0)+reeds(564,382,1)+bird(266,167,.8);break;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-labelledby="${id}-title" data-poetry-scene="${esc(scene)}"><title id="${id}-title">${esc(poem.title)}：${esc(poem.pictureCaption)}</title><defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${night?'#809f9c':'#edeedc'}"/><stop offset="1" stop-color="${night?'#c8d5c0':'#faf1d7'}"/></linearGradient></defs>${art}<path d="M16 383H624" stroke="#d0d6b8" stroke-width="1" opacity=".5"/></svg>`;
  }
  return Object.freeze({illustration,bookCover,sceneNames:Object.freeze(names)});
})();
