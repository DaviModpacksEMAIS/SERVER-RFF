/* =====================================================================
   Núcleo da simulação do Futebol 3D — roda em Node, sem navegador.
   A lógica (física, chute, habilidades, IA, goleiro, regras) é a do jogo
   original v10.18; só foi tirado o que era desenho/DOM/áudio e o "jogador
   único" virou uma lista de humanos (cada um controla 1 jogador).
   Tudo vive dentro de createSim(), então dá pra rodar várias salas por processo.
   ===================================================================== */
'use strict';
const W=34,L=52,GW=3.66,GH=2.44,GD=2.4,BR=0.28,PR=0.38,G_=12;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const wrap=a=>{a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;};
const FORM_DEFS={
  padrao:{l:[3,0,2]},ataque1:{l:[2,0,2]},ataque2:{l:[1,1,2]},defesa:{l:[3,0,1]},equil:{l:[1,2,1]}
};
const FORMS=[{x:0,d:0.012},{x:-0.5,d:0.26},{x:0.5,d:0.26},{x:-0.45,d:0.5},{x:0.45,d:0.5},{x:0,d:0.7}];
const NAMES=['Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante'],NUMS=[1,4,7,9,10,11];
const FEINT_CD=1.6,HEAD_CD=1.2,BIKE_CD=3.2;
const IN0=()=>({fwd:0,back:0,left:0,right:0,sprint:0,jump:0,kick:0,pass:0,yaw:0,pitch:0.5,ax:0,ay:0,slide:0,feint:0,swap:0,reset:0,control:0,jumpP:0});

function createSim(opts){
opts=Object.assign({seed:1,duration:180,et:false,formations:['padrao','padrao'],aggr:[0,0],dribble:['esquiva','esquiva']},opts||{});
let _s=(opts.seed>>>0)||1;
const rand=()=>{_s=(_s+0x6D2B79F5)>>>0;let t=_s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
const rnd=(a,b)=>a+rand()*(b-a);
const EV=[];
const sfx=(n,v)=>{EV.push(['sfx',n,v===undefined?1:v]);};
const emit=()=>{};
const banner=(t,ms,sub)=>{EV.push(['banner',t,ms||1800,sub||'',bnTeam]);};
const confetti=p=>{EV.push(['confetti',p?p.idx:-1]);};
let bnTeam=0;
const G={state:'ready',mode:'match',score:[0,0],time:0,timer:0,t:0,shotId:0,concede:0,restart:null,boost:0,sp:null,
  aggr:opts.aggr.slice(),el:0,end:opts.duration,ph:0,bk:null,over:false,rTimer:0};
const ball={x:0,y:BR,z:0,vx:0,vy:0,vz:0,px:0,py:BR,pz:0,spin:0,held:null,inGoal:[false,false],noColP:null,noColT:0,fx:0,home:null};
const lastTouch={team:0,p:null};
const humans=[];
const humanOf=p=>{for(const h of humans)if(h.ctrl===p.idx)return h;return null;};
const stopCharges=()=>{for(const h of humans)h.ch.on=false;};
function ballTo(x,z){ball.x=ball.px=x;ball.z=ball.pz=z;ball.y=ball.py=BR;ball.vx=ball.vy=ball.vz=0;ball.spin=0;ball.held=null;ball.inGoal[0]=ball.inGoal[1]=false;ball.home=null;}
function touch(p){lastTouch.team=p.team;lastTouch.p=p;}
function makePlayer(team,i){
  return {team,i,gk:i===0,pos:{x:0,y:0,z:0},slide:null,slideCd:0,feintCd:0,pname:team===0?NAMES[i]:'Rival '+(i||'GK'),stun:0,aer:null,jump:null,jumpCd:0,headCd:0,bikeCd:0,thrower:false,throwT:0,holdT:0,vx:0,vz:0,yaw:0,kick:null,feint:null,cel:0,sad:false,dive:0,diveDir:1,diveUp:0,hold:0,react:0,shot:-1,rolled:-1,tx:0,ty:0,cool:0,think:0,forcePass:false,runT:0,active:true,rank:9,form:FORMS[i],idx:team*6+i,num:{n:NUMS[i]},dom:null,domCd:0};
}
const P=[];
for(let t=0;t<2;t++)for(let i=0;i<6;i++)P.push(makePlayer(t,i));
function resetPlayer(p){p.dom=null;p.domCd=0;p.slide=null;p.slideCd=0;p.feintCd=0;p.stun=0;p.aer=null;p.jump=null;p.jumpCd=0;p.headCd=0;p.bikeCd=0;p.thrower=false;p.throwT=0;p.vx=p.vz=0;p.kick=null;p.feint=null;p.cel=0;p.sad=false;p.dive=0;p.hold=0;p.react=0;p.shot=-1;p.rolled=-1;p.cool=0;p.think=0;p.forcePass=false;p.runT=0;p.pos.y=0;}
function setP(p,x,z,yaw){p.pos.x=x;p.pos.y=0;p.pos.z=z;p.yaw=yaw;}
function slotsFor(key){
  const f=FORM_DEFS[key]||FORM_DEFS.padrao;let [a,m,t]=f.l;if(a+m+t<5)m++;
  const sh=key==='ataque1'||key==='ataque2'?0.05:key==='defesa'?-0.04:0;
  const xs=n=>n<=0?[]:n===1?[0]:n===2?[-0.5,0.5]:n===3?[-0.62,0,0.62]:[-0.7,-0.25,0.25,0.7];
  const out=[];
  [[a,0.24,'def'],[m,0.47,'mid'],[t,0.71,'att']].forEach(([n,d,r])=>xs(n).forEach(x=>out.push({x,d:clamp(d+sh,0.12,0.8),role:r})));
  return out;
}
function assignFormation(team,key){
  const sl=slotsFor(key);
  P.filter(p=>p.team===team&&!p.gk).forEach((p,k)=>{const s=sl[k]||sl[sl.length-1];p.form={x:s.x,d:s.d,role:s.role};});
}
const SEGS=[];
for(const s of [1,-1]){SEGS.push([-GW,0,s*L,-GW,GH,s*L],[GW,0,s*L,GW,GH,s*L],[-GW,GH,s*L,GW,GH,s*L]);}
function segHit(a){
  const ax=a[0],ay=a[1],az=a[2],dx=a[3]-ax,dy=a[4]-ay,dz=a[5]-az;
  let t=((ball.x-ax)*dx+(ball.y-ay)*dy+(ball.z-az)*dz)/(dx*dx+dy*dy+dz*dz);t=t<0?0:t>1?1:t;
  const cx=ax+dx*t,cy=ay+dy*t,cz=az+dz*t;let nx=ball.x-cx,ny=ball.y-cy,nz=ball.z-cz;
  const d=Math.hypot(nx,ny,nz),m=BR+0.07;
  if(d<m&&d>1e-6){nx/=d;ny/=d;nz/=d;ball.x=cx+nx*m;ball.y=cy+ny*m;ball.z=cz+nz*m;
    const vn=ball.vx*nx+ball.vy*ny+ball.vz*nz;
    if(vn<0){ball.vx-=1.6*vn*nx;ball.vy-=1.6*vn*ny;ball.vz-=1.6*vn*nz;if(-vn>3)sfx('post',clamp(-vn/15,0.3,1));}}
}
function netCollide(s,h){
  const i=s>0?0:1,zp=ball.z*s,pzp=ball.pz*s,ax=Math.abs(ball.x);
  if(!ball.inGoal[i]&&zp>L&&ax<GW&&ball.y<GH&&pzp<=L+0.01)ball.inGoal[i]=true;
  if(ball.inGoal[i]){
    if(zp<L-BR){ball.inGoal[i]=false;return;}
    if(ball.x>GW-BR){ball.x=GW-BR;if(ball.vx>0)ball.vx*=-0.2;ball.vz*=0.8;}
    if(ball.x<-(GW-BR)){ball.x=-(GW-BR);if(ball.vx<0)ball.vx*=-0.2;ball.vz*=0.8;}
    if(ball.y>GH-BR){ball.y=GH-BR;if(ball.vy>0)ball.vy*=-0.2;}
    if(zp>L+GD-BR){ball.z=s*(L+GD-BR);if(ball.vz*s>0)ball.vz*=-0.15;ball.vx*=0.7;}
    const dm=Math.exp(-1.6*h);ball.vx*=dm;ball.vz*=dm;
    return;
  }
  if(zp>L&&zp<L+GD+BR&&ball.y<GH+BR&&ax<GW+BR&&Math.abs(ball.px)>=GW){
    const sx=ball.x>=0?1:-1;ball.x=sx*(GW+BR);if(ball.vx*sx<0)ball.vx=-ball.vx*0.2;ball.vz*=0.7;
  }
  if(zp>L-BR&&zp<L+GD+BR&&ax<GW+BR&&ball.py-BR>=GH-0.05&&ball.y-BR<GH&&ball.vy<0){ball.y=GH+BR;ball.vy=-ball.vy*0.25;ball.vx*=0.85;ball.vz*=0.85;}
  if(zp>L+GD-BR&&pzp>L+GD&&ax<GW&&ball.y<GH){ball.z=s*(L+GD+BR);if(ball.vz*s<0)ball.vz=-ball.vz*0.2;}
}
function ballStep(h){
  if(ball.held){const g=ball.held,of=g.thrower?0.12:0.35;ball.x=g.pos.x+Math.sin(g.yaw)*of;ball.z=g.pos.z+Math.cos(g.yaw)*of;ball.y=g.thrower?2.2:1.15;ball.vx=ball.vy=ball.vz=0;return;}
  ball.px=ball.x;ball.py=ball.y;ball.pz=ball.z;
  ball.vx+=ball.spin*ball.vz*0.35*h;ball.vz-=ball.spin*ball.vx*0.35*h;
  ball.vy-=G_*h;
  ball.x+=ball.vx*h;ball.y+=ball.vy*h;ball.z+=ball.vz*h;
  const dr=Math.exp(-0.09*h);ball.vx*=dr;ball.vz*=dr;
  const sp3=Math.hypot(ball.vx,ball.vy,ball.vz);if(sp3>42){const k=42/sp3;ball.vx*=k;ball.vy*=k;ball.vz*=k;}
  ball.spin*=Math.exp(-0.4*h);
  if(ball.y<BR){ball.y=BR;
    if(ball.vy<-1.5){if(ball.vy<-3.5)sfx('bounce',Math.min(1,-ball.vy/12));ball.vy=-ball.vy*0.64;ball.vx*=0.95;ball.vz*=0.95;ball.spin*=0.6;}
    else ball.vy=0;}
  if(ball.y<=BR+0.02&&Math.abs(ball.vy)<0.6){
    const sp=Math.hypot(ball.vx,ball.vz);
    if(sp>0){const ns=Math.max(0,sp-2.7*h)*Math.exp(-0.1*h),k=ns/sp;ball.vx*=k;ball.vz*=k;}
    ball.spin*=Math.exp(-2*h);
  }
  for(let i=0;i<6;i++)segHit(SEGS[i]);
  netCollide(1,h);netCollide(-1,h);
}
function playerBall(){
  for(const p of P){
    if(!p.active)continue;
    if(p.aer&&p.aer.type==='bike')continue;
    if(ball.noColP===p&&ball.noColT>0)continue;
    if(ball.y-BR>1.75+p.pos.y)continue;
    const dx=ball.x-p.pos.x,dz=ball.z-p.pos.z,m=PR+BR,d2=dx*dx+dz*dz;
    if(d2>=m*m)continue;
    let d=Math.sqrt(d2),nx=0,nz=1;if(d>1e-4){nx=dx/d;nz=dz/d;}
    ball.x=p.pos.x+nx*m;ball.z=p.pos.z+nz*m;
    const rel=(ball.vx-p.vx)*nx+(ball.vz-p.vz)*nz;
    if(rel<0){ball.vx-=1.3*rel*nx;ball.vz-=1.3*rel*nz;if(rel<-2)sfx('touch',clamp(-rel/10,0.2,1));}
    touch(p);
  }
}
function physics(dt){
  const n=Math.max(1,Math.ceil(dt/0.008)),h=dt/n;
  if(ball.noColT>0)ball.noColT-=dt;
  for(let i=0;i<n;i++){ballStep(h);if(!ball.held)playerBall();}
  if(ball.fx>0)ball.fx-=dt;
}

/* ================= CHUTE / PASSE ================= */
function kickBall(p,dx,dz,spd,la,spin){
  const h=spd*Math.cos(la);
  ball.held=null;
  ball.vx=dx*h+p.vx*0.25;ball.vz=dz*h+p.vz*0.25;ball.vy=spd*Math.sin(la);
  if(ball.vy>0.1&&ball.y<BR+0.05)ball.y=BR+0.05;
  ball.spin=spin||0;G.shotId++;touch(p);p.cool=0.45;
  ball.noColP=p;ball.noColT=(p.aer||p.jump)?0.5:0.15; /* bola não colide com o corpo de quem acabou de bater */
  sfx('kick',clamp(spd/28,0.3,1));
  emit(ball.x,0.15,ball.z,10,2.2,1.5,[0xffffff,0xd9ffd0],0.5);
}
function startKick(p,type,dx,dz,power,loft,spin,target){
  if(p.kick||p.slide||p.aer||p.jump||p.stun>0)return false;
  let fs=1;const sp_=spin||0;
  if(Math.abs(sp_)>0.3)fs=sp_<0?-1:1; /* curva pra direita => pé direito (x-) */
  else{const lx=(ball.x-p.pos.x)*Math.cos(p.yaw)-(ball.z-p.pos.z)*Math.sin(p.yaw);fs=lx<-0.12?-1:1;}
  p.kick={t:0,type,dx,dz,power,loft,spin,target,applied:false,fs,tri:type==='kick'&&Math.abs(sp_)>0.3&&power>0.3};return true;
}
function strike(p,k){
  const mine=ball.held===p;
  if(ball.held&&!mine)return false;
  if(!mine&&(Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z)>1.9||ball.y>1.7))return false;
  if(mine&&p.thrower){
    let dx=k.dx,dz=k.dz,v,la;
    if(k.target){
      const q=k.target,lx=q.pos.x+q.vx*0.8-p.pos.x,lz=q.pos.z+q.vz*0.8-p.pos.z,d=Math.hypot(lx,lz)||1;
      const e=rnd(-0.07,0.07),ce=Math.cos(e),se=Math.sin(e);
      dx=(lx*ce-lz*se)/d;dz=(lx*se+lz*ce)/d;la=0.55;v=clamp(Math.sqrt(G_*d/Math.sin(2*la))*1.05,6,26);
    }else if(k.type==='pass'){la=0.45;v=6+10*k.power;}
    else{la=0.5;v=7+13*k.power;}
    p.thrower=false;p.throwT=0.4;kickBall(p,dx,dz,v,la,0);if(k.target)ball.home={q:k.target,t:0,id:G.shotId};return true;
  }
  let dx=k.dx,dz=k.dz;
  if(k.type==='pass'){
    if(k.target){
      const q=k.target;let d=Math.hypot(q.pos.x-ball.x,q.pos.z-ball.z);
      const t=d/Math.max(8,Math.sqrt(36+5.4*d)*0.8);
      const lx=q.pos.x+q.vx*t*0.8-ball.x,lz=q.pos.z+q.vz*t*0.8-ball.z;
      d=Math.hypot(lx,lz)||1;dx=lx/d;dz=lz/d;
      if(d>26){const la=0.38;kickBall(p,dx,dz,clamp(Math.sqrt(G_*d/Math.sin(2*la))*1.02,10,30),la,0);}
      else kickBall(p,dx,dz,clamp(Math.sqrt(36+5.4*d)*(0.88+0.24*k.power),7,31),0,0);
    }else kickBall(p,dx,dz,6+18*k.power,0,0);
  }else kickBall(p,dx,dz,k.v||8+24*k.power,k.la!==undefined?k.la:k.loft*0.7,k.spin);
  return true;
}
function updateKick(p,dt){
  const k=p.kick;if(!k)return;
  k.t+=dt;turnTo(p,Math.atan2(k.dx,k.dz),18,dt);
  if(!k.applied&&k.t>=0.13){k.applied=true;
    const ok=strike(p,k);if(ok&&k.tri)ball.fx=1.3;
    {const hu=humanOf(p);if(ok&&k.target&&hu&&!humanOf(k.target)&&k.target.team===p.team)hu.ctrl=k.target.idx;}}
  if(k.t>0.5)p.kick=null;
}
function pickPassTarget(u,dx,dz,cone,maxD){cone=cone||0.5;maxD=maxD||48;
  let best=null,bs=-1e9;
  for(const q of P){
    if(!q.active||q.team!==u.team||q===u||q.gk)continue;
    const ex=q.pos.x-u.pos.x,ez=q.pos.z-u.pos.z,d=Math.hypot(ex,ez);
    if(d<3||d>maxD)continue;
    const c=(ex*dx+ez*dz)/d;if(c<cone)continue;
    let s=c*6-d*0.03;
    for(const o of P){if(o.active&&o.team!==u.team&&Math.hypot(o.pos.x-q.pos.x,o.pos.z-q.pos.z)<3)s-=1.5;}
    if(s>bs){bs=s;best=q;}
  }
  return best;
}

const chargePower=hu=>1-Math.abs(1-((hu.ch.t*1.15)%2));
/* câmera de cada humano: só o necessário pra calcular a mira (mesma conta do updateCam do cliente) */
function camUpdate(hu,dt){
  const c=hu.cam,t=P[hu.ctrl],k=1-Math.exp(-10*dt);
  c.fx+=(t.pos.x-c.fx)*k;c.fz+=(t.pos.z-c.fz)*k;
  const cp=Math.cos(c.pitch),sp=Math.sin(c.pitch),d=hu.camDist;
  c.px=clamp(c.fx-Math.sin(c.yaw)*cp*d,-W-7,W+7);c.pz=clamp(c.fz-Math.cos(c.yaw)*cp*d,-L-8,L+8);c.py=clamp(1.4+sp*d+hu.camH,0.6,45);
  const lx=c.fx+Math.sin(c.yaw)*4,ly=1.0+(0.5-c.pitch)*12,lz=c.fz+Math.cos(c.yaw)*4;
  const dx=lx-c.px,dy=ly-c.py,dz=lz-c.pz,dl=Math.hypot(dx,dy,dz)||1;c.dx=dx/dl;c.dy=dy/dl;c.dz=dz/dl;
}
function aimCalc(hu,u,v){
  const c=hu.cam,dh=Math.hypot(c.dx,c.dz)||1,hc=Math.hypot(c.px-u.pos.x,c.pz-u.pos.z);
  const yAt=d=>c.py+c.dy/dh*(d+hc);
  const Dg=c.dy<-0.001?-c.py*dh/c.dy-hc:1e9;
  const att=u.team===0?1:-1,cz=Math.cos(c.yaw),Dgl=att*cz>0.2?(att*L-u.pos.z)/cz:-1;
  let D,h;
  if(Dgl>2&&Dgl<Dg&&Dgl<70&&Math.abs(u.pos.x+Math.sin(c.yaw)*Dgl)<GW+1.2&&yAt(Dgl)<GH+1.2){D=Dgl;h=clamp(yAt(Dgl),0.3,GH-0.15);}
  else if(Dg<55){D=Math.max(2.5,Dg);h=0.2;}
  else{D=40;h=clamp(yAt(40),0.2,3);}
  let la=0;for(let i=0;i<4;i++){const t=D/(v*Math.cos(la));la=Math.atan2(h-0.2+0.5*G_*t*t,D);}
  if(h<=0.3&&D<20)la=Math.min(la,0.05);
  return{la:clamp(la,0,1),D,h};
}
function crossCalc(tx,tz){const ex=tx-ball.x,ez=tz-ball.z,D=Math.hypot(ex,ez)||1,la=0.62,c=Math.cos(la),den=2*c*c*(D*Math.tan(la)-1.5);return{dx:ex/D,dz:ez/D,D,la,v:den>0.5?clamp(Math.sqrt(G_*D*D/den),9,30):18};}

function cornerInfo(){if(G.sp&&G.sp.type==='corner')return G.sp;if(G.state==='out'&&G.restart&&G.restart.type==='corner')return G.restart;return null;}
function cornerSlot(p){
  const c=cornerInfo();if(!c||p.gk||p.forcePass)return null;
  const sg=Math.sign(c.z)||1,att=p.team===c.team;
  const lst=P.filter(q=>q.active&&!q.gk&&!q.forcePass&&q.team===p.team&&!humanOf(q)).sort((a,b)=>att?b.form.d-a.form.d:a.form.d-b.form.d);
  const A=[[-4,9],[1,8],[5,10],[-7,14],[8,14],[0,24]],D=[[-2.5,4.5],[2.5,4.5],[-6,8.5],[0,9],[6,8.5],[-10,12]];
  const t=(att?A:D)[lst.indexOf(p)];return t?[t[0],sg*(L-t[1])]:null;
}
const cornerPrep=()=>(G.sp&&G.sp.type==='corner'&&G.state==='ready')||(G.state==='out'&&G.restart&&G.restart.type==='corner');
function cornerAssist(hu){
  const u=P[hu.ctrl];let b=null,bd=6;
  for(const q of P){if(!q.active||q.team!==u.team||q===u||q.gk)continue;const d=Math.hypot(q.pos.x-hu.cAim.x,q.pos.z-hu.cAim.z);if(d<bd){bd=d;b=q;}}
  return b;
}
function cornerShort(hu,u){
  const dx=hu.cAim.x-u.pos.x,dz=hu.cAim.z-u.pos.z,d=Math.hypot(dx,dz)||1;
  let b=pickPassTarget(u,dx/d,dz/d,0.3,32),bd=1e9;
  if(!b)for(const q of P){if(!q.active||q.team!==u.team||q===u||q.gk)continue;const e=Math.hypot(q.pos.x-u.pos.x,q.pos.z-u.pos.z);if(e<bd){bd=e;b=q;}}
  return b;
}
function moveAim(hu,mx,my){
  const a=hu.cAim,s=Math.sign(a.z)||1,k=0.06*hu.sens,sy=Math.sin(hu.cam.yaw),cy=Math.cos(hu.cam.yaw);
  a.x=clamp(a.x+(-cy*mx-sy*my)*k,-24,24);
  a.z=s>0?clamp(a.z+(sy*mx-cy*my)*k,L-26,L-2):clamp(a.z+(sy*mx-cy*my)*k,-L+2,-L+26);
}
function homeStep(dt){
  const h=ball.home;if(!h)return;h.t+=dt;
  if(ball.held||G.shotId!==h.id||h.t>1.8||(ball.y<=BR+0.02&&h.t>0.3)){ball.home=null;return;}
  const q=h.q,sp=Math.hypot(ball.vx,ball.vz)||1,tx=q.pos.x+q.vx*0.35-ball.x,tz=q.pos.z+q.vz*0.35-ball.z,d=Math.hypot(tx,tz)||1;
  if(d<1.2){ball.home=null;return;}
  const k=1-Math.exp(-2.2*dt);ball.vx+=(tx/d*sp-ball.vx)*k;ball.vz+=(tz/d*sp-ball.vz)*k;
}

function startCharge(hu,type){
  if(hu.ch.on||G.state!=='play')return;
  const u=P[hu.ctrl];if(!u||!u.active||u.kick||u.slide||u.aer||u.stun>0)return;
  if(type==='kick'&&u.jump){tryJumpHeader(u);return;}
  if(type==='kick'&&hu.in.jump&&startBikeCombo(u))return;
  if(type==='kick'&&!ball.held&&ball.y>1.3){
    if(startAerial(u,'head',Math.sin(hu.cam.yaw),Math.cos(hu.cam.yaw)))return;
  }
  hu.ch.on=true;hu.ch.type=type;hu.ch.t=0;
}
function releaseCharge(hu,type){
  const ch=hu.ch;
  if(!ch.on||ch.type!==type)return;
  const pw=chargePower(hu);ch.on=false;
  if(G.state!=='play')return;
  const u=P[hu.ctrl],dx=Math.sin(hu.cam.yaw),dz=Math.cos(hu.cam.yaw);
  if(hu.cAim&&G.sp&&G.sp.type==='corner'&&G.sp.team===u.team){
    if(type==='kick'){
      const q=cornerAssist(hu),e=(1-pw)*3.2;
      const tx=(q?q.pos.x+q.vx*0.5:hu.cAim.x)+rnd(-e,e),tz=(q?q.pos.z+q.vz*0.5:hu.cAim.z)+rnd(-e,e);
      const cc=crossCalc(tx,tz);if(startKick(u,'kick',cc.dx,cc.dz,pw,0,0,q)){u.kick.la=cc.la;u.kick.v=cc.v;}
    }else{
      const q=cornerShort(hu,u),ex=(q?q.pos.x:hu.cAim.x)-u.pos.x,ez=(q?q.pos.z:hu.cAim.z)-u.pos.z,D=Math.hypot(ex,ez)||1;
      startKick(u,'pass',ex/D,ez/D,pw,0,0,q);
    }
    hu.cAim=null;return;
  }
  if(type==='kick'){
    if(u.thrower){startKick(u,'kick',dx,dz,pw,0,0,pickPassTarget(u,dx,dz,0.7));return;}
    const strafe=(hu.in.right?1:0)-(hu.in.left?1:0);
    if(startKick(u,'kick',dx,dz,pw,0,-strafe*1.2,null))u.kick.la=aimCalc(hu,u,8+24*pw).la;
  }else startKick(u,'pass',dx,dz,pw,0,0,pickPassTarget(u,dx,dz,u.thrower?0.7:0.5));
}
function doFeint(hu){
  const u=P[hu.ctrl],cam=hu.cam;
  if(G.state!=='play'||!u||u.feint||u.feintCd>0||u.kick||u.slide||u.aer||u.jump||u.stun>0||ball.held===u)return;
  const st=opts.dribble[u.team]||'esquiva',dir=hu.in.left?-1:1,sx=-Math.cos(cam.yaw)*dir,sz=Math.sin(cam.yaw)*dir,fx=Math.sin(u.yaw),fz=Math.cos(u.yaw);
  let ix=sx*5.5,iz=sz*5.5;
  if(st==='giro'){ix=fx*4.2+sx*1.6;iz=fz*4.2+sz*1.6;}
  else if(st==='elastico'){ix=sx*7.2;iz=sz*7.2;}
  else if(st==='lambreta'){ix=fx*5.4;iz=fz*5.4;}
  u.vx+=ix;u.vz+=iz;
  const near=Math.hypot(ball.x-u.pos.x,ball.z-u.pos.z)<1.8&&ball.y<0.8;
  if(near&&st!=='giro'&&st!=='lambreta'){ball.vx+=ix;ball.vz+=iz;touch(u);}
  if(st!=='esquiva')for(const o of P)if(o.active&&o.team!==u.team&&!o.gk&&Math.hypot(o.pos.x-u.pos.x,o.pos.z-u.pos.z)<2.8)o.cool=Math.max(o.cool,0.5);
  u.feint={t:0,dir,style:st,carry:near};u.cool=0.2;u.feintCd=FEINT_CD;
}
function startControl(p){
  if(!p||!p.active||p.dom||p.domCd>0||p.kick||p.slide||p.aer||p.stun>0||p.gk||ball.held||G.state!=='play')return false;
  p.dom={t:0,s:0};const hu=humanOf(p);if(hu)hu.ch.on=false;return true;
}
function domStep(p,dt){
  if(ball.held||G.state!=='play')return;
  const d=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z);
  if(d>1.9||ball.y>3.4)return;
  touch(p);if(!p.dom.s){p.dom.s=1;sfx('touch',0.6);}
  const tx=p.pos.x+Math.sin(p.yaw)*0.7,tz=p.pos.z+Math.cos(p.yaw)*0.7,k=1-Math.exp(-12*dt);
  ball.vx+=((p.vx+(tx-ball.x)*6)-ball.vx)*k;ball.vz+=((p.vz+(tz-ball.z)*6)-ball.vz)*k;
  if(ball.y>BR+0.05){ball.vy-=26*dt;if(ball.vy>0)ball.vy*=Math.exp(-14*dt);}
  if(ball.y<BR+0.3&&ball.vy<0)ball.vy*=0.2;
  for(const o of P)if(o.active&&o.team!==p.team&&!o.gk&&Math.hypot(o.pos.x-ball.x,o.pos.z-ball.z)<1.6)o.cool=Math.max(o.cool,0.35);
}
/* ================= PULO ================= */
function jumpStep(p,dt){
  const j=p.jump;j.t+=dt;if(j.nod>0)j.nod-=dt;
  p.pos.y=0.8*Math.sin(Math.min(1,j.t/0.78)*Math.PI);
  if(j.t>=0.78){p.jump=null;p.pos.y=0;p.jumpCd=0.25;}
}

function startJump(p){
  const hu=p&&humanOf(p);
  if(hu&&hu.ch.on&&hu.ch.type==='kick'&&!p.jump&&!p.aer&&startBikeCombo(p))return true;
  if(!p||!p.active||p.jump||p.aer||p.kick||p.slide||p.stun>0||p.jumpCd>0||(hu&&hu.ch.on)||ball.held||G.state!=='play')return false;
  if(hu&&hu.in.back&&ball.y>1.0&&startAerial(p,'bike',Math.sin(hu.cam.yaw),Math.cos(hu.cam.yaw)))return true;
  p.jump={t:0,nod:0};return true;
}
function tryJumpHeader(p){
  const j=p.jump;if(!j||p.headCd>0||ball.held)return;
  const hu=humanOf(p),yaw=hu?hu.cam.yaw:p.yaw;
  const d=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z);
  if(d<2.3&&Math.abs(ball.y-(1.75+p.pos.y))<1.4){
    p.headCd=HEAD_CD;j.nod=0.3;
    headKick(p,Math.sin(yaw),Math.cos(yaw));
  }
}
/* cabeceio: por padrão a bola sobe reto; segurando "frente" vira cabeceada forte (IA sempre pra frente) */
function headKick(p,dx,dz){
  const hu=humanOf(p),fwd=!hu||hu.in.fwd;
  if(fwd)kickBall(p,dx,dz,22,0.22,0);
  else{kickBall(p,dx,dz,15,1.5,0);ball.vx*=0.3;ball.vz*=0.3;}
}
function startBikeCombo(p){
  const hu=p&&humanOf(p);if(!hu)return false;
  const dx=Math.sin(hu.cam.yaw),dz=Math.cos(hu.cam.yaw);
  if(ball.y>=1.0)return startAerial(p,'bike',dx,dz);
  return startAerial(p,'bike',dx,dz,true);
}
function startAerial(p,type,dx,dz,pop){
  if(!p||!p.active||p.aer||p.jump||p.kick||p.slide||p.stun>0||p.gk||p.cel>0||ball.held||G.state!=='play'||G.mode==='pen')return false;
  if(type==='head'&&p.headCd>0)return false;
  if(type==='bike'&&p.bikeCd>0)return false;
  const d=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z);
  if(type==='head'){if(d>2.3||ball.y<1.3||ball.y>3.4)return false;}
  else if(pop){if(d>2.2||ball.y>1.0)return false;}
  else if(d>2.6||ball.y<1.0||ball.y>3.4)return false;
  p.aer={type,t:0,dx,dz,done:false};p.feint=null;
  if(pop){/* sobe a bola reto pra cima, ligeiramente à frente, para estar no ponto na hora da bicicleta */
    const tx=p.pos.x+dx*1.0,tz=p.pos.z+dz*1.0;
    ball.held=null;ball.vy=7.5;ball.vx=(tx-ball.x)/0.3;ball.vz=(tz-ball.z)/0.3;ball.spin=0;
    if(ball.y<BR+0.05)ball.y=BR+0.05;touch(p);sfx('kick',0.5);}
  if(type==='head')p.headCd=HEAD_CD;else{p.bikeCd=BIKE_CD;p.headCd=Math.max(p.headCd,0.8);}
  {const hu=humanOf(p);if(hu)hu.ch.on=false;}
  return true;
}
function aerStep(p,dt){
  const a=p.aer,head=a.type==='head';a.t+=dt;
  let y=0;
  if(head){const u=a.t/0.55;y=u<1?0.62*Math.sin(Math.PI*u):0;}
  else if(a.t<0.3)y=0.95*Math.sin(a.t/0.3*Math.PI/2);
  else if(a.t<0.66)y=0.95*Math.cos((a.t-0.3)/0.36*Math.PI/2);
  p.pos.y=y;
  p.yaw+=wrap(Math.atan2(a.dx,a.dz)-p.yaw)*Math.min(1,20*dt);
  if(head&&a.t<0.3){const dx=ball.x-p.pos.x,dz=ball.z-p.pos.z,d=Math.hypot(dx,dz)||1;steer(p,dx/d*4,dz/d*4,dt,30);}
  else if(!head&&a.t<0.7)steer(p,-a.dx*1.5,-a.dz*1.5,dt,10);
  else steer(p,0,0,dt,12);
  const tc=head?0.2:0.3;
  if(!a.done&&a.t>=tc){
    a.done=true;
    const hy=(head?1.75:1.55)+p.pos.y,d=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z);
    if(!ball.held&&d<(head?1.9:2.3)&&Math.abs(ball.y-hy)<(head?1.3:1.6)){
      const user=!!humanOf(p);
      if(head)headKick(p,a.dx,a.dz);
      else kickBall(p,-a.dx,-a.dz,26,user?0.12:0.12,0); /* bicicleta: bola vai reta para as costas */
    }
  }
  if(a.t>=(head?0.7:1.35)){p.aer=null;p.pos.y=0;}
}

/* ================= RASTEIRA ================= */
function startSlide(p){
  if(!p||!p.active||p.slide||p.aer||p.jump||p.kick||p.gk||p.slideCd>0||p.cel>0||p.stun>0||ball.held||G.state!=='play')return false;
  let dx=p.vx,dz=p.vz;const sp=Math.hypot(dx,dz);
  if(sp>1){dx/=sp;dz/=sp;}else{dx=Math.sin(p.yaw);dz=Math.cos(p.yaw);}
  p.slide={t:0,dx,dz,hit:0};p.slideCd=1.7;p.feint=null;
  {const hu=humanOf(p);if(hu)hu.ch.on=false;}
  sfx('slide');return true;
}
function callFoul(o,inBox,sg){
  stopCharges();G.state='out';G.sp=null;sfx('whistle',0.8);G.timer=1.8;bnTeam=o.team;
  if(inBox){G.restart={type:'penalty',x:0,z:sg*(L-11),team:o.team,tk:o};banner('PÊNALTI!',1600);}
  else{G.restart={type:'foul',x:clamp(o.pos.x,-W+2,W-2),z:clamp(o.pos.z,-L+2,L-2),team:o.team,tk:o};banner('FALTA',1400);}
}
function slideStep(p,dt){
  const s=p.slide;s.t+=dt;
  const sp=s.t<0.7?lerp(10.5,2,s.t/0.7):0;
  p.vx=s.dx*sp;p.vz=s.dz*sp;
  p.yaw+=wrap(Math.atan2(s.dx,s.dz)-p.yaw)*Math.min(1,20*dt);
  if(s.t<0.6){
    if(sp>3)emit(p.pos.x,0.08,p.pos.z,1,1.3,1.6,[0x2f8a38,0x3fae4b,0x6b4a2a],0.5);
    const fx=p.pos.x+s.dx*0.95,fz=p.pos.z+s.dz*0.95;
    s.hit-=dt;
    if(!ball.held&&ball.y<0.6&&s.hit<=0&&Math.hypot(ball.x-fx,ball.z-fz)<0.95){
      const k=7+sp*0.8;ball.vx=s.dx*k;ball.vz=s.dz*k;ball.vy=1.2;ball.spin=0;touch(p);s.hit=0.3;sfx('kick',0.5);
      emit(ball.x,0.15,ball.z,10,2.2,1.5,[0xffffff,0xd9ffd0],0.5);
    }
    for(const o of P){
      if(!o.active||o.team===p.team||o.gk||o.aer||o.stun>0.2)continue;
      if(Math.hypot(o.pos.x-fx,o.pos.z-fz)<0.85){
        o.stun=0.7;o.vx*=0.2;o.vz*=0.2;
        if(G.mode==='match'&&G.state==='play'&&!s.fl){s.fl=1;
          const sg=o.team===0?1:-1,inBox=Math.abs(o.pos.x)<20.2&&o.pos.z*sg>L-16.5;
          if(rand()<(inBox?0.10:0.15))callFoul(o,inBox,sg);}
        if(!ball.held&&ball.y<0.8&&Math.hypot(ball.x-o.pos.x,ball.z-o.pos.z)<1.4){ball.vx+=s.dx*5;ball.vz+=s.dz*5;touch(p);}
      }
    }
  }
  if(s.t>=1.0)p.slide=null;
}

/* ================= MOVIMENTO / ANIMAÇÃO ================= */
function steer(p,tvx,tvz,dt,acc){let dx=tvx-p.vx,dz=tvz-p.vz;const d=Math.hypot(dx,dz),m=acc*dt;if(d>m){dx*=m/d;dz*=m/d;}p.vx+=dx;p.vz+=dz;}
function turnTo(p,yaw,rate,dt){p.yaw+=wrap(yaw-p.yaw)*Math.min(1,rate*dt);}
function spFrozen(u){const sp=G.sp;return !!(sp&&(sp.type==='foul'||sp.type==='penalty'||sp.type==='corner')&&sp.team===u.team&&G.shotId===sp.id&&!ball.held&&G.state!=='goal');}

function userControl(hu,dt){
  const u=P[hu.ctrl];if(!u||!u.active)return;
  const i=hu.in,cam=hu.cam;
  if(u.cel>0){steer(u,0,0,dt,20);return;}
  if(ball.held===u&&u.thrower){steer(u,0,0,dt,30);turnTo(u,cam.yaw,14,dt);return;}
  let f=(i.fwd?1:0)-(i.back?1:0),r=(i.right?1:0)-(i.left?1:0);
  if(spFrozen(u)){f=0;r=0;}
  const sy=Math.sin(cam.yaw),cy=Math.cos(cam.yaw),dx=f*sy-r*cy,dz=f*cy+r*sy,len=Math.hypot(dx,dz),moving=len>0.01;
  const shift=!!i.sprint;
  if(moving&&shift)u.runT+=dt;else u.runT=Math.max(0,u.runT-dt*2);
  let tvx=0,tvz=0;
  if(moving){const spd=shift?7.6+1.6*clamp((u.runT-0.8)/1.2,0,1):4.6;tvx=dx/len*spd;tvz=dz/len*spd;}
  if(u.kick||u.dom){tvx*=0.35;tvz*=0.35;}
  steer(u,tvx,tvz,dt,moving?22:30);
  if(hu.ch.on||u.kick||spFrozen(u))turnTo(u,cam.yaw,14,dt);
  else if(moving)turnTo(u,Math.atan2(dx,dz),12,dt);
}
function moveAI(p,tx,tz,sp,dt){
  tx=clamp(tx,-W+1,W-1);tz=clamp(tz,-L+1,L-1);
  const dx=tx-p.pos.x,dz=tz-p.pos.z,d=Math.hypot(dx,dz);
  if(d<0.4){steer(p,0,0,dt,26);return;}
  const s=sp*Math.min(1,d/1.5+0.25);steer(p,dx/d*s,dz/d*s,dt,22);
  if(Math.hypot(p.vx,p.vz)>0.5)turnTo(p,Math.atan2(p.vx,p.vz),10,dt);
}
function aiShoot(p){
  const att=p.team===0?1:-1,gz=att*L,opp=P[p.team===0?6:0];
  let tx=rnd(-1,1)*(GW-0.9);
  if(opp.active)tx=(opp.pos.x>0?-1:1)*rnd(1.0,GW-0.7);
  const dx=tx-p.pos.x,dz=gz-p.pos.z,d=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz)+rnd(-1,1)*(0.075-0.05*G.aggr[p.team]);
  startKick(p,'kick',Math.sin(yaw),Math.cos(yaw),clamp(0.5+d/50,0.55,1),rnd(0.05,0.3),0,null);
}
function aiPass(p,force){
  const att=p.team===0?1:-1;let best=null,bs=-1e9;
  for(const q of P){
    if(!q.active||q.team!==p.team||q===p||q.gk)continue;
    const dx=q.pos.x-p.pos.x,dz=q.pos.z-p.pos.z,d=Math.hypot(dx,dz);
    if(d<4||d>40)continue;
    let s=att*dz*0.6-d*0.15;
    for(const o of P){if(!o.active||o.team===p.team)continue;const od=Math.hypot(o.pos.x-q.pos.x,o.pos.z-q.pos.z);if(od<3)s-=10;else if(od<6)s-=3;}
    if(s>bs){bs=s;best=q;}
  }
  if(!best){
    if(!force)return false;
    const dx=-p.pos.x*0.3,dz=att*L-p.pos.z,d=Math.hypot(dx,dz)||1;
    startKick(p,'kick',dx/d,dz/d,0.55,0.1,0,null);return true;
  }
  const dx=best.pos.x-p.pos.x,dz=best.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1;
  startKick(p,'pass',dx/d,dz/d,0.6,0,0,best);return true;
}
function aiDecide(p){
  const att=p.team===0?1:-1,gz=att*L,D=Math.hypot(p.pos.x,gz-p.pos.z);
  let nd=99;
  for(const o of P){if(!o.active||o.team===p.team)continue;const d=Math.hypot(o.pos.x-p.pos.x,o.pos.z-p.pos.z);if(d<nd)nd=d;}
  const ag=G.aggr[p.team];p.think=rnd(0.3,0.6)*(1-0.4*ag);
  if(D<24+9*ag&&(nd>2.5||D<13||rand()<0.4)){aiShoot(p);return true;}
  if(att*p.pos.z<-L+14&&nd<3.5){const dx=rnd(-15,15)-p.pos.x,dz=att*L*0.4-p.pos.z,d=Math.hypot(dx,dz)||1;startKick(p,'kick',dx/d,dz/d,0.85,0.45,0,null);return true;}
  if(nd<4&&rand()<0.75)return aiPass(p,true);
  return false;
}
function fRole(p){const f=p.form;return f.role||(f.d<0.35?'def':f.d<0.6?'mid':'att');}
/* quanto o time precisa adiantar (+) ou recuar (-): perdendo no fim avança, ganhando no fim recua */
function pushNeed(t){if(G.mode!=='match')return 0;const diff=G.score[t]-G.score[1-t],late=G.end>0?G.el/G.end:0;
  if(diff<0&&late>0.5)return 0.18;if(diff>0&&late>0.7)return -0.08;return 0;}
function aiField(p,dt){
  if(p.kick){steer(p,0,0,dt,10);return;}
  const ag=G.aggr[p.team];
  if(ball.held===p&&p.thrower){steer(p,0,0,dt,26);p.holdT-=dt;if(p.holdT<=0)aiPass(p,true);return;}
  if(G.sp&&G.sp.type==='corner'){const sl=cornerSlot(p);if(sl){moveAI(p,sl[0],sl[1],6.5,dt);return;}}
  const att=p.team===0?1:-1,gz=att*L;
  const dB=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z),mine=lastTouch.team===p.team;
  if(G.state==='play'&&!p.aer&&p.headCd<=0&&p.rank===0&&!ball.held&&ball.y>1.1&&ball.y<2.8&&dB<1.9&&rand()<0.6){
    const hx=-p.pos.x*0.3,hz=gz-p.pos.z,hd=Math.hypot(hx,hz)||1;
    if(startAerial(p,'head',hx/hd,hz/hd))return;
  }
  if(G.state==='play'&&!G.sp&&!mine&&p.rank===0&&p.slideCd<=0&&dB>1.1&&dB<2.5+ag*0.6&&ball.y<0.5&&Math.hypot(ball.vx,ball.vz)<9&&rand()<dt*(1.2+3.5*ag)){
    const dx=ball.x-p.pos.x,dz=ball.z-p.pos.z,d=Math.hypot(dx,dz)||1;p.vx=dx/d*3;p.vz=dz/d*3;
    if(startSlide(p))return;
  }
  p.think-=dt;
  const hasBall=dB<1.4&&ball.y<1.2&&!ball.held;
  let tx,tz,sp;
  if(p.forcePass){
    if(dB<1.7){const sp0=G.sp;if(sp0&&(sp0.type==='penalty'||(sp0.type==='foul'&&Math.hypot(p.pos.x,(p.team===0?L:-L)-p.pos.z)<30)))aiShoot(p);else aiPass(p,true);p.forcePass=false;return;}
    tx=ball.x;tz=ball.z;sp=6.5;
  }else if(hasBall){
    if(p.think<=0&&aiDecide(p))return;
    let ax=-p.pos.x*0.4,az=gz-p.pos.z;const al=Math.hypot(ax,az)||1;ax/=al;az/=al;
    for(const o of P){
      if(!o.active||o.team===p.team)continue;
      const ox=o.pos.x-p.pos.x,oz=o.pos.z-p.pos.z,od=Math.hypot(ox,oz);
      if(od<4.2&&od>0.01&&(ox*ax+oz*az)/od>0.1){const w=1.6*(1-od/4.2);ax-=ox/od*w;az-=oz/od*w;}
    }
    const l2=Math.hypot(ax,az)||1;tx=p.pos.x+ax/l2*10;tz=p.pos.z+az/l2*10;sp=7.2;
  }else if(p.rank===0||(!mine&&p.rank===1&&dB<15)){
    const k=Math.min(0.45,dB/10);tx=ball.x+ball.vx*k;tz=ball.z+ball.vz*k;sp=7.3;
  }else{
    const f=p.form,ro=fRole(p),nd=pushNeed(p.team),bd=p.team===0?(ball.z+L)/(2*L):(L-ball.z)/(2*L);
    let sh=(bd-0.5)*0.42+(mine?0.12+0.08*ag:-0.08+0.03*ag);
    if(ro==='def')sh=sh*0.6+(mine&&bd>0.5?0.06:0)+nd;          /* defesa segura a linha; só sobe com o time ou se precisar */
    else if(ro==='att')sh=Math.max(sh*1.1,mine?-9:-0.12)+nd*0.5; /* ataque não volta tanto */
    else sh+=nd*0.7;
    const cap=ro==='def'?(nd>0?0.78:0.52):0.92,d=clamp(f.d+sh,0.08,cap);
    tz=p.team===0?-L+d*2*L:L-d*2*L;tx=f.x*W*0.8+ball.x*0.22;sp=5.6;
    if(!mine&&ro!=='att'&&bd<(ro==='def'?0.62:0.5)){ /* marcação: fica entre o adversário e o próprio gol */
      let mk=null,bs=121;
      for(const o of P){if(!o.active||o.team===p.team||o.gk)continue;const od=(o.pos.x-tx)**2+(o.pos.z-tz)**2;if(od<bs){bs=od;mk=o;}}
      if(mk){const ogz=p.team===0?-L:L,ux=-mk.pos.x,uz=ogz-mk.pos.z,ul=Math.hypot(ux,uz)||1;
        tx=mk.pos.x+ux/ul*1.7;tz=mk.pos.z+uz/ul*1.7;sp=ro==='def'?6.8:6.2;
        const cz=p.team===0?-L+cap*2*L:L-cap*2*L;tz=p.team===0?Math.min(tz,cz):Math.max(tz,cz);}
    }
    if(mine&&f.d>=0.5){/* atacantes se desmarcam à frente da bola, no lado oposto */
      const lead=ball.z+att*7;
      tz=att>0?Math.max(tz,Math.min(lead,L-6)):Math.min(tz,Math.max(lead,-L+6));
      tx=f.x*W*0.8-ball.x*0.15;sp=6.4;
    }
  }
  if(G.sp&&p.team!==G.sp.team){const q=spAvoid(tx,tz);tx=q[0];tz=q[1];}
  moveAI(p,tx,tz,sp*(1+0.25*ag),dt);
}
function gkKick(p){
  const att=p.team===0?1:-1;let tgt=null,bs=-1;
  for(const q of P){if(q.active&&q.team===p.team&&!q.gk){const s=rnd(0,1)+att*(q.pos.z-p.pos.z)/L;if(s>bs){bs=s;tgt=q;}}}
  let dx,dz;if(tgt){dx=tgt.pos.x-p.pos.x;dz=tgt.pos.z-p.pos.z;}else{dx=rnd(-10,10);dz=att*30;}
  const d=Math.hypot(dx,dz)||1;dx/=d;dz/=d;const la=0.45;
  ball.held=null;ball.x=p.pos.x+dx*0.5;ball.z=p.pos.z+dz*0.5;ball.y=0.9;
  kickBall(p,dx,dz,clamp(Math.sqrt(G_*d/Math.sin(2*la))*1.02,12,27),la,0);
  p.kick={t:0.13,type:'kick',dx,dz,power:0.6,loft:0.5,spin:0,target:null,applied:true};
}
function gkUpdate(p,dt){
  const s=p.team===1?1:-1,gz=s*L;
  if(ball.held===p){
    p.hold-=dt;steer(p,0,0,dt,30);turnTo(p,Math.atan2(0,-s),8,dt);
    if(p.hold<=0)gkKick(p);
    return;
  }
  if(p.kick){steer(p,0,0,dt,10);return;}
  if(p.dive>0)p.dive-=dt;
  if(p.forcePass&&Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z)<1.8&&!ball.held){gkKick(p);p.forcePass=false;return;}
  if(p.shot!==G.shotId&&ball.vz*s>4&&Math.abs(ball.z)>L*0.2&&!ball.held){
    const tt=(gz-ball.z)/ball.vz;
    if(tt>0&&tt<2){
      const ex=ball.x+ball.vx*tt,ey=ball.y+ball.vy*tt-0.5*G_*tt*tt;
      if(Math.abs(ex)<GW+2.4&&ey<GH+1.3){
        p.shot=G.shotId;p.react=rnd(0.08,0.2)*(1-0.55*G.aggr[p.team]);p.tx=clamp(ex+rnd(-1,1)*(1.0)*(1-0.5*G.aggr[p.team]),-GW-0.4,GW+0.4);p.ty=Math.max(0.3,ey);p.dive=0;
      }
    }
  }
  let tx,tz,sp=6;
  const reacting=p.shot===G.shotId&&ball.vz*s>0.5;
  if(reacting){
    if(p.react>0){
      p.react-=dt;
      if(p.react<=0){const dx=p.tx-p.pos.x;if(Math.abs(dx)>1.0||p.ty>1.7){p.dive=0.75;p.diveDir=dx>=0?1:-1;p.diveUp=p.ty>1.5?1:0;}}
      tx=p.pos.x;tz=p.pos.z;sp=0;
    }else{tx=p.tx;tz=p.pos.z;sp=p.dive>0?10:7;}
  }else{
    const dx=ball.x,dz=ball.z-gz,d=Math.hypot(dx,dz)||1,k=Math.min(3.2,d*0.35)+0.4;
    tx=clamp(dx/d*k*1.6,-GW+0.7,GW-0.7);tz=gz+dz/d*k*0.9;
  }
  const ddx=tx-p.pos.x,ddz=tz-p.pos.z,dd=Math.hypot(ddx,ddz);
  if(sp<=0||dd<0.15)steer(p,0,0,dt,30);
  else{const v=sp*Math.min(1,dd/0.8+0.2);steer(p,ddx/dd*v,ddz/dd*v,dt,30);}
  turnTo(p,Math.atan2(ball.x-p.pos.x,ball.z-p.pos.z),8,dt);
  if(!ball.held){
    const reach=p.dive>0?1.75:1.35,hy=p.dive>0&&p.diveUp?1.7:0.9,hx=p.pos.x+(p.dive>0?p.diveDir*0.8:0);
    const dx=ball.x-hx,dy=ball.y-hy,dz=ball.z-p.pos.z,d=Math.hypot(dx,dy,dz),spd=Math.hypot(ball.vx,ball.vy,ball.vz);
    if(d<reach&&lastTouch.team!==p.team&&p.rolled!==G.shotId){
      p.rolled=G.shotId;
      const inBox=Math.abs(ball.z)>L-16.5&&Math.abs(ball.x)<20.2;
      const ok=spd<=7||rand()<clamp(0.88-spd*0.011+0.09*G.aggr[p.team],0.25,0.95);
      if(ok){
        if(inBox&&spd<17&&rand()<(spd<8?0.9:0.55)){ball.held=p;p.hold=rnd(0.9,1.6);touch(p);ball.vx=ball.vy=ball.vz=0;sfx('touch');}
        else{ball.vz=-s*Math.max(4,spd*0.35);ball.vx=(ball.x-p.pos.x)*3+rnd(-3,3);ball.vy=rnd(2,5);touch(p);sfx('touch');}
      }
    }
  }
}

/* ================= REGRAS / ESTADOS ================= */
function formPos(p,kick,team){
  const d=Math.min(p.form.d,p.team===team?0.45:0.4),z=p.team===0?-L+d*2*L:L-d*2*L;
  return [p.form.x*W*0.85,z];
}

function assignHumans(){
  for(const t of [0,1]){
    const base=t===0?5:11;let n=0;
    for(const h of humans){
      if(h.team!==t)continue;
      h.ctrl=base-n;n++;h.cAim=null;h.ch.on=false;
      h.cam.fx=P[h.ctrl].pos.x;h.cam.fz=P[h.ctrl].pos.z;h.cam.yaw=t===0?0:Math.PI;
      EV.push(['yaw',h.id,h.cam.yaw]);
    }
  }
}
function kickoff(team){
  P.forEach(p=>{if(!p.active)return;resetPlayer(p);const f=formPos(p,true,team);setP(p,f[0],f[1],p.team===0?0:Math.PI);});
  ballTo(0,0);
  const att=team===0?1:-1,k=P[team===0?5:11];
  setP(k,0,-att*1.1,team===0?0:Math.PI);
  assignHumans();
  lastTouch.team=team;lastTouch.p=k;
  if(!humanOf(k))k.forcePass=true;
  G.sp={type:'kickoff',x:0,z:0,team,id:G.shotId,t:0};
  G.state='ready';G.timer=1.5;sfx('whistle',0.6);
  bnTeam=0;banner('PONTAPÉ INICIAL',1400);
}
function nearestField(team){let b=null,bd=1e9;for(const p of P){if(p.active&&p.team===team&&!p.gk){const d=Math.hypot(p.pos.x-ball.x,p.pos.z-ball.z);if(d<bd){bd=d;b=p;}}}return b;}
function spAvoid(tx,tz){
  const sp=G.sp;
  if(sp.type==='goalkick'){const sz=Math.sign(sp.z);if(Math.abs(tx)<21&&tz*sz>L-17.5)tz=sz*(L-17.5);return [tx,tz];}
  const dx=tx-sp.x,dz=tz-sp.z,d=Math.hypot(dx,dz);
  if(d<10){let nx=dx,nz=dz;if(d<1e-3){nx=0;nz=-Math.sign(sp.z||1);}else{nx/=d;nz/=d;}return [sp.x+nx*10,sp.z+nz*10];}
  return [tx,tz];
}
function spRestrict(dt){
  const sp=G.sp;if(!sp)return;
  sp.t+=dt;
  if(G.shotId!==sp.id||sp.t>22||(!ball.held&&Math.hypot(ball.x-sp.x,ball.z-sp.z)>3.2)){G.sp=null;return;}
  for(const p of P){
    if(sp.type==='penalty'&&p.active&&!p.gk&&p!==sp.tk){const sz=Math.sign(sp.z);if(Math.abs(p.pos.x)<20.4&&p.pos.z*sz>L-16.7)p.pos.z=sz*(L-16.7);}
    if(!p.active||p.gk||p.team===sp.team)continue;
    if(sp.type==='goalkick'){const sz=Math.sign(sp.z);if(Math.abs(p.pos.x)<20.4&&p.pos.z*sz>L-16.7)p.pos.z=sz*(L-16.7);}
    else{
      const dx=p.pos.x-sp.x,dz=p.pos.z-sp.z,d=Math.hypot(dx,dz);
      if(d<9.15){let nx=dx,nz=dz;if(d<1e-3){nx=0;nz=-Math.sign(sp.z||1);}else{nx/=d;nz/=d;}
        p.pos.x=clamp(sp.x+nx*9.15,-W-2.5,W+2.5);p.pos.z=clamp(sp.z+nz*9.15,-L-3,L+3);}
    }
  }
}

function onGoal(team){
  G.state='goal';stopCharges();G.boost=1;sfx('goal');
  G.score[team]++;G.sp=null;G.concede=1-team;G.timer=3.6;
  const sc=(lastTouch.p&&lastTouch.team===team&&!lastTouch.p.gk)?lastTouch.p:nearestField(team)||P[1];
  P.forEach(p=>{if(!p.active)return;if(p.team===team)p.cel=3.4;else p.sad=true;});
  bnTeam=team;banner('GOOOL!',3200,(team===0?'AZUL':'VERMELHO')+' marcou'+(sc&&sc.pname?' · '+sc.pname+' #'+(sc.num?sc.num.n:''):''));
  EV.push(['goal',team,sc?sc.idx:-1,G.score[0],G.score[1]]);confetti(sc);
}
function afterGoal(){P.forEach(p=>{p.cel=0;p.sad=false;});kickoff(G.concede);}
function checkGoal(){
  if(G.state!=='play'||ball.held)return;
  for(const s of [1,-1]){
    if(ball.z*s-BR>L&&Math.abs(ball.x)+BR<=GW+0.01&&ball.y+BR<=GH+0.01){onGoal(s>0?0:1);return;}
  }
}
function checkOut(){
  if(G.state!=='play'||ball.held)return;
  const ax=Math.abs(ball.x),az=Math.abs(ball.z);
  let type=null,x=0,z=0,team=0,label='';
  if(ax-BR>W){type='lateral';team=1-lastTouch.team;x=Math.sign(ball.x)*(W-0.3);z=clamp(ball.z,-L+4,L-4);label='LATERAL';}
  else if(az-BR>L&&!ball.inGoal[ball.z>0?0:1]){
    const side=Math.sign(ball.z),att=side>0?0:1;
    if(lastTouch.team===att){type='goalkick';team=1-att;x=0;z=side*(L-5.5);label='TIRO DE META';}
    else{type='corner';team=att;x=(ball.x>=0?1:-1)*(W-0.5);z=side*(L-0.5);label='ESCANTEIO';}
  }
  if(!type)return;
  stopCharges();G.state='out';sfx('whistle',0.6);if(type==='goalkick')sfx('miss',0.8);
  G.timer=1.5;G.restart={type,x,z,team};bnTeam=team;banner(label,1400);
}

function placeRestart(r){
  ballTo(r.x,r.z);
  let tk=null;
  if(r.type==='goalkick')tk=P[r.team===0?0:6];
  else{let bd=1e9;for(const p of P){if(p.active&&p.team===r.team&&!p.gk){const d=Math.hypot(p.pos.x-r.x,p.pos.z-r.z);if(d<bd){bd=d;tk=p;}}}}
  if(r.tk&&r.tk.active&&!r.tk.gk)tk=r.tk;
  tk.slide=null;tk.aer=null;tk.stun=0;tk.pos.y=0;tk.vx=tk.vz=0;tk.kick=null;
  if(r.type==='lateral'){
    const sx=r.x>=0?1:-1;
    tk.pos.x=sx*(W+0.15);tk.pos.z=r.z;tk.yaw=-sx*Math.PI/2;
    tk.thrower=true;tk.holdT=rnd(0.9,1.5);ball.held=tk;
    ball.x=tk.pos.x+Math.sin(tk.yaw)*0.12;ball.z=tk.pos.z;ball.y=2.2;
  }else if(r.type==='foul'||r.type==='penalty'){
    const a=r.team===0?1:-1;tk.pos.x=r.x;tk.pos.z=r.z-a*1.0;tk.yaw=a>0?0:Math.PI;
  }else{
    let nx=r.x,nz=r.z;const nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
    tk.pos.x=r.x+nx*0.9;tk.pos.z=r.z+nz*0.9;tk.yaw=Math.atan2(-nx,-nz);
  }
  touch(tk);
  /* o humano do time que cobra assume o cobrador (exceto tiro de meta, que é do goleiro); sem humano, a IA cobra */
  const hu=r.type!=='goalkick'?humans.find(h=>h.team===r.team):null;
  for(const h of humans)h.cAim=null;
  if(hu){
    const other=humanOf(tk);if(other&&other!==hu)other.ctrl=hu.ctrl;
    hu.ctrl=tk.idx;hu.ch.on=false;tk.forcePass=false;hu.cam.yaw=tk.yaw;EV.push(['yaw',hu.id,tk.yaw]);
    if(r.type==='corner'){const sg=Math.sign(r.z)||1;hu.cAim={x:0,z:sg*(L-11)};const ya=Math.atan2(hu.cAim.x-tk.pos.x,hu.cAim.z-tk.pos.z);hu.cam.yaw=ya;tk.yaw=ya;EV.push(['yaw',hu.id,ya]);}
  }else tk.forcePass=true;
  G.sp={type:r.type,x:r.x,z:r.z,team:r.team,id:G.shotId,t:0,tk};
  if(r.type==='penalty'){
    const sz=Math.sign(r.z),dg=P[r.team===0?6:0];resetPlayer(dg);setP(dg,0,sz*(L-0.7),sz>0?Math.PI:0);
    for(const p of P){if(!p.active||p.gk||p===tk)continue;if(Math.abs(p.pos.x)<20.4&&p.pos.z*sz>L-16.7)p.pos.z=sz*(L-16.7);}
  }
  G.state='ready';G.timer=0.9;
  bnTeam=r.team;
}
function afterOut(){const r=G.restart;G.restart=null;if(r)placeRestart(r);else G.state='play';}
function startBreak(label,sub,k){
  G.state='half';G.sp=null;stopCharges();G.boost=0;G.bk={t:0,ph:0,k,label,sub,out:true};
  sfx('whistle',0.8);EV.push(['break',label,sub]);
  P.forEach(p=>{p.cel=0;p.sad=false;});
}
function checkPeriod(){
  const e=G.el,H=opts.duration/2;
  if(G.ph===0&&e>=H){G.ph=1;startBreak('INTERVALO','1º TEMPO',1);}
  else if(G.ph===1&&e>=2*H){if(G.score[0]===G.score[1]&&opts.et){G.ph=2;G.end=2*H+H*2/3;startBreak('PRORROGAÇÃO','FIM DO TEMPO NORMAL',0);}else endGame();}
  else if(G.ph===2&&e>=2*H+H/3){G.ph=3;startBreak('INTERVALO DA PRORROGAÇÃO','1º TEMPO EXTRA',1);}
  else if(G.ph===3&&e>=2*H+H*2/3)endGame();
}
function endGame(){
  if(G.state==='end')return;
  G.state='end';G.over=true;stopCharges();sfx('whistle',0.8);
  EV.push(['end',G.score[0],G.score[1]]);
}
function breakMove(p,dt){
  const bk=G.bk;if(!bk){steer(p,0,0,dt,26);return;}
  let tx,tz;
  if(bk.out){tx=W+2.3;tz=p.pos.z*0.5;}
  else{const f=formPos(p,true,bk.k);tx=f[0];tz=f[1];}
  const dx=tx-p.pos.x,dz=tz-p.pos.z,d=Math.hypot(dx,dz);
  if(d<0.5){steer(p,0,0,dt,26);return;}
  const sp=5.2;steer(p,dx/d*sp,dz/d*sp,dt,22);turnTo(p,Math.atan2(p.vx,p.vz),10,dt);
}

function breakStep(dt){
  const bk=G.bk;if(!bk)return;bk.t+=dt;
  if(bk.ph===0){
    if(bk.t>5.5){bk.ph=1;bk.t=0;bk.out=false;
      ballTo(0,0);
      P.forEach(p=>{if(!p.active)return;resetPlayer(p);const x=p.team===0?-(W+2.3):(W+2.3);setP(p,x,p.pos.z*0.5||0,Math.PI/2*(x>0?-1:1));});
    }
  }else if(bk.ph===1&&bk.t>3){const k=bk.k;G.bk=null;kickoff(k);}
}
function switchPlayer(hu){
  const cur=P[hu.ctrl];if(spFrozen(cur))return;
  if(G.state==='goal'||(ball.held&&ball.held.thrower))return;
  const c=P.filter(p=>p.active&&p.team===hu.team&&!p.gk&&p.idx!==hu.ctrl&&!humanOf(p));
  c.sort((a,b)=>Math.hypot(a.pos.x-ball.x,a.pos.z-ball.z)-Math.hypot(b.pos.x-ball.x,b.pos.z-ball.z));
  if(c.length){hu.ctrl=c[0].idx;hu.ch.on=false;}
}
const sepA=[];
function separate(){
  for(let i=0;i<P.length;i++){const a=P[i];if(!a.active)continue;
    for(let j=i+1;j<P.length;j++){const b=P[j];if(!b.active)continue;
      const dx=b.pos.x-a.pos.x,dz=b.pos.z-a.pos.z,d=Math.hypot(dx,dz);
      if(d<0.8&&d>1e-4){const m=(0.8-d)/2,nx=dx/d,nz=dz/d;a.pos.x-=nx*m;a.pos.z-=nz*m;b.pos.x+=nx*m;b.pos.z+=nz*m;}}}
}
function magnet(dt){
  if(ball.held||G.state!=='play'||ball.y>0.7)return;
  let h=null,hd=1.15;
  for(const p of P){
    if(!p.active||p.gk||p.cool>0||p.kick||p.slide||p.stun>0)continue;
    const d=Math.hypot(ball.x-p.pos.x,ball.z-p.pos.z);if(d<hd){hd=d;h=p;}
  }
  if(!h||Math.hypot(h.vx,h.vz)<0.4)return;
  if(hd<0.95)touch(h);
  const tx=h.pos.x+Math.sin(h.yaw)*0.82,tz=h.pos.z+Math.cos(h.yaw)*0.82,k=1-Math.exp(-9*dt);
  ball.vx+=((h.vx+(tx-ball.x)*5)-ball.vx)*k;ball.vz+=((h.vz+(tz-ball.z)*5)-ball.vz)*k;
}
function computeRanks(){
  for(let t=0;t<2;t++){
    sepA.length=0;
    {const bd=t===0?(ball.z+L)/(2*L):(L-ball.z)/(2*L),nd=pushNeed(t);
    for(const p of P)if(p.active&&p.team===t&&!p.gk){
      let r=(ball.x-p.pos.x)**2+(ball.z-p.pos.z)**2;
      if(G.mode==='match'){const ro=fRole(p);
        if(ro==='def'&&bd>p.form.d+0.3+nd)r+=1e4;          /* zagueiro só persegue se a bola está na sua zona */
        else if(ro==='att'&&bd<0.3-nd*0.5&&r>110)r+=1e4;}   /* atacante fica à frente, a não ser que a bola esteja perto */
      p.rank=r;sepA.push(p);}}
    sepA.sort((a,b)=>a.rank-b.rank);
    for(let i=0;i<sepA.length;i++)sepA[i].rank=i;
  }
}

/* entradas: kick/pass/jump chegam como estado "segurado"; as bordas (apertou/soltou) saem da comparação com o tick anterior.
   slide/feint/swap/control/jumpP são pulsos de um tick. ax/ay = movimento da mira de cobrança. */
function applyInput(hu){
  const i=hu.in,pv=hu.prev;
  hu.cam.yaw=Number.isFinite(i.yaw)?i.yaw:hu.cam.yaw;hu.cam.pitch=clamp(Number.isFinite(i.pitch)?i.pitch:0.5,0.04,1.25);
  if(hu.cAim&&(i.ax||i.ay))moveAim(hu,clamp(i.ax,-400,400),clamp(i.ay,-400,400));
  i.ax=i.ay=0;
  if(G.state==='play'){
    if(i.kick&&!pv.kick)startCharge(hu,'kick');
    if(i.pass&&!pv.pass)startCharge(hu,'pass');
    if(i.feint)doFeint(hu);
    if(i.swap)switchPlayer(hu);
    if(i.slide)startSlide(P[hu.ctrl]);
    if((i.jump&&!pv.jump)||i.jumpP)startJump(P[hu.ctrl]);
    if(i.control)startControl(P[hu.ctrl]);
  }
  if(!i.kick&&pv.kick)releaseCharge(hu,'kick');
  if(!i.pass&&pv.pass)releaseCharge(hu,'pass');
  pv.kick=i.kick;pv.pass=i.pass;pv.jump=i.jump;
  i.feint=i.swap=i.slide=i.reset=i.control=i.jumpP=0;
}

/* ================= PASSO FIXO ================= */
function step(dt){
  G.t+=dt;
  if(G.over)return;
  for(const hu of humans)applyInput(hu);
  if(G.boost>0)G.boost=Math.max(0,G.boost-dt*0.35);
  const st0=G.state;
  if(st0==='ready'){G.timer-=dt;if(G.timer<=0){G.state='play';if(!G.sp)sfx('whistle',0.5);}}
  else if(st0==='out'){G.timer-=dt;if(G.timer<=0)afterOut();}
  else if(st0==='goal'){G.timer-=dt;if(G.timer<=0)afterGoal();}
  const st=G.state,play=st==='play';
  if(st!=='end'){
    if(play){G.el+=dt;G.time=Math.max(0,G.end-G.el);checkPeriod();}
    if(G.state==='half')breakStep(dt);
    computeRanks();
    const userOK=st==='play'||st==='ready'||st==='out';
    for(const p of P){
      if(!p.active)continue;
      const hu=humanOf(p);
      p.domCd-=dt;if(p.dom){p.dom.t+=dt;domStep(p,dt);if(p.dom.t>0.45){p.dom=null;p.domCd=0.5;}}p.cool-=dt;p.slideCd-=dt;p.headCd-=dt;p.bikeCd-=dt;p.feintCd-=dt;p.throwT-=dt;p.jumpCd-=dt;
      if(p.stun>0){p.stun-=dt;steer(p,0,0,dt,14);}
      else if(p.slide)slideStep(p,dt);
      else if(p.aer)aerStep(p,dt);
      else if(st==='half')breakMove(p,dt);
      else if(hu&&userOK)userControl(hu,dt);
      else if(cornerPrep()&&!p.gk){const sl=cornerSlot(p);if(sl)moveAI(p,sl[0],sl[1],6.5,dt);else steer(p,0,0,dt,26);}
      else if(play){if(p.gk)gkUpdate(p,dt);else aiField(p,dt);}
      else steer(p,0,0,dt,26);
      if(p.jump)jumpStep(p,dt);
      updateKick(p,dt);
      if(p.feint){const f=p.feint;f.t+=dt;
        if(f.style==='giro'&&f.carry&&!ball.held&&G.state==='play'){
          if(f.t<0.5){const u=clamp(f.t/0.5,0,1),e=u*u*(3-2*u),a=p.yaw+f.dir*Math.PI*2*e,tx=p.pos.x+Math.sin(a)*0.78,tz=p.pos.z+Math.cos(a)*0.78,k=1-Math.exp(-24*dt);
            ball.vx+=((p.vx+(tx-ball.x)*14)-ball.vx)*k;ball.vz+=((p.vz+(tz-ball.z)*14)-ball.vz)*k;if(ball.y>BR+0.05&&ball.vy>0)ball.vy*=0.5;touch(p);}
          else if(!f.rel){f.rel=1;ball.vx=p.vx+Math.sin(p.yaw)*3.5;ball.vz=p.vz+Math.cos(p.yaw)*3.5;sfx('touch',0.6);}
        }
        if(f.style==='lambreta'&&f.carry&&!ball.held&&G.state==='play'){
          if(f.t<0.14){const tx=p.pos.x+Math.sin(p.yaw)*0.45,tz=p.pos.z+Math.cos(p.yaw)*0.45,k=1-Math.exp(-24*dt);
            ball.vx+=((p.vx+(tx-ball.x)*14)-ball.vx)*k;ball.vz+=((p.vz+(tz-ball.z)*14)-ball.vz)*k;touch(p);}
          else if(!f.rel){f.rel=1;const fx=Math.sin(p.yaw),fz=Math.cos(p.yaw);
            ball.vx=p.vx*0.2+fx*3.6;ball.vz=p.vz*0.2+fz*3.6;ball.vy=7.4;if(ball.y<BR+0.05)ball.y=BR+0.05;ball.spin=0;
            ball.noColP=p;ball.noColT=0.5;touch(p);sfx('kick',0.5);emit(p.pos.x+fx*0.4,0.2,p.pos.z+fz*0.4,10,2,1.6,[0xffffff,0xffe14d],0.45);}
        }
        if(f.t>0.55)p.feint=null;}
      if(p.cel>0)p.cel-=dt;
      p.pos.x=clamp(p.pos.x+p.vx*dt,-W-2.5,W+2.5);p.pos.z=clamp(p.pos.z+p.vz*dt,-L-3,L+3);
    }
    separate();
    spRestrict(dt);
    if(play)magnet(dt);
    if(play||st==='goal'){
      homeStep(dt);physics(dt);
      if(play){checkGoal();checkOut();}
    }
  }
  for(const hu of humans){
    const u=P[hu.ctrl],ch=hu.ch;
    if(ch.on){if(G.state!=='play'||u.kick||u.slide||u.aer||u.stun>0)ch.on=false;else ch.t+=dt;}
    if(hu.cAim&&(!G.sp||G.sp.type!=='corner'||G.shotId!==G.sp.id||G.state==='end'))hu.cAim=null;
    camUpdate(hu,dt);
  }
}

/* ================= API ================= */
function addHuman(id,team,o){
  o=o||{};
  const free=P.filter(p=>p.active&&p.team===team&&!p.gk&&!humanOf(p)).sort((a,b)=>Math.hypot(a.pos.x-ball.x,a.pos.z-ball.z)-Math.hypot(b.pos.x-ball.x,b.pos.z-ball.z));
  if(!free.length)return null;
  const h={id,team,ctrl:free[0].idx,ch:{on:false,type:'',t:0},in:IN0(),prev:{kick:0,pass:0,jump:0},cAim:null,
    camDist:clamp(o.camDist||7.5,4,16),camH:clamp(o.camH===undefined?0.5:o.camH,0,5),sens:clamp(o.sens||1,0.3,2.5),
    cam:{yaw:team===0?0:Math.PI,pitch:0.5,fx:free[0].pos.x,fz:free[0].pos.z,px:0,py:3,pz:0,dx:0,dy:-0.3,dz:1}};
  h.in.yaw=h.cam.yaw;
  humans.push(h);camUpdate(h,0);return h;
}
function removeHuman(id){const i=humans.findIndex(h=>h.id===id);if(i>=0){humans[i].ch.on=false;humans.splice(i,1);}}
function setInput(id,inp){
  const h=humans.find(x=>x.id===id);if(!h)return;
  for(const k of ['fwd','back','left','right','sprint','jump','kick','pass'])if(k in inp)h.in[k]=inp[k]?1:0;
  if('yaw' in inp)h.in.yaw=+inp.yaw;if('pitch' in inp)h.in.pitch=+inp.pitch;
  for(const k of ['feint','swap','slide','reset','control','jumpP'])if(inp[k])h.in[k]=1;
  h.in.ax+=+inp.ax||0;h.in.ay+=+inp.ay||0;
}
function start(kickTeam){
  assignFormation(0,FORM_DEFS[opts.formations[0]]?opts.formations[0]:'padrao');
  assignFormation(1,FORM_DEFS[opts.formations[1]]?opts.formations[1]:'padrao');
  G.score=[0,0];G.el=0;G.ph=0;G.over=false;G.end=opts.duration;G.time=opts.duration;
  kickoff(kickTeam|0);
}
function flags(p){
  return (p.kick?1:0)|(p.slide?2:0)|(p.aer?(p.aer.type==='bike'?8:4):0)|(p.jump?16:0)|(p.stun>0?32:0)|(p.cel>0?64:0)|(p.sad?128:0)|(p.thrower?256:0)|(p.dive>0?512:0)|(p.feint?1024:0)|(ball.held===p?2048:0);
}
function snapshot(){
  return {tm:+G.t.toFixed(3),state:G.state,ph:G.ph,el:+G.el.toFixed(2),score:G.score.slice(),
    ball:[ball.x,ball.y,ball.z,ball.vx,ball.vy,ball.vz,ball.spin,ball.held?ball.held.idx:-1],
    pl:P.map(p=>[p.pos.x,p.pos.y,p.pos.z,p.yaw,p.vx,p.vz,flags(p)]),
    hu:humans.map(h=>({id:h.id,ctrl:h.ctrl,aim:h.cAim?[h.cAim.x,h.cAim.z]:null,ch:h.ch.on?h.ch.t:-1,cd:[P[h.ctrl].slideCd,P[h.ctrl].bikeCd,P[h.ctrl].feintCd]}))};
}
return {G,P,ball,humans,step,start,addHuman,removeHuman,setInput,snapshot,drain:()=>EV.splice(0),
  C:{W,L,GW,GH,GD,BR,PR,G_}};
}
module.exports={createSim,FORM_DEFS};
