// Деньги: остатки, прибыль, ОПИУ, отсрочки, прочие расходы, архив, правка договора, переплата, проверка базы
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);await autoConfirm(p);

  // Остаток = цена − предоплата − оплаты − скидки, по каждому договору
  const bal=await p.evaluate(()=>S.clients.filter(c=>{const s=getStats(c),paid=S.payments.filter(x=>x.clientId===c.id&&x.type==='payment').reduce((a,x)=>a+x.amount,0);
    return Math.abs(s.balance-Math.max(0,c.price-c.prepay-paid))>0.004;}).map(c=>c.id));
  check('остаток долга каждого договора считается верно',!bal.length,bal.slice(0,5));

  const ic0=await p.evaluate(()=>integrityIssues().map(x=>x.t));
  check('проверка базы: в согласованной базе расхождений нет',!ic0.length,ic0.slice(0,5));

  // Прибыль одна и та же: карточка сделки = события инвесторов = ОПИУ
  const pr=await p.evaluate(()=>{const M=invModel(),ev={};M.events.forEach(e=>{if(e.kind!=='profit')return;const n=e.ref.match(/№(\d+)/);if(n)ev[n[1]]=(ev[n[1]]||0)+e.amount;});
    const bad=S.clients.filter(c=>Math.abs((dealMarginGot(c)||0)-(ev[c.contractId]||0))>0.01).map(c=>c.id);
    const ctx=finCtx(),mks=[...new Set(M.events.map(e=>monthKey(e.d)))];const opiu=mks.reduce((a,mk)=>{const f=finFact(mk,ctx);return a+f.gross-f.disc;},0);
    const all=M.events.filter(e=>e.kind==='profit').reduce((a,e)=>a+e.amount,0);return{bad,opiu:R2(opiu),all:R2(all)};});
  check('маржа в карточке сделки = прибыли у инвесторов',!pr.bad.length,pr.bad.slice(0,5));
  check('наценка в ОПИУ за все месяцы = прибыли у инвесторов',Math.abs(pr.opiu-pr.all)<0.05,pr);

  // Отсрочка: план — по новой дате, собираемость и просрочка — по договору
  const df=await p.evaluate(async()=>{const nxt=monthKey(new Date(new Date().getFullYear(),new Date().getMonth()+2,1));
    const c=S.clients.find(c=>!c.archived&&getStats(c).schedule.some(it=>it.st==='overdue'));const it=getStats(c).schedule.find(it=>it.st==='overdue'),om=monthKey(parseD(it.date));
    const snap=()=>{const x=finCtx(),f=finFact(nxt,x),o=finFact(om,x);return{planOrig:o.plan,planNxt:f.plan,rate:finDerive(o).rate,exp:f.expLeft,defer:f.deferLeft,over:getStats(S.clients.find(y=>y.id===c.id)).overdue};};
    const b=snap();const nd=new Date(new Date().getFullYear(),new Date().getMonth()+2,10);
    await window.DB.updateDoc(window.DB.doc(window.DB.db,'clients',c.id),{defer:{[it.month]:{date:dayKey(nd),note:'тест'}}});await new Promise(r=>setTimeout(r,1200));
    const a=snap();return{size:it.size,left:R2(it.size-it.paid),b,a,next:clNextHtml(S.clients.find(x=>x.id===c.id))};});
  check('отсрочка: план переехал в месяц отсрочки',Math.abs(df.b.planOrig-df.a.planOrig-df.size)<0.01&&Math.abs(df.a.planNxt-df.b.planNxt-df.size)<0.01,df);
  check('отсрочка: собираемость и просрочка — по договору',df.b.rate===df.a.rate&&df.b.over===df.a.over&&df.a.over>0,df);
  check('отсрочка: в прогнозе и в строке «Отсроченные платежи»',Math.abs(df.a.exp-df.b.exp-df.left)<0.01&&Math.abs(df.a.defer-df.b.defer-df.left)<0.01,df);
  check('отсрочка: «След. платёж» красный и с датой отсрочки',/class="cr"/.test(df.next)&&/отсрочка/.test(df.next));

  // Прочий расход — только учредителям
  const fx=await p.evaluate(async()=>{const cur=monthKey(new Date()),pick=()=>Object.fromEntries(invComputeMonth(invModel(),cur).rows.map(x=>[x.invId,x.total]));
    const b=pick();await doSaveKassa('other_exp',9000,'w1','','Налоги','',S.wallets.find(w=>w.id==='w1'));await new Promise(r=>setTimeout(r,1200));
    const a=pick(),f=finDerive(finFact(cur,finCtx()));return{f:R2(b.INV0-a.INV0),i:R2(b.INV1-a.INV1),other:f.otherExp};});
  check('прочий расход 9 000 целиком на учредителе',Math.abs(fx.f-9000)<0.02&&Math.abs(fx.i)<0.02,fx);
  check('прочий расход виден в ОПИУ',fx.other===9000,fx);

  // Архив: можно и с долгом
  const ar=await p.evaluate(async()=>{const c=S.clients.find(x=>!x.archived&&getStats(x).balance>0);let msg='';window.showConfirm=(t,m,ok)=>{msg=m;ok&&ok();};archiveClient(c.id,true);await new Promise(r=>setTimeout(r,1200));window.showConfirm=(t,m,ok)=>ok&&ok();
    const arch=!!S.clients.find(x=>x.id===c.id).archived;archiveClient(c.id,false);await new Promise(r=>setTimeout(r,1000));return{arch,warn:/Долг .* пропадёт/.test(msg)};});
  check('договор с долгом уходит в архив, CRM предупреждает о долге',ar.arch&&ar.warn,ar);

  // Удаление договора: можно с долгом, если нет денег и закупок
  const dl=await p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));const{db,doc,setDoc}=window.DB;
    const b={...S.clients.find(x=>x.id==='c3')};delete b.id;delete b._u;delete b.archived;await setDoc(doc(db,'clients','cDel'),{...b,contractId:'09990',name:'Удаляемый',cost:30000});await sl(1200);
    const r={};r.btn=cdDelBtn(S.clients.find(x=>x.id==='cDel')).includes('Удалить');
    delClient('cDel');await sl(1500);r.gone=!S.clients.some(x=>x.id==='cDel');
    const withPay=S.clients.find(x=>!x.archived&&S.payments.some(p=>p.clientId===x.id&&p.type==='payment'));
    r.btnPay=cdDelBtn(withPay).includes('Удалить');delClient(withPay.id);await sl(300);
    const t=document.querySelector('#confirmLayer .confirm-title');r.blocked=!!t&&t.textContent==='Удалить нельзя'&&S.clients.some(x=>x.id===withPay.id);document.getElementById('confirmLayer').innerHTML='';
    return r;});
  check('договор без денег и закупок удаляется, даже с долгом',dl.btn&&dl.gone,dl);
  check('договор с платежами удалить нельзя',!dl.btnPay&&dl.blocked,dl);

  // Закупка частями: пока не оплачена вся себестоимость
  const pu=await p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));const{db,doc,setDoc}=window.DB;
    const b={...S.clients.find(x=>x.id==='c3')};delete b.id;delete b._u;delete b.archived;await setDoc(doc(db,'clients','cBuy'),{...b,contractId:'09991',name:'Закупка',cost:30000});await sl(1200);
    const r={};const sh=()=>{const t=document.querySelector('#confirmLayer .confirm-title');const v=t?t.textContent:'';document.getElementById('confirmLayer').innerHTML='';return v;};
    goTo('kassa');openKassaOp();document.getElementById('koWallet').value='w1';koClientPick('cBuy');r.pre=parseNum(document.getElementById('koAmt').value);
    document.getElementById('koAmt').value='10 000';await saveKassaOp();await sl(1200);r.first=purchasePaid('cBuy');
    openKassaOp();document.getElementById('koWallet').value='w1';koClientPick('cBuy');r.pre2=parseNum(document.getElementById('koAmt').value);
    document.getElementById('koAmt').value='25 000';await saveKassaOp();await sl(600);r.over=sh();r.still=purchasePaid('cBuy');
    document.getElementById('koAmt').value='20 000';await saveKassaOp();await sl(1200);r.full=purchasePaid('cBuy');
    openKassaOp();koClientPick('cBuy');r.blocked=document.getElementById('koClientId').value==='__blocked__';closeM('mKassa');
    openC('cBuy');await sl(200);r.card=document.getElementById('cDetail').innerText.includes('Оплачено полностью');
    return r;});
  check('закупка подставляет себестоимость, можно оплатить частично',pu.pre===30000&&pu.first===10000,pu);
  check('вторая закупка подставляет остаток',pu.pre2===20000,pu);
  check('закупка больше остатка себестоимости не проводится',pu.over==='Больше себестоимости'&&pu.still===10000,pu);
  check('после полной оплаты новая закупка по договору закрыта',pu.full===30000&&pu.blocked&&pu.card,pu);

  // Правка договора с предоплатой: одна запись; при обрыве — ничего
  const ed=await p.evaluate(async()=>{const run=async fail=>{openEdit('c7');await new Promise(r=>setTimeout(r,200));document.getElementById('f_prepay').value='7000';document.getElementById('f_product').value='Изменённый товар';_schedOk=true;
      const orig=window.DB.writeBatch;if(fail)window.DB.writeBatch=db=>{const b=orig(db);return{...b,commit:()=>Promise.reject(new Error('обрыв'))};};
      await saveClient();window.DB.writeBatch=orig;closeM('mClient');await new Promise(r=>setTimeout(r,1200));
      const c=S.clients.find(x=>x.id==='c7');return{prepay:c.prepay,product:c.product,kassa:S.kassaOps.filter(o=>o.type==='prepay_in'&&o.refId==='c7').map(o=>o.amount),pay:S.payments.filter(x=>x.clientId==='c7'&&x.type==='prepay').map(x=>x.amount)};};
    return{fail:await run(true),ok:await run(false)};});
  check('правка договора при обрыве связи не записывает половину',ed.fail.prepay===5000&&!ed.fail.kassa.length&&ed.fail.product!=='Изменённый товар',ed.fail);
  check('правка договора без обрыва записывает всё вместе',ed.ok.prepay===7000&&ed.ok.kassa[0]===7000&&ed.ok.pay[0]===7000&&ed.ok.product==='Изменённый товар',ed.ok);
  const sc=await p.evaluate(()=>integrityIssues().map(x=>x.t));
  check('график, который после правки не сходится с ценой, виден в «Проверке базы»',sc.some(t=>/№00008.*сумма графика/.test(t)),sc);

  // Переплата попадает в список проверки и в карточку
  const op=await p.evaluate(async()=>{const bal=R2(getStats(S.clients.find(x=>x.id==='c3')).balance);_cid='c3';await savePay(bal,'w1');
    // та же сумма, принятая «на другом устройстве» до того, как первое узнало об оплате
    const{db,doc,collection,writeBatch,increment}=window.DB,c=S.clients.find(x=>x.id==='c3'),bt=writeBatch(db),pR=doc(collection(db,'payments')),kR=doc(collection(db,'kassaOps')),now=new Date();
    bt.set(pR,{clientId:'c3',contractId:c.contractId,name:c.name,amount:bal,type:'payment',typeLabel:'Ежемес. платеж',payType:'Сбер',wallet:'w2',kassaOpId:kR.id,date:now,dateStr:fmtD(now)});
    bt.set(kR,{type:'payment_in',amount:bal,wallet:'w2',walletName:'Сбер',desc:'Оплата',date:now,dateStr:fmtD(now),auto:true,refType:'client',refId:'c3',paymentId:pR.id});
    bt.update(doc(db,'wallets','w2'),{balance:increment(bal)});await bt.commit();await new Promise(r=>setTimeout(r,1200));
    openC('c3');await new Promise(r=>setTimeout(r,300));return{card:(document.getElementById('cDetail').innerText.match(/Переплата[^\n]*/)||[''])[0],list:integrityIssues().map(x=>x.t)};});
  check('переплата видна в карточке сделки',op.card.startsWith('Переплата'),op.card);
  check('переплата попадает в «Проверку базы»',op.list.some(t=>/переплата/.test(t)),op.list);
  check('после оплат касса сходится с операциями',await p.evaluate(()=>{const m=walletCalc();return S.wallets.every(w=>Math.abs(R2(w.balance)-(m[w.id]||0))<0.01);}));

  noErrors('деньги',errs);await ctx.close();
}
