// Деньги: остатки, прибыль, ОПИУ, отсрочки, прочие расходы, архив, правка договора, переплата, проверка базы
import {reseed,device,login,check,noErrors,wait,autoConfirm,BACKEND} from '../lib.mjs';
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

  // Новый договор: выбор клиента двумя кнопками, срок 18 месяцев, номер удалённого договора возвращается
  const nd=await p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));const r={};
    const make=async(date)=>{openNew();await sl(200);if(date){document.getElementById('f_date').value=date;}
      r.btns=[...document.querySelectorAll('#pk_client .pick-btns button')].map(b=>b.textContent);r.boxHidden=getComputedStyle(document.querySelector('#pk_client .pick-box')).display==='none';
      const k=[...personIndex().values()].find(x=>x.no==='К-0001').key;pickSet('f_name',encodeURIComponent(k));
      document.getElementById('f_product').value='Телефон';document.getElementById('f_price').value='90 000';document.getElementById('f_cost').value='60 000';document.getElementById('f_prepay').value='0';
      document.getElementById('f_months').value='18';monthsInput(true);await sl(100);r.rows=document.querySelectorAll('#schedBody tr').length;
      await saveClient();await sl(1500);return S.clients.filter(c=>c.product==='Телефон').sort((a,b)=>(b.createdAt&&b.createdAt.toDate?b.createdAt.toDate():new Date(b.createdAt||0))-(a.createdAt&&a.createdAt.toDate?a.createdAt.toDate():new Date(a.createdAt||0)))[0];};
    const yy=String(new Date().getFullYear()).slice(-2);
    const max=y=>S.clients.reduce((a,c)=>{const m=String(c.contractId||'').match(/^(\d{2})-(\d+)$/);return m&&m[1]===y?Math.max(a,parseInt(m[2],10)):a;},0);
    const before=max(yy);const c1=await make();r.no1=c1&&c1.contractId;r.months=c1&&c1.months;r.sched=c1&&getStats(c1).schedule.length;r.exp=yy+'-'+String(before+1).padStart(4,'0');
    delClient(c1.id);await sl(1500);r.gone=!S.clients.some(x=>x.id===c1.id);
    const c2=await make();r.no2=c2&&c2.contractId;
    const c3=await make();r.no3=c3&&c3.contractId;r.exp3=yy+'-'+String(before+2).padStart(4,'0');
    // договор с датой прошлого года — номер из счётчика того года
    const py=String(new Date().getFullYear()-1).slice(-2);const c4=await make((new Date().getFullYear()-1)+'-12-20');r.no4=c4&&c4.contractId;r.exp4=py+'-'+String(max(py)).padStart(4,'0');
    // сортировка: новые номера выше старых 00001…; поиск «ГГ-N» находит договор
    goBase('clients');renderClients();await sl(200);r.top=dealSortKey(c3.contractId)>dealSortKey('00200')&&dealSortKey(c3.contractId)>dealSortKey(c4.contractId);
    r.find=S.clients.filter(c=>dealMatch(c,yy+'-'+(before+2))).map(c=>c.contractId);
    r.findOld=S.clients.filter(c=>dealMatch(c,'00007')).map(c=>c.contractId);
    return r;});
  check('в форме сделки две кнопки: «Выбрать существующего» и «Новый клиент»',nd.boxHidden&&nd.btns[0]==='Выбрать существующего'&&/Новый клиент/.test(nd.btns[1]),nd);
  check('договор на 18 месяцев: график из 18 платежей',nd.rows===18&&String(nd.months)==='18'&&nd.sched===18,nd);
  check('номер договора вида ГГ-NNNN, номер удалённого последнего договора достаётся следующему',/^\d{2}-\d{4}$/.test(nd.no1)&&nd.no1===nd.exp&&nd.gone&&nd.no2===nd.exp&&nd.no3===nd.exp3,nd);
  check('договор с датой прошлого года получает номер того года, нумерация по годам своя',nd.no4===nd.exp4&&/-0001$/.test(nd.no4),nd);
  check('сортировка и поиск понимают новые (ГГ-NNNN) и старые (00007) номера договоров',nd.top&&nd.find.length===1&&nd.find[0]===nd.exp3&&nd.findOld.includes('00007'),nd);

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
    goTo('kassa');openKassaOp();document.getElementById('koClientSearch').value='09991';koClientSearchInput();r.hidden=!document.getElementById('koClientDropdown').innerText.includes('09991');closeM('mKassa');
    return r;});
  check('закупка подставляет себестоимость, можно оплатить частично',pu.pre===30000&&pu.first===10000,pu);
  check('вторая закупка подставляет остаток',pu.pre2===20000,pu);
  check('закупка больше остатка себестоимости не проводится',pu.over==='Больше себестоимости'&&pu.still===10000,pu);
  check('после полной оплаты новая закупка по договору закрыта',pu.full===30000&&pu.blocked&&pu.card,pu);
  check('договор с полностью оплаченным товаром не виден в списке закупки',pu.hidden,pu);

  // Правка договора с предоплатой: одна запись; при обрыве — ничего
  const ed=await p.evaluate(async()=>{const run=async fail=>{openEdit('c7');await new Promise(r=>setTimeout(r,200));document.getElementById('f_prepay').value='7000';document.getElementById('f_product').value='Изменённый товар';recalcSched();
      const orig=window.DB.writeBatch;if(fail)window.DB.writeBatch=db=>{const b=orig(db);return{...b,commit:()=>Promise.reject(new Error('обрыв'))};};
      await saveClient();window.DB.writeBatch=orig;closeM('mClient');await new Promise(r=>setTimeout(r,1200));
      const c=S.clients.find(x=>x.id==='c7');return{prepay:c.prepay,product:c.product,kassa:S.kassaOps.filter(o=>o.type==='prepay_in'&&o.refId==='c7').map(o=>o.amount),pay:S.payments.filter(x=>x.clientId==='c7'&&x.type==='prepay').map(x=>x.amount)};};
    return{fail:await run(true),ok:await run(false)};});
  check('правка договора при обрыве связи не записывает половину',ed.fail.prepay===5000&&!ed.fail.kassa.length&&ed.fail.product!=='Изменённый товар',ed.fail);
  check('правка договора без обрыва записывает всё вместе',ed.ok.prepay===7000&&ed.ok.kassa[0]===7000&&ed.ok.pay[0]===7000&&ed.ok.product==='Изменённый товар',ed.ok);
  // график, не сходящийся с ценой, сохранить нельзя; если такой пришёл в базу в обход CRM — виден в «Проверке базы»
  const sm=await p.evaluate(async()=>{openEdit('c8');await new Promise(r=>setTimeout(r,200));const e=document.getElementById('f_price');e.value=fmt(parseNum(e.value)+10000);e.dispatchEvent(new Event('input',{bubbles:true}));
    const p0=S.clients.find(x=>x.id==='c8').price;await saveClient();await new Promise(r=>setTimeout(r,800));const t=document.querySelector('#confirmLayer .confirm-title');const r={title:t?t.textContent:'',same:S.clients.find(x=>x.id==='c8').price===p0};
    document.getElementById('confirmLayer').innerHTML='';closeM('mClient');
    const{db,doc,updateDoc}=window.DB;await updateDoc(doc(db,'clients','c8'),{'размер6':1});await new Promise(r=>setTimeout(r,1200));r.issues=integrityIssues().map(x=>x.t);return r;});
  check('договор с графиком, не сходящимся с ценой, не сохраняется',sm.title==='График не сходится с ценой'&&sm.same,sm);
  check('такой график, пришедший в обход CRM, виден в «Проверке базы»',sm.issues.some(t=>/№00009.*сумма графика/.test(t)),sm.issues);
  // предоплата больше себестоимости — договор не сохраняется
  const ppc=await p.evaluate(async()=>{const k=[...personIndex().values()].find(x=>x.no==='К-0003').key;const mk=async(pre)=>{openNew();await new Promise(r=>setTimeout(r,150));pickSet('f_name',encodeURIComponent(k));
      const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};set('f_product','Предоплата-тест');set('f_cost','40 000');set('f_price','70 000');set('f_prepay',pre);
      document.getElementById('f_months').value='3';monthsInput(true);await new Promise(r=>setTimeout(r,100));const n=S.clients.length;document.getElementById('confirmLayer').innerHTML='';await saveClient();await new Promise(r=>setTimeout(r,1500));
      const t=document.querySelector('#confirmLayer .confirm-title');const r={saved:S.clients.length>n,title:t?t.textContent:'',toast:document.getElementById('toast').textContent};document.getElementById('confirmLayer').innerHTML='';closeM('mClient');return r;};
    return{over:await mk('50 000'),equal:await mk('40 000')};});
  check('предоплата больше или равная себестоимости — договор не сохраняется, понятное окно',!ppc.over.saved&&!ppc.equal.saved&&ppc.over.title==='Предоплата не меньше себестоимости'&&ppc.equal.title==='Предоплата не меньше себестоимости',ppc);

  // дата оплаты: только в открытом месяце, не раньше договора, не в будущем
  const pdt=await p.evaluate(async()=>{const c=S.clients.find(x=>!x.archived&&getStats(x).balance>3000&&dealDate(x)<new Date(Date.now()-40*864e5));const r={};
    const pay=async(dv)=>{openPay(c.id);await new Promise(r=>setTimeout(r,100));document.getElementById('mpAmt').value='1 000';if(dv)document.getElementById('mpDate').value=dv;const n=S.payments.length;confirmPay();await new Promise(r=>setTimeout(r,1500));closeM('mPay');return{added:S.payments.length>n,t:document.getElementById('toast').textContent};};
    const y=new Date();y.setDate(y.getDate()-1);r.back=await pay(dayKey(y));r.backDate=(S.payments.filter(x=>x.clientId===c.id&&x.amount===1000).map(x=>x.dateStr));
    const f=new Date();f.setDate(f.getDate()+2);r.future=await pay(dayKey(f));
    const old=new Date(dealDate(c));old.setDate(old.getDate()-3);r.before=await pay(dayKey(old));
    const{db,doc,setDoc,deleteDoc}=window.DB;const mk=mkShift(monthKey(new Date()),-2);await setDoc(doc(db,'invMonths',mk),{month:mk,closedAt:new Date(),rows:[]});await new Promise(r=>setTimeout(r,1000));
    const inClosed=mStart(Number(mk.slice(0,4)),Number(mk.slice(5))-1);inClosed.setDate(10);r.closed=await pay(dayKey(inClosed));r.min=document.getElementById('mpDate').min;
    await deleteDoc(doc(db,'invMonths',mk));await new Promise(r=>setTimeout(r,800));r.yest=fmtD(y);return r;});
  check('оплату можно записать вчерашним числом',pdt.back.added&&pdt.backDate.includes(pdt.yest),pdt);
  check('дату оплаты в будущем, раньше договора и в закрытом месяце поставить нельзя',!pdt.future.added&&!pdt.before.added&&!pdt.closed.added,pdt);

  // Переплата попадает в список проверки и в карточку
  const op=await p.evaluate(async()=>{const bal=R2(getStats(S.clients.find(x=>x.id==='c3')).balance);_cid='c3';await savePay(bal,'w1');
    // та же сумма, принятая «на другом устройстве» до того, как первое узнало об оплате
    const{db,doc,collection,writeBatch,increment}=window.DB,c=S.clients.find(x=>x.id==='c3'),bt=writeBatch(db),pR=doc(collection(db,'payments')),kR=doc(collection(db,'kassaOps')),now=new Date();
    bt.set(pR,{clientId:'c3',contractId:c.contractId,name:c.name,amount:bal,type:'payment',typeLabel:'Ежемес. платеж',payType:'Сбер',wallet:'w2',kassaOpId:kR.id,date:now,dateStr:fmtD(now)});
    bt.set(kR,{type:'payment_in',amount:bal,wallet:'w2',walletName:'Сбер',desc:'Оплата',date:now,dateStr:fmtD(now),auto:true,refType:'client',refId:'c3',paymentId:pR.id});
    bt.update(doc(db,'wallets','w2'),{balance:increment(bal)});
    try { await bt.commit(); } catch(e) { return { rejected: e.message, balance:getStats(c).balance, duplicate:S.payments.some(p=>p.id===pR.id) }; }
    await new Promise(r=>setTimeout(r,1200));
    openC('c3');await new Promise(r=>setTimeout(r,300));return{card:(document.getElementById('cDetail').innerText.match(/Переплата[^\n]*/)||[''])[0],list:integrityIssues().map(x=>x.t)};});
  if(BACKEND==='pb') check('сервер отклоняет повторную оплату погашенного договора',/больше остатка/.test(op.rejected)&&op.balance===0&&!op.duplicate,op);
  else {
  check('переплата видна в карточке сделки',op.card.startsWith('Переплата'),op.card);
  check('переплата попадает в «Проверку базы»',op.list.some(t=>/переплата/.test(t)),op.list);
  }
  check('после оплат касса сходится с операциями',await p.evaluate(()=>{const m=walletCalc();return S.wallets.every(w=>Math.abs(R2(w.balance)-(m[w.id]||0))<0.01);}));

  // правка цены и себестоимости существующего договора сохраняется (раньше кнопка «Сохранить» молча не срабатывала)
  const ed2=await p.evaluate(async()=>{const c=S.clients.find(x=>!x.archived&&S.payments.some(q=>q.clientId===x.id&&q.type==='payment'));const was={price:c.price,cost:c.cost};
    const sc=window.showConfirm;let asked='';window.showConfirm=(t,m,ok)=>{asked=t;ok&&ok();};
    openEdit(c.id);await new Promise(r=>setTimeout(r,300));
    const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('f_price',String(was.price+12000));set('f_cost',String(was.cost+6000));recalcSched();await new Promise(r=>setTimeout(r,200));
    await saveClient();await new Promise(r=>setTimeout(r,1500));window.showConfirm=sc;
    const n=S.clients.find(x=>x.id===c.id);return{was,now:{price:n.price,cost:n.cost},asked,open:document.getElementById('mClient').classList.contains('on')};});
  check('правка цены и себестоимости договора с оплатами сохраняется, перед этим CRM спрашивает',ed2.now.price===ed2.was.price+12000&&ed2.now.cost===ed2.was.cost+6000&&/Изменить цену и себестоимость/.test(ed2.asked)&&!ed2.open,ed2);
  // Правило прибыли: в каждом рубле от клиента (и в предоплате) одинаковая доля наценки; скидка уменьшает наценку следующих платежей
  const pf=await p.evaluate(()=>{const D=n=>new Date(2026,0,n),P=(type,amount,n)=>({p:{type,amount},d:D(n)}),r2=x=>Math.round(x*100)/100;
    const c={price:100000,cost:70000,prepay:20000};
    const a=dealProfitSplit(c,[P('prepay',20000,1),P('payment',30000,2)]);
    const b=dealProfitSplit({price:100000,cost:70000,prepay:0},[P('payment',50000,1),P('discount',10000,2),P('payment',40000,3)]);
    const e=dealProfitSplit({price:100000,cost:70000,prepay:0},[P('payment',90000,1),P('discount',10000,2)]);
    // в инвесторах прибыль от предоплаты — событие в день предоплаты
    const M=invModel(),cc=S.clients.find(x=>x.prepay>0&&x.cost>0),ev=M.events.filter(x=>x.src==='prepay'&&x.ref.includes(cc.contractId));
    return{pre:r2(a.items[0].prof),a:r2(a.got),aBody:r2(a.bodyRem),aProf:r2(a.profRem),bDisc:b.items.filter(x=>x.disc).length,b:r2(b.got),bMid:r2(b.items[1].prof),e:r2(e.got),eLoss:r2((e.items.find(x=>x.disc)||{}).disc||0),
      ratio:planRatio(c),ev:ev.length,evAmt:ev[0]&&r2(ev[0].amount),evWant:r2(cc.prepay*(cc.price-cc.cost)/cc.price)};});
  check('прибыль: в предоплате та же доля наценки, что и в платежах (20 000 → 6 000 при наценке 30%)',pf.pre===6000&&pf.a===15000&&pf.aBody===35000&&pf.aProf===15000&&Math.abs(pf.ratio-0.3)<1e-9,pf);
  check('скидка не уходит в минус месяца, а уменьшает прибыль следующих платежей; итог = наценка − скидка',pf.bDisc===0&&pf.b===20000&&pf.bMid===5000,pf);
  check('скидка больше оставшейся наценки — остаток убыток в день скидки, итог всё равно = наценка − скидка',pf.e===20000&&pf.eLoss===7000,pf);
  check('у инвесторов прибыль от предоплаты начисляется в день предоплаты',pf.ev===1&&pf.evAmt===pf.evWant,pf);
  noErrors('деньги',errs);await ctx.close();
}
