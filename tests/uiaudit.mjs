// UI/UX-аудит: реалистичные данные (длинные ФИО, 2 поручителя, длинные товары), скриншоты всех экранов и автодетекторы (разрывы телефонов и сумм, обрезки, наложения).
// Запуск: FONTS_DIR=<папка со шрифтами> npx firebase emulators:exec --only firestore,auth --project amana-crm-16033 "node uiaudit.mjs <папка> [экраны через запятую]"
import fs from 'node:fs';import path from 'node:path';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,writeBatch,getDocs,collection} from 'firebase/firestore';
import {start,stop,reseed,device,login,wait} from './lib.mjs';
const OUT=path.resolve(process.argv[2]||'ui-out');fs.mkdirSync(OUT,{recursive:true});
const ONLY=process.argv[3]||'';
const FAM=['Ахмедова','Эскерханов','Митаев','Айбаев','Ахмедов','Занкиев','Исмаилов','Магомадова','Хасбулатов','Абдулкеримов','Дудаева','Мусаев'];
const NAM=['Залина Абдулмуслимовна','Салахь Зубайраевич','Абубакар Хасанович','Ибрагим Мовсарович','Ислам Аллиевич','Бексолта Сулейманович','Руслан Ахмедович','Марьям Висаитовна','Адам Лечиевич','Магомед Абдулхамидович','Хадижат Умаровна','Ильяс Русланович'];
const PROD=['Кирпич облицовочный, 4 поддона','Полики, руль и перешив потолка','Холодильник Samsung RB37A','Мебель для спальни (шкаф, кровать, комод)','iPhone 15 Pro Max 256 ГБ','Одежда','Стиральная машина LG F2J3HS4L','Диван угловой «Монако»'];
const PART=['Сторонний','Иса кирпич строймаркет','Сторонний','ТехноМир Гудермес','Сторонний'];
const ADDR=['г. Гудермес, пр. Терешковой, 34','г. Гудермес, ул. Кирова, 111','г. Гудермес, ул. Буйнакская, 112, кв. 45','с. Ойсхара, ул. Нурадилова, 7',''];
await start();await reseed();
// реалистичные данные поверх тестовой базы
const env=await initializeTestEnvironment({projectId:'amana-crm-16033',firestore:{host:'127.0.0.1',port:8085,rules:"rules_version='2';service cloud.firestore{match /databases/{d}/documents{match /{p=**}{allow read,write: if request.auth!=null;}}}"}});
await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();let b=writeBatch(db),n=0;const up=async(p,d)=>{b.set(doc(db,p),d,{merge:true});if(++n%400===0){await b.commit();b=writeBatch(db);}};
  const nm=j=>FAM[j%FAM.length]+' '+NAM[(j*7)%NAM.length],ph=j=>'89'+String(28000000+j*7919).padStart(9,'0').slice(0,9);
  for(let j=0;j<150;j++)await up('persons/P'+j,{name:nm(j),phones:j%4===0?[ph(j),ph(j+500)]:[ph(j)],addr:ADDR[j%ADDR.length],no:'К-'+String(j+1).padStart(5,'0'),note:j%9===0?'Работает на рынке, платит после 10-го числа. Брат — поручитель по другому договору.':''});
  for(let i=0;i<200;i++){const j=i%150;const g=i%3===0?[{name:nm((i+1)%150),pid:'P'+((i+1)%150)},{name:nm((i+2)%150),pid:'P'+((i+2)%150)}]:(i%3===1?[{name:nm((i+3)%150),pid:'P'+((i+3)%150)}]:[]);
    await up('clients/c'+i,{name:nm(j),phones:j%4===0?[ph(j),ph(j+500)]:[ph(j)],addr:ADDR[j%ADDR.length],guarantors:g,product:PROD[i%PROD.length],partner:PART[i%PART.length],contractId:'26-'+String(i+1).padStart(4,'0'),...(i%5===0?{comment:'Обещал оплатить до конца недели, после зарплаты. Звонить после 18:00.',commentDate:'02.11.2026'}:{})});}
  const ps=await getDocs(collection(db,'payments'));ps.forEach(d=>{const i=+d.data().clientId.slice(1);b.set(d.ref,{name:nm(i%150),contractId:'26-'+String(i+1).padStart(4,'0')},{merge:true});});
  await up('investors/INV0',{name:'Занкиев Бексолта Сулейманович'});await up('investors/INV1',{name:'Магомадова Хадижат Умаровна',phone:'89280233434'});
  await up('settings/partners',{list:['Сторонний','Иса кирпич строймаркет','ТехноМир Гудермес'],phones:{'Иса кирпич строймаркет':'89290000034','ТехноМир Гудермес':'89281112233'}});
  await up('wallets/w2',{name:'Сбербанк бека'});
  await b.commit();});
await env.cleanup();

const closeAll=()=>{document.querySelectorAll('.mover.on').forEach(m=>m.classList.remove('on'));document.getElementById('confirmLayer').innerHTML='';
  document.querySelectorAll('.nb-sub.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('body>.mover:not([id])').forEach(m=>m.remove());closeDrops&&closeDrops();window.scrollTo(0,0);};
const SHOTS=[
 ['01-dashboard','Дашборд',()=>goTo('dashboard'),'page'],
 ['02-fin-sum','Обзор — Итоги',()=>{S.finTab='sum';goTo('finance');},'page'],
 ['03-fin-opiu','Обзор — ОПИУ',()=>{S.finTab='opiu';goTo('finance');},'page'],
 ['04-fin-money','Обзор — Деньги и долги',()=>{S.finTab='money';goTo('finance');},'page'],
 ['05-fin-deals','Обзор — Сделки',()=>{S.finTab='deals';goTo('finance');},'page'],
 ['06-people','Клиенты',()=>goBase('people'),'page'],
 ['07-person','Карточка клиента',()=>openPerson('p:P0'),'page'],
 ['08-deals','Сделки',()=>{goBase('clients');renderClients();},'page'],
 ['09-deal','Карточка сделки (2 поручителя)',()=>openC('c0'),'page'],
 ['10-reminders','Контроль платежей',()=>goBase('reminders'),'page'],
 ['11-kassa','Касса/ДДС',()=>goTo('kassa'),'page'],
 ['12-inv-list','Инвесторы — Участники',()=>{goTo('investors');setInvTab('list',document.querySelector('#invTabs .ft'));},'page'],
 ['13-inv-stats','Инвесторы — Показатели',()=>{goTo('investors');setInvTab('months',document.querySelectorAll('#invTabs .ft')[1]);},'page'],
 ['14-inv-ops','Инвесторы — Журнал',()=>{goTo('investors');setInvTab('ops',document.querySelectorAll('#invTabs .ft')[2]);document.querySelector('#invContent details.inv-jm')&&(document.querySelector('#invContent details.inv-jm').open=true);},'page'],
 ['15-investor','Карточка инвестора',()=>openInv('INV1'),'page'],
 ['16-journal','История действий',()=>goTo('journal'),'page'],
 ['17-settings','Настройки',()=>goTo('settings'),'page'],
 ['20-m-new','Окно: новый договор',()=>{goTo('dashboard');openNew();},'modal'],
 ['20b-m-edit','Окно: изменить договор',()=>{openC('c0');openEdit('c0');},'modal'],
 ['21-m-pay','Окно: оплата',()=>{openC('c0');openPay('c0');},'modal'],
 ['22-m-disc','Окно: скидка',()=>{openC('c0');openDisc('c0');},'modal'],
 ['23-m-comment','Окно: комментарий',()=>{openC('c0');openComment('c0');},'modal'],
 ['24-m-person','Окно: клиент',()=>{goBase('people');openPersonForm('p:P0');},'modal'],
 ['25-m-defer','Окно: отсрочка',()=>{goBase('reminders');openDefer('c0',6);},'modal'],
 ['26-m-kassa','Окно: операция кассы',()=>{goTo('kassa');openKassaOp();},'modal'],
 ['27-m-invform','Окно: инвестор',()=>{goTo('investors');openInvForm('INV1');},'modal'],
 ['28-m-invop','Окно: вклад',()=>{openInv('INV1');openInvOp('deposit','INV1');},'modal'],
 ['29-m-invmonth','Окно: месяц инвесторов',()=>{goTo('investors');openInvMonth(invModel().months[0]);},'modal'],
 ['30-m-view','Окно: вид',()=>{goBase('clients');openView(window.innerWidth<=768?'card':'cols');},'modal'],
 ['31-m-pfilter','Окно: фильтры клиентов',()=>{goBase('people');openPplFilter();},'modal'],
 ['32-m-confirm','Окно: подтверждение',()=>{goBase('clients');archiveClient('c0',true);},'modal'],
];
const MOB=[['40-m-dfilter','Окно: фильтры сделок',()=>{goBase('clients');renderClients();openMobileFilter('clients');},'modal'],['41-more','Меню «Ещё»',()=>{document.getElementById('nav-more').click();},'modal']];
// Детекторы
const DETECT=()=>{
  const root=document.querySelector('.mover.on .modal')||document.querySelector('body>.mover:not([id]) .modal')||document.querySelector('#confirmLayer .confirm-box')||[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none'&&x.offsetParent)||document.body;
  const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none';};
  const out={broken:[],wrapVal:[],clip:[],overlap:[]};
  // 1. разорванные телефоны, суммы, даты, номера
  const RE=/(8 \d{3} \d{3} \d{2} \d{2})|(\d{1,3}(?:[  ]\d{3})+(?:,\d+)?[  ]?₽)|(\d{2}\.\d{2}\.\d{4})|(№?\d{2}-\d{4})|(К-\d{4,5})/g;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){const t=n.textContent;if(!t.trim()||!n.parentElement||!vis(n.parentElement))continue;let m;RE.lastIndex=0;
    while((m=RE.exec(t))){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const rs=[...r.getClientRects()].filter(x=>x.width>0);
      const tops=new Set(rs.map(x=>Math.round(x.top/4)));if(tops.size>1)out.broken.push(m[0]);}}
  // 2. значения в строках карточек, расползшиеся на 3+ строки или ушедшие под подпись
  root.querySelectorAll('.mcard-row,.kcard-bot,.ii').forEach(row=>{if(!vis(row))return;const v=row.querySelector('.mcard-val,.iv')||row.lastElementChild;if(!v)return;
    const lh=parseFloat(getComputedStyle(v).lineHeight)||16,h=v.getBoundingClientRect().height;if(h>lh*2.5)out.wrapVal.push((row.innerText||'').replace(/\s+/g,' ').slice(0,70));});
  // 3. обрезанный текст (многоточие или скрытое переполнение)
  root.querySelectorAll('*').forEach(e=>{if(!vis(e)||e.children.length>2)return;const s=getComputedStyle(e);if((s.overflow==='hidden'||s.overflowX==='hidden'||s.textOverflow==='ellipsis')&&e.scrollWidth>e.clientWidth+2&&(e.innerText||'').trim())out.clip.push((e.innerText||'').trim().replace(/\s+/g,' ').slice(0,50));});
  // 4. наложение карточек
  const bx=[...root.querySelectorAll('.card,.sc,.mcard,.kcard,.cph,.dsh-g4,.sg4,.inv-jm,.pr')].filter(vis);
  for(let i=0;i<bx.length;i++)for(let j=i+1;j<bx.length;j++){const a=bx[i],b=bx[j];if(a.contains(b)||b.contains(a))continue;const A=a.getBoundingClientRect(),B=b.getBoundingClientRect();
    const ox=Math.min(A.right,B.right)-Math.max(A.left,B.left),oy=Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top);if(ox>4&&oy>2)out.overlap.push(String(a.className).slice(0,20)+' × '+String(b.className).slice(0,20));}
  for(const k in out)out[k]=[...new Set(out[k])].slice(0,12);
  return out;};
const report=[];
for(const [dev,o] of [['mobile',{vp:{width:390,height:844},mobile:true}],['desktop',{vp:{width:1280,height:850}}]]){
  const {p,ctx,errs}=await device(o);
  const FD=process.env.FONTS_DIR;
  if(FD){await ctx.route(/fonts\.googleapis\.com/,r=>r.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(FD,'fonts.css'))}));
    await ctx.route(/fontlocal/,r=>r.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(FD,r.request().url().split('/').pop()))}));}
  await login(p);await p.evaluate(()=>document.fonts&&document.fonts.ready);await wait(p,400);
  // вид как у пользователя: в карточке сделки и в таблице включены поручитель, товар, поставщик, цены
  await p.evaluate(()=>{S.ui=S.ui||{};S.ui.card=['date','gname','product','partner','price','margin','prepay','cost','months','monthly','bal','over','next','status','comment'].map(k=>({k,on:true}));
    S.ui.cols=['id','date','name','gname','product','bal','over','next','monthly','pricecost','months','partner','status','comment'].map(k=>({k,on:true}));
    S.ui.pcols=['no','phone','addr','deals','active','done','debt','over','state','note'].map(k=>({k,on:true}));});
  const list=(dev==='mobile'?SHOTS.concat(MOB):SHOTS).filter(x=>!ONLY||ONLY.split(',').includes(x[0]));
  for(const [file,label,fn,kind] of list){
    await p.evaluate(closeAll);await wait(p,80);
    try{await p.evaluate(fn);}catch(e){console.log('  ! '+label+': '+e.message.split('\n')[0]);continue;}
    await wait(p,file==='16-journal'?900:400);
    const base=path.join(OUT,`${file}-${dev}`);const d=await p.evaluate(DETECT);report.push({dev,file,label,...d});
    if(kind==='page'){const H=await p.evaluate(()=>document.documentElement.scrollHeight);const steps=Math.min(4,Math.ceil(H/o.vp.height));
      for(let s=0;s<steps;s++){await p.evaluate(y=>window.scrollTo(0,y),s*Math.round(o.vp.height*0.85));await wait(p,150);await p.screenshot({path:base+(s?'-'+(s+1):'')+'.png'});}
      await p.evaluate(()=>window.scrollTo(0,0));}
    else{await p.screenshot({path:base+'.png'});
      const sc=await p.evaluate(()=>{const m=document.querySelector('.mover.on .modal')||document.querySelector('body>.mover .modal');if(!m||m.scrollHeight<=m.clientHeight+20)return false;m.scrollTop=m.scrollHeight;return true;});
      if(sc){await wait(p,120);await p.screenshot({path:base+'-bottom.png'});}}
  }
  console.log(dev,'errors:',errs.slice(0,3));
  await ctx.close();
}
fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,1));
await stop();console.log('готово',OUT);
