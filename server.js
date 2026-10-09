const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');
const app = express();
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/health', (req, res) => res.json({ok:true, game:'Dednate'}));
const server = http.createServer(app);
const wss = new WebSocketServer({server, maxPayload:2048});
const rooms = new Map();
const colors = ['#ff9843','#bb8bff','#69efb8','#ff83bc','#ffe27d','#78cfff','#e1b1ff','#b0dc64'];
const rnd = (a,b) => a + Math.random() * (b-a);
const active = r => [...r.players.values()].filter(p => !p.spectator);
const living = r => active(r).filter(p => p.alive);
function publicState(r) {
  return {phase:r.phase,host:r.host,holder:r.holder,round:r.round,winner:r.winner,event:r.event,eventLeft:r.eventLeft,powerups:r.powerups,notice:r.notice,
    players:[...r.players.values()].map(({id,name,x,y,alive,color,spectator,wins,passes,speed,shield}) => ({id,name,x,y,alive,color,spectator,wins,passes,speed,shield}))};
}
function broadcast(r) { const data=JSON.stringify({type:'state',state:publicState(r)}); for(const p of r.players.values()) if(p.ws.readyState===1)p.ws.send(data); }
function fail(ws,message){ws.send(JSON.stringify({type:'error',message}));}
function code(){let c;do{c=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(c));return c;}
function finish(r){if(r.phase!=='playing')return;const survivors=living(r);if(survivors.length>1)return;r.phase='ended';r.holder=null;r.event=null;r.powerups=[];r.winner=survivors[0]?.name||'Nobody';if(survivors[0])survivors[0].wins++;r.notice=r.winner+' survived the haunted hollow!';}
function spawn(r){if(r.powerups.length>=4)return;const type=['speed','shield','teleport'][Math.floor(Math.random()*3)];r.powerups.push({id:crypto.randomUUID(),type,x:rnd(55,745),y:rnd(55,425)});}
function start(r){const players=active(r);if(players.length<2)return;r.phase='playing';r.round++;r.winner='';r.fuse=rnd(8000,16000);r.holder=players[Math.floor(Math.random()*players.length)].id;r.cooldown=1.2;r.powerups=[];r.spawnIn=4;r.event=null;r.eventLeft=0;r.eventIn=7;r.notice='The pumpkin is ticking. Pass it on!';for(const p of r.players.values()){p.alive=!p.spectator;p.x=rnd(50,750);p.y=rnd(50,430);p.keys=[];p.speed=0;p.shield=0;}spawn(r);broadcast(r);}
wss.on('connection',ws=>{
  let current=null;const id=crypto.randomUUID();
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
    if(!current&&(m.type==='create'||m.type==='join')){
      let r;if(m.type==='create'){const c=code();r={code:c,players:new Map(),phase:'lobby',host:id,holder:null,round:0,winner:'',powerups:[],event:null,eventLeft:0,notice:'Gather your ghouls. Two players needed.'};rooms.set(c,r);}else r=rooms.get(String(m.room||'').trim().toUpperCase());
      if(!r)return fail(ws,'That room does not exist. Check the code.');
      if(r.players.size>=24)return fail(ws,'This room is full (24 guests).');
      const spectator=m.spectator===true||r.phase==='playing'||active(r).length>=8;
      const p={id,ws,name:String(m.name||'Ghoul').replace(/[\x00-\x1f]/g,'').slice(0,14),x:rnd(50,750),y:rnd(50,430),alive:!spectator,spectator,color:colors[active(r).length%8],keys:[],wins:0,passes:0,speed:0,shield:0};
      r.players.set(id,p);current=r;ws.send(JSON.stringify({type:'welcome',id,room:r.code}));broadcast(r);return;
    }
    if(!current)return;const p=current.players.get(id);if(!p)return;
    if(m.type==='start'&&current.host===id&&current.phase!=='playing')start(current);
    if(m.type==='seat'&&current.phase!=='playing'){
      if(m.spectator===true){p.spectator=true;p.alive=false;}else if(active(current).length<8){p.spectator=false;p.alive=true;p.color=colors[active(current).length%8];}else return fail(ws,'All 8 player spots are taken.');broadcast(current);
    }
    if(m.type==='input'&&current.phase==='playing'&&p.alive&&!p.spectator)p.keys=Array.isArray(m.keys)?m.keys.filter(k=>typeof k==='string').slice(0,8):[];
  });
  ws.on('close',()=>{if(!current)return;current.players.delete(id);if(current.host===id)current.host=active(current)[0]?.id||current.players.keys().next().value||null;if(current.holder===id){current.holder=living(current)[0]?.id||null;current.cooldown=1.2;}if(!current.players.size)rooms.delete(current.code);else{finish(current);broadcast(current);}});
});
let prev=Date.now();
function tick(){const now=Date.now(),dt=Math.min((now-prev)/1000,.1);prev=now;
  for(const r of rooms.values()){
    if(r.phase!=='playing')continue;finish(r);if(r.phase!=='playing'){broadcast(r);continue;}
    r.fuse-=dt*1000;r.cooldown=Math.max(0,r.cooldown-dt);r.spawnIn-=dt;r.eventIn-=dt;
    if(r.spawnIn<=0){spawn(r);r.spawnIn=5;}
    if(r.eventLeft>0){r.eventLeft-=dt;if(r.eventLeft<=0){r.event=null;r.notice='The curse has lifted.';}}
    if(r.eventIn<=0){r.event=['fog','rush','shrink'][Math.floor(Math.random()*3)];r.eventLeft=6;r.eventIn=13;r.notice={fog:'Ghost fog! Watch the glowing outlines.',rush:'Witching hour! Everyone moves faster.',shrink:'Closing gates! The hollow is shrinking.'}[r.event];}
    const alive=living(r),edge=r.event==='shrink'?90:22;
    for(const p of alive){p.speed=Math.max(0,p.speed-dt);p.shield=Math.max(0,p.shield-dt);const k=p.keys;
      const dx=Number(k.includes('d')||k.includes('D')||k.includes('ArrowRight'))-Number(k.includes('a')||k.includes('A')||k.includes('ArrowLeft'));
      const dy=Number(k.includes('s')||k.includes('S')||k.includes('ArrowDown'))-Number(k.includes('w')||k.includes('W')||k.includes('ArrowUp'));
      const length=Math.hypot(dx,dy)||1,speed=185*(p.speed>0?1.6:1)*(r.event==='rush'?1.35:1);
      p.x=Math.max(edge,Math.min(800-edge,p.x+dx/length*speed*dt));p.y=Math.max(edge,Math.min(480-edge,p.y+dy/length*speed*dt));
      const pickup=r.powerups.find(item=>Math.hypot(p.x-item.x,p.y-item.y)<33);
      if(pickup){r.powerups=r.powerups.filter(item=>item.id!==pickup.id);if(pickup.type==='speed')p.speed=5;if(pickup.type==='shield')p.shield=5;if(pickup.type==='teleport'){p.x=rnd(edge+20,780-edge);p.y=rnd(edge+20,460-edge);}r.notice=p.name+' picked up '+pickup.type+'!';}
    }
    let holder=r.players.get(r.holder);
    if(holder&&r.cooldown<=0){const target=alive.find(p=>p.id!==holder.id&&p.shield<=0&&Math.hypot(p.x-holder.x,p.y-holder.y)<40);if(target){r.holder=target.id;holder.passes++;r.cooldown=1.2;r.notice=holder.name+' passed the pumpkin to '+target.name+'!';}}
    if(r.fuse<=0){holder=r.players.get(r.holder);if(holder){holder.alive=false;holder.keys=[];r.notice=holder.name+' was pumpkin-popped!';}finish(r);if(r.phase==='playing'){const survivors=living(r);r.holder=survivors[Math.floor(Math.random()*survivors.length)].id;r.fuse=rnd(7000,14000);r.cooldown=1.5;}}
    broadcast(r);
  }
}
setInterval(tick,50);
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Dednate is haunting port '+(process.env.PORT||3000)));
