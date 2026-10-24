const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const GAMES=require('./games'),INDEX=fs.readFileSync(path.join(__dirname,'index.html'));
const MAX=15,EMOJI='🐙🦊🐼🦄🐸🐯🦉🐳🦋🐝🐧🦔🐨🦁🐢🦜🐬🦒'.match(/./gu);
const pub=g=>{if(!g||!g.rounds)return g;const{rounds,...x}=g;return{...x,n:rounds.length}};
const rooms=new Map(),rid=n=>crypto.randomBytes(n).toString('hex');
const newCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:5},()=>a[crypto.randomInt(a.length)]).join('')}while(rooms.has(c));return c};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}};
const json=(res,s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const clean=n=>String(n||'').trim().slice(0,20);

function view(r,pid){
  const g=GAMES.find(x=>x.id===r.game)||null,on=new Set([...r.clients].map(c=>c.pid));
  const done=id=>!g?false:g.rounds?!!(r.picks[r.i]||{})[id]:g.type==='text'?r.cards.some(c=>c.pid===id):g.type==='scale'?(r.ans[id]||[]).filter(Boolean).length===g.qs.length:r.ans[id]!=null;
  const v={code:r.code,phase:r.phase,game:pub(g),endsAt:r.endsAt,isHost:pid===r.host,me:pid,
    players:Object.entries(r.players).map(([id,p])=>({id,name:p.name,emoji:p.emoji,on:on.has(id),done:done(id),host:id===r.host}))};
  if(r.phase==='lobby'&&pid===r.host)v.list=GAMES.map(({id,title,cat,desc,type})=>({id,title,cat,desc,type}));
  if(r.phase==='collect'){v.mine=r.cards.filter(c=>c.pid===pid).map(({id,col,text})=>({id,col,text}));v.myAns=r.ans[pid]??null}
  if(r.phase==='vote'){v.cards=r.cards.map(c=>({id:c.id,col:c.col,text:c.text,mine:c.votes.has(pid)}));v.left=3-r.cards.filter(c=>c.votes.has(pid)).length}
  const board=()=>Object.entries(r.players).map(([id,p])=>({name:p.name,emoji:p.emoji,score:r.score[id]||0})).sort((a,b)=>b.score-a.score);
  const counts=(i,o)=>{const c=o.map(()=>0);Object.values(r.picks[i]||{}).forEach(p=>c[p.c]++);return c};
  if(r.phase==='play'){const rd=g.rounds[r.i],o=g.type==='who'?r.names:rd.o;v.rd={i:r.i,n:g.rounds.length,q:rd.q,o,show:r.show,my:(r.picks[r.i]||{})[pid]?.c??null};
    if(r.show){v.rd.c=counts(r.i,o);if(g.type==='quiz')v.rd.a=rd.a}if(g.type==='quiz')v.board=board()}
  if(r.phase==='results'&&g.rounds){if(g.type==='quiz')v.board=board();else v.sum=g.rounds.map((rd,i)=>{const o=g.type==='who'?r.names:rd.o;return{q:rd.q,o,c:counts(i,o)}})}
  else if(r.phase==='results'){
    if(g.type==='text')v.cards=r.cards.map(c=>({id:c.id,col:c.col,text:c.text,votes:c.votes.size})).sort((a,b)=>b.votes-a.votes);
    if(g.type==='scale')v.res=g.qs.map((_,i)=>{const x=Object.values(r.ans).map(a=>a[i]).filter(Boolean),d=Array(g.max).fill(0);x.forEach(n=>d[n-1]++);return{n:x.length,avg:x.length?x.reduce((a,b)=>a+b,0)/x.length:0,dist:d}});
    if(g.type==='choice'){v.res=g.opts.map(()=>0);Object.values(r.ans).forEach(i=>v.res[i]++)}
  }
  return v;
}
const push=r=>{for(const c of r.clients)c.res.write(`data:${JSON.stringify(view(r,c.pid))}\n\n`)};

function act(r,pid,b){
  const host=pid===r.host,g=GAMES.find(x=>x.id===r.game),need=()=>{if(!host)throw Error('Only the facilitator can do that')};
  switch(b.a){
    case'pick':need();if(!GAMES.some(x=>x.id===b.id))throw Error('Unknown game');Object.assign(r,{game:b.id,phase:'ready',cards:[],ans:{},endsAt:null,picks:[],score:{},names:[],i:0,show:false});break;
    case'start':need();if(!g)return;
      if(g.rounds){Object.assign(r,{phase:'play',i:0,show:false,picks:[],score:{},names:Object.values(r.players).map(p=>p.name)});r.endsAt=g.type==='quiz'?Date.now()+20000:null;break}
      Object.assign(r,{phase:'collect',cards:[],ans:{},endsAt:b.secs>0?Date.now()+Math.min(b.secs,3600)*1000:null});break;
    case'next':need();
      if(r.phase==='play'){if(!r.show){r.show=true;r.endsAt=null;if(g.type==='quiz'){const rd=g.rounds[r.i];for(const[id,p]of Object.entries(r.picks[r.i]||{}))if(p.c===rd.a)r.score[id]=(r.score[id]||0)+100+Math.round(100*p.l)}}
        else if(++r.i>=g.rounds.length)r.phase='results';else{r.show=false;r.names=Object.values(r.players).map(p=>p.name);r.endsAt=g.type==='quiz'?Date.now()+20000:null}break}
      if(r.phase==='collect'){if(g.type==='text'&&r.cards.length){shuffle(r.cards);r.phase='vote'}else r.phase='results'}else if(r.phase==='vote')r.phase='results';r.endsAt=null;break;
    case'lobby':need();Object.assign(r,{phase:'lobby',game:null,cards:[],ans:{},endsAt:null});break;
    case'add':{if(r.phase!=='collect'||g.type!=='text')return;const t=String(b.text||'').trim().slice(0,200);if(!t)return;
      if(r.cards.filter(c=>c.pid===pid).length>=20)throw Error('Max 20 cards each');
      r.cards.push({id:rid(4),pid,col:g.cols?Math.max(0,Math.min(g.cols.length-1,b.col|0)):0,text:t,votes:new Set()});break}
    case'answer':{if(r.phase!=='play'||r.show)return;const rd=g.rounds[r.i],n=g.type==='who'?r.names.length:rd.o.length;if(!(b.c>=0&&b.c<n))return;
      if(g.type==='quiz'&&Date.now()>r.endsAt+1500)throw Error('Time is up');
      const m=r.picks[r.i]||(r.picks[r.i]={});if(g.type==='quiz'&&m[pid])return;m[pid]={c:b.c|0,l:r.endsAt?Math.max(0,Math.min(1,(r.endsAt-Date.now())/20000)):0};break}
    case'del':r.cards=r.cards.filter(c=>!(c.id===b.id&&c.pid===pid));break;
    case'vote':{if(r.phase!=='vote')return;const c=r.cards.find(c=>c.id===b.id);if(!c)return;
      if(c.votes.has(pid))c.votes.delete(pid);else if(r.cards.filter(k=>k.votes.has(pid)).length<3)c.votes.add(pid);break}
    case'rate':{if(r.phase!=='collect'||g.type!=='scale')return;const a=r.ans[pid]||(r.ans[pid]=[]);
      if(b.q>=0&&b.q<g.qs.length&&b.v>=1&&b.v<=g.max)a[b.q]=b.v;break}
    case'choose':if(r.phase!=='collect'||g.type!=='choice'||!(b.i>=0&&b.i<g.opts.length))return;r.ans[pid]=b.i;break;
  }
  push(r);
}

http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),code=(u.searchParams.get('code')||'').toUpperCase();
  try{
    if(req.method==='GET'){
      if(u.pathname==='/healthz')return res.end('ok');
      if(u.pathname==='/api/room')return json(res,rooms.has(code)?200:404,{});
      if(u.pathname==='/api/events'){
        const r=rooms.get(code),pid=u.searchParams.get('pid');
        if(!r||!r.players[pid])return json(res,404,{error:'Room not found'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 2000\n\n');const c={res,pid};r.clients.add(c);push(r);
        return req.on('close',()=>{r.clients.delete(c);push(r)});
      }
      if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(INDEX)}
      return json(res,404,{error:'Not found'});
    }
    if(req.method!=='POST')return json(res,405,{});
    let body='';for await(const ch of req){body+=ch;if(body.length>1e4)throw Error('Too large')}
    const b=JSON.parse(body||'{}');
    if(u.pathname==='/api/room'){
      const name=clean(b.name);if(!name)throw Error('Enter your name');
      const r={code:newCode(),host:rid(6),players:{},clients:new Set(),phase:'lobby',game:null,cards:[],ans:{},endsAt:null,t:Date.now(),picks:[],score:{},names:[],i:0,show:false};
      r.players[r.host]={name,emoji:EMOJI[0]};rooms.set(r.code,r);return json(res,200,{code:r.code,pid:r.host});
    }
    const r=rooms.get(String(b.code||'').toUpperCase());if(!r)return json(res,404,{error:'Room not found. Check the code.'});
    if(u.pathname==='/api/join'){
      if(b.pid&&r.players[b.pid])return json(res,200,{pid:b.pid});
      const name=clean(b.name);if(!name)throw Error('Enter your name');
      if(Object.keys(r.players).length>=MAX)throw Error(`Room is full (${MAX} people max)`);
      const pid=rid(6);r.players[pid]={name,emoji:EMOJI[Object.keys(r.players).length%EMOJI.length]};push(r);return json(res,200,{pid});
    }
    if(u.pathname==='/api/act'){if(!r.players[b.pid])return json(res,403,{error:'Not in this room'});act(r,b.pid,b);return json(res,200,{})}
    json(res,404,{error:'Not found'});
  }catch(e){json(res,400,{error:e.message})}
}).listen(process.env.PORT||8080,'0.0.0.0',()=>console.log('RetroHub on',process.env.PORT||8080));

setInterval(()=>{for(const[c,r]of rooms){for(const x of r.clients)x.res.write(': ka\n\n');if(!r.clients.size&&Date.now()-r.t>12*36e5)rooms.delete(c)}},15000);
