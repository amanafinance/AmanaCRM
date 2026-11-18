// Общий денежный расчёт для браузера и сервера. Все суммы округляются до копеек.
(function(root){
function engine(input){
const S={...input,inv:input.inv||input.investors||[],clients:input.clients||[],payments:input.payments||[],kassaOps:input.kassaOps||[],invOps:input.invOps||[],invMonths:input.invMonths||[],wallets:input.wallets||[]};
const invD=x=>{if(!x)return null;if(x instanceof Date)return x;if(x.$date)return new Date(x.$date);if(x.toDate)return x.toDate();const d=new Date(x);return isNaN(d)?null:d;};
const dTs=invD,invR=n=>Math.round((n+Number.EPSILON)*100)/100;
const biz=d=>new Date(d.getTime()+10800000);
const parseD=v=>{if(!v)return null;const m=String(v).match(/^(\d\d)\.(\d\d)\.(\d{4})$/);return m?new Date(Date.UTC(+m[3],+m[2]-1,+m[1])-10800000):new Date(v);};
const monthKey=d=>{const x=biz(d);return x.getUTCFullYear()+'-'+String(x.getUTCMonth()+1).padStart(2,'0');};
const mkStart=mk=>{const[y,m]=mk.split('-').map(Number);return new Date(Date.UTC(y,m-1,1)-10800000);};
const mkNext=mk=>{const[y,m]=mk.split('-').map(Number);return monthKey(new Date(Date.UTC(y,m,1)-10800000));};
const fmtD=d=>{const x=biz(d);return String(x.getUTCDate()).padStart(2,'0')+'.'+String(x.getUTCMonth()+1).padStart(2,'0')+'.'+x.getUTCFullYear();};
const dealDate=c=>parseD(c.date)||invD(c.createdAt),paysOf=id=>S.payments.filter(p=>p.clientId===id);
const INV_EXP_TYPES=['salary','opex'],INV_FEXP_TYPES=['other_exp'];
const INV_OP={deposit:1,withdraw:1,reinvest:1,payout:1,profit:1,loss:1};
function dealProfitList(c,pays){
  const out=[],pre=parseFloat(c.prepay)||0;let preD=null;
  (pays||paysOf(c.id)).forEach(p=>{
    if(p.type==='prepay'){if(!preD)preD=invD(p.date);return;}
    if(p.type!=='payment'&&p.type!=='discount')return;
    const d=invD(p.date);if(d)out.push({p,d});
  });
  if(pre>0){const d=preD||dealDate(c);if(d)out.push({p:{type:'prepay',amount:pre},d});}
  return out;
}

function dealProfitSplit(c,list){
  const cost=parseFloat(c.cost)||0,price=parseFloat(c.price)||0;
  let bodyRem=Math.max(0,cost),profRem=Math.max(0,price-cost),got=0;const items=[];
  const ord=t=>t==='prepay'?0:1; // в один день сначала предоплата
  list.slice().sort((a,b)=>a.d-b.d||ord(a.p.type)-ord(b.p.type)).forEach(({p,d})=>{
    const a=parseFloat(p.amount)||0;if(a<=0)return;
    if(p.type==='discount'){const fromProf=Math.min(a,profRem);profRem-=fromProf;const loss=Math.min(a-fromProf,bodyRem);bodyRem-=loss;
      if(loss>0.004){got-=loss;items.push({d,disc:loss});}return;}
    const R=bodyRem+profRem;let prof,body;
    if(R<=0){prof=a;body=0;}
    else{const x=Math.min(a,R);prof=x*profRem/R;body=x-prof;profRem-=prof;bodyRem-=body;prof+=a-x;}
    got+=prof;items.push({d,prof,body,src:p.type==='prepay'?'prepay':'payment'});
  });
  return{items,bodyRem,profRem,got};
}

function invAddMonths(d,n){const p=biz(d),y=p.getUTCFullYear(),m=p.getUTCMonth()+n,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(p.getUTCDate(),last),p.getUTCHours(),p.getUTCMinutes(),p.getUTCSeconds())-10800000);}
function invDaysLeft(M,t){if(!t.termEnd)return null;return Math.ceil((t.termEnd-M.now)/86400000);}
function invRentFmt(x){if(x===null||x===undefined||!isFinite(x))return'—';const p=x*100;const v=Math.abs(p)<10?p.toFixed(2):p.toFixed(1);return v.replace('.',',').replace(/,00$/,'')+'%';}
// ---------- МОДЕЛЬ ----------
// Модель считается заново, только когда изменились данные (или прошла минута)
let _imC=null;
function invModel(){
  const k=[S.invOps,S.invMonths,S.inv,S.payments,S.clients,S.kassaOps,S.wallets],t=Math.floor(Date.now()/60000);
  if(_imC&&_imC.t===t&&_imC.k.every((x,i)=>x===k[i]))return _imC.m;
  const m=invModelCalc();_imC={k,t,m};return m;
}

function invModelCalc(){
  const now=new Date(),curMk=monthKey(now);
  const ops=S.invOps.map(o=>({...o,_d:invD(o.date),_a:parseFloat(o.amount)||0})).filter(o=>o._d).sort((a,b)=>a._d-b._d);
  const closed={};S.invMonths.forEach(m=>closed[m.id]=m);
  const closedKeys=Object.keys(closed).sort();
  const lastClosed=closedKeys.length?closedKeys[closedKeys.length-1]:null;
  const invById={};S.inv.forEach(i=>invById[i.id]=i);
  // Вклады, их капитал и «к выплате» по каждому вкладу
  const tranches={},tcapNow={},tpay={},capEvents=[];
  const pushCap=(d,depId,delta,src)=>{capEvents.push({_d:d,depId,delta,src});tcapNow[depId]=(tcapNow[depId]||0)+delta;};
  const addPay=(depId,delta)=>{tpay[depId]=(tpay[depId]||0)+delta;};
  const trOf=invId=>Object.values(tranches).filter(t=>t.invId===invId).sort((a,b)=>a.date-b.date);
  const fifoPay=(invId,amt)=>{let rem=amt;const ts=trOf(invId);ts.forEach(t=>{if(rem<=0.004)return;const take=Math.min(rem,Math.max(0,tpay[t.id]||0));if(take>0){addPay(t.id,-take);rem-=take;}});if(rem>0.004&&ts.length)addPay(ts[0].id,-rem);};
  const propPay=(invId,amt)=>{const ts=trOf(invId);if(!ts.length)return;const act=ts.filter(t=>(tcapNow[t.id]||0)>0.004);const tot=act.reduce((s,t)=>s+tcapNow[t.id],0);if(tot>0)act.forEach(t=>addPay(t.id,amt*tcapNow[t.id]/tot));else addPay(ts[0].id,amt);};
  const newTranche=(o,inv,kind)=>{
    const isF=inv.role==='founder';
    const pct=isF?100:(parseFloat(o.pct)||0); // доля инвестору задаётся в каждом вкладе
    const st=o._d;
    let termEnd=null;
    if(!isF){if(o.endDate!==undefined)termEnd=invD(o.endDate)||null;else if(parseInt(o.termMonths)>0)termEnd=invAddMonths(st,parseInt(o.termMonths));}
    tranches[o.id]={id:o.id,invId:o.invId,kind,date:o._d,amount:o._a,pct,start:st,termEnd,op:o};
    tpay[o.id]=tpay[o.id]||0;pushCap(o._d,o.id,o._a,o.id);
  };
  ops.forEach(o=>{
    const inv=invById[o.invId];if(!inv)return;
    const dep=o.depId&&tranches[o.depId]&&tranches[o.depId].invId===o.invId?o.depId:null;
    if(o.type==='deposit')newTranche(o,inv,'deposit');
    else if(o.type==='reinvest'){
      if(dep){pushCap(o._d,dep,o._a,o.id);addPay(dep,-o._a);}
      else{fifoPay(o.invId,o._a);newTranche(o,inv,'reinvest');}
    }
    else if(o.type==='payout'){if(dep)addPay(dep,-o._a);else fifoPay(o.invId,o._a);}
    else if(o.type==='profit'){if(dep)addPay(dep,o._a);else propPay(o.invId,o._a);}
    else if(o.type==='withdraw'){
      if(dep){pushCap(o._d,dep,-o._a,o.id);return;}
      let rem=o._a;trOf(o.invId).filter(t=>(tcapNow[t.id]||0)>0.004).forEach(t=>{if(rem<=0.004)return;const take=Math.min(rem,tcapNow[t.id]);pushCap(o._d,t.id,-take,o.id);rem-=take;});
      const first=trOf(o.invId)[0];if(rem>0.004&&first)pushCap(o._d,first.id,-rem,o.id);
    }
    else if(o.type==='loss'){
      if(dep){pushCap(o._d,dep,-o._a,o.id);return;}
      if(Array.isArray(o.deps)&&o.deps.length){o.deps.forEach(x=>{if(tranches[x.depId])pushCap(o._d,x.depId,-(parseFloat(x.amount)||0),o.id);});return;}
      const ts=trOf(o.invId).filter(t=>(tcapNow[t.id]||0)>0.004);const tot=ts.reduce((s,t)=>s+tcapNow[t.id],0);
      if(tot>0)ts.forEach(t=>pushCap(o._d,t.id,-o._a*tcapNow[t.id]/tot,o.id));
    }
  });
  // события прибыли по договорам
  const byClient={};
  S.payments.forEach(p=>{if(p.type!=='payment'&&p.type!=='discount'&&p.type!=='prepay')return;(byClient[p.clientId]=byClient[p.clientId]||[]).push(p);});
  const events=[];let inDeals=0,noCost=0,profLeft=0;
  S.clients.forEach(c=>{
    const cost=parseFloat(c.cost)||0,price=parseFloat(c.price)||0;
    if(price<=0)return;
    if(cost<=0){if(byClient[c.id])noCost++;return;}
    const sp=dealProfitSplit(c,dealProfitList(c,byClient[c.id]||[]));
    sp.items.forEach(x=>events.push(x.disc?{d:x.d,amount:-x.disc,body:0,kind:'profit',src:'discount',ref:'Скидка ниже себестоимости №'+(c.contractId||'—')+' '+(c.name||'')}:{d:x.d,amount:x.prof,body:x.body,kind:'profit',src:x.src,ref:(x.src==='prepay'?'Предоплата ':'')+'№'+(c.contractId||'—')+' '+(c.name||'')}));
    inDeals+=Math.max(0,sp.bodyRem);profLeft+=Math.max(0,sp.profRem);
  });
  S.kassaOps.forEach(o=>{if(!INV_EXP_TYPES.includes(o.type)&&!INV_FEXP_TYPES.includes(o.type))return;const d=invD(o.date);const a=parseFloat(o.amount)||0;if(d&&a>0)events.push({d,amount:-a,kind:INV_FEXP_TYPES.includes(o.type)?'fexpense':'expense',etype:o.type,ref:o.desc||({salary:'Зарплата',opex:'Операционные расходы',other_exp:'Прочий расход'})[o.type]});});
  events.sort((a,b)=>a.d-b.d);
  // балансы участников
  const bal={};
  S.inv.forEach(i=>bal[i.id]={capital:0,payable:0,earned:0,deposited:0,withdrawn:0,paid:0,reinvested:0,ops:0});
  ops.forEach(o=>{const b=bal[o.invId];const m=INV_OP[o.type];if(!b||!m)return;b.ops++;
    if(o.type==='profit')b.earned+=o._a;if(o.type==='loss')b.earned-=o._a;if(o.type==='deposit')b.deposited+=o._a;if(o.type==='withdraw')b.withdrawn+=o._a;if(o.type==='payout')b.paid+=o._a;if(o.type==='reinvest')b.reinvested+=o._a;});
  Object.values(tranches).forEach(t=>{if(bal[t.invId]){bal[t.invId].capital+=tcapNow[t.id]||0;bal[t.invId].payable+=tpay[t.id]||0;}});
  Object.values(bal).forEach(b=>{['capital','payable','earned'].forEach(k=>b[k]=invR(b[k]));});
  Object.keys(tcapNow).forEach(k=>tcapNow[k]=invR(tcapNow[k]));Object.keys(tpay).forEach(k=>tpay[k]=invR(tpay[k]));
  const poolCap=invR(Object.values(bal).reduce((s,b)=>s+Math.max(0,b.capital),0));
  const firstMk=ops.length?monthKey(ops[0]._d):null;
  let startMk=firstMk;if(closedKeys.length&&(!startMk||closedKeys[0]<startMk))startMk=closedKeys[0];
  const months=[];if(startMk){let mk=startMk;while(mk<=curMk){months.push(mk);mk=mkNext(mk);}}
  const firstOpen=months.find(mk=>!closed[mk])||curMk;
  const kassaTotal=S.wallets.reduce((s,w)=>s+(parseFloat(w.balance)||0),0);
  capEvents.sort((a,b)=>a._d-b._d);
  return{now,curMk,ops,tranches,tcapNow,tpay,capEvents,closed,closedKeys,lastClosed,events,inDeals:invR(inDeals),profLeft:invR(profLeft),noCost,bal,poolCap,months,firstOpen,kassaTotal,_mc:{}};
}

function invComputeMonth(M,mk){
  if(M._mc[mk])return M._mc[mk];
  const st=mkStart(mk),en=mkStart(mkNext(mk));
  const evs=M.events.filter(e=>e.d>=st&&e.d<en);
  const tcap={};Object.keys(M.tranches).forEach(id=>tcap[id]=0);
  const rows={};
  S.inv.forEach(i=>{rows[i.id]={invId:i.id,name:i.name,role:i.role||'investor',gross:0,exp:0,toInv:0,toComp:0,fromComp:0,pre:0,pcts:new Set()};});
  const dep={};
  const dg=id=>{const tr=M.tranches[id];return dep[id]||(dep[id]={depId:id,invId:tr.invId,pct:tr.pct,date:fmtD(tr.date),start:fmtD(tr.start),gross:0,exp:0,toInv:0,toComp:0,fromComp:0,pre:0});};
  let k=0;const ce=M.capEvents;
  const apply=t=>{while(k<ce.length&&ce[k]._d<=t){const e=ce[k];if(tcap[e.depId]!==undefined)tcap[e.depId]+=e.delta;k++;}};
  let gross=0,exp=0,unalloc=0,noFounder=false;
  evs.forEach(e=>{
    apply(e.d);
    const amt=e.amount;if(e.kind==='profit')gross+=amt;else exp-=amt;
    let act=Object.keys(tcap).filter(id=>tcap[id]>0.004&&rows[M.tranches[id].invId]);
    if(e.kind==='fexpense')act=act.filter(id=>rows[M.tranches[id].invId].role==='founder');
    const tot=act.reduce((s,id)=>s+tcap[id],0);
    if(tot<=0){unalloc+=amt;return;}
    const fT=act.filter(id=>rows[M.tranches[id].invId].role==='founder');
    const ftot=fT.reduce((s,id)=>s+tcap[id],0);
    act.forEach(id=>{
      const tr=M.tranches[id],r=rows[tr.invId],sl=amt*tcap[id]/tot,g=dg(id);
      if(e.kind==='profit'){r.gross+=sl;g.gross+=sl;}else{r.exp-=sl;g.exp-=sl;}
      let pct;
      if(r.role==='founder')pct=1;
      else if(e.d<tr.start){pct=0;r.pre+=sl;g.pre+=sl;}
      else{pct=tr.pct/100;r.pcts.add(tr.pct);}
      r.toInv+=sl*pct;g.toInv+=sl*pct;
      const cp=sl*(1-pct);r.toComp+=cp;g.toComp+=cp;
      if(Math.abs(cp)>1e-9){
        if(ftot>0)fT.forEach(fid=>{const part=cp*tcap[fid]/ftot;dg(fid).fromComp+=part;rows[M.tranches[fid].invId].fromComp+=part;});
        else{unalloc+=cp;noFounder=true;}
      }
    });
  });
  apply(new Date(en.getTime()-1));
  Object.keys(tcap).forEach(id=>{if(tcap[id]>0.004)dg(id);});
  const capBy={};Object.keys(tcap).forEach(id=>{const iv=M.tranches[id].invId;capBy[iv]=(capBy[iv]||0)+Math.max(0,tcap[id]);});
  const totEnd=Object.values(capBy).reduce((s,v)=>s+v,0);
  const list=Object.values(rows).map(r=>{
    const cap=capBy[r.invId]||0;
    const deps=Object.values(dep).filter(d=>d.invId===r.invId).map(d=>{const tr=M.tranches[d.depId];const toInv=invR(d.toInv),fromComp=invR(d.fromComp);
      if(r.role!=='founder'&&!r.pcts.size&&tcap[d.depId]>0.004)r.pcts.add(tr.pct);
      return{depId:d.depId,pct:d.pct,date:d.date,start:d.start,gross:invR(d.gross),exp:invR(d.exp),toInv,toComp:invR(d.toComp),fromComp,pre:invR(d.pre),total:invR(toInv+fromComp),capEnd:invR(Math.max(0,tcap[d.depId])),started:tr.start<en};});
    const pcts=[...r.pcts].sort((a,b)=>a-b);
    const total=invR(deps.reduce((s,x)=>s+x.total,0));
    const startedCap=invR(deps.filter(x=>x.started).reduce((s,x)=>s+x.capEnd,0));
    return{invId:r.invId,name:r.name,role:r.role,pct:pcts.length===1?pcts[0]:null,pcts,gross:invR(r.gross),exp:invR(r.exp),net:invR(r.gross-r.exp),toInv:invR(r.toInv),toComp:invR(r.toComp),fromComp:invR(r.fromComp),pre:invR(r.pre),total,capEnd:invR(cap),startedCap,shareEnd:totEnd>0?cap/totEnd:0,deps};
  }).filter(r=>r.gross||r.exp||r.total||r.capEnd>0);
  const want=invR(gross-exp-unalloc),got=invR(list.reduce((s,r)=>s+r.total,0)),diff=invR(want-got);
  if(diff&&Math.abs(diff)<1){const f=list.filter(r=>r.role==='founder').sort((a,b)=>b.capEnd-a.capEnd)[0];if(f&&f.deps.length){const fd=f.deps.slice().sort((a,b)=>b.capEnd-a.capEnd)[0];fd.total=invR(fd.total+diff);fd.fromComp=invR(fd.fromComp+diff);f.total=invR(f.total+diff);f.fromComp=invR(f.fromComp+diff);}}
  const net=invR(gross-exp);
  const res={mk,gross:invR(gross),exp:invR(exp),net,unalloc:invR(unalloc),noFounder,rows:list,count:evs.length,live:true,poolCap:invR(totEnd),poolRent:totEnd>0?net/totEnd:null};
  M._mc[mk]=res;return res;
}
return {build:invModelCalc,month:invComputeMonth};
}
const api={build(input){const M=engine(input).build();M._source=input;return M;},month(M,mk){return engine(M._source).month(M,mk);}};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AmanaModel=api;
})(typeof window!=='undefined'?window:this);
