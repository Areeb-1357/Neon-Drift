
"use strict";
const $=id=>document.getElementById(id);
const TAU=Math.PI*2;
const rnd=(a=1,b)=>b===undefined?Math.random()*a:a+Math.random()*(b-a);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const dist=(a,b,c,d)=>Math.hypot(c-a,d-b);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const FONT='"Bahnschrift","Segoe UI Semibold",system-ui,sans-serif';
const PERF={reduced:(navigator.hardwareConcurrency||4)<=4||(navigator.deviceMemory||8)<=4,partStep:((navigator.hardwareConcurrency||4)<=4||(navigator.deviceMemory||8)<=4)?2:1};

const cv=$('c'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1,grid=null,bgCanvas=null,hurtGrad=null;
let G=null,P=null,picks={},best=0,state='menu',uid=0,choices=[];
const gridForces=[];

function compactLive(list){
  let write=0;
  for(let read=0;read<list.length;read++) if(list[read].life>0) list[write++]=list[read];
  list.length=write;
}
function compactUndead(list){
  let write=0;
  for(let read=0;read<list.length;read++) if(!list[read].dead) list[write++]=list[read];
  list.length=write;
}

// ================= Canvas / background =================
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2); W=innerWidth; H=innerHeight;
  cv.width=W*DPR; cv.height=H*DPR; cv.style.width=W+'px'; cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const sp=46, cols=Math.ceil(W/sp)+3, rows=Math.ceil(H/sp)+3;
  grid={sp,cols,rows,px:new Float32Array(cols*rows),py:new Float32Array(cols*rows)};
  bgCanvas=document.createElement('canvas'); bgCanvas.width=W; bgCanvas.height=H;
  const b=bgCanvas.getContext('2d');
  const g=b.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.8);
  g.addColorStop(0,'#0b1233'); g.addColorStop(1,'#02030b'); b.fillStyle=g; b.fillRect(0,0,W,H);
  const hues=[200,260,300,180,230];
  for(let i=0;i<6;i++){
    const x=rnd(W),y=rnd(H),r=rnd(220,480);
    const n=b.createRadialGradient(x,y,0,x,y,r);
    n.addColorStop(0,`hsla(${hues[i%5]},90%,50%,0.11)`); n.addColorStop(1,'transparent');
    b.fillStyle=n; b.fillRect(0,0,W,H);
  }
  hurtGrad=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.75);
  hurtGrad.addColorStop(0,'rgba(255,0,60,0)'); hurtGrad.addColorStop(1,'rgba(255,0,60,0.55)');
  if(P){ P.x=clamp(P.x,P.r,W-P.r); P.y=clamp(P.y,P.r,H-P.r); }
}
const stars=Array.from({length:PERF.reduced?120:220},()=>({x:Math.random()*3000,y:Math.random()*3000,z:Math.random()*2.4+0.3,tw:Math.random()*TAU}));

const glowCache={};
function glowImg(col){
  if(glowCache[col]) return glowCache[col];
  const s=64,c=document.createElement('canvas'); c.width=c.height=s;
  const g=c.getContext('2d'), gr=g.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.14,`rgba(${col},0.95)`);
  gr.addColorStop(0.45,`rgba(${col},0.22)`); gr.addColorStop(1,`rgba(${col},0)`);
  g.fillStyle=gr; g.fillRect(0,0,s,s); return glowCache[col]=c;
}
function drawGlow(x,y,r,col,a=1){ if(r<=0||a<=0) return; ctx.globalAlpha=Math.min(1,a); ctx.drawImage(glowImg(col),x-r,y-r,r*2,r*2); ctx.globalAlpha=1; }

// ================= Audio =================
let AC=null,master,mFilter,sfxBus,musBus,noiseBuf,muted=false,intensity=0.25,nextNoteT=0,musStep=0;
function initAudio(){
  if(AC){ if(AC.state==='suspended') AC.resume(); return; }
  try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
  const comp=AC.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=4; comp.connect(AC.destination);
  mFilter=AC.createBiquadFilter(); mFilter.type='lowpass'; mFilter.frequency.value=18000; mFilter.connect(comp);
  master=AC.createGain(); master.gain.value=0.7; master.connect(mFilter);
  sfxBus=AC.createGain(); sfxBus.gain.value=0.85; sfxBus.connect(master);
  musBus=AC.createGain(); musBus.gain.value=0.3; musBus.connect(master);
  noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);
  const d=noiseBuf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  nextNoteT=AC.currentTime+0.1; setInterval(schedule,25);
}
function setFilter(f){ if(mFilter) mFilter.frequency.setTargetAtTime(f,AC.currentTime,0.15); }
function toggleMute(){ muted=!muted; if(master) master.gain.setTargetAtTime(muted?0:0.7,AC.currentTime,0.05); }
const sfxLast={};
function canPlay(k,gap){ if(!AC||muted) return false; const t=AC.currentTime; if(sfxLast[k]!==undefined&&t-sfxLast[k]<gap) return false; sfxLast[k]=t; return true; }
function tone(f,d,type,v,sweep,t0){
  const t=t0||AC.currentTime, o=AC.createOscillator(), g=AC.createGain();
  o.type=type||'square'; o.frequency.setValueAtTime(f,t);
  if(sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20,f+sweep),t+d);
  g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0008,t+d);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t+d+0.02);
}
function nz(d,v,freq,type,bus,t0,endF){
  const t=t0||AC.currentTime, s=AC.createBufferSource(), f=AC.createBiquadFilter(), g=AC.createGain();
  s.buffer=noiseBuf; f.type=type||'lowpass'; f.frequency.setValueAtTime(freq,t);
  if(endF) f.frequency.exponentialRampToValueAtTime(endF,t+d);
  g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0008,t+d);
  s.connect(f); f.connect(g); g.connect(bus||sfxBus); s.start(t); s.stop(t+d+0.02);
}
const SFX={
  shoot(){ if(canPlay('shoot',0.05)) tone(900+rnd(80),0.06,'square',0.03,-500); },
  hit(){ if(canPlay('hit',0.035)) tone(220+rnd(60),0.05,'sawtooth',0.035,-120); },
  crit(){ if(canPlay('crit',0.06)) tone(1800,0.08,'square',0.035,-900); },
  boom(big){ if(canPlay(big?'bb':'boom',big?0.15:0.03)){ nz(big?1.3:0.35,big?0.5:0.2,big?2400:3000,'lowpass',null,0,80); tone(big?80:120,big?0.9:0.25,'sine',big?0.5:0.22,-50);} },
  hurt(){ if(canPlay('hurt',0.1)){ tone(160,0.25,'sawtooth',0.18,-100); nz(0.2,0.2,800);} },
  shield(){ if(canPlay('shield',0.1)) tone(600,0.15,'sine',0.12,600); },
  dash(){ if(canPlay('dash',0.08)) nz(0.25,0.16,600,'bandpass',null,0,4000); },
  level(){ if(!canPlay('lvl',0.2)) return; [523,659,784,1046].forEach((f,i)=>tone(f,0.28,'triangle',0.12,0,AC.currentTime+i*0.07)); },
  pick(){ if(canPlay('pick',0.03)) tone(1200+rnd(500),0.05,'sine',0.045,300); },
  zap(){ if(canPlay('zap',0.07)) nz(0.12,0.12,5000,'highpass'); },
  hole(){ if(canPlay('hole',0.3)){ tone(55,2.5,'sawtooth',0.18,-25); nz(2.5,0.15,300,'lowpass',null,0,60);} },
  chrono(){ if(canPlay('chr',0.3)) tone(1600,1.4,'sine',0.15,-1500); },
  alarm(){ if(!canPlay('alarm',0.6)) return; for(let i=0;i<4;i++) tone(440,0.3,'square',0.07,-200,AC.currentTime+i*0.4); },
  graze(){ if(canPlay('graze',0.05)) tone(2400,0.035,'sine',0.03); },
  eshot(){ if(canPlay('es',0.08)) tone(300,0.08,'triangle',0.035,200); },
};
const STEP=60/126/4, PROG=[45,45,41,43], BASS=[0,0,12,0,0,12,0,10,0,0,12,0,7,0,10,12], ARP=[0,7,12,15,19,15,12,7];
const mtof=n=>440*Math.pow(2,(n-69)/12);
function schedule(){ if(!AC) return; while(nextNoteT<AC.currentTime+0.12){ if(!muted) playStep(musStep,nextNoteT); nextNoteT+=STEP; musStep++; } }
function mv(f,t,d,type,v,cut){
  const o=AC.createOscillator(), g=AC.createGain(), fl=AC.createBiquadFilter();
  o.type=type; o.frequency.value=f; fl.type='lowpass';
  fl.frequency.setValueAtTime(cut,t); fl.frequency.exponentialRampToValueAtTime(180,t+d);
  g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+d);
  o.connect(fl); fl.connect(g); g.connect(musBus); o.start(t); o.stop(t+d+0.02);
}
function playStep(s,t){
  const i=s%16, root=PROG[Math.floor(s/16)%4];
  if(i%4===0){
    const o=AC.createOscillator(), g=AC.createGain();
    o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(40,t+0.14);
    g.gain.setValueAtTime(0.5*Math.min(1,intensity+0.3),t); g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
    o.connect(g); g.connect(musBus); o.start(t); o.stop(t+0.2);
  }
  if(intensity>0.4&&i%4===2) nz(0.04,0.06,7000,'highpass',musBus,t);
  if(intensity>0.4&&(i===4||i===12)) nz(0.14,0.12,1800,'bandpass',musBus,t);
  mv(mtof(root-12+BASS[i]),t,STEP*0.9,'sawtooth',0.16,300+intensity*900);
  if(intensity>0.3) mv(mtof(root+12+ARP[s%8]),t,STEP*0.8,'square',0.03,1200+intensity*2500);
  if(intensity>0.8&&i%2===0) mv(mtof(root+24+ARP[(s>>1)%8]),t,STEP*1.6,'sawtooth',0.02,3200);
}

// ================= Input =================
const keys={}, mouse={x:innerWidth/2,y:innerHeight/2,down:false};
addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
  initAudio();
  if(e.repeat){ keys[k]=true; return; }
  keys[k]=true;
  if(k==='shift') dash();
  if(k==='q') singularity();
  if(k==='r') phaseBurst();
  if(k==='f') fluxGuard();
  if(k==='e') chrono();
  if(k==='m') toggleMute();
  if(k==='escape'||k==='p') togglePause();
  if(state==='upgrade'){ if(k==='1'||k==='2'||k==='3') choose(+k-1); if(k==='r') reroll(); }
  if(state==='menu'&&k==='enter') startGame();
  if(state==='over'&&k==='enter') startGame();
});
addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
addEventListener('mousemove',e=>{ mouse.x=e.clientX; mouse.y=e.clientY; });
addEventListener('mousedown',e=>{ initAudio(); if(e.button===0) mouse.down=true; if(e.button===2) dash(); });
addEventListener('mouseup',e=>{ if(e.button===0) mouse.down=false; });
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; mouse.down=false; if(state==='play') togglePause(); });
addEventListener('resize',resize);

// ================= Data =================
const ETYPES={
  chaser:  {r:12,hp:3, spd:100,col:'255,60,110', sides:5,score:10,xp:3,dmg:12},
  dasher:  {r:11,hp:3, spd:70, col:'255,150,40', sides:3,score:15,xp:4,dmg:16},
  gunner:  {r:14,hp:5, spd:65, col:'80,255,160', sides:6,score:20,xp:5,dmg:10},
  swarm:   {r:6, hp:1, spd:175,col:'255,90,255', sides:3,score:4, xp:1,dmg:6},
  splitter:{r:19,hp:9, spd:55, col:'120,160,255',sides:4,score:25,xp:6,dmg:18},
  mini:    {r:8, hp:2, spd:125,col:'160,200,255',sides:4,score:5, xp:1,dmg:8},
  phaser:  {r:13,hp:6, spd:85, col:'170,255,255',sides:7,score:30,xp:7,dmg:14},
};
const WAVE_NOTES={2:'New enemy: chargers (they rush at you)',3:'New enemies: shooters and swarms',4:'New enemy: splitters (break into small ones)',6:'New enemy: teleporters (jump near you)'};
const AFFIX_LABEL={volatile:'explodes',swift:'fast',regen:'heals'};
const BOSS_NAMES=['BIG EYE','SPIN KING','DARK STAR','RED GIANT','CRYSTAL BOSS'];
const RAR=[{n:'Common',c:'#7fe9ff',w:60},{n:'Rare',c:'#7b93ff',w:28},{n:'Very rare',c:'#d36bff',w:10},{n:'Best',c:'#ffcf4a',w:3}];
const UPG=[
  {id:'rate',  i:'⟫',n:'Faster Shooting', d:'Shoot 20% faster',r:0,max:8,f:s=>s.fireRate*=1.2},
  {id:'dmg',   i:'✦',n:'More Damage',     d:'Bullets hit 35% harder',r:0,max:10,f:s=>s.dmg*=1.35},
  {id:'crit',  i:'◎',n:'Lucky Hits',      d:'More chance of a big hit that does extra damage',r:0,max:5,f:s=>{s.crit+=0.1;s.critMult+=0.5}},
  {id:'hull',  i:'⬢',n:'More Health',     d:'+30 max health and heal fully',r:0,max:6,f:()=>{P.maxHp+=30;P.hp=P.maxHp}},
  {id:'shield',i:'⛉',n:'Stronger Shield', d:'+25 shield and it refills faster',r:0,max:5,f:s=>{P.maxShield+=25;P.shield=P.maxShield;s.shieldRegen+=4}},
  {id:'speed', i:'➤',n:'Faster Ship',     d:'Move faster, dash is ready sooner',r:0,max:5,f:s=>{s.speed*=1.12;s.dashCd*=0.85}},
  {id:'magnet',i:'⊛',n:'Magnet',          d:'Pick up XP from farther away',r:0,max:4,f:s=>s.magnet*=1.6},
  {id:'multi', i:'⋔',n:'Extra Bullet',    d:'Shoot 1 more bullet each time',r:1,max:5,f:s=>s.multi++},
  {id:'pierce',i:'⇥',n:'Pass Through',    d:'Bullets go through 1 more enemy',r:1,max:4,f:s=>s.pierce++},
  {id:'bounce',i:'↯',n:'Bounce',          d:'Bullets bounce to 1 more enemy',r:1,max:4,f:s=>s.bounce++},
  {id:'homing',i:'⌖',n:'Aim Help',        d:'Bullets turn toward enemies',r:1,max:3,f:s=>s.homing++},
  {id:'leech', i:'♥',n:'Heal on Hit',     d:'Sometimes heal 1 when you hit',r:1,max:4,f:s=>s.lifesteal+=0.08},
  {id:'regen', i:'✚',n:'Self Repair',     d:'Heal a little every second',r:1,max:4,f:s=>s.regen+=1.5},
  {id:'size',  i:'●',n:'Big Bullets',     d:'Bigger bullets that hit a bit harder',r:1,max:3,f:s=>{s.size*=1.3;s.dmg*=1.15}},
  {id:'chain', i:'ϟ',n:'Lightning',       d:'Hits can zap 2 more enemies nearby',r:2,max:3,f:s=>s.chain+=2},
  {id:'drone', i:'◇',n:'Helper Ship',     d:'A small ship flies around you and shoots',r:2,max:4,f:s=>s.drones++},
  {id:'explo', i:'✺',n:'Exploding Bullets',d:'Every hit makes a small explosion',r:2,max:3,f:s=>s.explosive++},
  {id:'blade', i:'✧',n:'Spinning Blades', d:'2 blades spin around you and cut enemies',r:2,max:3,f:s=>s.orbitals+=2},
  {id:'nova',  i:'◌',n:'Dash Blast',      d:'Dashing hurts enemies near you',r:2,max:1,f:s=>s.dashNova=1},
  {id:'singu', i:'◉',n:'Bigger Black Hole',d:'Black hole is bigger, stronger and ready sooner',r:3,max:3,f:s=>s.hole++},
  {id:'barrage',i:'☄',n:'Bullet Storm',d:'+2 bullets, and they pass through and bounce',r:3,max:1,f:s=>{s.multi+=2;s.pierce++;s.bounce++}},
];

// ================= Run setup =================
function newRun(){
  uid=0; picks={};
  G={time:0,score:0,dispScore:0,wave:0,kills:0,combo:0,comboT:0,maxCombo:0,grazes:0,
     queue:[],spawnT:0,cleared:false,inter:0,boss:null,
  bullets:[],ebullets:[],enemies:[],parts:[],orbs:[],texts:[],rings:[],bolts:[],holes:[],lasers:[],hazards:[],after:[],pickups:[],
     shake:0,hitstop:0,flash:0,chrono:0,ws:1,pending:0,rerolls:2,dieT:0};
  P={x:W/2,y:H*0.6,vx:0,vy:0,r:13,hp:100,maxHp:100,shield:40,maxShield:40,shieldDelay:0,shieldHit:0,
     level:1,xp:0,xpNeed:15,fireCd:0,iframes:0,dashT:0,dashCd:0,holeCd:0,od:0,hue:190,aim:0,trail:[],
    droneAng:0,droneCd:[],dronePos:[],bladeAng:0,bladePos:[],dead:false,pulseCd:0,guardCd:0,guardT:0,
     s:{fireRate:6,dmg:1,bspeed:760,multi:1,spread:0.14,pierce:0,bounce:0,homing:0,crit:0.05,critMult:2,chain:0,
        drones:0,lifesteal:0,magnet:120,speed:1,dashCd:1.1,explosive:0,regen:0,shieldRegen:7,size:1,orbitals:0,hole:1,dashNova:0}};
}
function startGame(){
  initAudio(); newRun();
  ['menu','over','pause','upgrade'].forEach(id=>$(id).classList.remove('show'));
  $('hud').classList.remove('hide'); $('bossbar').classList.add('hide');
  document.body.classList.remove('chrono','low');
  state='play'; intensity=0.6; setFilter(18000);
  ring(P.x,P.y,'95,244,255',Math.max(W,H),1.4,3);
  nextWave();
}
function nextWave(){
  G.wave++; G.cleared=false; const w=G.wave;
  if(w%5===0){ G.queue=[]; spawnBoss(); }
  else{
    const pool=['chaser','chaser'];
    if(w>=2) pool.push('dasher'); if(w>=3) pool.push('gunner','swarm'); if(w>=4) pool.push('splitter'); if(w>=6) pool.push('phaser');
    G.queue=Array.from({length:6+w*3},()=>pick(pool));
    banner('Wave '+w, WAVE_NOTES[w]||(w>5?'Enemies are getting stronger':'Destroy all enemies'));
  }
  G.spawnT=1.2;
}
function spawnPos(){
  for(let k=0;k<25;k++){ const x=rnd(50,W-50), y=rnd(50,H-50); if(dist(x,y,P.x,P.y)>240) return [x,y]; }
  return [rnd(50,W-50),50];
}
function makeEnemy(type,x,y){
  const d=ETYPES[type], sc=1+(G.wave-1)*0.12;
  const e={id:++uid,type,x,y,vx:0,vy:0,r:d.r,hp:Math.ceil(d.hp*sc),col:d.col,sides:d.sides,spd:d.spd*(1+G.wave*0.015),
    score:d.score,xp:d.xp,dmg:d.dmg,rot:rnd(TAU),t:rnd(10),state:0,st:rnd(1,2.2),flash:0,spawn:0.6,elite:false,affix:null,dead:false,bladeT:0};
  if(type!=='swarm'&&type!=='mini'&&Math.random()<Math.min(0.3,G.wave*0.02)){
    e.elite=true; e.hp*=3; e.r*=1.35; e.score*=3; e.xp*=3; e.affix=pick(['volatile','swift','regen']);
    if(e.affix==='swift') e.spd*=1.4;
  }
  e.maxHp=e.hp; return e;
}
function spawnBoss(){
  const tier=G.wave/5, hp=Math.round(170*Math.pow(tier,1.55));
  const b={id:++uid,boss:true,type:'boss',name:BOSS_NAMES[(tier-1)%BOSS_NAMES.length],tier,x:W/2,y:-100,vx:0,vy:0,r:54,
    hp,maxHp:hp,col:'190,90,255',rot:0,rot2:0,t:0,phase:1,atkT:2.5,spiralT:0,sa:0,sAcc:0,volley:0,volleyT:0,
    spawn:0,flash:0,score:600*tier,xp:30+tier*15,dmg:22,entering:true,dead:false};
  G.boss=b; G.enemies.push(b);
  banner('Warning','Boss coming: '+b.name);
  $('bossname').textContent=b.name; $('bossbar').classList.remove('hide');
  SFX.alarm(); intensity=1; G.shake=18;
}

// ================= FX helpers =================
function addP(x,y,vx,vy,life,col,size,type,drag){
  if(G.parts.length>(PERF.reduced?850:1800)) return;
  G.parts.push({x,y,vx,vy,life,max:life,col,size:size||2,type:type||'spark',drag:drag===undefined?3:drag});
}
function ring(x,y,col,maxR,life,force){
  if(G.rings.length>30) G.rings.shift();
  G.rings.push({x,y,col,r:0,maxR,life,max:life,force:force||0});
}
function explode(x,y,col,n,scale){
  for(let k=0;k<n;k++){ const a=rnd(TAU), sp=rnd(80,440)*scale; addP(x,y,Math.cos(a)*sp,Math.sin(a)*sp,rnd(0.3,0.8),col,rnd(1.5,3),'spark',2.5); }
  for(let k=0;k<n/3;k++){ const a=rnd(TAU), sp=rnd(20,140)*scale; addP(x,y,Math.cos(a)*sp,Math.sin(a)*sp,rnd(0.5,1.1),col,rnd(5,12),'dot',2); }
  addP(x,y,0,0,0.25,'255,255,255',40*scale,'flash',0);
  ring(x,y,col,50*scale+40,0.5,scale*0.8);
  SFX.boom(scale>1.8);
  G.shake=Math.max(G.shake,5*scale);
}
function addText(x,y,v,crit,color){
  if(G.texts.length>90) G.texts.shift();
  const txt=typeof v==='number'?(v<10?(Math.round(v*10)/10).toString():Math.round(v).toString()):v;
  G.texts.push({x,y,txt,crit,color,life:crit?0.9:0.6,max:crit?0.9:0.6});
}
function banner(t,s){ const b=$('banner'); $('bT').textContent=t; $('bS').textContent=s||''; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); }
function comboMult(){ return Math.min(5,1+Math.floor(G.combo/8)*0.25); }
function holeCdMax(){ return 14*Math.pow(0.8,P.s.hole-1); }

// ================= Combat =================
function nearestEnemy(x,y,maxD,excl){
  let best=null,bd=maxD*maxD;
  for(const e of G.enemies){
    if(e.dead||e.spawn>0) continue;
    if(excl&&excl.includes(e.id)) continue;
    const d=(e.x-x)**2+(e.y-y)**2; if(d<bd){ bd=d; best=e; }
  }
  return best;
}
function firePlayer(){
  const s=P.s, n=s.multi;
  for(let i=0;i<n;i++){
    const a=P.aim+(i-(n-1)/2)*s.spread+rnd(-0.03,0.03);
    G.bullets.push({x:P.x+Math.cos(P.aim)*16,y:P.y+Math.sin(P.aim)*16,vx:Math.cos(a)*s.bspeed,vy:Math.sin(a)*s.bspeed,
      dmg:s.dmg,life:1.3,pierce:s.pierce,bounce:s.bounce,homing:s.homing,r:3.5*s.size,hit:[],drone:false});
  }
  for(let k=0;k<3;k++){ const a=P.aim+rnd(-0.4,0.4); addP(P.x+Math.cos(P.aim)*18,P.y+Math.sin(P.aim)*18,Math.cos(a)*rnd(150,300),Math.sin(a)*rnd(150,300),0.15,'255,220,140',1.5); }
  P.vx-=Math.cos(P.aim)*18; P.vy-=Math.sin(P.aim)*18;
  G.shake=Math.max(G.shake,1.2);
  SFX.shoot();
}
function hitEnemy(e,dmg,kx,ky,noProc){
  if(e.dead) return;
  const crit=Math.random()<P.s.crit; if(crit) dmg*=P.s.critMult;
  e.hp-=dmg; e.flash=0.07;
  const kb=e.boss?0:(e.elite?50:130); e.vx+=kx*kb; e.vy+=ky*kb;
  addText(e.x+rnd(-8,8),e.y-e.r,dmg,crit);
  for(let k=0;k<3;k++){ const a=Math.atan2(-ky,-kx)+rnd(-0.8,0.8); addP(e.x-kx*e.r,e.y-ky*e.r,Math.cos(a)*rnd(100,260),Math.sin(a)*rnd(100,260),0.25,'255,230,160',1.5); }
  crit?SFX.crit():SFX.hit();
  if(P.s.lifesteal>0&&P.hp<P.maxHp&&Math.random()<P.s.lifesteal) P.hp=Math.min(P.maxHp,P.hp+1);
  if(!noProc){
    if(P.s.chain>0&&Math.random()<0.35) chainArc(e,P.s.chain,dmg*0.7);
    if(P.s.explosive>0) nova(e.x,e.y,40+P.s.explosive*16,dmg*0.45*P.s.explosive,e,'255,170,60');
  }
  if(e.hp<=0) killEnemy(e,true);
}
function dmgRaw(e,a){ if(e.dead) return; e.hp-=a; e.flash=0.05; if(e.hp<=0) killEnemy(e,true); }
function nova(x,y,R,dmg,skip,col){
  ring(x,y,col,R,0.3,0.4); addP(x,y,0,0,0.15,col,R*0.8,'flash',0);
  for(const o of G.enemies){ if(o===skip||o.dead||o.spawn>0) continue; if(dist(x,y,o.x,o.y)<R+o.r) hitEnemy(o,dmg,0,0,true); }
}
function chainArc(from,count,dmg){
  let cur=from; const seen=[from.id];
  for(let i=0;i<count;i++){
    const nx=nearestEnemy(cur.x,cur.y,190,seen); if(!nx) break;
    const pts=[], segs=8;
    for(let k=0;k<=segs;k++){ const f=k/segs, j=(k===0||k===segs)?0:rnd(-12,12);
      const px=-(nx.y-cur.y), py=nx.x-cur.x, pl=Math.hypot(px,py)||1;
      pts.push([cur.x+(nx.x-cur.x)*f+px/pl*j, cur.y+(nx.y-cur.y)*f+py/pl*j]); }
    G.bolts.push({pts,life:0.2,max:0.2});
    seen.push(nx.id); const c=cur; cur=nx;
    hitEnemy(nx,dmg,(nx.x-c.x)/190,(nx.y-c.y)/190,true);
  }
  SFX.zap();
}
function killEnemy(e,byPlayer){
  if(e.dead) return; e.dead=true;
  if(e.boss) bossDeath(e);
  else explode(e.x,e.y,e.col,e.elite?40:18,e.elite?1.6:1);
  if(byPlayer){
    G.kills++; G.combo++; G.comboT=2.6; G.maxCombo=Math.max(G.maxCombo,G.combo);
    const pts=Math.round(e.score*comboMult()); G.score+=pts;
    if(e.elite||e.boss) addText(e.x,e.y-e.r-16,'+'+pts,true,'#7fffd4');
    P.od=Math.min(100,P.od+(e.boss?100:e.elite?10:2.5));
    const n=Math.min(30,Math.ceil(e.xp/2));
    for(let k=0;k<n;k++) G.orbs.push({x:e.x,y:e.y,vx:rnd(-170,170),vy:rnd(-170,170),v:e.xp/n,life:14,vac:false});
    if(Math.random()<(e.elite?0.3:0.025)) G.pickups.push({x:e.x,y:e.y,life:12,t:0});
    if(e.elite) G.hitstop=Math.max(G.hitstop,0.05);
    if(G.combo>0&&G.combo%25===0) banner(G.combo+' combo!','Points ×'+comboMult().toFixed(2));
  }
  if(e.type==='splitter') for(let k=0;k<3;k++){ const m=makeEnemy('mini',e.x+rnd(-10,10),e.y+rnd(-10,10)); m.spawn=0; m.vx=rnd(-220,220); m.vy=rnd(-220,220); G.enemies.push(m); }
  if(e.affix==='volatile') for(let k=0;k<12;k++) eShoot(e.x,e.y,k*TAU/12,140,{col:'255,210,80',dmg:8});
}
function bossDeath(b){
  for(let k=0;k<6;k++) explode(b.x+rnd(-45,45),b.y+rnd(-45,45),k%2?b.col:'255,255,255',50,2.4);
  ring(b.x,b.y,'255,255,255',Math.max(W,H),1.6,4);
  for(const eb of G.ebullets) addP(eb.x,eb.y,rnd(-40,40),rnd(-40,40),0.6,'255,220,120',6,'dot');
  G.ebullets.length=0; G.lasers.length=0;
  G.boss=null; $('bossbar').classList.add('hide'); intensity=0.6;
  G.hitstop=0.4; G.shake=40;
  banner('Boss defeated!',b.name);
  for(let k=0;k<2;k++) G.pickups.push({x:b.x+rnd(-40,40),y:b.y+rnd(-40,40),life:15,t:0});
}
function eShoot(x,y,a,sp,o={}){
  if(G.ebullets.length>900) return;
  G.ebullets.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:o.r||5,dmg:o.dmg||10,life:o.life||7,col:o.col||'255,60,200',grazed:false});
}
function damagePlayer(a){
  if(P.iframes>0||P.dead) return;
  P.shieldDelay=3;
  if(P.shield>0){ const s=Math.min(P.shield,a); P.shield-=s; a-=s; SFX.shield(); ring(P.x,P.y,'120,200,255',55,0.3,0.6); P.shieldHit=0.3; }
  if(a>0){
    P.hp-=a; SFX.hurt(); G.flash=0.5; G.shake=Math.max(G.shake,14); G.combo=Math.floor(G.combo/2);
    for(let k=0;k<14;k++){ const an=rnd(TAU); addP(P.x,P.y,Math.cos(an)*rnd(100,300),Math.sin(an)*rnd(100,300),0.4,'255,80,110',2); }
  }
  P.iframes=0.6;
  if(P.hp<=0) die();
}
function die(){
  P.dead=true; state='dying'; G.dieT=2.2;
  for(let k=0;k<4;k++) explode(P.x+rnd(-20,20),P.y+rnd(-20,20),k%2?'95,244,255':'255,255,255',50,2.6);
  ring(P.x,P.y,'95,244,255',Math.max(W,H),1.8,4);
  G.shake=35; intensity=0.2; setFilter(700);
  document.body.classList.remove('chrono');
}
function showGameOver(){
  state='over';
  const nb=G.score>best; best=Math.max(best,G.score);
  $('newbest').textContent=nb&&G.score>0?'New best score!':'';
  $('oScore').textContent=G.score.toLocaleString(); $('oWave').textContent=G.wave; $('oLvl').textContent=P.level;
  $('oKills').textContent=G.kills; $('oCombo').textContent=G.maxCombo;
  const t=Math.floor(G.time); $('oTime').textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');
  $('menuHi').textContent=best.toLocaleString();
  $('over').classList.add('show'); setFilter(2500);
  setTimeout(()=>$('retryBtn').focus(),50);
}

// ================= Abilities =================
function dash(){
  if(state!=='play'||P.dashCd>0||P.dead) return;
  let dx=0,dy=0;
  if(keys.w||keys.arrowup) dy--; if(keys.s||keys.arrowdown) dy++;
  if(keys.a||keys.arrowleft) dx--; if(keys.d||keys.arrowright) dx++;
  if(!dx&&!dy){ dx=Math.cos(P.aim); dy=Math.sin(P.aim); }
  const m=Math.hypot(dx,dy); P.vx=dx/m*1150; P.vy=dy/m*1150;
  P.dashT=0.16; P.iframes=Math.max(P.iframes,0.3); P.dashCd=P.s.dashCd;
  SFX.dash(); ring(P.x,P.y,'95,244,255',70,0.35,1);
  if(P.s.dashNova) nova(P.x,P.y,130,4*P.s.dmg,null,'95,244,255');
}
function singularity(){
  if(state!=='play'||P.holeCd>0||P.dead) return;
  const L=P.s.hole, dm=Math.max(1,P.s.dmg), life=3+L*0.6;
  G.holes.push({x:mouse.x,y:mouse.y,r:150+L*40,life,max:life,t:0,dps:(5+L*4)*dm,blast:(12+L*10)*dm});
  P.holeCd=holeCdMax(); SFX.hole(); ring(mouse.x,mouse.y,'170,90,255',220,0.5,-1);
}
function chrono(){
  if(state!=='play'||P.od<100||G.chrono>0) return;
  P.od=0; G.chrono=5.5; SFX.chrono(); setFilter(1300);
  banner('Slow time','Enemies move slowly');
  document.body.classList.add('chrono');
  ring(P.x,P.y,'63,255,210',Math.max(W,H),1,2);
}
function phaseBurst(){
  if(state!=='play'||P.pulseCd>0||P.dead) return;
  P.pulseCd=8.5; P.iframes=Math.max(P.iframes,0.5);
  const R=175;
  for(const b of G.ebullets) if(dist(b.x,b.y,P.x,P.y)<R) b.life=0;
  nova(P.x,P.y,R,10*P.s.dmg,null,'255,207,74');
  ring(P.x,P.y,'255,207,74',R,0.55,1.2); SFX.boom(false);
  banner('Phase burst','Bullets erased');
}
function fluxGuard(){
  if(state!=='play'||P.guardCd>0||P.dead) return;
  P.guardCd=12; P.guardT=1.8; P.iframes=Math.max(P.iframes,1.8); P.shield=Math.min(P.maxShield,P.shield+P.maxShield*0.45);
  ring(P.x,P.y,'127,233,255',110,0.7,1); SFX.shield(); banner('Flux guard','Damage blocked');
}

// ================= Upgrades / pause =================
function gainXp(v){
  P.xp+=v;
  while(P.xp>=P.xpNeed){ P.xp-=P.xpNeed; P.level++; P.xpNeed=Math.floor(P.xpNeed*1.3+5); G.pending++; }
  if(G.pending>0&&state==='play') openUpgrade();
}
function rollChoices(){
  const avail=UPG.filter(u=>(picks[u.id]||0)<u.max), out=[], lb=Math.min(2,G.wave*0.08);
  for(let k=0;k<3&&avail.length;k++){
    let tot=0; const ws=avail.map(u=>{ const w=RAR[u.r].w*(u.r>=2?1+lb:1); tot+=w; return w; });
    let x=Math.random()*tot, i=0; while(i<ws.length-1&&x>ws[i]){ x-=ws[i]; i++; }
    out.push(avail.splice(i,1)[0]);
  }
  return out;
}
function openUpgrade(){
  state='upgrade'; SFX.level(); choices=rollChoices();
  $('cards').innerHTML=choices.map((u,i)=>{
    const have=picks[u.id]||0;
    const pips=Array.from({length:u.max},(_,j)=>j<have?'◆':(j===have?'◈':'◇')).join('');
    return `<div class="card${u.r===3?' leg':''}" tabindex="0" style="--rc:${RAR[u.r].c}" data-i="${i}">
      <div class="rar">${RAR[u.r].n}</div><div class="ic">${u.i}</div><div class="nm">${u.n}</div>
      <div class="ds">${u.d}</div><div class="pips">${pips}</div><div class="kk">${i+1}</div></div>`;
  }).join('');
  $('cards').querySelectorAll('.card').forEach(c=>{
    c.onclick=()=>choose(+c.dataset.i);
    c.onkeydown=e=>{ if(e.key==='Enter') choose(+c.dataset.i); };
  });
  const rb=$('rerollBtn'); rb.textContent=`Show new choices (${G.rerolls} left) — R`; rb.disabled=G.rerolls<=0;
  $('upgrade').classList.add('show');
}
function choose(i){
  if(state!=='upgrade') return;
  const u=choices[i]; if(!u) return;
  u.f(P.s); picks[u.id]=(picks[u.id]||0)+1;
  $('upgrade').classList.remove('show');
  G.pending--; P.iframes=Math.max(P.iframes,0.8);
  ring(P.x,P.y,RAR[u.r].c==='#ffcf4a'?'255,207,74':'95,244,255',160,0.6,1.5);
  addText(P.x,P.y-30,u.n,true,RAR[u.r].c);
  if(G.pending>0) openUpgrade(); else state='play';
}
function reroll(){ if(state!=='upgrade'||G.rerolls<=0) return; G.rerolls--; $('upgrade').classList.remove('show'); state='play'; G.pending>0&&openUpgradeNoSfx(); }
function openUpgradeNoSfx(){ const m=muted; muted=true; openUpgrade(); muted=m; }
function togglePause(){
  if(state==='play'){
    state='paused';
    const entries=Object.entries(picks);
    $('build').innerHTML=entries.length?entries.map(([id,n])=>{ const u=UPG.find(x=>x.id===id); return `<span style="border-color:${RAR[u.r].c}">${u.i} ${u.n}<em>×${n}</em></span>`; }).join(''):'<span>No power-ups yet</span>';
    $('pause').classList.add('show'); setFilter(900);
  } else if(state==='paused'){
    state='play'; $('pause').classList.remove('show'); setFilter(G.chrono>0?1300:18000);
  }
}
$('startBtn').onclick=startGame;
$('retryBtn').onclick=startGame;
$('resumeBtn').onclick=togglePause;
$('rerollBtn').onclick=reroll;
$('quitBtn').onclick=()=>{ $('pause').classList.remove('show'); P.hp=0; P.iframes=0; state='play'; die(); };

// ================= Update =================
function update(dt){
  G.time+=dt;
  if(G.chrono>0){ G.chrono-=dt; if(G.chrono<=0){ setFilter(18000); document.body.classList.remove('chrono'); } }
  G.ws+=((G.chrono>0?0.3:1)-G.ws)*Math.min(1,dt*8);
  if(G.hitstop>0){ G.hitstop-=dt; updateFx(dt*0.15); return; }
  const wdt=dt*G.ws;
  updatePlayer(dt);
  updateWaves(wdt);
  for(let i=0;i<G.enemies.length;i++) updateEnemy(G.enemies[i],wdt);
  separate();
  updateLasers(wdt);
  updateBullets(dt);
  updateEBullets(wdt);
  updateCompanions(dt);
  updateHoles(dt);
  updateOrbs(dt);
  compactUndead(G.enemies);
  G.comboT-=dt; if(G.comboT<=0) G.combo=0;
  updateFx(dt);
}
function updatePlayer(dt){
  let ix=0,iy=0;
  if(keys.w||keys.arrowup) iy--; if(keys.s||keys.arrowdown) iy++;
  if(keys.a||keys.arrowleft) ix--; if(keys.d||keys.arrowright) ix++;
  const m=Math.hypot(ix,iy)||1; ix/=m; iy/=m;
  const spd=290*P.s.speed;
  if(P.dashT>0){ P.dashT-=dt; G.after.push({x:P.x,y:P.y,a:P.aim,h:P.hue,life:0.3}); }
  else{ const k=1-Math.exp(-14*dt); P.vx+=(ix*spd-P.vx)*k; P.vy+=(iy*spd-P.vy)*k; }
  P.x+=P.vx*dt; P.y+=P.vy*dt;
  if(P.x<P.r||P.x>W-P.r){ P.x=clamp(P.x,P.r,W-P.r); P.vx*=-0.4; }
  if(P.y<P.r||P.y>H-P.r){ P.y=clamp(P.y,P.r,H-P.r); P.vy*=-0.4; }
  P.aim=Math.atan2(mouse.y-P.y,mouse.x-P.x);
  P.iframes=Math.max(0,P.iframes-dt); P.dashCd=Math.max(0,P.dashCd-dt); P.holeCd=Math.max(0,P.holeCd-dt);
  P.pulseCd=Math.max(0,P.pulseCd-dt); P.guardCd=Math.max(0,P.guardCd-dt); P.guardT=Math.max(0,P.guardT-dt);
  P.shieldHit=Math.max(0,P.shieldHit-dt); P.shieldDelay-=dt;
  if(P.shieldDelay<=0) P.shield=Math.min(P.maxShield,P.shield+P.s.shieldRegen*dt);
  if(P.s.regen) P.hp=Math.min(P.maxHp,P.hp+P.s.regen*dt);
  P.fireCd-=dt;
  if((mouse.down||keys[' '])&&P.fireCd<=0){ firePlayer(); P.fireCd=1/(P.s.fireRate*(G.chrono>0?1.5:1)); }
  if(ix||iy){
    P.hue=(P.hue+60*dt)%360;
    const back=Math.atan2(-P.vy,-P.vx)+rnd(-0.3,0.3);
    addP(P.x+Math.cos(back)*10,P.y+Math.sin(back)*10,Math.cos(back)*rnd(60,160),Math.sin(back)*rnd(60,160),0.3,'120,200,255',1.2);
  }
  P.trail.push({x:P.x,y:P.y}); if(P.trail.length>18) P.trail.shift();
}
function updateWaves(dt){
  if(G.queue.length){
    G.spawnT-=dt;
    if(G.spawnT<=0){
      const t=G.queue.shift(), [x,y]=spawnPos();
      if(t==='swarm') for(let k=0;k<5;k++) G.enemies.push(makeEnemy('swarm',x+rnd(-30,30),y+rnd(-30,30)));
      else G.enemies.push(makeEnemy(t,x,y));
      G.spawnT=Math.max(0.22,1-G.wave*0.035)*rnd(0.6,1.3);
    }
  } else if(!G.boss&&G.enemies.length===0){
    if(!G.cleared){
      G.cleared=true; G.inter=2.4;
      const bonus=100*G.wave; G.score+=bonus;
      banner('Wave cleared','+'+bonus+' points and some health back');
      for(const o of G.orbs) o.vac=true;
      P.hp=Math.min(P.maxHp,P.hp+P.maxHp*0.1);
    } else { G.inter-=dt; if(G.inter<=0) nextWave(); }
  }
}
function updateEnemy(e,dt){
  if(e.dead) return;
  if(e.boss){ updateBoss(e,dt); return; }
  e.t+=dt; e.rot+=dt*(e.type==='swarm'?6:1.6);
  if(e.flash>0) e.flash-=dt;
  if(e.spawn>0){ e.spawn-=dt; return; }
  const dx=P.x-e.x, dy=P.y-e.y, d=Math.hypot(dx,dy)||1, ux=dx/d, uy=dy/d;
  let tx=ux*e.spd, ty=uy*e.spd, resp=4;
  switch(e.type){
    case 'swarm':{ const w=Math.sin(e.t*5+e.id)*0.8; tx=(ux-uy*w)*e.spd; ty=(uy+ux*w)*e.spd; resp=3; break; }
    case 'dasher':
      if(e.state===0){ e.st-=dt; if(e.st<=0&&d<460){ e.state=1; e.st=0.55; e.dx=ux; e.dy=uy; } }
      else if(e.state===1){ tx=0; ty=0; resp=10; e.st-=dt; e.rot+=dt*14; if(e.st<=0){ e.state=2; e.st=0.38; e.vx=e.dx*720; e.vy=e.dy*720; SFX.dash(); } }
      else{ e.st-=dt; resp=0; addP(e.x,e.y,rnd(-30,30),rnd(-30,30),0.3,e.col,4,'dot'); if(e.st<=0){ e.state=0; e.st=rnd(1.3,2.4); } }
      break;
    case 'gunner':{
      const dir=e.id%2?1:-1;
      if(d<220){ tx=-ux*e.spd; ty=-uy*e.spd; } else if(d<320){ tx=-uy*e.spd*dir; ty=ux*e.spd*dir; }
      e.st-=dt;
      if(e.st<=0){
        e.st=rnd(1.5,2.3)*(e.elite?0.6:1);
        const a=Math.atan2(dy,dx);
        for(let k=-1;k<=1;k++) eShoot(e.x,e.y,a+k*0.18,230,{col:'80,255,160',dmg:9});
        addP(e.x+ux*e.r,e.y+uy*e.r,0,0,0.15,e.col,18,'flash',0); SFX.eshot();
      }
      break; }
    case 'phaser':
      e.st-=dt;
      if(e.st<=0){
        e.st=rnd(2.4,3.6);
        explode(e.x,e.y,e.col,10,0.6);
        const a=rnd(TAU), rr=rnd(170,250);
        e.x=clamp(P.x+Math.cos(a)*rr,30,W-30); e.y=clamp(P.y+Math.sin(a)*rr,30,H-30); e.vx=e.vy=0;
        ring(e.x,e.y,e.col,60,0.4,0.6);
        for(let k=0;k<8;k++) eShoot(e.x,e.y,k*TAU/8+e.t,150,{col:'170,255,255',dmg:8});
        SFX.zap(); return;
      }
      break;
  }
  if(resp>0){ const k=1-Math.exp(-resp*dt); e.vx+=(tx-e.vx)*k; e.vy+=(ty-e.vy)*k; }
  e.x=clamp(e.x+e.vx*dt,-40,W+40); e.y=clamp(e.y+e.vy*dt,-40,H+40);
  if(e.affix==='regen') e.hp=Math.min(e.maxHp,e.hp+e.maxHp*0.04*dt);
  if(!P.dead&&d<e.r+P.r){
    const ram=P.dashT>0||P.iframes>0.25;
    if(!ram) damagePlayer(e.dmg);
    if(ram){ addText(e.x,e.y-20,'Crash hit!',true,'#5ff4ff'); G.hitstop=Math.max(G.hitstop,0.03); }
    if(e.elite&&ram){ hitEnemy(e,6*P.s.dmg,ux*-1,uy*-1,true); } else killEnemy(e,ram);
  }
}
function separate(){
  const en=G.enemies, n=en.length; if(n>170) return;
  for(let i=0;i<n;i++){ const a=en[i]; if(a.dead||a.boss||a.spawn>0) continue;
    for(let j=i+1;j<n;j++){ const b=en[j]; if(b.dead||b.boss||b.spawn>0) continue;
      const dx=b.x-a.x, dy=b.y-a.y, rr=a.r+b.r;
      if(Math.abs(dx)>rr||Math.abs(dy)>rr) continue;
      const d=Math.hypot(dx,dy)||0.01; if(d<rr){ const p=(rr-d)*0.5/d; a.x-=dx*p; a.y-=dy*p; b.x+=dx*p; b.y+=dy*p; }
    } }
}
function updateBoss(b,dt){
  b.t+=dt; b.rot+=dt*0.6; b.rot2-=dt*1.1; if(b.flash>0) b.flash-=dt;
  if(b.entering){ b.y+=(H*0.28-b.y)*Math.min(1,dt*1.5); if(Math.abs(b.y-H*0.28)<4) b.entering=false; return; }
  const tx=W/2+Math.cos(b.t*0.35)*W*0.3, ty=H*0.3+Math.sin(b.t*0.6)*H*0.14;
  b.x+=(tx-b.x)*Math.min(1,dt*0.8); b.y+=(ty-b.y)*Math.min(1,dt*0.8);
  const f=b.hp/b.maxHp, ph=f>0.66?1:f>0.33?2:3;
  if(ph!==b.phase){
    b.phase=ph; b.col=ph===2?'255,130,60':'255,40,90';
    banner('Boss stage '+ph,b.name+' is getting angry');
    for(const eb of G.ebullets) addP(eb.x,eb.y,0,0,0.4,'255,255,255',5,'dot');
    G.ebullets.length=0;
    ring(b.x,b.y,'255,80,140',500,1.2,3); G.shake=22; SFX.alarm(); summon(b,4+ph*2);
    b.atkT=1.5; b.spiralT=0; b.volley=0;
  }
  if(b.spiralT>0){
    b.spiralT-=dt; b.sAcc+=dt;
    while(b.sAcc>0.055){ b.sAcc-=0.055; b.sa+=0.31; const arms=b.phase+1;
      for(let k=0;k<arms;k++) eShoot(b.x,b.y,b.sa+k*TAU/arms,150+b.phase*20,{col:'255,80,220'}); }
  }
  if(b.volley>0){
    b.volleyT-=dt;
    if(b.volleyT<=0){ b.volley--; b.volleyT=0.24; const a=Math.atan2(P.y-b.y,P.x-b.x);
      for(let k=-2;k<=2;k++) eShoot(b.x,b.y,a+k*0.13,260,{col:'255,200,80',r:6,dmg:12}); SFX.eshot(); }
  }
  b.atkT-=dt;
  if(b.atkT<=0&&b.spiralT<=0&&b.volley<=0){
    const pool=['spiral','burst','aimed']; if(b.phase>=2) pool.push('laser','summon','minefield'); if(b.phase>=3) pool.push('laser','spiral','gravity');
    const p=pick(pool);
    if(p==='spiral') b.spiralT=2.2;
    else if(p==='burst'){ const n=24+b.phase*4, o=rnd(TAU); for(let k=0;k<n;k++){ eShoot(b.x,b.y,o+k*TAU/n,175); eShoot(b.x,b.y,o+(k+0.5)*TAU/n,115,{col:'190,120,255'}); } SFX.eshot(); }
    else if(p==='aimed'){ b.volley=3+b.phase; b.volleyT=0; }
    else if(p==='laser'){ const n=b.phase===3?4:3, base=rnd(TAU), spin=(Math.random()<0.5?-1:1)*(0.5+b.phase*0.12);
      for(let k=0;k<n;k++) G.lasers.push({o:b,ang:base+k*TAU/n,spin,warn:1.1,life:2.6,w:16}); }
    else if(p==='minefield') minefield(b,4+b.phase);
    else if(p==='gravity') gravityWell(b);
    else summon(b,3+b.phase*2);
    b.atkT=b.phase===3?1.3:b.phase===2?1.8:2.3;
  }
  const d=dist(b.x,b.y,P.x,P.y);
  if(!P.dead&&d<b.r+P.r){ damagePlayer(b.dmg); const ux=(P.x-b.x)/(d||1), uy=(P.y-b.y)/(d||1); P.vx=ux*700; P.vy=uy*700; }
}
function summon(b,n){
  for(let k=0;k<n;k++){ const a=k*TAU/n, e=makeEnemy(Math.random()<0.5?'swarm':'chaser',b.x+Math.cos(a)*95,b.y+Math.sin(a)*95); e.spawn=0.4; G.enemies.push(e); }
  ring(b.x,b.y,'255,90,255',140,0.5,1);
}
function updateLasers(dt){
  for(const l of G.lasers){
    if(l.o.dead){ l.life=0; continue; }
    if(l.warn>0){ l.warn-=dt; l.ang+=l.spin*dt*0.3; continue; }
    l.life-=dt; l.ang+=l.spin*dt;
    const c=Math.cos(l.ang), s=Math.sin(l.ang), rx=P.x-l.o.x, ry=P.y-l.o.y, t=rx*c+ry*s, perp=Math.abs(-rx*s+ry*c);
    if(!P.dead&&t>0&&perp<l.w*0.5+P.r*0.6) damagePlayer(18);
    if(Math.random()<0.6){ const q=rnd(60,1200); addP(l.o.x+c*q,l.o.y+s*q,rnd(-60,60),rnd(-60,60),0.3,'255,80,140',2); }
  }
  compactLive(G.lasers);
}
function updateHazards(dt){
  for(const h of G.hazards){
    h.life-=dt; h.warn-=dt;
    const d=dist(P.x,P.y,h.x,h.y)||1;
    if(h.type==='gravity'&&h.warn<=0&&d<h.r){ const pull=(1-d/h.r)*420*dt; P.vx+=(h.x-P.x)/d*pull; P.vy+=(h.y-P.y)/d*pull; }
    if(h.warn<=0&&!h.hit&&d<h.r+P.r){ h.hit=true; damagePlayer(h.type==='mine'?26:20); explode(h.x,h.y,h.type==='mine'?'255,170,60':'170,100,255',PERF.reduced?10:18,1.2); }
    if(h.life<=0&&h.type==='mine'&&!h.hit) explode(h.x,h.y,'255,170,60',PERF.reduced?8:14,0.8);
  }
  compactLive(G.hazards);
}
function minefield(b,n){
  for(let k=0;k<n;k++){ const a=rnd(TAU), d=rnd(150,330); G.hazards.push({type:'mine',x:clamp(P.x+Math.cos(a)*d,36,W-36),y:clamp(P.y+Math.sin(a)*d,36,H-36),r:34,life:3.4,warn:1.25,hit:false}); }
  banner('Minefield','Keep moving'); SFX.alarm();
}
function gravityWell(b){
  G.hazards.push({type:'gravity',x:P.x,y:P.y,r:145,life:3.2,warn:0.9,hit:false});
  banner('Gravity well','Break away from the pull'); SFX.alarm();
}
function updateBullets(dt){
  for(const b of G.bullets){
    if(b.homing>0){
      const t=nearestEnemy(b.x,b.y,340,b.hit);
      if(t){ const sp=Math.hypot(b.vx,b.vy), cur=Math.atan2(b.vy,b.vx), want=Math.atan2(t.y-b.y,t.x-b.x);
        const df=(((want-cur)%TAU)+TAU*1.5)%TAU-Math.PI, turn=Math.sign(df)*Math.min(Math.abs(df),b.homing*5*dt);
        b.vx=Math.cos(cur+turn)*sp; b.vy=Math.sin(cur+turn)*sp; }
    }
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    if(b.x<0||b.x>W||b.y<0||b.y>H){
      if(b.bounce>0){ if(b.x<0||b.x>W) b.vx*=-1; else b.vy*=-1; b.x=clamp(b.x,0,W); b.y=clamp(b.y,0,H); b.bounce--;
        for(let k=0;k<4;k++) addP(b.x,b.y,rnd(-150,150),rnd(-150,150),0.2,'255,220,140',1.5); }
      else{ b.life=0; continue; }
    }
    for(const e of G.enemies){
      if(e.dead||e.spawn>0||b.hit.includes(e.id)) continue;
      const rr=e.r+b.r, ex=e.x-b.x, ey=e.y-b.y;
      if(Math.abs(ex)>rr||Math.abs(ey)>rr||ex*ex+ey*ey>rr*rr) continue;
      b.hit.push(e.id);
      const sp=Math.hypot(b.vx,b.vy)||1;
      hitEnemy(e,b.dmg,b.vx/sp,b.vy/sp,false);
      if(b.pierce>0) b.pierce--;
      else if(b.bounce>0){ const t=nearestEnemy(b.x,b.y,420,b.hit);
        if(t){ const a=Math.atan2(t.y-b.y,t.x-b.x); b.vx=Math.cos(a)*sp; b.vy=Math.sin(a)*sp; b.bounce--; b.life=Math.max(b.life,0.8); } else b.life=0; }
      else b.life=0;
      if(b.life<=0) break;
    }
  }
  compactLive(G.bullets);
}
function updateEBullets(dt){
  for(const b of G.ebullets){
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    if(b.x<-30||b.x>W+30||b.y<-30||b.y>H+30) b.life=0;
    if(P.dead||b.life<=0) continue;
    const d=dist(b.x,b.y,P.x,P.y);
    if(d<P.r*0.7+b.r){ if(P.iframes<=0){ damagePlayer(b.dmg); b.life=0; } }
    else if(!b.grazed&&d<P.r+22){
      b.grazed=true; G.grazes++; G.score+=5; P.od=Math.min(100,P.od+0.9); SFX.graze();
      addP(b.x,b.y,(b.x-P.x)*3,(b.y-P.y)*3,0.25,'255,255,255',1.5);
    }
  }
  compactLive(G.ebullets);
}
function updateCompanions(dt){
  const s=P.s;
  P.droneAng+=dt*1.6; P.dronePos.length=0;
  for(let k=0;k<s.drones;k++){
    const a=P.droneAng+k*TAU/s.drones, x=P.x+Math.cos(a)*44, y=P.y+Math.sin(a)*44;
    P.dronePos.push({x,y});
    P.droneCd[k]=(P.droneCd[k]===undefined?rnd(0.4):P.droneCd[k])-dt;
    if(P.droneCd[k]<=0){
      const t=nearestEnemy(x,y,480);
      if(t){ const an=Math.atan2(t.y-y,t.x-x);
        G.bullets.push({x,y,vx:Math.cos(an)*820,vy:Math.sin(an)*820,dmg:s.dmg*0.6,life:1,pierce:0,bounce:0,homing:0,r:3,hit:[],drone:true});
        P.droneCd[k]=0.35; } else P.droneCd[k]=0.1;
    }
  }
  P.bladeAng+=dt*4.5; P.bladePos.length=0;
  for(let k=0;k<s.orbitals;k++){
    const a=P.bladeAng+k*TAU/s.orbitals, x=P.x+Math.cos(a)*76, y=P.y+Math.sin(a)*76;
    P.bladePos.push({x,y,a});
    for(const e of G.enemies){
      if(e.dead||e.spawn>0||G.time<e.bladeT) continue;
      if(dist(x,y,e.x,e.y)<e.r+10){ e.bladeT=G.time+0.25; hitEnemy(e,s.dmg*1.5,Math.cos(a),Math.sin(a),true); }
    }
  }
}
function updateHoles(dt){
  for(const h of G.holes){
    h.life-=dt; h.t+=dt; const R=h.r;
    for(const e of G.enemies){
      if(e.dead||e.spawn>0) continue;
      const d=dist(e.x,e.y,h.x,h.y)||1;
      if(d<R){ const pull=(1-d/R)*(e.boss?25:300)*dt; e.x+=(h.x-e.x)/d*Math.min(pull,d); e.y+=(h.y-e.y)/d*Math.min(pull,d); e.rot+=dt*8;
        if(d<R*0.35) dmgRaw(e,h.dps*dt); }
    }
    for(const b of G.ebullets){
      const d=dist(b.x,b.y,h.x,h.y)||1;
      if(d<R){ const k=(1-d/R)*900*dt; b.vx+=(h.x-b.x)/d*k; b.vy+=(h.y-b.y)/d*k; if(d<16) b.life=0; }
    }
    for(const o of G.orbs){ const d=dist(o.x,o.y,h.x,h.y)||1; if(d<R){ o.vx+=(h.x-o.x)/d*400*dt; o.vy+=(h.y-o.y)/d*400*dt; } }
    for(let k=0;k<3;k++){ const a=rnd(TAU), rr=R*rnd(0.6,1);
      addP(h.x+Math.cos(a)*rr,h.y+Math.sin(a)*rr,-Math.cos(a)*rr*1.4-Math.sin(a)*rr*1.6,-Math.sin(a)*rr*1.4+Math.cos(a)*rr*1.6,0.6,k?'170,90,255':'255,120,220',1.6,'spark',0); }
    if(h.life<=0){
      for(const e of G.enemies){ if(!e.dead&&e.spawn<=0&&dist(e.x,e.y,h.x,h.y)<R+e.r) hitEnemy(e,h.blast,0,0,true); }
      explode(h.x,h.y,'200,120,255',60,2.2); ring(h.x,h.y,'255,255,255',R*2.5,0.9,3); G.shake=26;
    }
  }
  compactLive(G.holes);
}
function updateOrbs(dt){
  const k=Math.exp(-3*dt);
  for(const o of G.orbs){
    o.life-=dt; o.vx*=k; o.vy*=k;
    const d=dist(o.x,o.y,P.x,P.y)||1;
    if(!P.dead&&(o.vac||d<P.s.magnet)){ const a=(o.vac?2600:1700)*dt; o.vx+=(P.x-o.x)/d*a; o.vy+=(P.y-o.y)/d*a; o.life=Math.max(o.life,1); }
    o.x+=o.vx*dt; o.y+=o.vy*dt;
    if(!P.dead&&d<P.r+9){ o.life=0; SFX.pick(); addP(o.x,o.y,0,0,0.2,'255,220,90',10,'dot'); gainXp(o.v); }
  }
  compactLive(G.orbs);
  for(const p of G.pickups){
    p.life-=dt; p.t+=dt;
    if(!P.dead&&dist(p.x,p.y,P.x,P.y)<P.r+16){
      p.life=0; const h=Math.min(30,P.maxHp-P.hp); P.hp+=h; P.shield=P.maxShield;
      addText(P.x,P.y-28,'+'+Math.round(h)+' health',true,'#6fffa0'); ring(P.x,P.y,'111,255,160',90,0.5,1); SFX.shield();
    }
  }
  compactLive(G.pickups);
}
function updateFx(dt){
  for(const p of G.parts){ p.x+=p.vx*dt; p.y+=p.vy*dt; if(p.drag){ const k=Math.exp(-p.drag*dt); p.vx*=k; p.vy*=k; } p.life-=dt; }
  compactLive(G.parts);
  for(const r of G.rings){ r.life-=dt; const q=1-r.life/r.max; r.r=r.maxR*(1-Math.pow(1-q,3)); }
  compactLive(G.rings);
  for(const t of G.texts){ t.life-=dt; t.y-=40*dt; }
  compactLive(G.texts);
  for(const b of G.bolts) b.life-=dt; compactLive(G.bolts);
  for(const a of G.after) a.life-=dt; compactLive(G.after);
  G.shake=Math.max(0,G.shake-dt*45);
  G.flash=Math.max(0,G.flash-dt*1.5);
}

// ================= Render =================
function drawGrid(){
  if(PERF.reduced&&Math.floor(G.time*14)%2===1) return;
  const {sp,cols,rows,px,py}=grid;
  gridForces.length=0;
  const forces=gridForces;
  for(const r of G.rings) if(r.force) forces.push([r.x,r.y,r.r,r.force*(r.life/r.max),0]);
  for(const h of G.holes) forces.push([h.x,h.y,h.r*1.5,1,1]);
  if(state!=='menu'&&!P.dead) forces.push([P.x,P.y,100,0.3,2]);
  const off=(G.time*10)%sp;
  for(let j=0;j<rows;j++) for(let i=0;i<cols;i++){
    const x=(i-1)*sp-off, y=(j-1)*sp-off; let dx=0,dy=0;
    for(let f=0;f<forces.length;f++){
      const F=forces[f], vx=x-F[0], vy=y-F[1], d=Math.hypot(vx,vy)+0.001;
      if(F[4]===0){ const k=F[2]-d; if(k>-70&&k<70){ const s=(1-Math.abs(k)/70)*F[3]*20; dx+=vx/d*s; dy+=vy/d*s; } }
      else if(F[4]===1){ if(d<F[2]){ const s=(1-d/F[2]); dx-=vx*s*0.6; dy-=vy*s*0.6; } }
      else if(d<F[2]){ const s=(1-d/F[2])*F[3]*20; dx+=vx/d*s; dy+=vy/d*s; }
    }
    px[j*cols+i]=x+dx; py[j*cols+i]=y+dy;
  }
  ctx.beginPath();
  for(let j=0;j<rows;j++){ ctx.moveTo(px[j*cols],py[j*cols]); for(let i=1;i<cols;i++) ctx.lineTo(px[j*cols+i],py[j*cols+i]); }
  for(let i=0;i<cols;i++){ ctx.moveTo(px[i],py[i]); for(let j=1;j<rows;j++) ctx.lineTo(px[j*cols+i],py[j*cols+i]); }
  ctx.strokeStyle=G.chrono>0?'rgba(63,255,210,0.16)':'rgba(80,120,255,0.12)'; ctx.lineWidth=1; ctx.stroke();
}
function poly(n,r,star){
  ctx.beginPath();
  const m=star?n*2:n;
  for(let i=0;i<m;i++){ const a=i/m*TAU, rr=star&&i%2?r*0.55:r; ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr); }
  ctx.closePath();
}
function drawEnemy(e){
  const sp=e.spawn>0?clamp(1-e.spawn/0.6,0,1):1;
  if(e.spawn>0){
    ctx.strokeStyle=`rgba(${e.col},${sp})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(e.x,e.y,e.r*(3.5-2.5*sp),0,TAU); ctx.stroke();
    ctx.setLineDash([3,5]); ctx.beginPath(); ctx.arc(e.x,e.y,e.r*(1.5+sp),e.t*4,e.t*4+TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.globalCompositeOperation='lighter';
  drawGlow(e.x,e.y,e.r*3*sp,e.col,0.45);
  ctx.globalCompositeOperation='source-over';
  ctx.save(); ctx.translate(e.x,e.y); ctx.scale(sp,sp); ctx.rotate(e.rot);
  const star=e.type==='chaser'||e.type==='swarm';
  poly(e.sides,e.r,star);
  ctx.fillStyle=e.flash>0?'#fff':`rgba(${e.col},0.2)`; ctx.fill();
  ctx.strokeStyle=`rgb(${e.col})`; ctx.lineWidth=2; ctx.stroke();
  ctx.rotate(-e.rot*2); poly(e.sides,e.r*0.45,false);
  ctx.fillStyle=`rgb(${e.col})`; ctx.fill();
  ctx.restore();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(e.x,e.y,Math.max(1.5,e.r*0.14),0,TAU); ctx.fill();
  if(e.type==='dasher'&&e.state===1){
    ctx.strokeStyle=`rgba(255,60,60,${0.4+0.4*Math.sin(G.time*40)})`; ctx.lineWidth=2; ctx.setLineDash([8,6]);
    ctx.beginPath(); ctx.moveTo(e.x,e.y); ctx.lineTo(e.x+e.dx*270,e.y+e.dy*270); ctx.stroke(); ctx.setLineDash([]);
  }
  if(e.elite){
    ctx.strokeStyle='rgba(255,207,74,0.9)'; ctx.lineWidth=1.5; ctx.setLineDash([6,6]); ctx.lineDashOffset=-G.time*30;
    ctx.beginPath(); ctx.arc(e.x,e.y,e.r+7,0,TAU); ctx.stroke(); ctx.setLineDash([]);
    if(e.hp<e.maxHp){ const w=e.r*2.4;
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(e.x-w/2,e.y-e.r-16,w,4);
      ctx.fillStyle='#ffcf4a'; ctx.fillRect(e.x-w/2,e.y-e.r-16,w*Math.max(0,e.hp/e.maxHp),4); }
    ctx.font=`10px ${FONT}`; ctx.textAlign='center'; ctx.fillStyle='rgba(255,207,74,0.85)';
    ctx.fillText(AFFIX_LABEL[e.affix],e.x,e.y+e.r+18);
  }
}
function drawBoss(b){
  const pulse=1+Math.sin(b.t*4)*0.05;
  ctx.globalCompositeOperation='lighter';
  drawGlow(b.x,b.y,b.r*4,b.col,0.55);
  ctx.globalCompositeOperation='source-over';
  ctx.save(); ctx.translate(b.x,b.y);
  ctx.save(); ctx.rotate(b.rot); poly(8,b.r*pulse,true);
  ctx.fillStyle=b.flash>0?'rgba(255,255,255,0.8)':`rgba(${b.col},0.18)`; ctx.fill();
  ctx.strokeStyle=`rgb(${b.col})`; ctx.lineWidth=3; ctx.stroke();
  for(let k=0;k<8;k++){ ctx.rotate(TAU/8); ctx.fillStyle=`rgb(${b.col})`; ctx.fillRect(b.r*0.95,-3,10,6); }
  ctx.restore();
  ctx.save(); ctx.rotate(b.rot2); poly(6,b.r*0.62,false); ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=2; ctx.stroke();
  ctx.setLineDash([10,8]); ctx.beginPath(); ctx.arc(0,0,b.r*0.8,0,TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  const ea=Math.atan2(P.y-b.y,P.x-b.x);
  ctx.fillStyle='#08000f'; ctx.beginPath(); ctx.arc(0,0,b.r*0.34,0,TAU); ctx.fill();
  ctx.fillStyle=`rgb(${b.col})`; ctx.beginPath(); ctx.arc(Math.cos(ea)*b.r*0.14,Math.sin(ea)*b.r*0.14,b.r*0.15*pulse,0,TAU); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(Math.cos(ea)*b.r*0.17,Math.sin(ea)*b.r*0.17,b.r*0.05,0,TAU); ctx.fill();
  ctx.restore();
}
function shipPath(){
  ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(-2,5); ctx.lineTo(-12,15); ctx.lineTo(-8,4); ctx.lineTo(-13,0);
  ctx.lineTo(-8,-4); ctx.lineTo(-12,-15); ctx.lineTo(-2,-5); ctx.closePath();
}
function drawPlayer(){
  if(P.dead) return;
  const hue=P.hue;
  ctx.globalCompositeOperation='lighter';
  for(let i=1;i<P.trail.length;i++){ const a=P.trail[i-1], b=P.trail[i], f=i/P.trail.length;
    ctx.strokeStyle=`hsla(${hue},100%,60%,${f*0.35})`; ctx.lineWidth=f*10; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
  for(const af of G.after){ ctx.save(); ctx.translate(af.x,af.y); ctx.rotate(af.a); shipPath();
    ctx.strokeStyle=`hsla(${af.h},100%,65%,${af.life/0.3*0.5})`; ctx.lineWidth=2; ctx.stroke(); ctx.restore(); }
  drawGlow(P.x,P.y,42,'80,200,255',0.35);
  const blink=P.iframes>0&&P.dashT<=0&&Math.floor(G.time*24)%2===0;
  ctx.save(); ctx.translate(P.x,P.y); ctx.rotate(P.aim);
  const fl=8+Math.hypot(P.vx,P.vy)/30+rnd(4);
  drawGlow(-14,0,fl,'255,160,60',0.9); drawGlow(-14-fl*0.5,0,fl*0.7,'80,160,255',0.6);
  ctx.globalCompositeOperation='source-over';
  ctx.globalAlpha=blink?0.35:1;
  shipPath(); ctx.fillStyle='#071526'; ctx.fill();
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=5; ctx.stroke();
  ctx.strokeStyle=`hsl(${hue},100%,68%)`; ctx.lineWidth=2.2; ctx.stroke();
  ctx.fillStyle=`hsl(${(hue+40)%360},100%,78%)`; ctx.beginPath(); ctx.moveTo(11,0); ctx.lineTo(0,3); ctx.lineTo(0,-3); ctx.closePath(); ctx.fill();
  ctx.globalAlpha=1; ctx.restore();
  if(P.shield>0){
    const f=P.shield/P.maxShield;
    ctx.strokeStyle=`rgba(120,210,255,${0.12+0.3*f+(P.shieldHit>0?0.5:0)})`; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(P.x,P.y,P.r+10,0,TAU); ctx.stroke();
    ctx.setLineDash([4,6]); ctx.lineDashOffset=G.time*20;
    ctx.beginPath(); ctx.arc(P.x,P.y,P.r+14,-Math.PI/2,-Math.PI/2+TAU*f); ctx.stroke(); ctx.setLineDash([]);
  }
  if(P.guardT>0){ ctx.strokeStyle=`rgba(127,233,255,${0.45+P.guardT*0.3})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(P.x,P.y,P.r+19+Math.sin(G.time*16)*2,0,TAU); ctx.stroke(); }
  ctx.globalCompositeOperation='lighter';
  for(const d of P.dronePos){ drawGlow(d.x,d.y,14,'80,255,230',0.7);
    ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(G.time*3); ctx.strokeStyle='rgb(80,255,230)'; ctx.lineWidth=1.5; poly(4,6,false); ctx.stroke(); ctx.restore(); }
  for(const b of P.bladePos){ drawGlow(b.x,b.y,18,'255,90,200',0.6);
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.a+G.time*10); ctx.fillStyle='rgba(255,200,240,0.9)';
    ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(0,2.5); ctx.lineTo(-10,0); ctx.lineTo(0,-2.5); ctx.closePath(); ctx.fill(); ctx.restore(); }
  ctx.globalCompositeOperation='source-over';
}
function drawHoles(){
  for(const h of G.holes){
    const grow=Math.min(1,h.t*3)*Math.min(1,h.life*2), R=h.r*grow;
    ctx.globalCompositeOperation='lighter';
    drawGlow(h.x,h.y,R*1.1,'130,60,255',0.35);
    for(let k=0;k<3;k++){
      ctx.strokeStyle=`rgba(${k===1?'255,120,220':'170,100,255'},${0.5-k*0.12})`; ctx.lineWidth=3-k;
      ctx.beginPath(); ctx.ellipse(h.x,h.y,R*(0.32+k*0.1),R*(0.14+k*0.05),h.t*(1.5+k)+k,0,TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
    const g=ctx.createRadialGradient(h.x,h.y,0,h.x,h.y,R*0.3);
    g.addColorStop(0,'#000'); g.addColorStop(0.7,'#000'); g.addColorStop(0.85,'rgba(255,200,255,0.9)'); g.addColorStop(1,'rgba(120,60,255,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(h.x,h.y,R*0.3,0,TAU); ctx.fill();
  }
}
function drawHazards(){
  for(const h of G.hazards){
    const pulse=1+Math.sin(G.time*12)*0.08, ready=h.warn<=0;
    ctx.strokeStyle=ready?'rgba(255,70,110,0.8)':'rgba(255,190,80,0.65)'; ctx.lineWidth=2;
    ctx.setLineDash(ready?[6,4]:[3,7]); ctx.beginPath(); ctx.arc(h.x,h.y,h.r*pulse,0,TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=ready?'rgba(255,60,110,0.14)':'rgba(255,190,80,0.1)'; ctx.beginPath(); ctx.arc(h.x,h.y,h.r,0,TAU); ctx.fill();
    if(h.type==='gravity'){ ctx.strokeStyle='rgba(170,100,255,0.75)'; ctx.beginPath(); ctx.arc(h.x,h.y,h.r*0.55,G.time*2,G.time*2+Math.PI*1.5); ctx.stroke(); }
  }
}
function render(){
  ctx.save();
  const sh=G.shake; if(sh>0) ctx.translate(rnd(-sh,sh)*0.5,rnd(-sh,sh)*0.5);
  if(G.chrono>0&&state==='play'){ ctx.globalAlpha=0.35; ctx.drawImage(bgCanvas,0,0); ctx.globalAlpha=1; }
  else ctx.drawImage(bgCanvas,-20,-20,W+40,H+40);
  const cx=(state==='menu'||!P)?W/2:P.x, cy=(state==='menu'||!P)?H/2:P.y;
  for(const s of stars){
    const x=((s.x-cx*0.08*s.z-G.time*6*s.z)%W+W)%W, y=((s.y-cy*0.08*s.z)%H+H)%H;
    ctx.fillStyle=`rgba(190,225,255,${0.2+s.z*0.2+Math.sin(G.time*2+s.tw)*0.1})`; ctx.fillRect(x,y,s.z,s.z);
  }
  drawGrid();
  if(state!=='menu'){
    drawHoles();
    drawHazards();
    ctx.globalCompositeOperation='lighter';
    for(const p of G.pickups){ const a=p.life<3?(Math.sin(p.t*20)>0?1:0.3):1;
      drawGlow(p.x,p.y,22+Math.sin(p.t*5)*4,'111,255,160',0.8*a);
      ctx.fillStyle=`rgba(220,255,230,${a})`; ctx.fillRect(p.x-7,p.y-2,14,4); ctx.fillRect(p.x-2,p.y-7,4,14); }
    for(const o of G.orbs){ const a=o.life<3?(Math.sin(o.life*25)>0?1:0.3):1; drawGlow(o.x,o.y,9,'255,210,80',a); }
    for(const l of G.lasers){
      const c=Math.cos(l.ang), s=Math.sin(l.ang), x2=l.o.x+c*2400, y2=l.o.y+s*2400;
      ctx.beginPath(); ctx.moveTo(l.o.x,l.o.y); ctx.lineTo(x2,y2);
      if(l.warn>0){ ctx.strokeStyle=`rgba(255,60,100,${0.25+0.25*Math.sin(G.time*30)})`; ctx.lineWidth=2; ctx.setLineDash([14,10]); ctx.stroke(); ctx.setLineDash([]); }
      else{ ctx.strokeStyle='rgba(255,40,110,0.25)'; ctx.lineWidth=l.w*2.6; ctx.stroke();
        ctx.strokeStyle='rgba(255,90,150,0.7)'; ctx.lineWidth=l.w; ctx.stroke();
        ctx.strokeStyle='rgba(255,255,255,0.95)'; ctx.lineWidth=l.w*0.3; ctx.stroke(); }
    }
    for(const b of G.ebullets) drawGlow(b.x,b.y,b.r*3.4,b.col,0.9);
    for(const b of G.bullets){
      const col=b.drone?'80,255,230':'255,200,90';
      drawGlow(b.x,b.y,b.r*4,col,0.85);
      ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=b.r*0.9;
      ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x-b.vx*0.02,b.y-b.vy*0.02); ctx.stroke();
    }
    ctx.fillStyle='#fff'; ctx.beginPath();
    for(const b of G.ebullets){ ctx.moveTo(b.x+b.r*0.5,b.y); ctx.arc(b.x,b.y,b.r*0.5,0,TAU); }
    for(const o of G.orbs){ ctx.moveTo(o.x+2,o.y); ctx.arc(o.x,o.y,2,0,TAU); }
    ctx.fill();
    for(const bo of G.bolts){
      const f=bo.life/bo.max;
      ctx.beginPath(); bo.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
      ctx.strokeStyle=`rgba(120,180,255,${0.5*f})`; ctx.lineWidth=7; ctx.stroke();
      ctx.strokeStyle=`rgba(235,245,255,${f})`; ctx.lineWidth=1.8; ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
    for(const e of G.enemies) e.boss?drawBoss(e):drawEnemy(e);
    drawPlayer();
  }
  ctx.globalCompositeOperation='lighter';
  for(let pi=0;pi<G.parts.length;pi+=PERF.partStep){ const p=G.parts[pi];
    const f=p.life/p.max;
    if(p.type==='spark'){ ctx.strokeStyle=`rgba(${p.col},${f})`; ctx.lineWidth=p.size*f+0.5;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-p.vx*0.035,p.y-p.vy*0.035); ctx.stroke(); }
    else if(p.type==='flash') drawGlow(p.x,p.y,p.size*(1.6-f),p.col,f);
    else drawGlow(p.x,p.y,p.size*(f*0.7+0.3),p.col,f);
  }
  for(const r of G.rings){ ctx.strokeStyle=`rgba(${r.col},${(r.life/r.max)*0.8})`; ctx.lineWidth=3*(r.life/r.max)+0.5;
    ctx.beginPath(); ctx.arc(r.x,r.y,Math.max(0,r.r),0,TAU); ctx.stroke(); }
  ctx.globalCompositeOperation='source-over';
  ctx.textAlign='center';
  for(const t of G.texts){
    const f=t.life/t.max, pop=t.crit?1+Math.max(0,f-0.75)*3:1;
    ctx.globalAlpha=Math.min(1,f*2.5);
    ctx.font=`700 ${Math.round((t.crit?17:11)*pop)}px ${FONT}`;
    ctx.fillStyle=t.color||(t.crit?'#ffd34d':'#e8f6ff'); ctx.fillText(t.txt,t.x,t.y);
  }
  ctx.globalAlpha=1;
  ctx.restore();

  if(state!=='menu'&&P){
    const low=!P.dead&&P.hp/P.maxHp<0.3;
    const fa=Math.max(G.flash,low?0.25+0.15*Math.sin(G.time*8):0);
    if(fa>0){ ctx.globalAlpha=fa; ctx.fillStyle=hurtGrad; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
  }
  if(state==='play'||state==='dying'){
    ctx.save(); ctx.translate(mouse.x,mouse.y);
    const ready=P.fireCd<=0;
    ctx.strokeStyle=ready?'#eaffff':'#ffcf4a'; ctx.lineWidth=2;
    ctx.shadowColor=ready?'#5ff4ff':'#ffcf4a'; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(0,0,18,0,TAU); ctx.stroke();
    ctx.save(); ctx.rotate(G.time*1.5);
    for(let k=0;k<4;k++){ ctx.rotate(TAU/4); ctx.beginPath(); ctx.moveTo(21,0); ctx.lineTo(29,0); ctx.stroke(); }
    ctx.restore();
    ctx.shadowBlur=0; ctx.fillStyle='#fff'; ctx.fillRect(-2,-2,4,4);
    if(P.holeCd<=0){ ctx.strokeStyle='rgba(170,100,255,0.25)'; ctx.setLineDash([2,6]); ctx.beginPath(); ctx.arc(0,0,20,0,TAU); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }
}

// ================= HUD =================
const hc={};
function setT(id,v){ if(hc[id]!==v){ hc[id]=v; $(id).textContent=v; } }
function setW(id,v){ v=Math.round(clamp(v,0,1)*1000)/10; if(hc[id+'w']!==v){ hc[id+'w']=v; $(id).style.width=v+'%'; } }
function setCD(id,p){ p=Math.round(clamp(p,0,1)*100)/100; const el=$(id); if(el._p!==p){ el._p=p; el.style.setProperty('--p',p); el.classList.toggle('ready',p<=0); } }
function updateHUD(){
  G.dispScore+=(G.score-G.dispScore)*0.2;
  setT('score',Math.round(G.dispScore).toLocaleString());
  setT('hi',Math.max(best,G.score).toLocaleString()); setT('wave',String(G.wave)); setT('lvl',String(P.level));
  setT('kills',String(G.kills)); setT('grazes',String(G.grazes));
  setW('hpF',P.hp/P.maxHp); setT('hpT',Math.ceil(Math.max(0,P.hp))+'/'+P.maxHp);
  setW('shF',P.shield/P.maxShield); setT('shT',String(Math.floor(P.shield)));
  setW('xpF',P.xp/P.xpNeed); setW('odF',P.od/100);
  setT('combo',G.combo>1?G.combo+' combo':''); setW('comboF',G.combo>1?G.comboT/2.6:0);
  setT('mult','×'+comboMult().toFixed(2));
  setCD('abDash',P.dashCd/P.s.dashCd); setCD('abHole',P.holeCd/holeCdMax());
  setCD('abPulse',P.pulseCd/8.5); setCD('abGuard',P.guardCd/12);
  setCD('abChrono',G.chrono>0?1-G.chrono/5.5:1-P.od/100);
  if(G.boss) setW('bossF',G.boss.hp/G.boss.maxHp);
  const low=P.hp/P.maxHp<0.3&&!P.dead;
  if(hc.low!==low){ hc.low=low; document.body.classList.toggle('low',low); }
}

// ================= Loop =================
let last=performance.now();
function frame(now){
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(state==='play'){ update(dt); updateHUD(); }
  else if(state==='dying'){ G.time+=dt*0.4; for(const e of G.enemies) updateEnemy(e,dt*0.2); updateFx(dt*0.4); G.dieT-=dt; updateHUD(); if(G.dieT<=0) showGameOver(); }
  else if(state==='menu'||state==='over'){
    G.time+=dt;
    if(Math.random()<dt*1.2) ring(rnd(W),rnd(H),pick(['95,244,255','181,107,255','255,61,110']),rnd(150,400),rnd(1,2),rnd(0.6,1.4));
    updateFx(dt);
  }
  render();
  requestAnimationFrame(frame);
}
resize();
newRun();
$('startBtn').focus();
requestAnimationFrame(frame);
