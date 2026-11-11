// Клиенты: номера, тёзки, выбор в договоре, поручитель, переименование
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  await p.evaluate(()=>goBase('people'));await wait(p,300);
  check('фильтр «№ клиента»: «к-0007», «7» и «К-00007» находят одного клиента К-0007',await p.evaluate(()=>['к-0007','7','К-00007'].every(q=>{S.PF={no:{q}};renderPeople();const r=[...document.querySelectorAll('.ptbl tbody tr')];S.PF={};return r.length===1&&/К-0007/.test(r[0].textContent);})));
  const pf=await p.evaluate(()=>{S.PF={};_pplSort={k:'no',dir:-1};renderPeople();const nos=[...document.querySelectorAll('.ptbl tbody tr')].map(tr=>noNum(tr.textContent.match(/К-\d+/)[0]));
    S.PF={name:{q:'клиент 1'}};renderPeople();const byName=[...document.querySelectorAll('.ptbl tbody tr')].every(tr=>/Клиент 1/.test(tr.textContent));
    S.PF={phone:{q:'8 928 100 00 05'}};renderPeople();const byPhone=document.querySelectorAll('.ptbl tbody tr').length;S.PF={};renderPeople();
    return{desc:nos.every((n,i)=>!i||nos[i-1]>=n),first:nos[0],byName,byPhone};});
  check('клиенты по умолчанию — новые номера сверху; фильтры по ФИО и телефону работают',pf.desc&&pf.byName&&pf.byPhone>=1,pf);
  await p.evaluate(()=>openPersonForm(null,'Клиент 5'));await p.fill('#pfPhones input','89990000005');await p.fill('#pf_wa','+7 999 123 45 67');
  await p.fill('#pf_addr','Псков');await p.fill('#pf_actual','Москва');await p.evaluate(()=>savePerson());await wait(p,300);
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
  const contact=await p.evaluate(pid=>{
    const c=S.clients.find(x=>x.clientPid===pid),urls=[],open=window.open;
    window.open=url=>urls.push(url);
    try { openChat(c.id);openWA(c.id); } finally { window.open=open; }
    openPersonForm('p:'+pid);
    return {urls,mobile:c.phones[0],reg:document.querySelector('#pf_addr').value,actual:document.querySelector('#pf_actual').value,wa:document.querySelector('#pf_wa').value.replace(/\D/g,'')};
  },nw.id);
  check('чат и напоминание открывают WhatsApp клиента, звонок сохраняет сотовый',contact.urls[0]==='https://wa.me/79991234567'&&contact.urls[1]?.startsWith('https://wa.me/79991234567?text=')&&contact.mobile==='89990000005',contact);
  check('форма редактирования сохраняет оба адреса и номер WhatsApp',contact.reg==='Псков'&&contact.actual==='Москва'&&contact.wa==='79991234567',contact);
  await p.fill('#pf_wa','');await p.evaluate(()=>savePerson());
  if(await p.isVisible('#pfSave') && /другой человек/.test(await p.textContent('#pfSave'))) await p.evaluate(()=>savePerson());
  await p.waitForFunction(pid=>S.persons.find(x=>x.id===pid)?.whatsapp==='',nw.id);
  check('очищенный номер WhatsApp не заменяется сотовым',await p.evaluate(pid=>dealWhatsApp(S.clients.find(c=>c.clientPid===pid))==='',nw.id));
  const cnt=await p.evaluate(ids=>{const g=groupPeople();return ids.map(id=>g.find(x=>x.id===id).deals.length);},[old.id,nw.id]);
  check('сделки тёзок не смешались',cnt[1]===1&&cnt[0]>=1,cnt);
  await p.evaluate(id=>openPersonForm('p:'+id),old.id);await p.fill('#pf_name','Пятов Пятый');await p.evaluate(()=>savePerson());await wait(p,1500);
  const rn=await p.evaluate(ids=>({old:S.clients.filter(c=>c.clientPid===ids[0]).map(c=>c.name),nw:S.clients.filter(c=>c.clientPid===ids[1]).map(c=>c.name)}),[old.id,nw.id]);
  check('переименование меняет ФИО только в сделках этого клиента',rn.old.length&&rn.old.every(n=>n==='Пятов Пятый')&&rn.nw.every(n=>n==='Клиент 5'),rn);
  await p.evaluate(()=>openC(S.clients.find(x=>x.name==='Клиент 5').id));await wait(p,300);
  check('карточка сделки открывается',/ДАННЫЕ КЛИЕНТА/i.test(await p.$eval('#cDetail',e=>e.innerText)));
  // поручители: у каждого свой телефон в столбце «Поручитель», в столбце «Клиент» — только телефоны клиента
  const gc=await p.evaluate(()=>{const P=S.persons.slice(0,3),c={...S.clients.find(x=>x.id==='c0'),clientPid:P[0].id,phones:P[0].phones,guarantors:[{name:P[1].name,pid:P[1].id},{name:P[2].name,pid:P[2].id}]};
    c._st='активный';const g=CL_COLS.gname.td(c),n=CL_COLS.name.td(c),d=x=>String(x||'').replace(/\D/g,''),txt=h=>{const e=document.createElement('div');e.innerHTML=h;return d(e.textContent);};
    const p1=d(P[1].phones[0]),p2=d(P[2].phones[0]);return{both:txt(g).includes(p1)&&txt(g).includes(p2),clientClean:!txt(n).includes(p1)&&!txt(n).includes(p2),card:CARD_F.gname.v(c)};});
  check('у каждого поручителя виден свой номер, в столбце «Клиент» номеров поручителей нет',gc.both&&gc.clientClean,gc);
  noErrors('клиенты',errs);await ctx.close();
}
