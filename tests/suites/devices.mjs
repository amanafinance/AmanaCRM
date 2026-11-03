// Без интернета, настройки на двух устройствах, дата после полуночи, дата и правка операции кассы
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  const A=await device(),B=await device();await login(A.p);await login(B.p);await autoConfirm(A.p);

  // --- без интернета: ничего не сохраняется, понятное сообщение; смотреть данные можно
  await A.ctx.setOffline(true);
  const off=await A.p.evaluate(async()=>{const w0=S.wallets.find(w=>w.id==='w1').balance,n0=S.payments.length;_cid='c4';const t=Date.now();
    await savePay(1111,'w1');const took=Date.now()-t,msg=document.getElementById('toast').textContent;await new Promise(r=>setTimeout(r,500));
    const vis=S.payments.some(p=>p.amount===1111&&p.clientId==='c4'),bal=S.wallets.find(w=>w.id==='w1').balance-w0;
    _cid='c4';document.getElementById('mcText').value='Обещал завтра';await saveComment();await new Promise(r=>setTimeout(r,300));const msg2=document.getElementById('toast').textContent;
    goTo('clients');const view=document.querySelectorAll('#cList tbody tr').length>0;
    const badge=document.getElementById('netBadge');return{took,msg,msg2,vis,bal,saving:_saving,view,comment:S.clients.find(c=>c.id==='c4').comment||'',badge:badge&&badge.classList.contains('on')?badge.textContent:''};});
  check('без интернета оплата не сохраняется и не «висит»',!off.vis&&Math.abs(off.bal)<0.01&&off.took<4000&&!off.saving,off);
  check('без интернета — сообщение «Нет интернета — изменение не сохранено»',/^Нет интернета — изменение не сохранено/.test(off.msg),off);
  check('без интернета комментарий тоже не сохраняется',off.comment!=='Обещал завтра'&&/Нет интернета/.test(off.msg2),off);
  check('без интернета данные можно смотреть, видна плашка «только просмотр»',off.view&&/Нет интернета/.test(off.badge)&&/только просмотр/.test(off.badge),off);
  const nd=await A.p.evaluate(async()=>{openNew('p:P9');await new Promise(r=>setTimeout(r,100));document.getElementById('f_product').value='Офлайн';document.getElementById('f_cost').value='1000';document.getElementById('f_price').value='3000';calcSched();
    await Promise.race([saveClient(),new Promise(r=>setTimeout(r,15000))]);const t=document.getElementById('toast').textContent;closeM('mClient');return t;});
  check('новый договор без интернета — понятное сообщение',/интернет/i.test(nd),nd);
  await A.ctx.setOffline(false);await wait(A.p,3000);
  const on=await A.p.evaluate(async()=>{_cid='c4';await savePay(1112,'w1');await new Promise(r=>setTimeout(r,800));return{pay:S.payments.some(p=>p.amount===1112&&p.clientId==='c4'),badge:document.getElementById('netBadge').classList.contains('on')};});
  await wait(B.p,2000);
  const onB=await B.p.evaluate(()=>({pay1111:S.payments.some(p=>p.amount===1111&&p.clientId==='c4'),pay1112:S.payments.some(p=>p.amount===1112&&p.clientId==='c4')}));
  check('когда сеть вернулась, сохранение снова работает и видно на втором устройстве',on.pay&&onB.pay1112,{on,onB});
  check('то, что пытались сохранить без интернета, в базу не попало',!onB.pay1111,onB);
  check('плашка пропала',!on.badge);

  // --- сервер сверяет остатки в момент записи
  await B.p.evaluate(()=>{window.showConfirm=(t,m,ok)=>ok&&ok();});
  const cc=await A.p.evaluate(()=>{const c=S.clients.find(x=>!x.archived&&getStats(x).balance>0&&getStats(x).balance<20000);return{id:c.id,bal:getStats(c).balance};});
  await Promise.all([A.p.evaluate(([id,b])=>{_cid=id;return savePay(b,'w1');},[cc.id,cc.bal]),B.p.evaluate(([id,b])=>{_cid=id;return savePay(b,'w1');},[cc.id,cc.bal])]);
  await wait(A.p,2500);
  const dbl=await A.p.evaluate(id=>{const c=S.clients.find(x=>x.id===id),s=getStats(c);return{bal:s.balance,over:s.overpaid};},cc.id);
  const msgB=await B.p.evaluate(()=>document.getElementById('toast').textContent),msgA=await A.p.evaluate(()=>document.getElementById('toast').textContent);
  check('один остаток с двух устройств одновременно: проходит одна оплата, переплаты нет',dbl.bal===0&&!(dbl.over>0),dbl);
  check('второе устройство получает «Договор изменился»',/Договор изменился/.test(msgA+msgB),{msgA,msgB});
  const w2=await A.p.evaluate(()=>R2(S.wallets.find(w=>w.id==='w2').balance)),part=Math.floor(w2*0.7);
  const ex=x=>x.p.evaluate(async a=>{const w=S.wallets.find(v=>v.id==='w2');await doSaveKassa('opex',a,'w2',null,'расход',null,w,new Date(),null);document.getElementById('confirmLayer').innerHTML='';return document.getElementById('toast').textContent;},part);
  const [ea,eb]=await Promise.all([ex(A),ex(B)]);await wait(A.p,2500);
  const w2a=await A.p.evaluate(()=>R2(S.wallets.find(w=>w.id==='w2').balance));
  check('два расхода по 70% остатка одновременно: счёт не ушёл в минус',w2a>=0&&Math.abs(w2a-(w2-part))<0.01,{w2,part,w2a});
  check('второй расход получает «Недостаточно средств»',/Недостаточно средств/.test(ea+eb),{ea,eb});
  // комментарий к платежу
  const pn=await A.p.evaluate(async()=>{const c=S.clients.find(x=>!x.archived&&getStats(x).balance>1000);openPay(c.id);await new Promise(r=>setTimeout(r,100));
    document.getElementById('mpAmt').value='1 000';document.getElementById('mpNote').value='Внёс 28.10, записали позже';confirmPay();await new Promise(r=>setTimeout(r,1500));
    const p=S.payments.find(x=>x.clientId===c.id&&x.note==='Внёс 28.10, записали позже');openC(c.id);await new Promise(r=>setTimeout(r,200));
    return{saved:!!p,shown:document.getElementById('cDetail').innerHTML.includes('Внёс 28.10, записали позже')};});
  check('комментарий к платежу сохраняется и виден в истории платежей',pn.saved&&pn.shown,pn);
  // закрытый у инвесторов месяц не трогается
  const cm=await A.p.evaluate(async()=>{const{db,doc,setDoc,deleteDoc}=window.DB;const p=S.payments.find(x=>x.type==='payment'&&dTs(x.date)<new Date(new Date().getFullYear(),new Date().getMonth()-1,1));const mk=monthKey(dTs(p.date));
    await setDoc(doc(db,'invMonths',mk),{month:mk,closedAt:new Date(),rows:[]});await new Promise(r=>setTimeout(r,1200));
    document.getElementById('confirmLayer').innerHTML='';await cancelPay(p.id,p.clientId,p.amount,'payment');await new Promise(r=>setTimeout(r,300));
    const t=document.querySelector('#confirmLayer .confirm-title');const r={title:t?t.textContent:'',still:S.payments.some(x=>x.id===p.id)};document.getElementById('confirmLayer').innerHTML='';
    await deleteDoc(doc(db,'invMonths',mk));await new Promise(r=>setTimeout(r,800));return r;});
  check('платёж в закрытом у инвесторов месяце отменить нельзя',cm.title==='Месяц закрыт'&&cm.still,cm);
  // удаление поставщика — с подтверждением; номер клиента — одной транзакцией
  const rp=await A.p.evaluate(async()=>{let asked='';const sc=window.showConfirm;window.showConfirm=(t)=>{asked=t;};goTo('settings');document.getElementById('newPart').value='Временный';await addPart();await new Promise(r=>setTimeout(r,600));
    removePart(S.partners.indexOf('Временный'));const still=S.partners.includes('Временный');window.showConfirm=sc;return{asked,still};});
  check('удаление поставщика спрашивает подтверждение',rp.asked==='Удалить поставщика?'&&rp.still,rp);
  const np=await A.p.evaluate(async()=>{const before=Math.max(...S.persons.map(p=>parseInt(String(p.no||'').replace(/\D/g,''))||0));openPersonForm(null,'');await new Promise(r=>setTimeout(r,150));
    document.getElementById('pf_name').value='Новиков Новый';await savePerson();await new Promise(r=>setTimeout(r,1200));const p=S.persons.find(x=>x.name==='Новиков Новый');return{before,no:p&&p.no};});
  check('новый клиент получает следующий номер в формате К-00000',np.no&&/^К-\d{5}$/.test(np.no)&&parseInt(np.no.replace(/\D/g,''))===np.before+1,np);

  // --- настройки с двух устройств
  await A.p.evaluate(async()=>{document.getElementById('newPart').value='Поставщик-ПК';document.getElementById('newPartPh').value='89000000001';await addPart();});
  await B.p.evaluate(async()=>{document.getElementById('newPart').value='Поставщик-телефон';await addPart();});
  await wait(A.p,2500);
  const la=await A.p.evaluate(()=>S.partners.join(', ')),lb=await B.p.evaluate(()=>S.partners.join(', '));
  check('поставщики, добавленные на двух устройствах, оба сохранились',/Поставщик-ПК/.test(la)&&/Поставщик-телефон/.test(la)&&/Поставщик-ПК/.test(lb),{A:la,B:lb});
  check('телефон поставщика дошёл до второго устройства',await B.p.evaluate(()=>S.partnerPhones['Поставщик-ПК']==='89000000001'));
  await B.p.evaluate(async()=>{await removePart(S.partners.indexOf('Поставщик-телефон'));});await wait(A.p,2000);
  check('удаление поставщика на одном устройстве видно на другом',!(await A.p.evaluate(()=>S.partners.includes('Поставщик-телефон'))));

  // --- операция кассы задним числом и её правка
  const k=await A.p.evaluate(async()=>{const y=new Date();y.setDate(y.getDate()-1);const w0=S.wallets.find(w=>w.id==='w1').balance;
    openKassaOp();const t=document.getElementById('koType');t.value='opex';kassaTypeChanged();document.getElementById('koAmt').value='5000';document.getElementById('koDesc').value='Аренда';document.getElementById('koWallet').value='w1';document.getElementById('koDate').value=dayKey(y);
    await saveKassaOp();await new Promise(r=>setTimeout(r,1200));const op=S.kassaOps.find(o=>o.desc==='Аренда');
    const r1={date:op&&op.dateStr,exp:fmtD(y),d1:R2(w0-S.wallets.find(w=>w.id==='w1').balance)};
    openKassaEdit(op.id);document.getElementById('koAmt').value='7000';await saveKassaOp();await new Promise(r=>setTimeout(r,1200));
    const op2=S.kassaOps.find(o=>o.id===op.id);const m=walletCalc();
    return{...r1,amt2:op2.amount,d2:R2(w0-S.wallets.find(w=>w.id==='w1').balance),recon:S.wallets.every(w=>Math.abs(R2(w.balance)-(m[w.id]||0))<0.01),n:S.kassaOps.filter(o=>o.desc==='Аренда').length};});
  check('расход можно провести вчерашним числом',k.date===k.exp&&k.d1===5000,k);
  check('правка операции: сумма и остаток счёта обновились, дублей нет',k.amt2===7000&&k.d2===7000&&k.n===1,k);
  check('после правки касса сходится с операциями',k.recon,k);
  // расход в закрытом у инвесторов месяце нельзя провести
  const cl=await A.p.evaluate(async()=>{const M=invModel();const mk=M.months.find(x=>invMonthStatus(M,x).canClose);await invCloseMonth(mk);await new Promise(r=>setTimeout(r,1500));
    openKassaOp();const t=document.getElementById('koType');t.value='salary';kassaTypeChanged();document.getElementById('koAmt').value='100';document.getElementById('koWallet').value='w1';document.getElementById('koDate').value=mk+'-15';
    const n0=S.kassaOps.length;await saveKassaOp();await new Promise(r=>setTimeout(r,500));closeM('mKassa');return{mk,toast:document.getElementById('toast').textContent,added:S.kassaOps.length-n0};});
  check('расход в закрытом у инвесторов месяце не проводится',cl.added===0&&/закрыт/.test(cl.toast),cl);
  noErrors('устройства A',A.errs);noErrors('устройства B',B.errs);
  await A.ctx.close();await B.ctx.close();

  // --- дата договора после полуночи
  const N=await device({clock:new Date('2026-09-29T00:30:00+03:00')});await login(N.p);
  const v=await N.p.evaluate(()=>{openNew();return document.getElementById('f_date').value;});
  check('в 00:30 по Москве новый договор получает сегодняшнюю дату',v==='2026-09-29',v);
  await N.ctx.close();

  // --- телефон: открыта клавиатура (видно 470 из 844) — окно над клавиатурой, поле ввода на виду
  const T=await device({vp:{width:390,height:844},mobile:true});await login(T.p);
  await T.p.evaluate(()=>{const P=VisualViewport.prototype;window.__kb={h:470,t:0};
    Object.defineProperty(P,'height',{get(){return window.__kb.h;},configurable:true});Object.defineProperty(P,'offsetTop',{get(){return window.__kb.t;},configurable:true});});
  for(const [name,open,sel] of [['новый клиент — телефон',()=>{goBase('people');openPersonForm();},'.mover.on input[type=tel]'],['фильтры клиентов',()=>{goBase('people');openPplFilter();},'#pf_addr'],['оплата — последнее поле',()=>{openC('c0');openPay('c0');},'.mover.on .modal input:not([type=hidden]), .mover.on .modal textarea']]){
    await T.p.evaluate(()=>document.querySelectorAll('.mover.on').forEach(m=>m.classList.remove('on')));
    await T.p.evaluate(open);await wait(T.p,300);
    const r=await T.p.evaluate(async sel=>{const els=[...document.querySelectorAll(sel)].filter(e=>e.offsetParent);const el=els[els.length-1];if(!el)return{none:sel};el.focus();window.__kbFit();await new Promise(r=>setTimeout(r,600));
      const b=el.getBoundingClientRect(),m=document.querySelector('.mover.on').getBoundingClientRect(),fs=parseFloat(getComputedStyle(el).fontSize);
      return{kb:document.documentElement.classList.contains('kb-open'),top:Math.round(b.top),bottom:Math.round(b.bottom),moverBottom:Math.round(m.bottom),fs};},sel);
    check('клавиатура, '+name+': поле над клавиатурой, окно не уходит под неё',r.kb&&r.top>=0&&r.bottom<=470&&r.moverBottom<=471,r);
    check('клавиатура, '+name+': шрифт поля 16px — iPhone не увеличивает страницу',r.fs>=16,r);
    await T.p.evaluate(()=>document.activeElement&&document.activeElement.blur());await wait(T.p,200);
  }
  const kbOff=await T.p.evaluate(()=>{window.__kb.h=844;window.__kbFit();return document.documentElement.classList.contains('kb-open');});
  check('клавиатура закрыта — окна и меню на обычном месте',!kbOff);
  // касса: сверка и проверка базы свёрнуты в компактные карточки с кнопкой «Показать»
  const kc=await T.p.evaluate(async()=>{goTo('kassa');await new Promise(r=>setTimeout(r,300));const out={};for(const id of ['kRecon','kCheck']){const d=document.getElementById(id);d.open=false;
      const h0=d.getBoundingClientRect().height,lbl=getComputedStyle(d.querySelector('summary'),'::after').content;d.querySelector('summary').click();await new Promise(r=>setTimeout(r,50));
      out[id]={h0:Math.round(h0),lbl,opened:d.open,h1:Math.round(d.getBoundingClientRect().height),lbl1:getComputedStyle(d.querySelector('summary'),'::after').content};}return out;});
  check('касса: свёрнутые «Сверка касс» и «Проверка базы» без пустого места и с кнопкой «Показать»',Object.values(kc).every(x=>x.h0<90&&/Показать/.test(x.lbl)&&x.opened&&x.h1>x.h0&&/Скрыть/.test(x.lbl1)),kc);
  noErrors('телефон с клавиатурой',T.errs);
  await T.ctx.close();
}
