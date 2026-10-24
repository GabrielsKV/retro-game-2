const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const GAMES=require('./games'),{Q,AGENDAS}=GAMES;
const BRAND=process.env.TEAM_NAME||'',SLACK=process.env.SLACK_WEBHOOK_URL||'';
const INDEX=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replace('<script>','<script>window.BRAND='+JSON.stringify(BRAND)+';');
const MAX=15,EMOJI='🐙🦊🐼🦄🐸🐯🦉🐳🦋🐝🐧🦔🐨🦁🐢🦜🐬🦒'.match(/./gu),REACT=['👍','❤️','😂','🤔'];
const rooms=new Map(),rid=n=>crypto.randomBytes(n).toString('hex');
const newCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:5},()=>a[crypto.randomInt(a.length)]).join('')}while(rooms.has(c));return c};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}};
const json=(res,s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const clean=n=>String(n||'').trim().slice(0,20);
const fresh=()=>({pw:'',anon:true,actions:[],log:[],total:{},tl:{},dyn:null,agenda:null,disc:null,cg:null,picks:[],score:{},names:[],i:0,show:false,cards:[],ans:{},endsAt:null,phase:'lobby',game:null});

// ---- persistence (set up a Fly volume mounted at /data to survive deploys) ----
const FILE=path.join(fs.existsSync('/data')?'/data':__dirname,'rooms.json');let st;
const save=()=>{clearTimeout(st);st=setTimeout(()=>fs.writeFile(FILE,JSON.stringify([...rooms.values()].map(r=>({...r,clients:undefined,cards:r.cards.map(c=>({...c,votes:[...c.votes]}))}))),()=>{}),1500)};
try{for(const r of JSON.parse(fs.readFileSync(FILE))){r.cards.forEach(c=>c.votes=new Set(c.votes));rooms.set(r.code,{...fresh(),...r,clients:new Set()})}}catch{}

const gameOf=r=>r.game==='custom'?r.cg:GAMES.find(x=>x.id===r.game)||null;
const eff=r=>{const g=gameOf(r);return g&&r.dyn?{...g,type:'quiz',rounds:r.dyn}:g};
const pub=g=>{if(!g||!g.rounds)return g;const{rounds,...x}=g;return{...x,n:rounds.length}};
const rank=r=>[...r.cards].sort((a,b)=>b.votes.size-a.votes.size);
const topN=r=>{const s=rank(r),t=s.filter(c=>c.votes.size>0).slice(0,5);return t.length?t:s.slice(0,3)};

function view(r,pid){
  const g=eff(r),on=new Set([...r.clients].map(c=>c.pid)),pn=id=>r.players[id]?.name;
  const done=id=>!g?false:g.type==='tl'?!!r.tl[id]:g.rounds?!!(r.picks[r.i]||{})[id]:g.type==='text'?r.cards.some(c=>c.pid===id):g.type==='scale'?(r.ans[id]||[]).filter(Boolean).length===g.qs.length:r.ans[id]!=null;
  const ag=r.agenda;
  const v={code:r.code,phase:r.phase,game:pub(g),endsAt:r.disc?r.disc.endsAt:r.endsAt,isHost:pid===r.host,me:pid,anon:r.anon,slack:!!SLACK,locked:!!r.pw,actions:r.actions,logN:r.log.length,
    agenda:ag&&{name:ag.name,pos:ag.pos,n:ag.ids.length,next:ag.pos+1<ag.ids.length?(GAMES.find(x=>x.id===ag.ids[ag.pos+1])||{}).title:null},
    total:Object.entries(r.total).filter(([id])=>r.players[id]).map(([id,s])=>({name:pn(id),emoji:r.players[id].emoji,score:s})).sort((a,b)=>b.score-a.score),
    players:Object.entries(r.players).map(([id,p])=>({id,name:p.name,emoji:p.emoji,on:on.has(id),done:done(id),host:id===r.host}))};
  if(r.phase==='lobby'&&pid===r.host){v.list=GAMES.map(({id,title,cat,desc,type})=>({id,title,cat,desc,type}));v.agendas=AGENDAS.map((a,i)=>({i,name:a.name,n:a.ids.length}))}
  const board=()=>Object.entries(r.players).map(([id,p])=>({name:p.name,emoji:p.emoji,score:r.score[id]||0})).sort((a,b)=>b.score-a.score);
  const counts=(i,o)=>{const c=o.map(()=>0);Object.values(r.picks[i]||{}).forEach(p=>c[p.c]++);return c};
  if(r.phase==='collect'){v.mine=r.cards.filter(c=>c.pid===pid).map(({id,col,text})=>({id,col,text}));v.myAns=r.ans[pid]??null;v.myTl=r.tl[pid]||null}
  if(r.phase==='vote'){v.cards=r.cards.map(c=>({id:c.id,col:c.col,text:c.text,mine:c.votes.has(pid),by:r.anon?undefined:pn(c.pid)}));v.left=3-r.cards.filter(c=>c.votes.has(pid)).length}
  if(r.phase==='play'){const rd=g.rounds[r.i],o=g.type==='who'?r.names:rd.o;v.rd={i:r.i,n:g.rounds.length,q:rd.q,o,show:r.show,mine:rd.owner===pid,my:(r.picks[r.i]||{})[pid]?.c??null};
    if(r.show){v.rd.c=counts(r.i,o);if(g.type==='quiz')v.rd.a=rd.a}if(g.type==='quiz')v.board=board()}
  if(r.phase==='results'){
    if(g.rounds){if(g.type==='quiz')v.board=board();else v.sum=g.rounds.slice(0,r.i+(r.show?1:0)).map((rd,i)=>{const o=g.type==='who'?r.names:rd.o;return{q:rd.q,o,c:counts(i,o)}})}
    else if(g.type==='text'){v.cards=rank(r).map(c=>({id:c.id,col:c.col,text:c.text,votes:c.votes.size,by:r.anon?undefined:pn(c.pid),re:Object.fromEntries(Object.entries(c.re||{}).filter(([,a])=>a.length).map(([e,a])=>[e,{n:a.length,me:a.includes(pid)}]))}));
      if(r.disc){const L=topN(r).map(c=>v.cards.find(x=>x.id===c.id));v.disc={i:r.disc.i,n:L.length,card:L[r.disc.i]}}}
    else if(g.type==='scale')v.res=g.qs.map((_,i)=>{const x=Object.values(r.ans).map(a=>a[i]).filter(Boolean),d=Array(g.max).fill(0);x.forEach(n=>d[n-1]++);return{n:x.length,avg:x.length?x.reduce((a,b)=>a+b,0)/x.length:0,dist:d}});
    else if(g.type==='choice'){v.res=g.opts.map(()=>0);Object.values(r.ans).forEach(i=>v.res[i]++)}
  }
  return v;
}
const push=r=>{for(const c of r.clients)c.res.write(`data:${JSON.stringify(view(r,c.pid))}\n\n`);save()};

const finish=r=>{const g=eff(r);r.phase='results';r.endsAt=null;r.disc=null;
  if(g.type==='quiz')for(const id in r.score)r.total[id]=(r.total[id]||0)+r.score[id];
  const v=view(r,r.host),x=v.game;r.log.push({title:x.title,type:x.type,cols:x.cols,qs:x.qs,opts:x.opts,cards:v.cards,res:v.res,board:v.board,sum:v.sum})};
const md=r=>{const L=[`# Retro ${new Date(r.t).toISOString().slice(0,10)}`,''];
  for(const e of r.log){L.push(`## ${e.title}`,'');
    if(e.type==='text')for(const c of e.cards)L.push(`- ${e.cols?'['+e.cols[c.col]+'] ':''}${c.text}${c.by?' ('+c.by+')':''}${c.votes?' — '+c.votes+' votes':''}`);
    else if(e.type==='scale')e.qs.forEach((q,i)=>L.push(`- ${q}: **${e.res[i].avg.toFixed(1)}** (${e.res[i].n} votes)`));
    else if(e.type==='choice')e.opts.forEach((o,i)=>L.push(`- ${o}: ${e.res[i]}`));
    else if(e.board)e.board.forEach((p,i)=>L.push(`${i+1}. ${p.name}: ${p.score}`));
    else if(e.sum)e.sum.forEach(x=>L.push(`- ${x.q} → `+x.o.map((o,i)=>`${o} ${x.c[i]}`).join(', ')));
    L.push('')}
  if(r.actions.length){L.push('## Action items','');r.actions.forEach(a=>L.push(`- [${a.done?'x':' '}] ${a.text}${a.owner?' — @'+a.owner:''}${a.due?' (due '+a.due+')':''}`))}
  return L.join('\n')};

const reset=r=>Object.assign(r,{cards:[],ans:{},endsAt:null,picks:[],score:{},names:[],i:0,show:false,tl:{},dyn:null,disc:null});
const pick=(r,id)=>{if(id!=='custom'&&!GAMES.some(x=>x.id===id))throw Error('Unknown game');reset(r);r.game=id;r.phase='ready'};

function act(r,pid,b){
  const host=pid===r.host,g=eff(r),need=()=>{if(!host)throw Error('Only the facilitator can do that')},nm=()=>Object.values(r.players).map(p=>p.name);
  switch(b.a){
    case'pick':need();pick(r,b.id);break;
    case'agenda':{need();const a=AGENDAS[b.i];if(!a)return;r.agenda={name:a.name,ids:a.ids,pos:0};pick(r,a.ids[0]);break}
    case'nextgame':{need();const a=r.agenda;if(a&&a.pos+1<a.ids.length){a.pos++;pick(r,a.ids[a.pos])}break}
    case'custom':{need();const rounds=String(b.lines||'').split('\n').map(l=>l.split('|').map(x=>x.trim()).filter(Boolean)).filter(p=>p.length>=3).slice(0,30).map(p=>Q(p[0].slice(0,200),p[1].slice(0,100),...p.slice(2,5).map(x=>x.slice(0,100))));
      if(!rounds.length)throw Error('Add lines like: Question | correct | wrong | wrong');
      r.cg={id:'custom',type:'quiz',cat:'Fun & Games',title:'🛠️ '+(clean(b.title)||'Custom quiz'),desc:'Custom quiz by the facilitator',rounds};r.agenda=null;pick(r,'custom');break}
    case'start':{need();if(!g)return;reset(r);r.anon=b.anon!==false;
      if(g.rounds){r.phase='play';r.names=nm();r.endsAt=g.type==='quiz'?Date.now()+20000:null;break}
      r.phase='collect';r.endsAt=b.secs>0?Date.now()+Math.min(b.secs,3600)*1000:null;break}
    case'next':{need();
      if(r.phase==='play'){
        if(!r.show){r.show=true;r.endsAt=null;if(g.type==='quiz'){const rd=g.rounds[r.i];let bad=0;for(const[id,p]of Object.entries(r.picks[r.i]||{})){if(p.c===rd.a)r.score[id]=(r.score[id]||0)+100+Math.round(100*p.l);else bad++}if(rd.owner)r.score[rd.owner]=(r.score[rd.owner]||0)+50*bad}}
        else if(++r.i>=g.rounds.length)finish(r);else{r.show=false;r.names=nm();r.endsAt=g.type==='quiz'?Date.now()+20000:null}break}
      if(r.phase==='collect'){
        if(g.type==='tl'){const dyn=Object.entries(r.tl).filter(([id])=>r.players[id]).map(([id,t])=>{const x=Q(`${r.players[id].name}: which one is the lie?`,t.s[t.lie],...t.s.filter((_,i)=>i!==t.lie));x.owner=id;return x});
          if(!dyn.length)throw Error('Nobody has submitted statements yet');Object.assign(r,{dyn,phase:'play',i:0,show:false,picks:[],score:{},names:nm(),endsAt:Date.now()+20000})}
        else if(g.type==='text'&&r.cards.length){shuffle(r.cards);r.phase='vote';r.endsAt=null}else finish(r);break}
      if(r.phase==='vote')finish(r);break}
    case'end':need();if(g.type==='tl'&&r.phase==='collect'){reset(r);Object.assign(r,{phase:'lobby',game:null,agenda:null})}else if(['collect','vote','play'].includes(r.phase))finish(r);break;
    case'lobby':need();reset(r);Object.assign(r,{phase:'lobby',game:null,agenda:null});break;
    case'add':{if(r.phase!=='collect'||g.type!=='text')return;const t=String(b.text||'').trim().slice(0,200);if(!t)return;
      if(r.cards.filter(c=>c.pid===pid).length>=20)throw Error('Max 20 cards each');
      r.cards.push({id:rid(4),pid,col:g.cols?Math.max(0,Math.min(g.cols.length-1,b.col|0)):0,text:t,votes:new Set(),re:{}});break}
    case'edit':{if(r.phase!=='collect')return;const c=r.cards.find(c=>c.id===b.id&&c.pid===pid),t=String(b.text||'').trim().slice(0,200);if(c&&t)c.text=t;break}
    case'del':r.cards=r.cards.filter(c=>!(c.id===b.id&&c.pid===pid));break;
    case'vote':{if(r.phase!=='vote')return;const c=r.cards.find(c=>c.id===b.id);if(!c)return;
      if(c.votes.has(pid))c.votes.delete(pid);else if(r.cards.filter(k=>k.votes.has(pid)).length<3)c.votes.add(pid);break}
    case'react':{if(r.phase!=='results'||g.type!=='text'||!REACT.includes(b.e))return;const c=r.cards.find(c=>c.id===b.id);if(!c)return;c.re=c.re||{};const a=c.re[b.e]||(c.re[b.e]=[]),k=a.indexOf(pid);k<0?a.push(pid):a.splice(k,1);break}
    case'rate':{if(r.phase!=='collect'||g.type!=='scale')return;const a=r.ans[pid]||(r.ans[pid]=[]);if(b.q>=0&&b.q<g.qs.length&&b.v>=1&&b.v<=g.max)a[b.q]=b.v;break}
    case'choose':if(r.phase!=='collect'||g.type!=='choice'||!(b.i>=0&&b.i<g.opts.length))return;r.ans[pid]=b.i;break;
    case'tl':{if(r.phase!=='collect'||g.type!=='tl')return;const s=(b.s||[]).map(x=>String(x||'').trim().slice(0,100));if(s.length!==3||s.some(x=>!x))throw Error('Fill in all three statements');r.tl[pid]={s,lie:Math.max(0,Math.min(2,b.lie|0))};break}
    case'answer':{if(r.phase!=='play'||r.show)return;const rd=g.rounds[r.i],n=g.type==='who'?r.names.length:rd.o.length;if(!(b.c>=0&&b.c<n)||rd.owner===pid)return;
      if(g.type==='quiz'&&Date.now()>r.endsAt+1500)throw Error('Time is up');
      const m=r.picks[r.i]||(r.picks[r.i]={});if(g.type==='quiz'&&m[pid])return;m[pid]={c:b.c|0,l:r.endsAt?Math.max(0,Math.min(1,(r.endsAt-Date.now())/20000)):0};break}
    case'action':{need();const t=String(b.text||'').trim().slice(0,200);if(!t)return;if(r.actions.length>=50)throw Error('Too many action items');r.actions.push({id:rid(3),text:t,owner:clean(b.owner),due:clean(b.due),done:false});break}
    case'adone':{need();const a=r.actions.find(a=>a.id===b.id);if(a)a.done=!a.done;break}
    case'adel':need();r.actions=r.actions.filter(a=>a.id!==b.id);break;
    case'discuss':need();if(r.phase==='results'&&g.type==='text'&&r.cards.length)r.disc={i:0,endsAt:Date.now()+180000};break;
    case'dnext':need();if(!r.disc)return;if(++r.disc.i>=topN(r).length)r.disc=null;else r.disc.endsAt=Date.now()+180000;break;
    case'dmore':need();if(r.disc)r.disc.endsAt+=120000;break;
    case'dstop':need();r.disc=null;break;
    case'kick':{need();if(b.id===r.host||!r.players[b.id])return;delete r.players[b.id];for(const c of[...r.clients])if(c.pid===b.id){c.res.write('data:{"kicked":true}\n\n');c.res.end();r.clients.delete(c)}break}
    case'host':need();if(r.players[b.id])r.host=b.id;break;
  }
  push(r);
}

http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x'),code=(u.searchParams.get('code')||'').toUpperCase();
  try{
    if(req.method==='GET'){
      if(u.pathname==='/healthz')return res.end('ok');
      if(u.pathname==='/api/room')return json(res,rooms.has(code)?200:404,{});
      const r=rooms.get(code),pid=u.searchParams.get('pid');
      if(u.pathname==='/api/events'){
        if(!r||!r.players[pid])return json(res,404,{error:'Room not found'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 2000\n\n');const c={res,pid};r.clients.add(c);push(r);
        return req.on('close',()=>{r.clients.delete(c);push(r)});
      }
      if(u.pathname==='/api/export'){if(!r||!r.players[pid])return json(res,404,{error:'Room not found'});res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8'});return res.end(md(r))}
      if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(INDEX)}
      return json(res,404,{error:'Not found'});
    }
    if(req.method!=='POST')return json(res,405,{});
    let body='';for await(const ch of req){body+=ch;if(body.length>2e4)throw Error('Too large')}
    const b=JSON.parse(body||'{}');
    if(u.pathname==='/api/room'){
      const name=clean(b.name);if(!name)throw Error('Enter your name');
      const r={...fresh(),code:newCode(),host:rid(6),players:{},clients:new Set(),t:Date.now(),pw:clean(b.pw)};
      r.players[r.host]={name,emoji:EMOJI[0]};rooms.set(r.code,r);save();return json(res,200,{code:r.code,pid:r.host});
    }
    const r=rooms.get(String(b.code||'').toUpperCase());if(!r)return json(res,404,{error:'Room not found. Check the code.'});
    if(u.pathname==='/api/join'){
      if(b.pid&&r.players[b.pid])return json(res,200,{pid:b.pid});
      if(r.pw&&clean(b.pw)!==r.pw)throw Error('Wrong room password');
      const name=clean(b.name);if(!name)throw Error('Enter your name');
      if(Object.keys(r.players).length>=MAX)throw Error(`Room is full (${MAX} people max)`);
      const pid=rid(6);r.players[pid]={name,emoji:EMOJI[Object.keys(r.players).length%EMOJI.length]};push(r);return json(res,200,{pid});
    }
    if(!r.players[b.pid])return json(res,403,{error:'Not in this room'});
    if(u.pathname==='/api/act'){act(r,b.pid,b);return json(res,200,{})}
    if(u.pathname==='/api/slack'){if(b.pid!==r.host)throw Error('Only the facilitator can do that');if(!SLACK)throw Error('Slack is not configured');
      const x=await fetch(SLACK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:md(r)})});if(!x.ok)throw Error('Slack rejected the message');return json(res,200,{})}
    json(res,404,{error:'Not found'});
  }catch(e){json(res,400,{error:e.message})}
}).listen(process.env.PORT||8080,'0.0.0.0',()=>console.log('RetroHub on',process.env.PORT||8080));

setInterval(()=>{for(const[c,r]of rooms){for(const x of r.clients)x.res.write(': ka\n\n');if(!r.clients.size&&Date.now()-r.t>12*36e5)rooms.delete(c)}},15000);
