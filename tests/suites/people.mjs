// Клиенты: номера, тёзки, выбор в договоре, поручитель, переименование
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  await p.evaluate(()=>goBase('people'));await wait(p,300);
  check('поиск по номеру клиента К-0007',await p.evaluate(()=>{document.getElementById('pplQ').value='к-0007';renderPeople();const n=document.querySelectorAll('.ptbl tbody tr').length;document.getElementById('pplQ').value='';return n===1;}));
  await p.evaluate(()=>openPersonForm(null,'Клиент 5'));await p.fill('#pfPhones input','89990000005');await p.evaluate(()=>savePerson());await wait(p,300);
  check('при тёзке CRM переспрашивает',/Уже есть клиент с таким ФИО/.test(await p.$eval('#pfWarn',e=>e.textContent)));
  await p.evaluate(()=>savePerson());await wait(p,1500);
  const twins=await p.evaluate(()=>S.persons.filter(x=>x.name==='Клиент 5').map(x=>({id:x.id,no:x.no,ph:(x.phones||[])[0]})));
  check('создан второй «Клиент 5» со своим номером',twins.length===2&&twins[0].no!==twins[1].no,twins);
  const nw=twins.find(x=>x.ph==='89990000005'),old=twins.find(x=>x.ph!=='89990000005');
  // договор на нового тёзку с поручителем
  await p.evaluate(async([pid,gno])=>{goBase('clients');openNew('p:'+pid);await new Promise(r=>setTimeout(r,100));
    document.getElementById('f_product').value='TV';document.getElementById('f_price').value='60000';document.getElementById('f_cost').value='40000';document.getElementById('f_prepay').value='0';calcSched();
    addGuarRow();const i=document.querySelector('#guarRows .pick-in');const k=[...personIndex().values()].find(x=>x.no===gno).key;pickSet(i.id,encodeURIComponent(k));await saveClient();},[nw.id,'К-0010']);
  await wait(p,1500);
  const deal=await p.evaluate(pid=>{const c=S.clients.find(x=>x.clientPid===pid);return c&&{name:c.name,ph:c.phones[0],g:c.guarantors};},nw.id);
  check('договор привязан к выбранному тёзке',deal&&deal.ph==='89990000005',deal);
  check('поручитель сохранён со ссылкой на карточку',deal&&deal.g&&deal.g[0]&&deal.g[0].pid==='P9',deal&&deal.g);
  const cnt=await p.evaluate(ids=>{const g=groupPeople();return ids.map(id=>g.find(x=>x.id===id).deals.length);},[old.id,nw.id]);
  check('сделки тёзок не смешались',cnt[1]===1&&cnt[0]>=1,cnt);
  await p.evaluate(id=>openPersonForm('p:'+id),old.id);await p.fill('#pf_name','Пятов Пятый');await p.evaluate(()=>savePerson());await wait(p,1500);
  const rn=await p.evaluate(ids=>({old:S.clients.filter(c=>c.clientPid===ids[0]).map(c=>c.name),nw:S.clients.filter(c=>c.clientPid===ids[1]).map(c=>c.name)}),[old.id,nw.id]);
  check('переименование меняет ФИО только в сделках этого клиента',rn.old.length&&rn.old.every(n=>n==='Пятов Пятый')&&rn.nw.every(n=>n==='Клиент 5'),rn);
  await p.evaluate(()=>openC(S.clients.find(x=>x.name==='Клиент 5').id));await wait(p,300);
  check('карточка сделки открывается',/ДАННЫЕ КЛИЕНТА/i.test(await p.$eval('#cDetail',e=>e.innerText)));
  noErrors('клиенты',errs);await ctx.close();
}
