// Перевод старых номеров (00042, К-0007) в новый формат (26-0042, К-00007): разово, из настроек
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);await autoConfirm(p);
  const before=await p.evaluate(()=>{goTo('settings');const M=invModel();
    return{card:getComputedStyle(document.getElementById('renumCard')).display!=='none',wallets:Object.fromEntries(S.wallets.map(w=>[w.id,w.balance])),
      earned:Object.fromEntries(S.inv.map(i=>[i.id,M.bal[i.id].earned])),c7:(S.clients.find(c=>c.contractId==='00007')||{}).id,p7:(S.persons.find(x=>x.no==='К-0007')||{}).id,
      nDeals:S.clients.length,nPers:S.persons.length};});
  check('в настройках есть карточка «Номера в новом формате», пока есть старые номера',before.card,before);
  await p.evaluate(()=>{document.getElementById('renumBtn').click();});
  await p.waitForFunction(()=>!_saving&&renumLegacy().d===0&&renumLegacy().p===0,null,{timeout:120000});await wait(p,1500);
  const r=await p.evaluate(({c7,p7})=>{const M=invModel(),byId=Object.fromEntries(S.clients.map(c=>[c.id,c]));
    const dn=S.clients.map(c=>c.contractId),pn=S.persons.map(x=>x.no);
    const badPay=S.payments.filter(x=>byId[x.clientId]&&x.contractId!==byId[x.clientId].contractId).length;
    const badKassa=S.kassaOps.filter(k=>k.refType==='client'&&k.auto&&byId[k.refId]&&/\(№/.test(k.desc||'')&&!(k.desc||'').includes('(№'+byId[k.refId].contractId+')')).length;
    const c=byId[c7],q=S.persons.find(x=>x.id===p7);
    // порядок: внутри года номера идут по дате договора
    const dt=x=>parseD(x.date).getTime();const yy=S.clients.filter(x=>x.contractId.startsWith(S.clients[0].contractId.slice(0,3))).sort((a,b)=>dealSortKey(a.contractId)-dealSortKey(b.contractId));
    const ordered=yy.every((x,i)=>!i||dt(yy[i-1])<=dt(x));
    return{allD:dn.every(x=>dealNoRe.test(x)),uniqD:new Set(dn).size===dn.length,allP:pn.every(isNewPNo),uniqP:new Set(pn).size===pn.length,badPay,badKassa,
      old:c&&c.oldContractId,newNo:c&&c.contractId,oldP:q&&q.oldNo,newP:q&&q.no,ordered,
      findOld:S.clients.filter(x=>dealMatch(x,'00007')).map(x=>x.id).includes(c7),
      wallets:Object.fromEntries(S.wallets.map(w=>[w.id,w.balance])),earned:Object.fromEntries(S.inv.map(i=>[i.id,M.bal[i.id].earned])),
      card:getComputedStyle(document.getElementById('renumCard')).display,nDeals:S.clients.length,nPers:S.persons.length,
      log:S.journal?undefined:undefined};},{c7:before.c7,p7:before.p7});
  check('все договоры получили номера ГГ-NNNN, все клиенты К-00000, без повторов',r.allD&&r.uniqD&&r.allP&&r.uniqP&&r.nDeals===before.nDeals&&r.nPers===before.nPers,r);
  check('внутри года номера договоров идут по дате договора',r.ordered,r);
  check('платежи и операции кассы ссылаются на новые номера',r.badPay===0&&r.badKassa===0,r);
  check('старый номер сохранён в карточке, по нему работает поиск',r.old==='00007'&&r.oldP==='К-0007'&&r.findOld&&r.newNo!=='00007',r);
  check('остатки счетов и начисления инвесторов не изменились',JSON.stringify(r.wallets)===JSON.stringify(before.wallets)&&JSON.stringify(r.earned)===JSON.stringify(before.earned),{b:before.wallets,a:r.wallets});
  check('после перевода карточка в настройках скрыта',r.card==='none',r);
  // повторный запуск ничего не меняет; новые договор и клиент продолжают нумерацию
  const again=await p.evaluate(async()=>{const P=renumPlan();const diff=S.clients.filter(c=>c.contractId!==P.dmap[c.id]).length+S.persons.filter(x=>x.no!==P.pmap[x.id]).length;
    const yy=String(new Date().getFullYear()).slice(-2),cnt=P.cnt[yy]||0;
    openPersonForm(null,'');await new Promise(r=>setTimeout(r,150));document.getElementById('pf_name').value='Новый После Перевода';await savePerson();await new Promise(r=>setTimeout(r,1200));
    const np=(S.persons.find(x=>x.name==='Новый После Перевода')||{}).no;
    return{diff,np,expP:pNo(P.pcount+1),cnt,yy};});
  check('повторный перевод ничего не меняет, новый клиент получает следующий номер',again.diff===0&&again.np===again.expP,again);
  const nd=await p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));openNew();await sl(200);
    const k=[...personIndex().values()][0].key;pickSet('f_name',encodeURIComponent(k));
    document.getElementById('f_product').value='После перевода';document.getElementById('f_price').value='30 000';document.getElementById('f_cost').value='20 000';document.getElementById('f_prepay').value='0';
    document.getElementById('f_months').value='3';monthsInput(true);await sl(100);await saveClient();await sl(1500);return(S.clients.find(c=>c.product==='После перевода')||{}).contractId;});
  check('новый договор текущего года получает следующий номер после перевода',nd===again.yy+'-'+String(again.cnt+1).padStart(4,'0'),{nd,again});
  noErrors('перевод номеров',errs);
  await ctx.close();
}
