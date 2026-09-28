// Инвесторы: закрытие месяца, двойное закрытие с двух устройств, отмена закрытия, выплата
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  const A=await device(),B=await device();await login(A.p);await login(B.p);await autoConfirm(A.p);
  const mk=await A.p.evaluate(()=>{const M=invModel();return M.months.find(x=>invMonthStatus(M,x).canClose);});
  check('есть месяц, который можно закрыть',!!mk,mk);
  const live=await A.p.evaluate(mk=>{const d=invComputeMonth(invModel(),mk);return{net:d.net,byInv:Object.fromEntries(d.rows.map(r=>[r.invId,r.total])),sum:R2(d.rows.reduce((a,r)=>a+r.total,0)),unalloc:d.unalloc};},mk);
  check('прибыль месяца распределена полностью',Math.abs(live.sum+live.unalloc-live.net)<0.02,live);
  // закрываем одновременно с двух устройств
  await Promise.all([A.p.evaluate(mk=>invCloseMonth(mk),mk),B.p.evaluate(mk=>invCloseMonth(mk),mk)]);
  await wait(A.p,2000);
  const r=await A.p.evaluate(mk=>{const ops=S.invOps.filter(o=>o.auto&&o.month===mk);const M=invModel();return{n:ops.length,byInv:Object.fromEntries(S.inv.map(i=>[i.id,M.bal[i.id].payable])),closed:!!M.closed[mk]};},mk);
  check('месяц закрыт с двух устройств — начисления записаны один раз',r.closed&&r.n===Object.keys(live.byInv).filter(k=>live.byInv[k]).length,r);
  check('«К выплате» у каждого = его прибыли за месяц',Object.keys(live.byInv).every(k=>Math.abs((r.byInv[k]||0)-Math.max(0,live.byInv[k]))<0.02),{live:live.byInv,pay:r.byInv});
  const again=await B.p.evaluate(async mk=>{await invCloseMonth(mk);return document.getElementById('toast').textContent;},mk);
  check('повторное закрытие отклоняется с понятным сообщением',/уже закрыт|нельзя закрыть/.test(again),again);
  // выплата части прибыли инвестору: касса уменьшается, «к выплате» тоже
  const po=await A.p.evaluate(async()=>{const M=invModel(),dep=Object.values(M.tranches).find(t=>t.invId==='INV1');const before={pay:M.bal.INV1.payable,w:S.wallets.find(w=>w.id==='w2').balance};
    openInvOp('payout','INV1');document.getElementById('ioDep').value=dep.id;document.getElementById('ioWallet').value='w2';document.getElementById('ioAmt').value='1000';await saveInvOp();await new Promise(r=>setTimeout(r,1500));
    const M2=invModel();return{before,after:{pay:M2.bal.INV1.payable,w:S.wallets.find(w=>w.id==='w2').balance}};});
  check('выплата 1 000 ₽: «к выплате» и касса уменьшились на 1 000',Math.abs(po.before.pay-po.after.pay-1000)<0.02&&Math.abs(po.before.w-po.after.w-1000)<0.02,po);
  // отмена закрытия невозможна после выплаты
  const ro=await A.p.evaluate(async mk=>{invReopenMonth(mk);await new Promise(r=>setTimeout(r,300));return{t:document.getElementById('toast').textContent,closed:!!invModel().closed[mk]};},mk);
  check('отмена закрытия после выплаты запрещена',ro.closed&&/выплаты/.test(ro.t),ro);
  // изменение в закрытом месяце видно в «Проверке базы»
  const ch=await A.p.evaluate(async mk=>{const pay=S.payments.find(x=>x.type==='payment'&&monthKey(dTs(x.date))===mk);await cancelPay(pay.id,pay.clientId,pay.amount,'payment');await new Promise(r=>setTimeout(r,1500));return integrityIssues().map(x=>x.t);},mk);
  check('отмена платежа в закрытом месяце видна в «Проверке базы»',ch.some(t=>/^Инвесторы:/.test(t)),ch);
  noErrors('инвесторы A',A.errs);noErrors('инвесторы B',B.errs);
  await A.ctx.close();await B.ctx.close();
}
