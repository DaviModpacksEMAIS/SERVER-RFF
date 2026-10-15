'use strict';
/* Servidor do Futebol 3D: HTTP (página) + WebSocket (salas) na mesma porta.
   Cada sala roda uma simulação autoritativa a 60 Hz e manda snapshots a 20 Hz. */
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const {createSim}=require('./sim/core');

const PORT=process.env.PORT||3000;
const TICK=1/60,SNAP_EVERY=3,MAX_PER_TEAM=2,MAX_ROOMS=10,MAX_MSG=2048,MAX_IN_PER_SEC=200;
const PUBLIC=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};

const server=http.createServer((req,res)=>{
  const url=(req.url||'/').split('?')[0];
  if(url==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok');}
  const f=url==='/'?'index.html':url.replace(/^\/+/,'');
  const fp=path.join(PUBLIC,path.normalize(f));
  if(!fp.startsWith(PUBLIC+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);return res.end('nao encontrado');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(d);
  });
});

const rooms=new Map();
let nextId=1;
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o));};

class Room{
  constructor(code){
    this.code=code;this.clients=new Map();this.tickN=0;this.acc=0;this.last=process.hrtime.bigint();this.overAt=0;this.emptyAt=Date.now();
    this.newMatch();
    this.timer=setInterval(()=>this.loop(),8);
  }
  newMatch(){
    const old=this.sim?[...this.sim.humans]:[];
    this.sim=createSim({seed:(Date.now()^(Math.random()*1e9))>>>0,duration:180});
    this.sim.start(0);this.overAt=0;
    for(const c of this.clients.values())this.sim.addHuman(c.id,c.team,{});
  }
  teamCount(t){let n=0;for(const c of this.clients.values())if(c.team===t)n++;return n;}
  add(ws,name){
    const t0=this.teamCount(0),t1=this.teamCount(1);
    if(t0>=MAX_PER_TEAM&&t1>=MAX_PER_TEAM)return null;
    const team=t0<=t1?(t0<MAX_PER_TEAM?0:1):(t1<MAX_PER_TEAM?1:0);
    const c={ws,id:'p'+(nextId++),name,team,ack:0,msgs:0,msgT:0};
    this.clients.set(ws,c);this.sim.addHuman(c.id,team,{});this.emptyAt=0;
    return c;
  }
  remove(ws){
    const c=this.clients.get(ws);if(!c)return;
    this.sim.removeHuman(c.id);this.clients.delete(ws);
    if(!this.clients.size)this.emptyAt=Date.now();
    this.roster();
  }
  roster(){
    const r=[...this.clients.values()].map(c=>({id:c.id,name:c.name,team:c.team}));
    this.broadcast({t:'roster',r});
  }
  broadcast(o){const s=JSON.stringify(o);for(const ws of this.clients.keys())if(ws.readyState===1)ws.send(s);}
  loop(){
    const now=process.hrtime.bigint();
    this.acc+=Math.min(0.1,Number(now-this.last)/1e9);this.last=now;
    while(this.acc>=TICK){
      this.sim.step(TICK);this.acc-=TICK;this.tickN++;
      const ev=this.sim.drain();if(ev.length)this.broadcast({t:'ev',e:ev});
      if(this.tickN%SNAP_EVERY===0){
        const snap=this.sim.snapshot();
        for(const [ws,c] of this.clients)send(ws,Object.assign({t:'snap',ack:c.ack},snap));
      }
    }
    if(this.sim.G.over){if(!this.overAt)this.overAt=Date.now();else if(Date.now()-this.overAt>10000){this.newMatch();this.broadcast({t:'newmatch'});this.roster();}}
    if(!this.clients.size&&this.emptyAt&&Date.now()-this.emptyAt>30000)this.close();
  }
  close(){clearInterval(this.timer);rooms.delete(this.code);}
}

const wss=new WebSocketServer({server,maxPayload:MAX_MSG});
wss.on('connection',ws=>{
  ws.alive=true;ws.on('pong',()=>{ws.alive=true;});
  let room=null;
  ws.on('message',buf=>{
    let m;try{m=JSON.parse(buf.toString());}catch(e){return;}
    if(!m||typeof m.t!=='string')return;
    if(m.t==='ping'){return send(ws,{t:'pong',ts:m.ts});}
    if(m.t==='join'&&!room){
      const code=String(m.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
      const name=String(m.name||'Jogador').replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,14)||'Jogador';
      if(code.length<3)return send(ws,{t:'err',msg:'Código da sala: 3 a 8 letras/números.'});
      let r=rooms.get(code);
      if(!r){if(rooms.size>=MAX_ROOMS)return send(ws,{t:'err',msg:'Servidor cheio, tente mais tarde.'});r=new Room(code);rooms.set(code,r);}
      const c=r.add(ws,name);
      if(!c)return send(ws,{t:'err',msg:'Sala cheia ('+MAX_PER_TEAM*2+' jogadores).'});
      room=r;send(ws,{t:'joined',id:c.id,team:c.team,room:code,C:r.sim.C});r.roster();return;
    }
    if(!room)return;
    const c=room.clients.get(ws);if(!c)return;
    if(m.t==='in'){
      const now=Date.now();if(now-c.msgT>1000){c.msgT=now;c.msgs=0;}
      if(++c.msgs>MAX_IN_PER_SEC)return;
      if(Number.isFinite(m.seq))c.ack=m.seq|0;
      room.sim.setInput(c.id,m);
    }
  });
  ws.on('close',()=>{if(room)room.remove(ws);});
  ws.on('error',()=>{});
});
setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},20000);

if(require.main===module)server.listen(PORT,()=>console.log('Futebol 3D ouvindo na porta '+PORT));
module.exports={server,rooms};
