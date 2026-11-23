const TAU = Math.PI * 2;
const chains = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
export class HarpRenderer {
  constructor(canvas, video) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.video=video;
    this.strings=[]; this.hands=[]; this.handsAt=0; this.particles=[]; this.vibrations=new Map(); this.showVideo=false; this.pointer=null;
    this.observer=new ResizeObserver(()=>this.resize()); this.observer.observe(canvas);
    this.reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame=requestAnimationFrame(t=>this.draw(t));
  }
  setNotes(notes){this.notes=notes;this.layout();this.vibrations.clear();}
  resize(){
    const r=this.canvas.getBoundingClientRect(); this.width=r.width;this.height=r.height;
    const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);this.dpr=dpr;
    this.scale=Math.min(r.width/1000,r.height/670);this.ox=(r.width-1000*this.scale)/2;this.oy=(r.height-670*this.scale)/2;
    this.layout();this.buildLayers();this.onResize?.();
  }
  layout(){
    if(!this.notes||!this.width)return;
    this.strings=this.notes.map((n,i)=>{const t=i/(this.notes.length-1),x=225+557*t,top=128+92*t-12*Math.sin(Math.PI*t),bottom=554-281*t;
      return {...n,cx:x,cyTop:top,cyBottom:bottom,x:(x*this.scale+this.ox)/this.width,top:(top*this.scale+this.oy)/this.height,bottom:(bottom*this.scale+this.oy)/this.height};});
  }
  path(ctx,d,fill,stroke,width=1){const p=new Path2D(d);if(fill){ctx.fillStyle=fill;ctx.fill(p);}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke(p);}}
  buildLayers(){
    const bg=document.createElement('canvas');bg.width=1000;bg.height=670;const c=bg.getContext('2d');
    c.fillStyle='#11201b';c.fillRect(0,0,1000,670);
    let g=c.createRadialGradient(530,250,10,500,280,650);g.addColorStop(0,'#29392b');g.addColorStop(.48,'#1a2b22');g.addColorStop(1,'#0c1b17');c.fillStyle=g;c.fillRect(0,0,1000,670);
    c.save();c.translate(230,-100);c.rotate(-.38);g=c.createLinearGradient(0,0,390,0);g.addColorStop(0,'#d2b87800');g.addColorStop(.5,'#dec48d0a');g.addColorStop(1,'#d2b87800');c.fillStyle=g;c.fillRect(0,0,390,900);c.restore();
    for(let i=0;i<18;i++){c.beginPath();c.ellipse(490,582+i*5,390+i*17,31+i*4,0,0,TAU);c.strokeStyle=`rgba(157,150,103,${.025-i*.0012})`;c.lineWidth=.8;c.stroke();}
    c.save();c.scale(1,.17);g=c.createRadialGradient(485,3400,20,485,3400,365);g.addColorStop(0,'#00000066');g.addColorStop(1,'#00000000');c.fillStyle=g;c.fillRect(0,2700,1000,1200);c.restore();
    // Subtle acoustic-hall grain, deterministic and local.
    let seed=771;for(let i=0;i<12000;i++){seed=(seed*16807)%2147483647;const x=seed%1000;seed=(seed*16807)%2147483647;const y=seed%670;c.fillStyle=i%2?'#e4d5ab05':'#0716100a';c.fillRect(x,y,1,1);}
    this.bg=bg;
    const hw=document.createElement('canvas');hw.width=1000;hw.height=670;const p=hw.getContext('2d');
    const gold=p.createLinearGradient(160,0,215,0);gold.addColorStop(0,'#775630');gold.addColorStop(.16,'#ae8751');gold.addColorStop(.4,'#e4c68c');gold.addColorStop(.56,'#ba975d');gold.addColorStop(.8,'#8b683a');gold.addColorStop(1,'#dbbd7e');
    const neck=p.createLinearGradient(0,70,0,240);neck.addColorStop(0,'#f0d49b');neck.addColorStop(.25,'#bb9357');neck.addColorStop(.5,'#93703f');neck.addColorStop(.75,'#cfad73');neck.addColorStop(1,'#6d4c2b');
    const wood=p.createLinearGradient(420,300,485,450);wood.addColorStop(0,'#492e22');wood.addColorStop(.18,'#86603d');wood.addColorStop(.34,'#b38b59');wood.addColorStop(.54,'#825532');wood.addColorStop(.85,'#432b1f');wood.addColorStop(1,'#6c462a');
    p.shadowColor='#0000005c';p.shadowBlur=16;p.shadowOffsetY=8;
    this.path(p,'M191 550 796 242Q827 238 849 274L273 604Q237 624 193 581Z',wood,'#9e7c4e',1.5);
    p.shadowBlur=0;p.shadowOffsetY=0;
    this.path(p,'M204 555 800 247 811 259 245 586Z','#be9d6b','#debd82',1);
    this.path(p,'M214 561 805 253',null,'#f0cc8b88',1.4);
    this.path(p,'M248 589 826 271',null,'#c29b6555',1);
    this.path(p,'M270 600 842 281',null,'#39251c',2);
    for(let i=0;i<11;i++)this.path(p,`M${252+i*1.9} ${586+i*1.4} L${815+i*2} ${264+i*1.4}`,null,i%2?'#e4b78016':'#2f1e1a30',.6);
    for(let i=0;i<5;i++){const x=327+i*86,y=564-i*47;p.save();p.translate(x,y);p.rotate(-.505);p.fillStyle='#201a13';p.beginPath();p.ellipse(0,0,13-i*.7,3.8,0,0,TAU);p.fill();p.strokeStyle='#bb94624d';p.lineWidth=.8;p.stroke();p.restore();}
    // Fluted pillar, capital and carved base.
    this.path(p,'M167 144Q187 136 208 144L207 535 164 535Z',gold,'#d0ad70',1);
    for(let i=0;i<6;i++){const x=170+i*6.3;this.path(p,`M${x} 160 Q${x+2} 340 ${x} 526`,null,i%2?'#62431c77':'#f5d49a55',1.2);}
    this.path(p,'M156 136Q185 124 218 134L214 153 158 153Z',neck,'#d8b77b',1);
    this.path(p,'M158 156 215 156',null,'#634a28',2);
    this.path(p,'M161 526 212 526 218 546 156 546Z',gold,'#d6b77f',1);
    this.path(p,'M152 544 218 544 235 565 144 565Z',neck,'#d2ac6e',1);
    this.path(p,'M143 564Q172 553 221 566L260 597Q219 611 169 598L135 579Z',gold,'#c5a16b',1.5);
    this.path(p,'M148 572Q178 563 218 574L243 594Q198 600 165 589Z','#7f5d33','#e0bf8155',1);
    // The knee joins the curved neck to the soundbox at the treble end.
    this.path(p,'M790 206Q831 200 838 231L846 265 812 264Q817 241 796 231Z',neck,'#be995f',1.4);
    this.path(p,'M807 219Q828 218 830 251',null,'#e4c78e99',1.7);
    // The neck and scroll close the acoustic triangle.
    p.shadowColor='#00000066';p.shadowBlur=10;p.shadowOffsetY=5;
    this.path(p,'M173 138Q142 94 176 76Q210 55 251 79C310 60 375 96 435 121S564 170 641 181Q748 205 805 193Q833 198 819 225Q746 238 634 208C554 188 493 169 431 145S306 98 246 114Q219 133 214 147Z',neck,'#c09c62',1.5);
    p.shadowBlur=0;p.shadowOffsetY=0;
    this.path(p,'M191 95Q205 69 246 91C318 78 368 106 431 132S567 182 641 192Q749 219 810 207',null,'#efd59caa',2);
    this.path(p,'M203 115Q222 91 250 101C320 88 377 117 438 140S572 189 647 200Q744 227 811 218',null,'#59422677',1.1);
    this.path(p,'M184 116C158 104 171 79 190 85S205 105 190 106C181 107 178 98 186 96',null,'#f0d59a',3);
    for(let i=0;i<32;i++){const t=i/31,x=242+t*551,y=124+94*t-10*Math.sin(Math.PI*t);p.beginPath();p.arc(x,y+3,2.2,0,TAU);p.fillStyle='#ddc397';p.fill();p.strokeStyle='#684922';p.lineWidth=.7;p.stroke();}
    // Engraved botanical details on the capital.
    for(let i=0;i<5;i++){let x=168+i*9;this.path(p,`M${x} 141q-6-12 0-15q6 3 0 15`,null,'#f3d8a177',.8);}
    this.path(p,'M180 479q-10-11 0-23q10 12 0 23m0 0v28m0-17q-13-10-14-1q3 8 14 7m0-13q13-9 14-1q-3 8-14 8',null,'#efd29a77',1);
    this.hardware=hw;
  }
  setHands(hands,at){this.hands=hands;this.handsAt=at;}
  pluck(id,velocity=.6,y){const s=this.strings.find(s=>s.id===id);if(!s)return;const now=performance.now();this.vibrations.set(id,{at:now,velocity,y:y??(s.top+s.bottom)/2});
    if(!this.reduceMotion)for(let i=0;i<7;i++)this.particles.push({x:s.cx,y:((y??(s.top+s.bottom)/2)*this.height-this.oy)/this.scale,vx:(Math.random()-.5)*35,vy:-12-Math.random()*40,at:now,life:450+Math.random()*500,r:.7+Math.random()*1.3});
  }
  hitTest(x,y){let nearest=null,d=Infinity;for(const s of this.strings){const dx=Math.abs(x-s.x);if(y>=s.top&&y<=s.bottom&&dx<d){nearest=s;d=dx;}}return d<Math.max(.01,.6/this.strings.length)?nearest:null;}
  draw(now){
    const c=this.ctx,w=this.width,h=this.height;if(!w||!h||!this.bg){this.frame=requestAnimationFrame(t=>this.draw(t));return;}
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#102019';c.fillRect(0,0,w,h);c.save();c.translate(this.ox,this.oy);c.scale(this.scale,this.scale);c.drawImage(this.bg,0,0);
    if(this.showVideo&&this.video.readyState>=2){c.globalAlpha=.16;c.save();c.translate((w-this.ox)/this.scale,0);c.scale(-1,1);c.drawImage(this.video,0,-this.oy/this.scale,w/this.scale,h/this.scale);c.restore();c.globalAlpha=1;}
    // Strings use the same geometry for rendering, mouse and camera collisions.
    for(const s of this.strings){const v=this.vibrations.get(s.id),age=v?(now-v.at)/1000:99,energy=v?Math.exp(-age*3.4)*v.velocity:0;const color=s.letter==='C'?'#d18a7b':s.letter==='F'?'#83b1ce':'#d7c49a';const mid=(s.cyTop+s.cyBottom)/2;const wave=this.reduceMotion?0:Math.sin(age*80)*energy*8;
      c.beginPath();c.moveTo(s.cx,s.cyTop);c.quadraticCurveTo(s.cx+wave,mid,s.cx,s.cyBottom);c.strokeStyle=color;c.globalAlpha=.65+energy*.35;c.lineWidth=(s.letter==='C'||s.letter==='F'?1.3:0.8)+(1-s.index/(this.strings.length-1))*.45;
      if(energy>.02){c.shadowColor=color;c.shadowBlur=energy*13;c.lineWidth+=energy*.7;}c.stroke();c.shadowBlur=0;c.globalAlpha=1;
      if(energy>.08){const y=(v.y*h-this.oy)/this.scale;c.beginPath();c.arc(s.cx,y,3+energy*6,0,TAU);c.fillStyle=`rgba(240,216,161,${energy*.65})`;c.fill();}
      if(age>2.5)this.vibrations.delete(s.id);
      if(s.letter==='C'||(this.strings.length<=22&&s.letter==='F')){c.font='10px Georgia';c.fillStyle=s.letter==='C'?'#b78b79':'#789aa1';c.textAlign='center';c.fillText(s.label,s.cx,s.cyBottom+19);}
    }
    c.drawImage(this.hardware,0,0);
    for(const s of this.strings)if(s.letter==='C'){c.save();c.translate(s.cx+26,s.cyBottom+35);c.rotate(-.505);c.font='10px Georgia';c.textAlign='center';c.fillStyle='#efe0bcaa';c.fillText(s.label,0,0);c.restore();}
    for(const p of this.particles){const age=(now-p.at)/1000;if(age*1000>p.life)continue;c.beginPath();c.arc(p.x+p.vx*age,p.y+p.vy*age+15*age*age,p.r*(1-age*1000/p.life),0,TAU);c.fillStyle=`rgba(240,211,152,${(1-age*1000/p.life)*.8})`;c.fill();}this.particles=this.particles.filter(p=>now-p.at<p.life);
    // Tiny suspended dust gives the light a quiet sense of depth.
    if(!this.reduceMotion)for(let i=0;i<18;i++){const x=280+(i*71.3)%510+Math.sin(now/6000+i)*8,y=120+(i*53.7+now*.003)%390;c.beginPath();c.arc(x,y,.65,0,TAU);c.fillStyle='#dbca991f';c.fill();}
    c.restore();
    if(now-this.handsAt<350)for(const hand of this.hands)this.drawHand(c,hand,w,h);
    if(this.pointer){c.beginPath();c.arc(this.pointer.x*w,this.pointer.y*h,5,0,TAU);c.strokeStyle='#e0c18b99';c.lineWidth=1;c.stroke();}
    this.frame=requestAnimationFrame(t=>this.draw(t));
  }
  drawHand(c,hand,w,h){
    const points=hand.landmarks;if(!points?.length)return;const color=hand.handedness==='Left'?'#c5d9bf':'#e4c286';
    c.lineWidth=1;c.strokeStyle=color+'50';c.beginPath();for(const chain of chains){c.moveTo(points[chain[0]].x*w,points[chain[0]].y*h);for(const i of chain.slice(1))c.lineTo(points[i].x*w,points[i].y*h);}c.stroke();
    const p=points[8],x=p.x*w,y=p.y*h;const g=c.createRadialGradient(x,y,1,x,y,22);g.addColorStop(0,color+'66');g.addColorStop(1,color+'00');c.fillStyle=g;c.beginPath();c.arc(x,y,22,0,TAU);c.fill();c.beginPath();c.arc(x,y,4,0,TAU);c.fillStyle='#fff2ce';c.fill();c.beginPath();c.arc(x,y,8,0,TAU);c.strokeStyle=color+'99';c.stroke();
    c.fillStyle=color+'99';c.font='9px sans-serif';c.fillText(hand.handedness==='Left'?'左手':'右手',x+12,y-10);
  }
}
