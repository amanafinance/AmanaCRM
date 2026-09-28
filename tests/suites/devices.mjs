// Без интернета, настройки на двух устройствах, дата после полуночи, дата и правка операции кассы
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  const A=await device(),B=await device();await login(A.p);await login(B.p);await autoConfirm(A.p);

  // --- без интернета
  await A.ctx.setOffline(true);
  const off=await A.p.evaluate(async()=>{const w0=S.wallets.find(w=>w.id==='w1').balance;_cid='c4';const t=Date.now();
    await savePay(1111,'w1');const took=Date.now()-t;await new Promise(r=>setTimeout(r,500));
    const vis=S.payments.some(p=>p.amount===1111&&p.clientId==='c4'),bal=S.wallets.find(w=>w.id==='w1').balance-w0;
    _cid='c4';document.getElementById('mcText').value='Обещал завтра';await saveComment();await new Promise(r=>setTimeout(r,300));
    const badge=document.getElementById('netBadge');return{took,vis,bal,saving:_saving,comment:S.clients.find(c=>c.id==='c4').comment,badge:badge&&badge.classList.contains('on')?badge.textContent:''};});
  check('без интернета оплата сохраняется за пару секунд, а не «висит»',off.took<4000&&!off.saving,off);
  check('без интернета оплата сразу видна, остаток счёта сразу изменился',off.vis&&Math.abs(off.bal-1111)<0.01,off);
  check('без интернета другие сохранения тоже работают',off.comment==='Обещал завтра',off);
  check('видна плашка «Нет интернета · изменений ждут отправки»',/Нет интернета/.test(off.badge)&&/ждут отправки/.test(off.badge),off.badge);
  const nd=await A.p.evaluate(async()=>{openNew('p:P9');await new Promise(r=>setTimeout(r,100));document.getElementById('f_product').value='Офлайн';document.getElementById('f_cost').value='1000';document.getElementById('f_price').value='3000';calcSched();
    await Promise.race([saveClient(),new Promise(r=>setTimeout(r,15000))]);const t=document.getElementById('toast').textContent;closeM('mClient');return t;});
  check('новый договор без интернета — понятное сообщение',/интернет/i.test(nd),nd);
  await A.ctx.setOffline(false);await wait(A.p,5000);
  const on=await B.p.evaluate(()=>({pay:S.payments.some(p=>p.amount===1111&&p.clientId==='c4'),comment:S.clients.find(c=>c.id==='c4').comment}));
  check('когда сеть вернулась, оплата и комментарий дошли до второго устройства',on.pay&&on.comment==='Обещал завтра',on);
  check('плашка пропала',await A.p.evaluate(()=>!document.getElementById('netBadge').classList.contains('on')));

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
