'use strict';
/* Teste de rede ponta a ponta: sobe o servidor numa porta livre e conecta clientes WebSocket de verdade. */
const http=require('http'),WebSocket=require('ws');
process.env.PORT=0;
const {server,rooms}=require('../server');
let fails=0;const ok=(c,m)=>{console.log((c?'  ok  ':' FALHA ')+m);if(!c)fails++;};
const get=(port,p)=>new Promise(r=>http.get({port,path:p},res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>r({s:res.statusCode,d}));}));
function client(port){
  return new Promise(res=>{
    const ws=new WebSocket('ws://127.0.0.1:'+port),c={ws,snaps:[],ev:[],msgs:[],bytes:0};
    ws.on('open',()=>res(c));
    ws.on('message',b=>{c.bytes+=b.length;const m=JSON.parse(b.toString());c.msgs.push(m);
      if(m.t==='joined')c.me=m;else if(m.t==='snap')c.snaps.push(m);else if(m.t==='ev')c.ev.push(...m.e);else if(m.t==='pong')c.pong=m;else if(m.t==='err')c.err=m.msg;});
    c.send=o=>ws.send(JSON.stringify(o));
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0,async()=>{
  const port=server.address().port;
  let r=await get(port,'/health');ok(r.s===200&&r.d==='ok','/health responde ok');
  r=await get(port,'/');ok(r.s===200&&r.d.includes('Futebol 3D'),'/ entrega a página');
  r=await get(port,'/../server.js');ok(r.s!==200,'não deixa ler arquivos fora de /public');

  const a=await client(port),b=await client(port);
  a.send({t:'join',room:'amigos!',name:'Ana'});b.send({t:'join',room:'AMIGOS',name:'Bia'});
  await sleep(300);
  ok(a.me&&b.me&&a.me.room==='AMIGOS','entraram na mesma sala (código normalizado)');
  ok(a.me.team!==b.me.team,'times balanceados: '+a.me.team+' e '+b.me.team);
  const c=await client(port),d=await client(port),e=await client(port);
  c.send({t:'join',room:'AMIGOS',name:'Cai'});d.send({t:'join',room:'AMIGOS',name:'Davi'});e.send({t:'join',room:'AMIGOS',name:'Edu'});
  await sleep(300);
  ok(c.me&&d.me&&!e.me&&/cheia/.test(e.err||''),'5º jogador é recusado (sala 2v2 cheia)');
  const teams=[a,b,c,d].map(x=>x.me.team).sort().join('');ok(teams==='0011','2v2 formado: '+teams);

  a.snaps.length=0;a.bytes=0;const t0=Date.now();
  await sleep(2000);
  const dt=(Date.now()-t0)/1000,rate=a.snaps.length/dt;
  ok(rate>17&&rate<23,'snapshots a ~20Hz (medido '+rate.toFixed(1)+'Hz)');
  ok(a.bytes/dt/1024<30,'tráfego por jogador: '+(a.bytes/dt/1024).toFixed(1)+' KB/s (JSON; binário vem depois)');

  // entrada: Ana corre pra frente e a posição do jogador dela muda
  const s0=a.snaps[a.snaps.length-1],ctrl0=s0.hu.find(h=>h.id===a.me.id).ctrl,p0=s0.pl[ctrl0].slice();
  for(let i=0;i<90;i++){a.send({t:'in',seq:i+1,yaw:a.me.team===0?0:Math.PI,pitch:0.5,fwd:1,sprint:1});await sleep(16);}
  const s1=a.snaps[a.snaps.length-1],p1=s1.pl[s1.hu.find(h=>h.id===a.me.id).ctrl];
  ok(Math.hypot(p1[0]-p0[0],p1[2]-p0[2])>2,'entrada move o jogador no servidor ('+Math.hypot(p1[0]-p0[0],p1[2]-p0[2]).toFixed(1)+' m)');
  ok(s1.ack>=80,'servidor confirma o número da última entrada (ack='+s1.ack+')');

  a.send({t:'ping',ts:123});await sleep(100);ok(a.pong&&a.pong.ts===123,'ping/pong');
  a.ws.send('{{{lixo');a.ws.send(JSON.stringify({t:'in',yaw:'abc',fwd:'x',pitch:NaN}));a.ws.send(JSON.stringify({t:'zzz'}));
  await sleep(200);
  ok(a.ws.readyState===1,'JSON inválido e valores absurdos não derrubam nem desconectam o jogador');
  const bad=await client(port);bad.send({t:'join',room:'LIXO',name:'Mau'});await sleep(150);
  bad.ws.send(JSON.stringify({t:'in',pad:'x'.repeat(5000)}));await sleep(300);
  ok(bad.ws.readyState!==1,'mensagem gigante desconecta quem mandou');
  const alive=await client(port);alive.send({t:'join',room:'OUTRA',name:'Zé'});await sleep(200);
  ok(alive.me&&rooms.has('OUTRA')&&rooms.has('AMIGOS'),'servidor segue funcionando e salas são independentes');
  b.ws.close();await sleep(200);
  const last=a.msgs.filter(m=>m.t==='roster').pop();ok(last&&last.r.length===3,'saída de jogador atualiza a lista da sala');
  for(const x of [a,c,d,e,alive])x.ws.close();
  await sleep(100);
  console.log(fails?'FALHOU ('+fails+')':'REDE OK');process.exit(fails?1:0);
});
