// Резервная копия: скачать всю базу файлом, испортить данные, восстановить из файла — всё как было
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {reseed,device,login,check,noErrors,wait,autoConfirm,BACKEND} from '../lib.mjs';
const snap=p=>p.evaluate(async()=>{
  const clean=o=>o&&JSON.parse(JSON.stringify(o,(k,v)=>k==='_u'?undefined:v));
  const{db,doc,getDoc}=window.DB,pc=await getDoc(doc(db,'settings','pcounter'));
  return{n:{c:S.clients.length,p:S.payments.length,k:S.kassaOps.length,w:S.wallets.length,pr:S.persons.length,i:S.inv.length},
    wallets:Object.fromEntries(S.wallets.map(w=>[w.id,w.balance])),c5:clean(S.clients.find(c=>c.id==='c5')),p3:clean(S.payments.find(x=>x.id==='p3_1')),
    extra:S.persons.some(x=>x.name==='Появился после копии'),pcounter:pc.exists()?pc.data().lastId:null};
});
const ready=async p=>{for(let i=0;;i++){try{await p.waitForFunction(()=>typeof S!=='undefined'&&S.clients.length>0&&S.payments.length>0&&S.wallets.length>0,null,{timeout:90000});break;}
  catch(e){if(i>=3||!/context|navigat/i.test(String(e)))throw e;await wait(p,1000);}}await wait(p,1500);};
export default async function(){
  await reseed();
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'amana-bk-'));
  const {p,errs,ctx}=await device();await login(p);await autoConfirm(p);
  const B=await device();await login(B.p); // второе устройство: данные уже в его памяти
  await p.evaluate(()=>goTo('settings'));await wait(p,300);
  check('в настройках есть карточка «Резервная копия»',await p.isVisible('#bkCard #bkDl'));
  const before=await snap(p);

  // 1. Скачать копию (компьютер — файл скачивается сразу)
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#bkDl')]);
  const file=path.join(tmp,dl.suggestedFilename());await dl.saveAs(file);
  const txt=fs.readFileSync(file,'utf8'),J=JSON.parse(txt),C=J.collections;
  check('имя файла с датой и временем',/^amana-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()),dl.suggestedFilename());
  check('в файле вся база: договоры, платежи, касса, счета, клиенты, инвесторы, настройки, история',J.format==='amana-crm-backup'&&J.version===1&&J.source==='server'
    &&Object.keys(C.clients).length===before.n.c&&Object.keys(C.payments).length===before.n.p&&Object.keys(C.kassaOps).length===before.n.k
    &&Object.keys(C.wallets).length===before.n.w&&Object.keys(C.persons).length===before.n.pr&&Object.keys(C.investors).length===before.n.i
    &&C.settings.pcounter&&!C.settings.meta&&C.journal&&C.invOps,J.counts);
  check('даты сохранены как ISO-время, суммы — числами, служебных меток нет',/^\d{4}-\d\d-\d\dT/.test(C.payments.p3_1.date.$date)&&typeof C.payments.p3_1.amount==='number'&&!txt.includes('"_u"'),C.payments.p3_1);
  const st=await p.textContent('#bkSt');
  check('после скачивания видно, что вошло в копию',/200\sдоговоров/.test(st)&&/150\sклиентов/.test(st),st);

  // 2. Меняем данные после копии
  await p.evaluate(async()=>{const{db,doc,collection,deleteDoc,updateDoc,addDoc,setDoc}=window.DB;
    await deleteDoc(doc(db,'clients','c5'));const w=S.wallets.find(x=>x.id==='w1');await updateDoc(doc(db,'wallets','w1'),{balance:w.balance+12345});
    await addDoc(collection(db,'persons'),{name:'Появился после копии',phones:[],no:'К-00999'});await setDoc(doc(db,'settings','pcounter'),{lastId:999});
    await updateDoc(doc(db,'payments','p3_1'),{amount:1});});
  await p.waitForFunction(()=>!S.clients.some(c=>c.id==='c5')&&S.persons.some(x=>x.name==='Появился после копии'),null,{timeout:20000});
  const mid=await snap(p);
  check('данные изменились (для проверки восстановления)',!mid.c5&&mid.extra&&mid.pcounter===999&&mid.wallets.w1!==before.wallets.w1,mid.n);

  // 3. Чужой файл не принимается
  const bad=path.join(tmp,'bad.json');fs.writeFileSync(bad,'{"hello":1}');
  await p.setInputFiles('#bkFile',bad);await p.waitForSelector('#bkRs .bk-err');
  check('чужой файл: «Это не файл копии Amana CRM»',/не файл копии/.test(await p.textContent('#bkRs')));

  // 4. Восстановление: дата и состав копии, сначала сохранить текущие данные, потом восстановить
  await p.setInputFiles('#bkFile',file);await p.waitForSelector('#bkPreBtn:not([disabled])',{timeout:60000});
  const rs=await p.textContent('#bkRs');
  check('перед восстановлением видно дату копии и её состав',/Копия от \d\d\.\d\d\.\d{4} \d\d:\d\d/.test(rs)&&/200\sдоговоров/.test(rs),rs.slice(0,200));
  check('кнопка «Восстановить» недоступна, пока не сохранены текущие данные',await p.isDisabled('#bkGo'));
  const [pre]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#bkPreBtn')]);
  const preJ=JSON.parse(fs.readFileSync(await pre.path(),'utf8'));
  check('текущие данные сохранены в отдельный файл (с изменениями после копии)',preJ.format==='amana-crm-backup'&&!preJ.collections.clients.c5&&preJ.collections.settings.pcounter.lastId===999);
  check('после сохранения кнопка «Восстановить» доступна',!(await p.isDisabled('#bkGo')));
  await Promise.all([p.waitForEvent('framenavigated',{timeout:180000}),p.click('#bkGo')]);
  await ready(p);await p.evaluate(()=>goTo('settings'));
  const after=await snap(p);
  check('после восстановления: столько же договоров, платежей, операций кассы, счетов, клиентов',JSON.stringify(after.n)===JSON.stringify(before.n),{before:before.n,after:after.n});
  check('удалённый договор вернулся, лишний клиент исчез',JSON.stringify(after.c5)===JSON.stringify(before.c5)&&!after.extra,{c5:!!after.c5,extra:after.extra});
  check('остатки счетов, суммы платежей и счётчик номеров — как в копии',JSON.stringify(after.wallets)===JSON.stringify(before.wallets)&&JSON.stringify(after.p3)===JSON.stringify(before.p3)&&after.pcounter===150,{w:after.wallets,pc:after.pcounter});
  const jr=await p.evaluate(async()=>{const{db,collection,getDocs}=window.DB;const s=await getDocs(collection(db,'journal'));return s.docs.map(d=>d.data().type);});
  check('в истории действий есть запись о восстановлении, старые записи на месте',jr.includes('Восстановление из резервной копии')&&jr.includes('Скачана резервная копия'),jr.slice(-5));
  // второе устройство при открытии получает восстановленную базу, а не свою старую память
  await login(B.p,{again:true});
  const b2=await snap(B.p);
  check('другое устройство после открытия видит восстановленные данные',JSON.stringify(b2.wallets)===JSON.stringify(before.wallets)&&!!b2.c5&&!b2.extra&&b2.n.pr===before.n.pr,{n:b2.n,extra:b2.extra});
  noErrors('копия и восстановление',errs);noErrors('второе устройство',B.errs);
  await B.ctx.close();

  // 5. Копия с паролем: в файле ничего не читается; неверный пароль не открывает, верный — открывает
  await p.fill('#bkPw','секрет-123');
  const [dl2]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#bkDl')]);
  const enc=fs.readFileSync(await dl2.path(),'utf8'),E=JSON.parse(enc);
  check('файл с паролем зашифрован (имён и сумм в нём не видно)',E.format==='amana-crm-backup-encrypted'&&E.kdf.iterations>=100000&&!enc.includes('Клиент')&&!enc.includes('clients'),Object.keys(E));
  const encFile=path.join(tmp,'enc.json');fs.writeFileSync(encFile,enc);await p.fill('#bkPw','');
  await p.setInputFiles('#bkFile',encFile);await p.waitForSelector('#bkOpenPw');
  await p.fill('#bkOpenPw','не тот');await p.click('#bkOpenBtn');await p.waitForSelector('#bkOpenSt .bk-err',{timeout:30000});
  check('неверный пароль: «Неверный пароль»',/Неверный пароль/.test(await p.textContent('#bkOpenSt')));
  await p.fill('#bkOpenPw','секрет-123');await p.click('#bkOpenBtn');await p.waitForSelector('#bkPreBtn',{timeout:30000});
  check('верный пароль открывает копию',/200\sдоговоров/.test(await p.textContent('#bkRs')));
  await p.waitForSelector('#bkPreBtn:not([disabled])',{timeout:60000});
  check('текущие данные перед восстановлением из копии с паролем тоже сохраняются с паролем',/с паролем/.test(await p.textContent('#bkPreBtn')));
  await p.click('#bkRs button:has-text("Отмена")');
  check('«Отмена» закрывает восстановление',(await p.textContent('#bkRs')).trim()==='');

  // 6. Нет интернета (или сервер лежит): копия делается из данных на устройстве, с предупреждением
  await ctx.setOffline(true);
  const [dl3]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#bkDl')]);
  const off=JSON.parse(fs.readFileSync(await dl3.path(),'utf8'));
  check('без интернета копия всё равно скачивается — из памяти устройства',off.source==='device'&&Object.keys(off.collections.clients).length===before.n.c&&Object.keys(off.collections.payments).length===before.n.p,off.counts);
  check('без интернета показано предупреждение',/из данных на этом устройстве/.test(await p.textContent('#bkSt')));
  await ctx.setOffline(false);
  await ctx.close();

  // 7. Телефон: файл сохраняется по кнопке «Сохранить файл»; карточка не шире экрана
  const M=await device({mobile:true,vp:{width:390,height:844}});await login(M.p);
  await M.p.evaluate(()=>goTo('settings'));await wait(M.p,300);
  const ov=await M.p.evaluate(()=>{const r=document.getElementById('bkCard').getBoundingClientRect();return{w:r.width,right:r.right,vw:innerWidth,sw:document.documentElement.scrollWidth};});
  check('телефон: карточка копии помещается в экран',ov.right<=ov.vw+0.5&&ov.sw<=ov.vw,ov);
  await M.p.click('#bkDl');await M.p.waitForSelector('#bkSt button:has-text("Сохранить файл")',{timeout:60000});
  const [dl4]=await Promise.all([M.p.waitForEvent('download',{timeout:60000}),M.p.click('#bkSt button:has-text("Сохранить файл")')]);
  check('телефон: «Сохранить файл» отдаёт файл копии',/^amana-backup-/.test(dl4.suggestedFilename()));
  noErrors('копия на телефоне',M.errs);
  await M.ctx.close();
  // 8. Старый адрес после переезда (Firebase): только просмотр, но копию скачать можно
  if(BACKEND==='fb'){
    const O=await device();await O.ctx.addInitScript(()=>{window.__AMANA_MOVED=true;});await login(O.p);
    const r=await O.p.evaluate(async()=>{const b=document.getElementById('movedBadge');let err='';
      try{await window.DB.updateDoc(window.DB.doc(window.DB.db,'wallets','w1'),{name:'Взлом'});}catch(e){err=e.message;}
      return{badge:!!b&&getComputedStyle(b).display!=='none'&&b.href.includes('crm-amana.ru'),err,name:S.wallets.find(w=>w.id==='w1').name};});
    check('старый адрес: плашка «CRM переехала», изменения не сохраняются',r.badge&&/переехала/.test(r.err)&&r.name!=='Взлом',r);
    await O.p.evaluate(()=>goTo('settings'));
    const [dl5]=await Promise.all([O.p.waitForEvent('download',{timeout:60000}),O.p.click('#bkDl')]);
    const J5=JSON.parse(fs.readFileSync(await dl5.path(),'utf8'));
    check('старый адрес: копию для переезда скачать можно',J5.format==='amana-crm-backup'&&Object.keys(J5.collections.clients).length===before.n.c);
    noErrors('старый адрес',O.errs);await O.ctx.close();
  }
  fs.rmSync(tmp,{recursive:true,force:true});
}
