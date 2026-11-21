// Договор, приватные реквизиты и мобильные действия кассы. Только вымышленные данные.
import fs from 'node:fs';
import path from 'node:path';
import {reseed,device,login,check,noErrors,PB_URL,pbAdmin} from '../lib.mjs';
export default async function(){
 await reseed();
 const A=await device({vp:{width:390,height:844},mobile:true});const p=A.p;await login(p);
 const waNumbers=['70000000101','70000000102'];
 const mobiles=await p.evaluate(numbers=>{
  goTo('settings');
  S.persons=S.persons.map(person=>person.id==='P0'?{...person,whatsapp:numbers[0]}:
    person.id==='P1'?{...person,whatsapp:numbers[1]}:person);
  openContract('c0');
  return [S.persons.find(person=>person.id==='P0').phones[0],S.persons.find(person=>person.id==='P1').phones[0]];
 },waNumbers);
 const initial=await p.evaluate(()=>({name:document.getElementById('contractSellerName').value,phone:document.getElementById('contractSellerPhone').value,series:document.querySelectorAll('[data-field=passportSeries]').length,numbers:document.querySelectorAll('[data-field=passportNumber]').length,people:contractDraft.persons.length}));
 check('до заполнения настроек ФИО и телефон продавца пустые',initial.name===''&&initial.phone==='');
 check('у покупателя и поручителей серия и номер в отдельных полях',initial.series===initial.people&&initial.numbers===initial.people&&initial.people>1,initial);
 const clauses=await p.evaluate(()=>{const a=contractSource(contractDraft)[31];contractDraft.addSignatures=true;const b=contractSource(contractDraft)[31];contractDraft.addSignatures=false;return{a,b};});
 check('без подписи договор действует с передачи товара',clauses.a==='8.1. Договор вступает в силу с момента передачи товара Покупателю.');
 check('с подписью сохраняется условие подписания и передачи',clauses.b.includes('подписания обеими сторонами и передачи товара'));
 const input=(field,i=0)=>`#mContract [data-person="${i}"][data-field="${field}"]`;
 for(let i=0;i<initial.people;i++){
  await p.fill(input('passportSeries',i),'0000');await p.fill(input('passportNumber',i),String(i+1).padStart(6,'0'));
  await p.fill(input('issuer',i),'Тестовый орган выдачи');await p.fill(input('issued',i),'10122003');
 }
 await p.selectOption('#contractSaleType','service');await p.selectOption('#contractSaleType','goods');
 check('смена типа продажи сохраняет раздельные паспортные поля',await p.inputValue(input('passportSeries'))==='0000'&&await p.inputValue(input('passportNumber'))==='000001');
 check('вручную введённые цифры даты форматируются как ДД.ММ.ГГГГ',
   await p.locator(input('issued')).getAttribute('type')==='text' && await p.inputValue(input('issued'))==='10.12.2003');
 await p.fill(input('issued'),'31.02.2003');
 await p.evaluate(()=>previewContract());
 check('несуществующая дата выдачи останавливает подготовку договора',
   await p.locator(input('issued')).getAttribute('aria-invalid')==='true');
 await p.fill(input('issued'),'10.12.2003');
 check('в договор подставляются сотовые номера покупателя и поручителя',
   await p.inputValue(input('phone'))===mobiles[0] && await p.inputValue(input('phone',1))===mobiles[1]);
 const editedMobile='80000000201';
 await p.fill(input('phone'),editedMobile);
 const pdfInfo=await p.evaluate(async()=>{
  const d=contractDraft,def=contractDefinition(d),json=JSON.stringify(def),s=JSON.stringify(d.persons);
  await previewContract();const bytes=d.blob?new Uint8Array(await d.blob.arrayBuffer()):[];
  return{json,s,pdf:bytes.length,header:String.fromCharCode(...bytes.slice(0,5))};
 });
 check('PDF создаётся и с пустым ФИО продавца',pdfInfo.pdf>1000&&pdfInfo.header==='%PDF-',pdfInfo.pdf);
 check('PDF содержит отдельные серию и номер и текст без подписания',pdfInfo.json.includes('Серия паспорта: 0000')&&pdfInfo.json.includes('Номер паспорта: 000001')&&pdfInfo.json.includes('с момента передачи товара Покупателю.')&&!pdfInfo.json.includes('с момента подписания'));
 const contacts=await p.evaluate(()=>{
   renderContractSend();
   const links=[];
   const open=window.open;
   window.open=url=>links.push(url);
   try{contractDraft.persons.forEach((_,i)=>contractOpenWhatsApp(i));}
   finally{window.open=open;}
   return {links,inPdf:JSON.stringify(contractDefinition(contractDraft))};
 });
 check('дата и сотовые номера попадают в PDF, номера WhatsApp открывают чаты',
   contacts.inPdf.includes('10.12.2003') && contacts.inPdf.includes('8 000 000 02 01') &&
   contacts.links.length===2 && contacts.links.every((url,i)=>url.startsWith('https://wa.me/'+waNumbers[i]+'?')),contacts.links);
 check('PDF печатает серию и номер паспорта в одной строке',
   pdfInfo.json.includes('Серия паспорта: 0000 · Номер паспорта: 000001'));
 check('при выключенной подписи в PDF нет строк подписи',!pdfInfo.json.includes('Подпись:'));
 if(process.env.AMANA_ARTIFACT_DIR){fs.mkdirSync(process.env.AMANA_ARTIFACT_DIR,{recursive:true});const data=await p.evaluate(async()=>Array.from(new Uint8Array(await contractDraft.blob.arrayBuffer())));fs.writeFileSync(path.join(process.env.AMANA_ARTIFACT_DIR,'contract-example.pdf'),Buffer.from(data));}
 await p.evaluate(()=>{closeContract();goTo('settings');});
 await p.fill('#sellerNameSetting','Тестовый Продавец Один');await p.fill('#sellerPhoneSetting','80000000001');await p.click('#sellerSave');
 await p.waitForFunction(()=>!document.getElementById('sellerSave').disabled&&sellerDetails.name==='Тестовый Продавец Один');
 const B=await device();await login(B.p);await B.p.waitForFunction(()=>sellerDetails.name==='Тестовый Продавец Один');await B.p.evaluate(()=>openContract('c0'));
 check('сохранённые реквизиты подставляются на другом устройстве',await B.p.inputValue('#contractSellerName')==='Тестовый Продавец Один'&&await B.p.inputValue('#contractSellerPhone')==='80000000001');
 const anon=await fetch(PB_URL+'/api/collections/settings/records/contractSeller');
 check('без входа реквизиты из базы не выдаются',anon.status===403||anon.status===404);
 const admin=await pbAdmin(),headers={Authorization:admin};
 const saved=await(await fetch(PB_URL+'/api/collections/settings/records/contractSeller',{headers})).json();
 check('в настройках сохранены только ФИО и телефон, без паспортов',saved.data.name==='Тестовый Продавец Один'&&!JSON.stringify(saved).includes('passport')&&!JSON.stringify(saved).includes('Тестовый орган выдачи'));
 // Очистка настроек должна удалять значения и на других устройствах.
 await p.fill('#sellerNameSetting','');await p.fill('#sellerPhoneSetting','');await p.click('#sellerSave');
 await p.waitForFunction(()=>!document.getElementById('sellerSave').disabled&&sellerDetails.name==='');await B.p.waitForFunction(()=>sellerDetails.name==='');
 await B.p.evaluate(()=>{closeContract();openContract('c0');});
 check('после очистки настроек ФИО и телефон снова пустые',await B.p.inputValue('#contractSellerName')===''&&await B.p.inputValue('#contractSellerPhone')==='');
 // Паспортные поля не попадали в БД: сравниваем исходные записи участников.
 const clients=await(await fetch(PB_URL+'/api/collections/clients/records/c0',{headers})).json();
 const person=await(await fetch(PB_URL+'/api/collections/persons/records/P0',{headers})).json();
 check('подготовка договора не сохраняет паспорт в клиенте или сделке',!JSON.stringify([clients,person]).includes('passport')&&!JSON.stringify([clients,person]).includes('Тестовый орган выдачи'));
 const archive=await p.evaluate(()=>{const c=S.clients.find(x=>x.id==='c3'),before=remRows().some(r=>r.c.id===c.id);c.archived=true;const after=remRows().some(r=>r.c.id===c.id);c.archived=false;return{before,after};});
 check('долг прежней архивной сделки остаётся в контроле',archive.before&&archive.after,archive);
 for(const width of [320,390,430]){
  await p.setViewportSize({width,height:844});await p.evaluate(()=>{goTo('kassa');S.kTab='opex';renderKassa();});
  const layout=await p.evaluate(()=>{const card=document.querySelector('#kList .kcard-actions').closest('.kcard'),group=card.querySelector('.kcard-actions'),meta=card.querySelector('.kcard-meta'),buttons=[...group.children];const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};return{page:document.documentElement.scrollWidth<=innerWidth,group:rect(group),meta:rect(meta),buttons:buttons.map(rect),background:buttons.map(b=>{const c=getComputedStyle(b,'::before');return{inset:c.left,color:getComputedStyle(b).backgroundColor};})};});
  check('касса '+width+' px: кнопки рядом, данные не перекрыты и экран не растянут',layout.page&&Math.abs(layout.buttons[0].y-layout.buttons[1].y)<1&&layout.meta.right<=layout.group.x+1,layout);
  check('касса '+width+' px: видимая кнопка 32 px, зона нажатия 44 px',layout.buttons.every(b=>b.w===44&&b.h===44)&&layout.background.every(b=>b.inset==='6px'&&b.color==='rgba(0, 0, 0, 0)'),layout);
 }
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>goTo('kassa'));
 if(process.env.AMANA_ARTIFACT_DIR)await p.screenshot({path:path.join(process.env.AMANA_ARTIFACT_DIR,'cash-mobile.png'),fullPage:false});
 await p.locator('#kList .kcard-actions button').first().click();
 check('компактная кнопка изменения открывает операцию',await p.isVisible('#mKassa'));
 await p.evaluate(()=>closeM('mKassa'));
 await p.locator('#kList .kcard-actions button').nth(1).click();
 check('компактная кнопка удаления запрашивает подтверждение',await p.locator('#confirmLayer').innerText().then(t=>t.includes('Удалить операцию')));
 noErrors('договор и касса на телефоне',A.errs);noErrors('реквизиты на другом устройстве',B.errs);
 await A.ctx.close();await B.ctx.close();
}
