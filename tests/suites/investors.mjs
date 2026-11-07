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
  // реинвест с датой: задним числом в открытом месяце — можно, в закрытом — нельзя
  const ri=await A.p.evaluate(async mk=>{const M=invModel(),dep=Object.values(M.tranches).find(t=>t.invId==='INV1');const first=mkNext(mk)+'-01',bad=mk+'-15';
    const run=async v=>{openInvOp('reinvest','INV1');document.getElementById('ioDep').value=dep.id;document.getElementById('ioAmt').value='100';document.getElementById('ioDate').value=v;const n=S.invOps.length;await saveInvOp();await new Promise(r=>setTimeout(r,1200));closeM('mInvOp');return S.invOps.length>n;};
    const shown=(()=>{openInvOp('reinvest','INV1');const v=document.getElementById('ioDateRow').style.display!=='none';closeM('mInvOp');return v;})();
    const badOk=await run(bad);const t=document.getElementById('toast').textContent;const ok=await run(first);
    const op=S.invOps.filter(o=>o.type==='reinvest').sort((a,b)=>dTs(b.createdAt)-dTs(a.createdAt))[0];
    return{shown,badOk,t,ok,date:op&&dayKey(dTs(op.date)),first};},mk);
  check('реинвест: дату можно выбрать задним числом, но не в закрытом месяце',ri.shown&&!ri.badOk&&/закрыт/.test(ri.t)&&ri.ok&&ri.date===ri.first,ri);
  // закрытый месяц не трогается: отмену платежа CRM не даёт, расхождений нет
  const ch=await A.p.evaluate(async mk=>{const pay=S.payments.find(x=>x.type==='payment'&&monthKey(dTs(x.date))===mk);document.getElementById('confirmLayer').innerHTML='';await cancelPay(pay.id,pay.clientId,pay.amount,'payment');await new Promise(r=>setTimeout(r,1500));
    const t=document.querySelector('#confirmLayer .confirm-title');const r={title:t?t.textContent:'',still:S.payments.some(x=>x.id===pay.id),issues:integrityIssues().filter(x=>/^Инвесторы:/.test(x.t)).length};document.getElementById('confirmLayer').innerHTML='';return r;},mk);
  check('платёж в закрытом месяце отменить нельзя — начисления инвесторам не расходятся',ch.title==='Месяц закрыт'&&ch.still&&ch.issues===0,ch);
  // окно месяца: капитал каждого участника на конец месяца в рублях
  const cap=await A.p.evaluate(mk=>{openInvMonth(mk);const d=invMonthData(invModel(),mk),hs=[...document.querySelectorAll('#imBody thead th')].map(t=>t.textContent),ci=hs.indexOf('Капитал на конец');
    const cells=[...document.querySelectorAll('#imBody tbody tr:not(.inv-subrow)')].map(tr=>tr.children[ci]&&tr.children[ci].textContent);closeM('mInvMonth');
    const want=d.rows.slice().sort((a,b)=>(a.role==='founder'?0:1)-(b.role==='founder'?0:1)||b.capEnd-a.capEnd).map(r=>fmt(r.capEnd||0)+'\u00a0₽');return{ci,cells,want};},mk);
  check('окно месяца показывает капитал участника на конец месяца в рублях',cap.ci===1&&cap.cells.length>0&&JSON.stringify(cap.cells)===JSON.stringify(cap.want),cap);
  // итоги пула: суммы совпадают с балансами участников и закрытыми месяцами
  const ps=await A.p.evaluate(()=>{S.invTab='months';S.invYears=[];goTo('investors');const M=invModel(),st=invPoolStats(M),R=x=>Math.round(x*100)/100;
    const earned=R(S.inv.reduce((a,i)=>a+M.bal[i.id].earned,0)),net=R(M.months.filter(mk=>M.closed[mk]).reduce((a,mk)=>a+invMonthData(M,mk).net,0));
    return{st:{earned:st.earned,net:st.net,closed:st.closedCount},earned,net,closed:Object.keys(M.closed).length,shown:!!document.getElementById('invPoolStats'),chart:/Рентабельность пула по месяцам/.test(document.getElementById('invContent').textContent)};});
  check('«Итоги пула»: прибыль, начисления и число закрытых месяцев сходятся',ps.shown&&ps.chart&&ps.st.closed===ps.closed&&Math.abs(ps.st.earned-ps.earned)<0.01&&Math.abs(ps.st.net-ps.net)<0.01,ps);
  // журнал по месяцам: каждая операция в своём месяце, итоги месяца равны сумме его операций
  const jg=await A.p.evaluate(()=>{S.invTab='ops';S.invOpsTab='all';renderInvestors();const M=invModel(),bad=[];let n=0;
    document.querySelectorAll('#invContent details.inv-jm').forEach(d=>{const mk=d.dataset.mk,ops=M.ops.filter(o=>monthKey(o._d)===mk);n+=ops.length;
      const cnt=d.querySelectorAll('.inv-desk tbody tr').length;if(cnt!==ops.length)bad.push(mk+': строк '+cnt+' из '+ops.length);
      const dep=ops.filter(o=>o.type==='deposit').reduce((a,o)=>a+o._a,0),chip=[...d.querySelectorAll('.inv-jchip')].find(c=>/Пополнения/.test(c.textContent));
      if(dep>0&&(!chip||chip.querySelector('b').textContent!=='+'+fmt(invR(dep))+'\u00a0₽'))bad.push(mk+': пополнения');});
    const open=[...document.querySelectorAll('#invContent details.inv-jm')].map(d=>d.open);
    return{bad,n,total:M.ops.length,groups:open.length,open};});
  check('журнал инвесторов разбит по месяцам, итоги месяцев верные, месяцы по умолчанию свёрнуты',!jg.bad.length&&jg.n===jg.total&&jg.groups>=2&&jg.open.every(x=>x===false),jg);
  const jt=await A.p.evaluate(async()=>{const d=document.querySelector('#invContent details.inv-jm');d.open=true;await new Promise(r=>setTimeout(r,50));S.invTab='list';renderInvestors();S.invTab='ops';renderInvestors();
    return document.querySelector('#invContent details.inv-jm').open;});
  check('раскрытый месяц журнала остаётся раскрытым при переходе по вкладкам',jt===true,jt);
  // «Участники» — только профили; «Показатели» — итоги, годы, график, месяцы
  const yr=await A.p.evaluate(()=>{S.invTab='list';renderInvestors();const listHas=!!document.getElementById('invPoolStats');
    S.invTab='months';S.invYears=[];renderInvestors();const M=invModel(),ys=invYearsAll(M),y=ys[ys.length-1];
    const chips=[...document.querySelectorAll('#invYearChips .ft')].map(b=>b.textContent);
    setInvYears(y);const st=invPoolStats(M,[y]),rows=document.querySelectorAll('#invContent .inv-desk tbody tr').length,mon=M.months.filter(mk=>mk.startsWith(y)).length;
    const net=Math.round(M.months.filter(mk=>mk.startsWith(y)&&M.closed[mk]).reduce((a,mk)=>a+invMonthData(M,mk).net,0)*100)/100;
    const title=document.querySelector('#invContent .dsh-ht').textContent;setInvYears(null);
    return{listHas,chips,y,rows,mon,net,stNet:st.net,title,tab:[...document.querySelectorAll('#invTabs .ft')].map(b=>b.textContent)};});
  check('«Участники» — только профили, итоги пула во вкладке «Показатели»',!yr.listHas&&yr.tab.includes('Показатели')&&!yr.tab.includes('Месяцы'),yr);
  check('«Показатели»: выбор года — итоги и месяцы только этого года',yr.chips[0]==='Всё время'&&yr.chips.includes(yr.y)&&yr.rows===yr.mon&&Math.abs(yr.net-yr.stNet)<0.01&&yr.title.includes(yr.y),yr);
  noErrors('инвесторы A',A.errs);noErrors('инвесторы B',B.errs);
  await A.ctx.close();await B.ctx.close();
}
