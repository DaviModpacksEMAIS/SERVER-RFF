'use strict';
/* Simula humanos mandando entradas (como o cliente faria) e confere o pipeline de controle.
   O "humano" aqui é um script: corre atrás da bola, mira no gol, segura e solta o chute, passa, dá rasteira, etc. */
const {createSim}=require('../sim/core');
const DT=1/60;
function scriptInput(sim,h,rng,mem){
  const P=sim.P,b=sim.ball,u=P[h.ctrl],att=h.team===0?1:-1,L=sim.C.L;
  const inp={fwd:0,back:0,left:0,right:0,sprint:0,jump:0,kick:0,pass:0};
  const dBall=Math.hypot(b.x-u.pos.x,b.z-u.pos.z);
  // restart com mira de escanteio
  if(h.cAim){
    inp.yaw=Math.atan2(h.cAim.x-u.pos.x,h.cAim.z-u.pos.z);
    mem.t=(mem.t||0)+1;
    inp.kick=(mem.t%90)<40?1:0;inp.pass=0;
    inp.ax=(rng()-0.5)*20;inp.ay=(rng()-0.5)*20;
    return inp;
  }
  const hasBall=dBall<1.6;
  let tx,tz;
  if(hasBall){tx=0;tz=att*L;}else{tx=b.x+b.vx*0.2;tz=b.z+b.vz*0.2;}
  inp.yaw=Math.atan2(tx-u.pos.x,tz-u.pos.z);
  inp.pitch=0.5;
  inp.fwd=(u.thrower||sim.G.state==='goal')?0:1;inp.sprint=dBall>4?1:0;
  mem.t=(mem.t||0)+1;
  if(hasBall||u.thrower){
    const ph=mem.t%120;
    inp.kick=ph<(20+(mem.seed%3)*8)?1:0;      // segura ~0.3-0.5s e solta
    if(ph>=60&&ph<70)inp.pass=1;
  }
  if(mem.t%97===0)inp.slide=1;
  if(mem.t%151===0)inp.feint=1;
  if(mem.t%203===0)inp.swap=1;
  if(mem.t%83===0)inp.jumpP=1;
  if(mem.t%211===0)inp.control=1;
  if(dBall>1.2&&b.y>1.2&&mem.t%17===0)inp.kick=1;
  return inp;
}
function run(seed,teams,label){
  const sim=createSim({seed,duration:180});
  const hs=teams.map((t,i)=>sim.addHuman('h'+i,t));
  sim.start(seed%2);
  const rng=(()=>{let s=seed*7919>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};})();
  const mem=hs.map((h,i)=>({seed:seed+i}));
  const cnt={kick:0,goal:0,banner:{},yaw:0,sfx:{}};
  let ticks=0,bad=[];
  while(!sim.G.over&&ticks<180*60*3){
    hs.forEach((h,i)=>sim.setInput(h.id,scriptInput(sim,h,rng,mem[i])));
    sim.step(DT);ticks++;
    for(const e of sim.drain()){
      if(e[0]==='goal')cnt.goal++;else if(e[0]==='banner')cnt.banner[e[1]]=(cnt.banner[e[1]]||0)+1;
      else if(e[0]==='yaw')cnt.yaw++;else if(e[0]==='sfx')cnt.sfx[e[1]]=(cnt.sfx[e[1]]||0)+1;
    }
    // humanos nunca podem dividir o mesmo jogador nem controlar goleiro
    const ids=hs.map(h=>h.ctrl);
    if(new Set(ids).size!==ids.length)bad.push('humanos dividindo jogador tick '+ticks);
    for(const h of hs){if(sim.P[h.ctrl].gk)bad.push('humano no goleiro');if(sim.P[h.ctrl].team!==h.team)bad.push('humano controlando o time errado');}
    const b=sim.ball;if(!Number.isFinite(b.x+b.y+b.z))bad.push('NaN bola tick '+ticks);
    for(const p of sim.P)if(!Number.isFinite(p.pos.x+p.pos.z+p.yaw))bad.push('NaN jogador '+p.idx);
    if(bad.length)break;
  }
  const s=sim.G.score;
  console.log(`${label} seed ${seed}: ${s.join(' x ')} fim=${sim.G.over} | chutes(sfx kick)=${cnt.sfx.kick||0} slide=${cnt.sfx.slide||0} | ${Object.entries(cnt.banner).map(([k,v])=>k+'×'+v).join(', ')} | yaw-events=${cnt.yaw}`+(bad.length?' | PROBLEMAS: '+bad.slice(0,3).join('; '):''));
  return bad.length;
}
let fails=0;
for(let s=1;s<=4;s++)fails+=run(s,[0,1],'1v1');
for(let s=1;s<=4;s++)fails+=run(s,[0,0,1,1],'2v2');
fails+=run(9,[0],'1 humano vs bots');
console.log(fails?'FALHOU':'TUDO OK');
process.exit(fails?1:0);
