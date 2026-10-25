const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const GAMES=require('./games'),{Q,AGENDAS,WORDS}=GAMES;
const BRAND=process.env.TEAM_NAME||'',SLACK=process.env.SLACK_WEBHOOK_URL||'';
const INDEX=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replace('<script>','<script>window.BRAND='+JSON.stringify(BRAND)+';');
const MAX=15,EMOJI='🐙🦊🐼🦄🐸🐯🦉🐳🦋🐝🐧🦔🐨🦁🐢🦜🐬🦒'.match(/./gu),REACT=['👍','❤️','😂','🤔'];
const U=m=>Object.assign(Error(m),{user:1}),has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const hp=(pw,s)=>crypto.scryptSync(pw,s,32).toString('hex'),mkPw=pw=>{const s=crypto.randomBytes(8).toString('hex');return{s,h:hp(pw,s)}};
const okPw=(p,pw)=>{try{return crypto.timingSafeEqual(Buffer.from(hp(pw,p.s),'hex'),Buffer.from(p.h,'hex'))}catch{return false}};
const al=id=>crypto.createHash('sha256').update(id).digest('hex').slice(0,10); // public alias: player ids are secret tokens and are never sent to other players
const hits=new Map(),sse=new Map();
const over=(k,max,win)=>{const n=Date.now();let h=hits.get(k);if(!h||h[1]<n){h=[0,n+win];hits.set(k,h)}return ++h[0]>max};
const ipOf=req=>String(req.headers['fly-client-ip']||(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress);
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const rooms=new Map(),rid=n=>crypto.randomBytes(n).toString('hex');
const newCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from({length:6},()=>a[crypto.randomInt(a.length)]).join('')}while(rooms.has(c));return c};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}};
const json=(res,s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const clean=n=>String(n||'').trim().slice(0,20);
const fresh=()=>({pwh:null,anon:true,actions:[],log:[],total:{},tl:{},dyn:null,agenda:null,disc:null,cg:null,picks:[],score:{},names:[],i:0,show:false,cards:[],ans:{},endsAt:null,phase:'lobby',game:null,bingo:{},bw:[],race:null,dr:null,team:''});

// ---- persistence (set up a Fly volume mounted at /data to survive deploys) ----
const DIR=fs.existsSync('/data')?'/data':__dirname,FILE=path.join(DIR,'rooms.json'),HF=path.join(DIR,'history.json');let st,hist={};try{hist=JSON.parse(fs.readFileSync(HF))}catch{}
const save=()=>{clearTimeout(st);st=setTimeout(()=>fs.writeFile(FILE,JSON.stringify([...rooms.values()].map(r=>({...r,clients:undefined,cards:r.cards.map(c=>({...c,votes:[...c.votes]}))}))),()=>{}),1500)};
try{for(const r of JSON.parse(fs.readFileSync(FILE))){r.cards.forEach(c=>c.votes=new Set(c.votes));{if(typeof r.pw==='string'){if(r.pw)r.pwh=mkPw(r.pw);delete r.pw}rooms.set(r.code,{...fresh(),...r,clients:new Set()})}}}catch{}

const gameOf=r=>r.game==='custom'?r.cg:GAMES.find(x=>x.id===r.game)||null;
const eff=r=>{const g=gameOf(r);return g&&r.dyn?{...g,type:'quiz',rounds:r.dyn}:g};
const pub=g=>{if(!g||!g.rounds)return g;const{rounds,...x}=g;return{...x,n:rounds.length}};
const online=r=>new Set([...r.clients].map(c=>c.pid));
const LINES=[0,1,2,3].flatMap(i=>[[0,1,2,3].map(k=>i*4+k),[0,1,2,3].map(k=>k*4+i)]).concat([[0,5,10,15],[3,6,9,12]]);
const bcard=(r,pid)=>{if(!r.bingo[pid]){const idx=[...gameOf(r).items.keys()];shuffle(idx);r.bingo[pid]={cells:idx.slice(0,16),marks:Array(16).fill(false)}}return r.bingo[pid]};
const endRound=r=>{const d=r.race;d.tok++;d.st='done';const P=[10,7,5,3,2,1];Object.entries(d.taps).filter(([,t])=>!t.bad).sort((a,b)=>a[1].ms-b[1].ms).forEach(([id,t],i)=>{t.pts=P[i]||1;r.score[id]=(r.score[id]||0)+t.pts})};
const newTurn=(r,i)=>{const d=r.dr;let w;do{w=WORDS[crypto.randomInt(WORDS.length)]}while(d.used.includes(w)&&d.used.length<WORDS.length);d.used.push(w);Object.assign(d,{i,word:w,strokes:[],chat:[],solved:{},st:'draw'});r.endsAt=Date.now()+75000};
const rank=r=>r.cards.filter(c=>!c.grp).sort((a,b)=>b.votes.size-a.votes.size);
const topN=r=>{const s=rank(r),t=s.filter(c=>c.votes.size>0).slice(0,5);return t.length?t:s.slice(0,3)};

function view(r,pid){
  const g=eff(r),on=new Set([...r.clients].map(c=>c.pid)),pn=id=>r.players[id]?.name;
  const done=id=>!g?false:g.type==='race'?!!(r.race&&r.race.taps[id]):g.type==='bingo'?r.bw.includes(id):g.type==='draw'?!!(r.dr&&r.dr.solved&&r.dr.solved[id]):g.type==='tl'?!!r.tl[id]:g.rounds?!!(r.picks[r.i]||{})[id]:g.type==='text'?r.cards.some(c=>c.pid===id):g.type==='scale'?(r.ans[id]||[]).filter(Boolean).length===g.qs.length:r.ans[id]!=null;
  const ag=r.agenda;
  const v={code:r.code,phase:r.phase,game:pub(g),endsAt:r.disc?r.disc.endsAt:r.endsAt,isHost:pid===r.host,me:pid,anon:r.anon,team:r.team?r.team.slice(2):null,slack:!!SLACK,locked:!!r.pwh,actions:r.actions,logN:r.log.length,
    agenda:ag&&{name:ag.name,pos:ag.pos,n:ag.ids.length,next:ag.pos+1<ag.ids.length?(GAMES.find(x=>x.id===ag.ids[ag.pos+1])||{}).title:null},
    total:Object.entries(r.total).filter(([id])=>r.players[id]).map(([id,s])=>({name:pn(id),emoji:r.players[id].emoji,score:s})).sort((a,b)=>b.score-a.score),
    players:Object.entries(r.players).map(([id,p])=>({id:al(id),name:p.name,emoji:p.emoji,on:on.has(id),done:done(id),host:id===r.host}))};
  if(r.phase==='lobby'&&pid===r.host){v.list=GAMES.map(({id,title,cat,desc,type})=>({id,title,cat,desc,type}));v.agendas=AGENDAS.map((a,i)=>({i,name:a.name,n:a.ids.length}))}
  const board=()=>Object.entries(r.players).map(([id,p])=>({name:p.name,emoji:p.emoji,score:r.score[id]||0})).sort((a,b)=>b.score-a.score);
  const counts=(i,o)=>{const c=o.map(()=>0);Object.values(r.picks[i]||{}).forEach(p=>c[p.c]++);return c};
  if(r.phase==='collect'){v.mine=r.cards.filter(c=>c.pid===pid).map(({id,col,text})=>({id,col,text}));v.myAns=r.ans[pid]??null;v.myTl=r.tl[pid]||null}
  if(r.phase==='vote'){v.cards=r.cards.filter(c=>!c.grp).map(c=>({id:c.id,col:c.col,text:c.text,more:r.cards.filter(m=>m.grp===c.id).map(m=>m.text),mine:c.votes.has(pid),by:r.anon?undefined:pn(c.pid)}));v.left=3-r.cards.filter(c=>c.votes.has(pid)).length}
  if(r.phase==='bingo'){const c=bcard(r,pid),it=g.items;v.bg={cells:c.cells.map(i=>it[i]),marks:c.marks,won:r.bw.includes(pid),winners:r.bw.map(pn)};v.board=board()}
  if(r.phase==='race'){const d=r.race,rs=Object.entries(r.players).map(([id,p])=>{const t=d.taps[id];return{name:p.name,ms:t&&t.ms,bad:!!(t&&t.bad),pts:(t&&t.pts)||0,none:!t}}).sort((a,b)=>(a.none-b.none)||(a.bad-b.bad)||(a.ms-b.ms));const t=d.taps[pid];v.rc={i:d.i,n:d.n,st:d.st,my:t?(t.bad?'bad':t.ms):null,res:d.st==='done'?rs:[]};v.board=board()}
  if(r.phase==='draw'){const d=r.dr,me=d.order[d.i]===pid;v.dr={i:d.i,n:d.order.length,drawer:pn(d.order[d.i]),me,st:d.st,hint:d.word.replace(/[a-z]/gi,'_ ').trim(),word:(me||d.st==='reveal')?d.word:null,strokes:d.strokes,chat:d.chat.slice(-25),solved:!!d.solved[pid]};v.board=board()}
  if(r.phase==='play'){const rd=g.rounds[r.i],o=g.type==='who'?r.names:rd.o;v.rd={i:r.i,n:g.rounds.length,q:rd.q,o,show:r.show,mine:rd.owner===pid,my:(r.picks[r.i]||{})[pid]?.c??null};
    if(r.show){v.rd.c=counts(r.i,o);if(g.type==='quiz')v.rd.a=rd.a}if(g.type==='quiz')v.board=board()}
  if(r.phase==='results'){
    if(['race','bingo','draw'].includes(g.type))v.board=board();
    else if(g.rounds){if(g.type==='quiz')v.board=board();else v.sum=g.rounds.slice(0,r.i+(r.show?1:0)).map((rd,i)=>{const o=g.type==='who'?r.names:rd.o;return{q:rd.q,o,c:counts(i,o)}})}
    else if(g.type==='text'){v.cards=rank(r).map(c=>({id:c.id,col:c.col,text:c.text,more:r.cards.filter(m=>m.grp===c.id).map(m=>m.text),votes:c.votes.size,by:r.anon?undefined:pn(c.pid),re:Object.fromEntries(Object.entries(c.re||{}).filter(([,a])=>a.length).map(([e,a])=>[e,{n:a.length,me:a.includes(pid)}]))}));
      if(r.disc){const L=topN(r).map(c=>v.cards.find(x=>x.id===c.id));v.disc={i:r.disc.i,n:L.length,card:L[r.disc.i]}}}
    else if(g.type==='scale')v.res=g.qs.map((_,i)=>{const x=Object.values(r.ans).map(a=>a[i]).filter(Boolean),d=Array(g.max).fill(0);x.forEach(n=>d[n-1]++);return{n:x.length,avg:x.length?x.reduce((a,b)=>a+b,0)/x.length:0,dist:d}});
    else if(g.type==='choice'){v.res=g.opts.map(()=>0);Object.values(r.ans).forEach(i=>v.res[i]++)}
  }
  return v;
}
const push=r=>{for(const c of r.clients)c.res.write(`data:${JSON.stringify(view(r,c.pid))}\n\n`);save()};

const finish=r=>{const g=eff(r);r.phase='results';r.endsAt=null;r.disc=null;
  if(['quiz','race','bingo','draw'].includes(g.type))for(const id in r.score)r.total[id]=(r.total[id]||0)+r.score[id];
  const v=view(r,r.host),x=v.game;r.log.push({title:x.title,type:x.type,cols:x.cols,qs:x.qs,opts:x.opts,cards:v.cards,res:v.res,board:v.board,sum:v.sum});
  if(r.team&&has(hist,r.team)&&g.type==='scale'){(hist[r.team]=(r.team&&has(hist,r.team)?hist[r.team]:[])).push({t:Date.now(),title:x.title,max:g.max,qs:g.qs.map((q,i)=>({q,avg:+v.res[i].avg.toFixed(2),n:v.res[i].n}))});if(hist[r.team].length>500)hist[r.team].shift();fs.writeFile(HF,JSON.stringify(hist),()=>{})}};
const md=r=>{const L=[`# Retro ${new Date(r.t).toISOString().slice(0,10)}`,''];
  for(const e of r.log){L.push(`## ${e.title}`,'');
    if(e.type==='text')for(const c of e.cards)L.push(`- ${e.cols?'['+e.cols[c.col]+'] ':''}${c.text}${c.by?' ('+c.by+')':''}${c.more&&c.more.length?' (+ '+c.more.join('; ')+')':''}${c.votes?' — '+c.votes+' votes':''}`);
    else if(e.type==='scale')e.qs.forEach((q,i)=>L.push(`- ${q}: **${e.res[i].avg.toFixed(1)}** (${e.res[i].n} votes)`));
    else if(e.type==='choice')e.opts.forEach((o,i)=>L.push(`- ${o}: ${e.res[i]}`));
    else if(e.board)e.board.forEach((p,i)=>L.push(`${i+1}. ${p.name}: ${p.score}`));
    else if(e.sum)e.sum.forEach(x=>L.push(`- ${x.q} → `+x.o.map((o,i)=>`${o} ${x.c[i]}`).join(', ')));
    L.push('')}
  if(r.actions.length){L.push('## Action items','');r.actions.forEach(a=>L.push(`- [${a.done?'x':' '}] ${a.text}${a.owner?' — @'+a.owner:''}${a.due?' (due '+a.due+')':''}`))}
  return L.join('\n')};

const reset=r=>Object.assign(r,{cards:[],ans:{},endsAt:null,picks:[],score:{},names:[],i:0,show:false,tl:{},dyn:null,disc:null,bingo:{},bw:[],race:null,dr:null});
const pick=(r,id)=>{if(id!=='custom'&&!GAMES.some(x=>x.id===id))throw U('Unknown game');reset(r);r.game=id;r.phase='ready'};

function act(r,pid,b){
  const host=pid===r.host,g=eff(r),need=()=>{if(!host)throw U('Only the facilitator can do that')},nm=()=>Object.values(r.players).map(p=>p.name);
  switch(b.a){
    case'pick':need();pick(r,b.id);break;
    case'agenda':{need();const a=AGENDAS[b.i];if(!a)return;r.agenda={name:a.name,ids:a.ids,pos:0};pick(r,a.ids[0]);break}
    case'nextgame':{need();const a=r.agenda;if(a&&a.pos+1<a.ids.length){a.pos++;pick(r,a.ids[a.pos])}break}
    case'custom':{need();const rounds=String(b.lines||'').split('\n').map(l=>l.split('|').map(x=>x.trim()).filter(Boolean)).filter(p=>p.length>=3).slice(0,30).map(p=>Q(p[0].slice(0,200),p[1].slice(0,100),...p.slice(2,5).map(x=>x.slice(0,100))));
      if(!rounds.length)throw U('Add lines like: Question | correct | wrong | wrong');
      r.cg={id:'custom',type:'quiz',cat:'Fun & Games',title:'🛠️ '+(clean(b.title)||'Custom quiz'),desc:'Custom quiz by the facilitator',rounds};r.agenda=null;pick(r,'custom');break}
    case'start':{need();if(!g)return;reset(r);r.anon=b.anon!==false;
      if(g.type==='race'){Object.assign(r,{phase:'race',race:{i:0,n:5,st:'idle',taps:{},tok:0}});break}
      if(g.type==='bingo'){r.phase='bingo';break}
      if(g.type==='draw'){const ids=Object.keys(r.players);shuffle(ids);r.phase='draw';r.dr={order:ids,used:[]};newTurn(r,0);break}
      if(g.rounds){r.phase='play';r.names=nm();r.endsAt=g.type==='quiz'?Date.now()+20000:null;break}
      r.phase='collect';r.endsAt=b.secs>0?Date.now()+Math.min(b.secs,3600)*1000:null;break}
    case'next':{need();
      if(r.phase==='bingo'){finish(r);break}
      if(r.phase==='race'){if(['wait','go'].includes(r.race.st))endRound(r);finish(r);break}
      if(r.phase==='draw'){const d=r.dr;if(d.st==='draw'){d.st='reveal';r.endsAt=null}else{let j=d.i+1;while(j<d.order.length&&!r.players[d.order[j]])j++;if(j>=d.order.length)finish(r);else newTurn(r,j)}break}
      if(r.phase==='play'){
        if(!r.show){r.show=true;r.endsAt=null;if(g.type==='quiz'){const rd=g.rounds[r.i];let bad=0;for(const[id,p]of Object.entries(r.picks[r.i]||{})){if(p.c===rd.a)r.score[id]=(r.score[id]||0)+100+Math.round(100*p.l);else bad++}if(rd.owner)r.score[rd.owner]=(r.score[rd.owner]||0)+50*bad}}
        else if(++r.i>=g.rounds.length)finish(r);else{r.show=false;r.names=nm();r.endsAt=g.type==='quiz'?Date.now()+20000:null}break}
      if(r.phase==='collect'){
        if(g.type==='tl'){const dyn=Object.entries(r.tl).filter(([id])=>r.players[id]).map(([id,t])=>{const x=Q(`${r.players[id].name}: which one is the lie?`,t.s[t.lie],...t.s.filter((_,i)=>i!==t.lie));x.owner=id;return x});
          if(!dyn.length)throw U('Nobody has submitted statements yet');Object.assign(r,{dyn,phase:'play',i:0,show:false,picks:[],score:{},names:nm(),endsAt:Date.now()+20000})}
        else if(g.type==='text'&&r.cards.length){shuffle(r.cards);r.phase='vote';r.endsAt=null}else finish(r);break}
      if(r.phase==='vote')finish(r);break}
    case'end':need();if(g.type==='tl'&&r.phase==='collect'){reset(r);Object.assign(r,{phase:'lobby',game:null,agenda:null})}else if(['collect','vote','play','race','bingo','draw'].includes(r.phase)){if(r.phase==='race'&&['wait','go'].includes(r.race.st))endRound(r);finish(r)}break;
    case'lobby':need();reset(r);Object.assign(r,{phase:'lobby',game:null,agenda:null});break;
    case'add':{if(r.phase!=='collect'||g.type!=='text')return;const t=String(b.text||'').trim().slice(0,200);if(!t)return;
      if(r.cards.filter(c=>c.pid===pid).length>=20)throw U('Max 20 cards each');
      r.cards.push({id:rid(4),pid,col:g.cols?Math.max(0,Math.min(g.cols.length-1,b.col|0)):0,text:t,votes:new Set(),re:{}});break}
    case'edit':{if(r.phase!=='collect')return;const c=r.cards.find(c=>c.id===b.id&&c.pid===pid),t=String(b.text||'').trim().slice(0,200);if(c&&t)c.text=t;break}
    case'merge':{need();if(r.phase!=='vote'||b.from===b.to)return;const f=r.cards.find(c=>c.id===b.from),t=r.cards.find(c=>c.id===b.to);if(!f||!t)return;const L=t.grp?r.cards.find(c=>c.id===t.grp):t;if(!L||L.id===f.id)return;
      r.cards.forEach(c=>{if(c.grp===f.id)c.grp=L.id});f.grp=L.id;f.votes.forEach(p=>L.votes.add(p));f.votes=new Set();break}
    case'unmerge':{need();if(r.phase!=='vote')return;const c=r.cards.find(c=>c.id===b.id);if(!c)return;if(c.grp)c.grp=null;else r.cards.forEach(m=>{if(m.grp===c.id)m.grp=null});break}
    case'rgo':{need();const d=r.race;if(r.phase!=='race'||!['idle','done'].includes(d.st)||d.i>=d.n)return;d.i++;d.taps={};d.st='wait';const tok=++d.tok;
      setTimeout(()=>{if(r.race&&r.race.tok===tok&&r.race.st==='wait'){r.race.st='go';r.race.goAt=Date.now();push(r)}},2000+crypto.randomInt(4000));break}
    case'tap':{if(r.phase!=='race')return;const d=r.race;if(d.taps[pid])return;if(d.st==='wait')d.taps[pid]={bad:true};else if(d.st==='go')d.taps[pid]={ms:Date.now()-d.goAt};else return;
      const on=online(r);if(on.size&&[...on].every(id=>d.taps[id]))endRound(r);break}
    case'rend':need();if(r.phase==='race'&&['wait','go'].includes(r.race.st))endRound(r);break;
    case'mark':{if(r.phase!=='bingo')return;const c=bcard(r,pid),i=b.i|0;if(i>=0&&i<16)c.marks[i]=!c.marks[i];break}
    case'bingo':{if(r.phase!=='bingo'||r.bw.includes(pid))return;const c=bcard(r,pid);if(!LINES.some(l=>l.every(i=>c.marks[i])))throw U('No complete row, column or diagonal yet');r.bw.push(pid);r.score[pid]=(r.score[pid]||0)+([10,7,5][r.bw.length-1]||3);break}
    case'pts':{const d=r.dr;if(r.phase!=='draw'||d.st!=='draw'||d.order[d.i]!==pid)return;const p=(Array.isArray(b.p)?b.p:[]).slice(0,200).filter(Array.isArray).map(q=>[Math.max(0,Math.min(1000,q[0]|0)),Math.max(0,Math.min(700,q[1]|0))]);if(!p.length)return;
      if(b.new){if(d.strokes.length>=500)return;d.strokes.push({c:/^#[0-9a-f]{6}$/i.test(b.c)?b.c:'#111111',w:Math.max(2,Math.min(40,b.w|0||6)),p})}else{const s=d.strokes[d.strokes.length-1];if(s&&s.p.length<4000)s.p.push(...p)}break}
    case'dundo':if(r.phase==='draw'&&r.dr.order[r.dr.i]===pid)r.dr.strokes.pop();break;
    case'dclear':if(r.phase==='draw'&&r.dr.order[r.dr.i]===pid)r.dr.strokes=[];break;
    case'guess':{if(r.phase!=='draw')return;const d=r.dr,dr=d.order[d.i];if(d.st!=='draw'||dr===pid||d.solved[pid])return;if(r.endsAt&&Date.now()>r.endsAt+2000)throw U('Time is up');
      const t=String(b.text||'').trim().slice(0,30);if(!t)return;const nz=x=>x.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(nz(t)===nz(d.word)){const k=Object.keys(d.solved).length;d.solved[pid]=k+1;r.score[pid]=(r.score[pid]||0)+([10,7,5][k]||3);r.score[dr]=(r.score[dr]||0)+3;d.chat.push({n:r.players[pid].name,ok:1});
        if([...online(r)].every(id=>id===dr||d.solved[id])){d.st='reveal';r.endsAt=null}}
      else d.chat.push({n:r.players[pid].name,t});if(d.chat.length>60)d.chat.shift();break}
    case'del':r.cards=r.cards.filter(c=>!(c.id===b.id&&c.pid===pid));break;
    case'vote':{if(r.phase!=='vote')return;const c=r.cards.find(c=>c.id===b.id);if(!c||c.grp)return;
      if(c.votes.has(pid))c.votes.delete(pid);else if(r.cards.filter(k=>k.votes.has(pid)).length<3)c.votes.add(pid);break}
    case'react':{if(r.phase!=='results'||g.type!=='text'||!REACT.includes(b.e))return;const c=r.cards.find(c=>c.id===b.id);if(!c)return;c.re=c.re||{};const a=c.re[b.e]||(c.re[b.e]=[]),k=a.indexOf(pid);k<0?a.push(pid):a.splice(k,1);break}
    case'rate':{if(r.phase!=='collect'||g.type!=='scale')return;const a=r.ans[pid]||(r.ans[pid]=[]);if(b.q>=0&&b.q<g.qs.length&&b.v>=1&&b.v<=g.max)a[b.q]=b.v;break}
    case'choose':if(r.phase!=='collect'||g.type!=='choice'||!(b.i>=0&&b.i<g.opts.length))return;r.ans[pid]=b.i;break;
    case'tl':{if(r.phase!=='collect'||g.type!=='tl')return;const s=(b.s||[]).map(x=>String(x||'').trim().slice(0,100));if(s.length!==3||s.some(x=>!x))throw U('Fill in all three statements');r.tl[pid]={s,lie:Math.max(0,Math.min(2,b.lie|0))};break}
    case'answer':{if(r.phase!=='play'||r.show)return;const rd=g.rounds[r.i],n=g.type==='who'?r.names.length:rd.o.length;if(!(b.c>=0&&b.c<n)||rd.owner===pid)return;
      if(g.type==='quiz'&&Date.now()>r.endsAt+1500)throw U('Time is up');
      const m=r.picks[r.i]||(r.picks[r.i]={});if(g.type==='quiz'&&m[pid])return;m[pid]={c:b.c|0,l:r.endsAt?Math.max(0,Math.min(1,(r.endsAt-Date.now())/20000)):0};break}
    case'action':{need();const t=String(b.text||'').trim().slice(0,200);if(!t)return;if(r.actions.length>=50)throw U('Too many action items');r.actions.push({id:rid(3),text:t,owner:clean(b.owner),due:clean(b.due),done:false});break}
    case'adone':{need();const a=r.actions.find(a=>a.id===b.id);if(a)a.done=!a.done;break}
    case'adel':need();r.actions=r.actions.filter(a=>a.id!==b.id);break;
    case'discuss':need();if(r.phase==='results'&&g.type==='text'&&r.cards.length)r.disc={i:0,endsAt:Date.now()+180000};break;
    case'dnext':need();if(!r.disc)return;if(++r.disc.i>=topN(r).length)r.disc=null;else r.disc.endsAt=Date.now()+180000;break;
    case'dmore':need();if(r.disc)r.disc.endsAt+=120000;break;
    case'dstop':need();r.disc=null;break;
    case'kick':{need();const kid=Object.keys(r.players).find(i=>al(i)===b.id);if(!kid||kid===r.host)return;delete r.players[kid];for(const c of[...r.clients])if(c.pid===kid){c.res.write('data:{"kicked":true}\n\n');c.res.end();r.clients.delete(c)}break}
    case'host':{need();const hid=Object.keys(r.players).find(i=>al(i)===b.id);if(hid)r.host=hid;break}
  }
  push(r);
}

const server=http.createServer(async(req,res)=>{
  for(const[k,v]of Object.entries({'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Strict-Transport-Security':'max-age=31536000','Cache-Control':'no-store'}))res.setHeader(k,v);
  const ip=ipOf(req),u=new URL(req.url,'http://x'),code=(u.searchParams.get('code')||'').toUpperCase();
  try{
    if(req.method==='GET'){
      if(u.pathname==='/healthz')return res.end('ok');
      if(over('g:'+ip,1200,6e4))return json(res,429,{error:'Too many requests'});
      if(u.pathname==='/api/room')return json(res,rooms.has(code)?200:404,{});
      const r=rooms.get(code),pid=u.searchParams.get('pid')||'';
      if(u.pathname==='/api/events'){
        if(!r||!has(r.players,pid))return json(res,404,{error:'Room not found'});
        if((sse.get(ip)||0)>=60||r.clients.size>=MAX*4)return json(res,429,{error:'Too many connections'});sse.set(ip,(sse.get(ip)||0)+1);
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 2000\n\n');const c={res,pid};r.clients.add(c);push(r);
        return req.on('close',()=>{sse.set(ip,Math.max(0,(sse.get(ip)||1)-1));r.clients.delete(c);push(r)});
      }
      if(u.pathname==='/api/trends'){if(!r||!has(r.players,pid))return json(res,404,{error:'Room not found'});const m=new Map();for(const e of hist[r.team]||[])e.qs.forEach(q=>{const k=e.title+'|'+q.q;if(!m.has(k))m.set(k,{title:e.title,q:q.q,max:e.max,pts:[]});m.get(k).pts.push({t:e.t,avg:q.avg})});return json(res,200,[...m.values()].map(x=>({...x,pts:x.pts.slice(-12)})))}
      if(u.pathname==='/api/export'){if(!r||!has(r.players,pid))return json(res,404,{error:'Room not found'});res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8'});return res.end(md(r))}
      if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(INDEX)}
      return json(res,404,{error:'Not found'});
    }
    if(req.method!=='POST')return json(res,405,{});
    const o=req.headers.origin;if(o){let h;try{h=new URL(o).host}catch{}if(h!==req.headers.host)return json(res,403,{error:'Forbidden'})}
    if(!String(req.headers['content-type']||'').startsWith('application/json'))throw U('Bad request');
    if(over('p:'+ip,3000,6e4))return json(res,429,{error:'Too many requests. Slow down.'});
    let body='';for await(const ch of req){body+=ch;if(body.length>2e4)throw U('Too large')}
    let b;try{b=JSON.parse(body||'{}')}catch{throw U('Bad request')}if(!b||typeof b!=='object'||Array.isArray(b))throw U('Bad request');
    if(u.pathname==='/api/room'){
      if(over('c:'+ip,20,36e5))throw U('Too many rooms created. Try again later.');if(rooms.size>=500)throw U('Server is busy. Try again later.');
      const name=clean(b.name);if(!name)throw U('Enter your name');const pw=clean(b.pw);let team=null;
      if(clean(b.team)){const k=clean(b.team).toLowerCase().replace(/[^a-z0-9 _-]/g,'').trim();if(!k)throw U('Use letters and numbers in the team name');if(!pw)throw U('Set a room password to use team trends');
        const key='t:'+k;if(has(hist,'p:'+key)){if(!okPw(hist['p:'+key],pw))throw U('That team name is taken or the password is wrong')}else{hist['p:'+key]=mkPw(pw);hist[key]=hist[key]||[];fs.writeFile(HF,JSON.stringify(hist),()=>{})}team=key}
      const r={...fresh(),code:newCode(),host:rid(16),players:{},clients:new Set(),t:Date.now(),pwh:pw?mkPw(pw):null,team};
      r.players[r.host]={name,emoji:EMOJI[0]};rooms.set(r.code,r);save();return json(res,200,{code:r.code,pid:r.host});
    }
    if(over('j:'+ip,300,6e4))throw U('Too many requests. Slow down.');
    const r=rooms.get(String(b.code||'').toUpperCase());if(!r)return json(res,404,{error:'Room not found. Check the code.'});
    const pid=typeof b.pid==='string'?b.pid:'';
    if(u.pathname==='/api/join'){
      if(pid&&has(r.players,pid))return json(res,200,{pid});
      if(r.pwh){if(over('pw:'+ip+r.code,10,6e5))throw U('Too many attempts. Try again in a few minutes.');if(!okPw(r.pwh,clean(b.pw)))throw U('Wrong room password')}
      const name=clean(b.name);if(!name)throw U('Enter your name');
      if(Object.keys(r.players).length>=MAX)throw U(`Room is full (${MAX} people max)`);
      const id=rid(16);r.players[id]={name,emoji:EMOJI[Object.keys(r.players).length%EMOJI.length]};push(r);return json(res,200,{pid:id});
    }
    if(!has(r.players,pid))return json(res,403,{error:'Not in this room'});
    if(u.pathname==='/api/act'){act(r,pid,b);return json(res,200,{})}
    if(u.pathname==='/api/slack'){if(pid!==r.host)throw U('Only the facilitator can do that');if(!SLACK)throw U('Slack is not configured');
      const x=await fetch(SLACK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:md(r)})});if(!x.ok)throw U('Slack rejected the message');return json(res,200,{})}
    json(res,404,{error:'Not found'});
  }catch(e){if(!e.user)console.error(e);if(!res.headersSent)json(res,e.user?400:500,{error:e.user?e.message:'Something went wrong'})}
});
server.requestTimeout=20000;server.headersTimeout=10000;
server.listen(process.env.PORT||8080,'0.0.0.0',()=>console.log('RetroHub on',process.env.PORT||8080));

setInterval(()=>{const n=Date.now();for(const x of hits.keys())if(hits.get(x)[1]<n)hits.delete(x);for(const[c,r]of rooms){for(const x of r.clients)x.res.write(': ka\n\n');if(!r.clients.size&&Date.now()-r.t>12*36e5)rooms.delete(c)}},15000);
