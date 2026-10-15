'use strict';
/* Roda partidas só de bots, sem navegador, e confere se a simulação está saudável.
   uso: node tools/headless.js [partidas=5] [duracao=180] */
const {createSim}=require('../sim/core');
const DT=1/60;
const N=+process.argv[2]||5, DUR=+process.argv[3]||180;

function runMatch(seed,opts){
  const sim=createSim(Object.assign({seed,duration:DUR},opts||{}));
  sim.start(seed%2);
  const st={ticks:0,goals:0,outs:{},banners:{},sfx:{},bad:[],stateT:{},maxSpeed:0,ballOut:0};
  let h=2166136261;
  const t0=process.hrtime.bigint();
  while(!sim.G.over&&st.ticks<DUR*60*3){
    sim.step(DT);st.ticks++;
    for(const e of sim.drain()){
      if(e[0]==='goal')st.goals++;
      else if(e[0]==='banner')st.banners[e[1]]=(st.banners[e[1]]||0)+1;
      else if(e[0]==='sfx')st.sfx[e[1]]=(st.sfx[e[1]]||0)+1;
    }
    st.stateT[sim.G.state]=(st.stateT[sim.G.state]||0)+1;
    const b=sim.ball;
    if(!Number.isFinite(b.x+b.y+b.z+b.vx+b.vy+b.vz)){st.bad.push('NaN bola tick '+st.ticks);break;}
    if(Math.abs(b.x)>80||Math.abs(b.z)>90||b.y>60||b.y<0){st.bad.push('bola fora do mundo '+[b.x,b.y,b.z].map(v=>v.toFixed(1))+' tick '+st.ticks);break;}
    for(const p of sim.P){
      if(!Number.isFinite(p.pos.x+p.pos.z+p.vx+p.vz+p.yaw)){st.bad.push('NaN jogador '+p.idx+' tick '+st.ticks);break;}
      if(Math.abs(p.pos.x)>sim.C.W+3||Math.abs(p.pos.z)>sim.C.L+4)st.bad.push('jogador '+p.idx+' fora do campo tick '+st.ticks);
      st.maxSpeed=Math.max(st.maxSpeed,Math.hypot(p.vx,p.vz));
    }
    if(st.bad.length>5)break;
    if(st.ticks%60===0){const s=sim.snapshot();h=Math.imul(h^Math.round(s.ball[0]*100),16777619)^Math.round(s.ball[2]*100);h=Math.imul(h^s.score[0]*7^s.score[1]*13,16777619);}
  }
  st.ms=Number(process.hrtime.bigint()-t0)/1e6;
  st.score=sim.G.score.slice();st.over=sim.G.over;st.hash=h>>>0;st.el=sim.G.el;
  return st;
}
let allBad=0;
for(let s=1;s<=N;s++){
  const r=runMatch(s);
  allBad+=r.bad.length+(r.over?0:1);
  console.log(`seed ${s}: placar ${r.score.join(' x ')} | fim=${r.over} | ${r.ticks} ticks em ${r.ms.toFixed(0)}ms (${(r.ticks*DT/(r.ms/1000)).toFixed(0)}x tempo real)`
   +` | estados(s): ${Object.entries(r.stateT).map(([k,v])=>k+':'+(v/60).toFixed(0)).join(' ')}`
   +` | bandeiras: ${Object.entries(r.banners).map(([k,v])=>k+'×'+v).join(', ')}`
   +` | vmax ${r.maxSpeed.toFixed(1)}`+(r.bad.length?` | PROBLEMAS: ${r.bad.join('; ')}`:''));
}
const a=runMatch(42),b=runMatch(42),c=runMatch(43);
console.log('determinismo (mesma semente):',a.hash===b.hash&&a.score.join()===b.score.join()?'OK':'FALHOU',a.hash,b.hash,'| semente diferente:',c.hash!==a.hash?'difere (ok)':'igual?!');
process.exit(allBad||a.hash!==b.hash?1:0);
