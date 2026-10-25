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
}
