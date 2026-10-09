const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');
const app = express();
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/health', (req, res) => res.json({ok:true, game:"Don't Dedonate"}));
const server = http.createServer(app);
const wss = new WebSocketServer({server, maxPayload:2048});
const rooms = new Map();
const colors = ['#ff9843','#bb8bff','#69efb8','#ff83bc','#ffe27d','#78cfff','#e1b1ff','#b0dc64'];
const hats=['none','witch','crown','bow','party','pirate','top','horns','pumpkin','halo','wizard'];
const characters=['ghost','spider','pumpkin','skeleton','witch','bat'];
const rnd = (a,b) => a + Math.random() * (b-a);
const active = r => [...r.players.values()].filter(p => !p.spectator);
const living = r => active(r).filter(p => p.alive);
const maps=[
 {id:'cemetery',name:'Haunted Cemetery',description:'Weave between tombstones. The dead are watching.',obstacles:[{x:160,y:110,w:42,h:62,kind:'grave'},{x:290,y:95,w:42,h:62,kind:'grave'},{x:470,y:95,w:42,h:62,kind:'grave'},{x:600,y:110,w:42,h:62,kind:'grave'},{x:160,y:300,w:42,h:62,kind:'grave'},{x:290,y:315,w:42,h:62,kind:'grave'},{x:470,y:315,w:42,h:62,kind:'grave'},{x:600,y:300,w:42,h:62,kind:'grave'}]},
 {id:'forest',name:'Wicked Forest',description:'Cross the river on two wooden bridges. Trees block your path.',obstacles:[{x:360,y:0,w:80,h:110,kind:'water'},{x:360,y:210,w:80,h:60,kind:'water'},{x:360,y:370,w:80,h:110,kind:'water'},...[[130,100],[250,290],[100,330],[570,110],[640,300],[520,330]].map(([x,y])=>({x,y,w:44,h:48,kind:'tree'}))]},
 {id:'patch',name:'Pumpkin Patch Panic',description:'Dodge hay bales and giant pumpkins. Keep the chase alive!',obstacles:[{x:155,y:125,w:100,h:40,kind:'hay'},{x:545,y:315,w:100,h:40,kind:'hay'},{x:330,y:205,w:140,h:40,kind:'hay'},...[[570,105],[180,320],[310,330],[465,100]].map(([x,y])=>({x,y,w:46,h:46,kind:'pumpkin'}))]}
];
const mapFor=r=>maps.find(m=>m.id===r.mapId)||maps[0];
function valid(r,x,y,edge=22,radius=19){return x>=edge&&x<=800-edge&&y>=edge&&y<=480-edge&&!mapFor(r).obstacles.some(o=>x>o.x-radius&&x<o.x+o.w+radius&&y>o.y-radius&&y<o.y+o.h+radius);}
function safePosition(r,edge=40,near=null){let best=null,distance=Infinity;if(!near)for(let i=0;i<200;i++){const point={x:rnd(edge,800-edge),y:rnd(edge,480-edge)};if(valid(r,point.x,point.y,edge))return point;}for(let y=edge;y<=480-edge;y+=10)for(let x=edge;x<=800-edge;x+=10){if(!valid(r,x,y,edge))continue;const d=near?Math.hypot(x-near.x,y-near.y):0;if(d<distance){best={x,y};distance=d;}}return best||{x:60,y:240};}
function clearLine(r,a,b,edge=22){const steps=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/7);for(let i=0;i<=steps;i++){const t=steps?i/steps:0;if(!valid(r,a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,edge))return false;}return true;}
function route(r,from,to,edge){if(clearLine(r,from,to,edge))return to;const nodes=[];for(let y=40;y<=440;y+=40)for(let x=40;x<=760;x+=40)if(valid(r,x,y,edge))nodes.push({x,y});const starts=nodes.filter(n=>clearLine(r,from,n,edge)).sort((a,b)=>Math.hypot(a.x-from.x,a.y-from.y)-Math.hypot(b.x-from.x,b.y-from.y));const goals=nodes.filter(n=>clearLine(r,n,to,edge)).sort((a,b)=>Math.hypot(a.x-to.x,a.y-to.y)-Math.hypot(b.x-to.x,b.y-to.y));if(!starts.length||!goals.length)return from;const start=starts[0],goal=goals[0],queue=[start],parents=new Map([[start,null]]);for(let i=0;i<queue.length;i++){const node=queue[i];if(node===goal){let next=node;while(parents.get(next)&&parents.get(next)!==start)next=parents.get(next);return next;}for(const next of nodes){if(parents.has(next)||Math.abs(next.x-node.x)+Math.abs(next.y-node.y)!==40||!clearLine(r,node,next,edge))continue;parents.set(next,node);queue.push(next);}}return start;}
function move(r,p,dx,dy,edge){const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/6));for(let i=0;i<steps;i++){if(valid(r,p.x+dx/steps,p.y,edge))p.x+=dx/steps;if(valid(r,p.x,p.y+dy/steps,edge))p.y+=dy/steps;}}
function publicState(r) {
  return {map:mapFor(r),phase:r.phase,host:r.host,holder:r.holder,round:r.round,countdown:Math.max(0,Math.ceil(r.countdown||0)),practice:!!r.practice,explosion:r.explosion,winner:r.winner,event:r.event,eventLeft:r.eventLeft,powerups:r.powerups,notice:r.notice,
    players:[...r.players.values()].map(({id,name,x,y,alive,color,spectator,wins,passes,speed,shield,character,hat,bot}) => ({id,name,x,y,alive,color,spectator,wins,passes,speed,shield,character,hat,bot}))};
}
function broadcast(r) { const data=JSON.stringify({type:'state',state:publicState(r)}); for(const p of r.players.values()) if(p.ws?.readyState===1&&(p.ws.bufferedAmount||0)<65536)p.ws.send(data); }
function fail(ws,message){ws.send(JSON.stringify({type:'error',message}));}
function code(){let c;do{c=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(c));return c;}
function finish(r){if(r.phase!=='playing')return;const survivors=living(r);if(survivors.length>1)return;r.phase='ended';r.holder=null;r.event=null;r.powerups=[];r.winner=survivors[0]?.name||'Nobody';if(survivors[0])survivors[0].wins++;r.notice=r.winner+' survived the haunted hollow!';}
function spawn(r){if(r.powerups.length>=4)return;const edge=r.event==='shrink'?115:55;const point=safePosition(r,edge);const type=['speed','shield','teleport'][Math.floor(Math.random()*3)];r.powerups.push({id:crypto.randomUUID(),type,x:point.x,y:point.y});}
function start(r){const players=active(r);if(players.length<2)return;r.mapId=maps[Math.floor(Math.random()*maps.length)].id;r.phase='countdown';r.countdown=3;r.round++;r.explosion=null;r.winner='';r.fuse=rnd(8000,16000);r.holder=players[Math.floor(Math.random()*players.length)].id;r.cooldown=1.2;r.powerups=[];r.spawnIn=4;r.event=null;r.eventLeft=0;r.eventIn=7;r.notice='Get ready to HAUNT!';for(const p of r.players.values()){p.alive=!p.spectator;Object.assign(p,safePosition(r,50));p.routeAt=0;p.waypoint=null;p.keys=[];p.inputAt=Date.now();p.target=null;p.speed=0;p.shield=0;}spawn(r);broadcast(r);}
wss.on('connection',ws=>{
  let current=null;const id=crypto.randomUUID();
  ws.on('error',()=>{});
  let messageWindow=Date.now(),messageCount=0;
  ws.on('message',raw=>{if(Date.now()-messageWindow>1000){messageWindow=Date.now();messageCount=0;}if(++messageCount>100)return;handle(raw);});
  function handle(raw){let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
    if(!current&&(m.type==='create'||m.type==='join')){
      let r;if(m.type==='create'){const c=code();r={code:c,players:new Map(),phase:'lobby',host:id,holder:null,round:0,winner:'',powerups:[],event:null,eventLeft:0,practice:m.practice===true,explosion:null,notice:'Gather your ghouls. Two players needed.'};rooms.set(c,r);}else r=rooms.get(String(m.room||'').trim().toUpperCase());
      if(!r)return fail(ws,'That room does not exist. Check the code.');
      if(r.players.size>=24)return fail(ws,'This room is full (24 guests).');
      const spectator=m.spectator===true||['playing','countdown'].includes(r.phase)||active(r).length>=8;
      const p={id,ws,name:String(m.name||'Ghoul').replace(/[\x00-\x1f]/g,'').trim().slice(0,14)||'Ghoul',x:rnd(50,750),y:rnd(50,430),alive:!spectator,spectator,character:characters.includes(m.character)?m.character:'ghost',bot:false,hat:'none',color:colors[active(r).length%8],keys:[],wins:0,passes:0,speed:0,shield:0};
      Object.assign(p,safePosition(r,50));r.players.set(id,p);if(m.type==='create'&&r.practice){p.spectator=false;p.alive=true;for(let i=0;i<3;i++){const bid=crypto.randomUUID();r.players.set(bid,{id:bid,ws:null,name:['Webby Bot','Patch Bot','Bones Bot'][i],x:rnd(50,750),y:rnd(50,430),alive:true,spectator:false,character:['spider','pumpkin','skeleton'][i],bot:true,hat:['witch','crown','bow'][i],color:colors[i+1],keys:[],wins:0,passes:0,speed:0,shield:0});}}current=r;ws.send(JSON.stringify({type:'welcome',id,room:r.code}));broadcast(r);return;
    }
    if(!current)return;const p=current.players.get(id);if(!p)return;
    if(m.type==='start'&&current.host===id&&['lobby','ended'].includes(current.phase))start(current);
    if(m.type==='seat'&&['lobby','ended'].includes(current.phase)){
      if(m.spectator===true){p.spectator=true;p.alive=false;}else if(!p.spectator||active(current).length<8){p.spectator=false;p.alive=true;p.color=colors.find(c=>![...current.players.values()].some(q=>q.id!==p.id&&!q.spectator&&q.color===c))||colors[0];}else return fail(ws,'All 8 player spots are taken.');broadcast(current);
    }
    if(m.type==='customize'&&['lobby','ended'].includes(current.phase)){if(characters.includes(m.character))p.character=m.character;if(hats.includes(m.hat))p.hat=m.hat;broadcast(current);}
    if(m.type==='input'&&current.phase==='playing'&&p.alive&&!p.spectator){p.keys=Array.isArray(m.keys)?m.keys.filter(k=>typeof k==='string').slice(0,8):[];p.inputAt=Date.now();}
  }
  ws.on('close',()=>{if(!current)return;current.players.delete(id);if(current.host===id)current.host=[...current.players.values()].find(p=>!p.bot&&!p.spectator)?.id||[...current.players.values()].find(p=>!p.bot)?.id||null;if(current.holder===id){current.holder=living(current)[0]?.id||null;current.cooldown=1.2;}if(![...current.players.values()].some(p=>!p.bot))rooms.delete(current.code);else{if(current.phase==='countdown'&&active(current).length<2)current.phase='lobby';finish(current);broadcast(current);}});
});
let prev=Date.now();
function tick(){const now=Date.now(),dt=Math.min((now-prev)/1000,.1);prev=now;
  for(const r of rooms.values()){
    if(r.phase==='countdown'){if(active(r).length<2){r.phase='lobby';broadcast(r);continue;}r.countdown-=dt;if(r.countdown<=0){r.phase='playing';r.notice='HAUNT! Pass the BOMB!';}broadcast(r);continue;}
    if(r.phase!=='playing')continue;finish(r);if(r.phase!=='playing'){broadcast(r);continue;}
    r.fuse-=dt*1000;r.cooldown=Math.max(0,r.cooldown-dt);r.spawnIn-=dt;r.eventIn-=dt;
    if(r.spawnIn<=0){spawn(r);r.spawnIn=5;}
    if(r.eventLeft>0){r.eventLeft-=dt;if(r.eventLeft<=0){r.event=null;r.notice='The curse has lifted.';}}
    if(r.eventIn<=0){r.event=['fog','rush','shrink'][Math.floor(Math.random()*3)];r.eventLeft=6;r.eventIn=13;r.notice={fog:'Ghost fog! Watch the glowing outlines.',rush:'Witching hour! Everyone moves faster.',shrink:'Closing gates! The hollow is shrinking.'}[r.event];}
    const alive=living(r),edge=r.event==='shrink'?90:22;
    for(const item of r.powerups){if(!valid(r,item.x,item.y,edge+20))Object.assign(item,safePosition(r,edge+20,item));}
    for(const p of alive){if(!valid(r,p.x,p.y,edge))Object.assign(p,safePosition(r,edge,p));if(!p.bot&&now-(p.inputAt||0)>750)p.keys=[];p.speed=Math.max(0,p.speed-dt);p.shield=Math.max(0,p.shield-dt);if(p.bot){const holder=r.players.get(r.holder);let target;if(holder?.id===p.id)target=alive.filter(q=>q.id!==p.id&&q.shield<=0).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];else if(holder&&Math.hypot(holder.x-p.x,holder.y-p.y)<240){const options=[{x:edge+35,y:edge+35},{x:765-edge,y:edge+35},{x:edge+35,y:445-edge},{x:765-edge,y:445-edge}];target=options.sort((a,b)=>(Math.hypot(b.x-holder.x,b.y-holder.y)-.4*Math.hypot(b.x-p.x,b.y-p.y))-(Math.hypot(a.x-holder.x,a.y-holder.y)-.4*Math.hypot(a.x-p.x,a.y-p.y)))[0];}else{if(!p.target||Math.hypot(p.target.x-p.x,p.target.y-p.y)<35)p.target={x:rnd(edge,800-edge),y:rnd(edge,480-edge)};target=p.target;}p.keys=[];if(target){target={x:target.x,y:target.y};target.x=Math.max(edge+10,Math.min(790-edge,target.x));target.y=Math.max(edge+10,Math.min(470-edge,target.y));if(!valid(r,target.x,target.y,edge))target=safePosition(r,edge,target);if(now-(p.routeAt||0)>200||!p.waypoint||Math.hypot(p.waypoint.x-p.x,p.waypoint.y-p.y)<12){p.waypoint=route(r,p,target,edge);p.routeAt=now;}target=p.waypoint;if(target.x>p.x+5)p.keys.push('d');if(target.x<p.x-5)p.keys.push('a');if(target.y>p.y+5)p.keys.push('s');if(target.y<p.y-5)p.keys.push('w');}}const k=p.keys;
      const dx=Number(k.includes('d')||k.includes('D')||k.includes('ArrowRight'))-Number(k.includes('a')||k.includes('A')||k.includes('ArrowLeft'));
      const dy=Number(k.includes('s')||k.includes('S')||k.includes('ArrowDown'))-Number(k.includes('w')||k.includes('W')||k.includes('ArrowUp'));
      const length=Math.hypot(dx,dy)||1,speed=185*(p.id===r.holder?1.08:1)*(p.speed>0?1.6:1)*(r.event==='rush'?1.35:1);
      move(r,p,dx/length*speed*dt,dy/length*speed*dt,edge);
      const pickup=r.powerups.find(item=>Math.hypot(p.x-item.x,p.y-item.y)<33);
      if(pickup){r.powerups=r.powerups.filter(item=>item.id!==pickup.id);if(pickup.type==='speed')p.speed=5;if(pickup.type==='shield')p.shield=5;if(pickup.type==='teleport'){Object.assign(p,safePosition(r,edge+20));}r.notice=p.name+' picked up '+pickup.type+'!';}
    }
    let holder=r.players.get(r.holder);
    if(holder&&r.cooldown<=0){const target=alive.find(p=>p.id!==holder.id&&p.shield<=0&&Math.hypot(p.x-holder.x,p.y-holder.y)<40&&clearLine(r,holder,p,edge));if(target){r.holder=target.id;holder.passes++;r.cooldown=1.2;r.notice=holder.name+' passed the BOMB to '+target.name+'!';}}
    if(r.fuse<=0){holder=r.players.get(r.holder);if(holder){holder.alive=false;holder.keys=[];r.explosion={id:crypto.randomUUID(),playerId:holder.id,x:holder.x,y:holder.y};r.notice=holder.name+' was BOO-m blasted!';}finish(r);if(r.phase==='playing'){const survivors=living(r);r.holder=survivors[Math.floor(Math.random()*survivors.length)].id;r.fuse=rnd(7000,14000);r.cooldown=1.5;}}
    broadcast(r);
  }
}
setInterval(tick,50);
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Dont Dedonate is haunting port '+(process.env.PORT||3000)));
