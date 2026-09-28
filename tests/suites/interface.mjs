// Интерфейс: карточка сделки, поиск, крестик в окнах, переименования, удаление клиента, ОПИУ, история, звонок
import {reseed,device,login,check,noErrors,wait,autoConfirm} from '../lib.mjs';
export default async function(){
  await reseed();
  // --- телефон
  const M=await device({vp:{width:390,height:844},mobile:true});await login(M.p);
  await M.p.evaluate(()=>openC('c0'));await wait(M.p,300);
  const card=await M.p.evaluate(()=>{const g=document.querySelector('.cd-grid'),side=document.querySelector('.cd-side'),main=document.querySelector('.cd-main');
    const link=document.querySelector('#cDetail .plink');return{oneCol:getComputedStyle(g).gridTemplateColumns.split(' ').length===1,sideTop:side.getBoundingClientRect().top<main.getBoundingClientRect().top,
      schedFirst:main.firstElementChild&&main.firstElementChild.querySelector('[id^="schedb_"]')!==null,schedOpen:document.getElementById('schedb_c0').classList.contains('on'),linkColor:getComputedStyle(link).color};});
  check('карточка сделки на телефоне в одну колонку, остаток сверху',card.oneCol&&card.sideTop,card);
  check('график платежей первым и сразу развёрнут',card.schedFirst&&card.schedOpen,card);
  check('ссылки ФИО не стандартного синего цвета',card.linkColor!=='rgb(0, 0, 238)',card.linkColor);
  await M.p.evaluate(()=>goBase('reminders'));await wait(M.p,300);
  check('в контроле платежей на телефоне есть номер и «Позвонить»',await M.p.evaluate(()=>{const a=document.querySelector('.rem-mob .rem-call a');return!!a&&/^tel:\+7\d{10}$/.test(a.getAttribute('href'));}));
  await M.p.evaluate(()=>openNew());await wait(M.p,200);
  const x=await M.p.$('#mClient .m-x');check('в окне есть крестик «Закрыть»',!!x);
  if(x){await x.click();await wait(M.p,200);check('крестик закрывает окно',!(await M.p.evaluate(()=>document.getElementById('mClient').classList.contains('on'))));}
  await M.p.click('.sidebar .gs-nb');await wait(M.p,200);
  check('на телефоне поиск есть в нижнем меню',await M.p.evaluate(()=>document.getElementById('mSearch').classList.contains('on')));
  noErrors('интерфейс, телефон',M.errs);await M.ctx.close();

  // --- компьютер
  const {p,errs,ctx}=await device();await login(p);await autoConfirm(p);
  check('в плитках дашборда суммы без копеек',await p.evaluate(()=>{goTo('dashboard');return![...document.querySelectorAll('#dStats .sv')].some(e=>/\d,\d{2}\s*₽/.test(e.textContent));}));
  // поиск по сделкам над таблицей
  const dq=await p.evaluate(()=>{goBase('clients');const i=document.getElementById('clQ');i.value='00011';renderClients();const n=document.querySelectorAll('#cList tbody tr').length;i.value='';renderClients();return n;});
  check('поиск сделки по номеру договора',dq===1,dq);
  // общий поиск
  await p.keyboard.press('/');await wait(p,200);await p.fill('#gsQ','к-0007');await wait(p,100);
  const gs=await p.evaluate(()=>[...document.querySelectorAll('#gsRes .gs-it b')].map(b=>b.textContent));
  check('общий поиск по номеру К-0007: клиент и только его сделки',/^Клиент 6 К-0007$/.test(gs[0])&&gs.length>1&&gs.slice(1).every(t=>/Клиент 6$/.test(t)),gs);
  await p.fill('#gsQ','00011');await p.keyboard.press('Enter');await wait(p,300);
  check('Enter в поиске открывает найденную сделку',await p.evaluate(()=>S.curClient==='c10'&&pageOn('client')));
  // ОПИУ: заголовки разделов закреплены
  check('заголовки разделов ОПИУ закреплены слева',await p.evaluate(()=>{goTo('finance');const s=document.querySelector('.fin-hs');return!!s&&getComputedStyle(s).position==='sticky';}));
  // переименование счёта: в старых операциях — новое название
  await p.evaluate(()=>{goTo('settings');renameWallet('w2');});await wait(p,200);await p.fill('#askIn','Т-Банк');await p.click('#askOk');await wait(p,1200);
  const wn=await p.evaluate(()=>{goTo('kassa');return{list:document.getElementById('kList').innerText.includes('Т-Банк'),old:[...document.querySelectorAll('#kList td')].some(td=>td.textContent.trim()==='Сбер')};});
  check('после переименования счёта в операциях видно новое название',wn.list&&!wn.old,wn);
  // переименование поставщика: меняется во всех договорах
  await p.evaluate(async()=>{goTo('settings');document.getElementById('newPart').value='Эльдорадо';await addPart();});
  await p.evaluate(async()=>{const{db,doc,updateDoc}=window.DB;await updateDoc(doc(db,'clients','c1'),{partner:'Эльдорадо'});await updateDoc(doc(db,'clients','c2'),{partner:'Эльдорадо'});});await wait(p,800);
  await p.evaluate(()=>renamePart(S.partners.indexOf('Эльдорадо')));await wait(p,200);await p.fill('#askIn','М.Видео');await p.click('#askOk');await wait(p,1800);
  const rp=await p.evaluate(()=>({list:S.partners.includes('М.Видео')&&!S.partners.includes('Эльдорадо'),deals:S.clients.filter(c=>c.partner==='М.Видео').length}));
  check('переименование поставщика меняет его во всех договорах',rp.list&&rp.deals===2,rp);
  // удаление клиента без сделок
  const dp=await p.evaluate(async()=>{const{db,doc,setDoc}=window.DB;await setDoc(doc(db,'persons','PX'),{name:'Лишний Клиент',phones:[],addr:'',note:'',no:'К-0999'});await new Promise(r=>setTimeout(r,1000));
    openPerson('p:PX');await new Promise(r=>setTimeout(r,200));const btn=[...document.querySelectorAll('#personBody button')].some(b=>b.textContent==='Удалить');delPerson('PX');await new Promise(r=>setTimeout(r,1200));
    openPerson('p:P0');await new Promise(r=>setTimeout(r,200));const btn0=[...document.querySelectorAll('#personBody button')].some(b=>b.textContent==='Удалить');return{btn,gone:!S.persons.some(x=>x.id==='PX'),btn0};});
  check('клиента без сделок можно удалить',dp.btn&&dp.gone,dp);
  check('у клиента со сделками кнопки «Удалить» нет',!dp.btn0,dp);
  // отмена скидки — понятный текст
  const cd=await p.evaluate(async()=>{let msg='';window.showConfirm=(t,m)=>{msg=m;};const{db,collection,addDoc}=window.DB;const r=await addDoc(collection(db,'payments'),{clientId:'c5',contractId:'00006',name:'x',amount:100,type:'discount',typeLabel:'Скидка',payType:'—',date:new Date(),dateStr:fmtD(new Date())});
    await new Promise(r=>setTimeout(r,800));await cancelPay(r.id,'c5',100,'discount');window.showConfirm=(t,m,ok)=>ok&&ok();return msg;});
  check('при отмене скидки нет пугающего «операция не найдена»',/Касса не меняется/.test(cd)&&!/не найдена/.test(cd),cd);
  // история: фильтр по датам спрашивает сервер
  const jr=await p.evaluate(async()=>{await logA('Проверка истории','тест');goTo('journal');await new Promise(r=>setTimeout(r,800));S.JF.date_from=dayKey(new Date());S.JF.date_to=dayKey(new Date());await loadJournal();return _jd.length>0&&_jd.every(j=>j.dateStr===fmtD(new Date()));});
  check('фильтр истории по датам загружает нужный период',jr);
  noErrors('интерфейс, ПК',errs);await ctx.close();
}
