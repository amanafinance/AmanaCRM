// Дизайн-аудит: скриншоты всех страниц и окон (телефон 390×844 и ПК 1280×850, обе темы) + замеры.
// Запуск: npx firebase emulators:exec --only firestore,auth --project amana-crm-16033 "node audit.mjs <папка>"
import fs from 'node:fs';import path from 'node:path';
import {start,stop,reseed,device,login,wait} from './lib.mjs';
const OUT=path.resolve(process.argv[2]||'audit-out');fs.mkdirSync(OUT,{recursive:true});

const closeAll=()=>{document.querySelectorAll('.mover.on').forEach(m=>m.classList.remove('on'));document.getElementById('confirmLayer').innerHTML='';
  document.querySelectorAll('.nb-sub.show').forEach(x=>x.classList.remove('show'));document.querySelectorAll('body>.mover:not([id])').forEach(m=>m.remove());window.scrollTo(0,0);};
// [имя файла, подпись, действие, тип: page|modal]
const SHOTS=[
 ['01-dashboard','Дашборд',()=>goTo('dashboard'),'page'],
 ['02-finance-sum','Обзор — Итоги',()=>{S.finTab='sum';goTo('finance');},'page'],
 ['03-finance-opiu','Обзор — ОПИУ',()=>{S.finTab='opiu';goTo('finance');},'page'],
 ['04-finance-money','Обзор — Деньги и долги',()=>{S.finTab='money';goTo('finance');},'page'],
 ['05-finance-deals','Обзор — Сделки',()=>{S.finTab='deals';goTo('finance');},'page'],
 ['06-people','Клиенты',()=>goBase('people'),'page'],
 ['07-person','Карточка клиента',()=>openPerson('p:P0'),'page'],
 ['08-deals','Сделки',()=>{goBase('clients');renderClients();},'page'],
 ['09-deal','Карточка сделки',()=>openC('c0'),'page'],
 ['10-reminders','Контроль платежей',()=>goBase('reminders'),'page'],
 ['11-kassa','Касса/ДДС',()=>goTo('kassa'),'page'],
 ['12-investors','Инвесторы — Участники',()=>{goTo('investors');setInvTab('list',document.querySelector('#invTabs .ft'));},'page'],
 ['13-investors-months','Инвесторы — Месяцы',()=>{goTo('investors');setInvTab('months',document.querySelectorAll('#invTabs .ft')[1]);},'page'],
 ['14-investors-ops','Инвесторы — Журнал',()=>{goTo('investors');setInvTab('ops',document.querySelectorAll('#invTabs .ft')[2]);},'page'],
 ['15-investor','Карточка инвестора',()=>openInv('INV1'),'page'],
 ['16-journal','История',()=>goTo('journal'),'page'],
 ['17-settings','Настройки',()=>goTo('settings'),'page'],
 ['20-m-new','Окно: новый договор',()=>{goTo('dashboard');openNew();},'modal'],
 ['21-m-pay','Окно: оплата',()=>{openC('c0');openPay('c0');},'modal'],
 ['22-m-disc','Окно: скидка',()=>{openC('c0');openDisc('c0');},'modal'],
 ['23-m-comment','Окно: комментарий',()=>{openC('c0');openComment('c0');},'modal'],
 ['24-m-person','Окно: клиент',()=>{goBase('people');openPersonForm('p:P0');},'modal'],
 ['25-m-defer','Окно: отсрочка',()=>{openC('c0');openDefer('c0',6);},'modal'],
 ['26-m-kassa','Окно: операция кассы',()=>{goTo('kassa');openKassaOp();},'modal'],
 ['27-m-invform','Окно: инвестор',()=>{goTo('investors');openInvForm('INV1');},'modal'],
 ['28-m-invop','Окно: вклад',()=>{openInv('INV1');openInvOp('deposit','INV1');},'modal'],
 ['29-m-invmonth','Окно: месяц инвесторов',()=>{goTo('investors');openInvMonth(invModel().months[0]);},'modal'],
 ['30-m-view','Окно: вид таблицы',()=>{goBase('clients');openView(window.innerWidth<=768?'card':'cols');},'modal'],
 ['31-m-pfilter','Окно: фильтры клиентов',()=>{goBase('people');openPplFilter();},'modal'],
 ['32-m-confirm','Окно: подтверждение',()=>{showConfirm('Удалить операцию?','Операция будет удалена, деньги вернутся на счёт.',()=>{});},'modal'],
];
const MOBILE_ONLY=[
 ['40-m-filter','Окно: фильтры (телефон)',()=>{goBase('clients');renderClients();openMobileFilter('clients');},'modal'],
 ['41-more','Меню «Ещё» (телефон)',()=>{document.getElementById('nav-more').click();},'modal'],
];

// Замеры на открытом экране: мелкие касания, шрифты, контраст
const MEASURE=()=>{
  const root=document.querySelector('.mover.on .modal')||document.querySelector('body>.mover:not([id]) .modal')||document.querySelector('#confirmLayer .confirm-box')||[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none'&&x.offsetParent)||document.body;
  const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>0.05;};
  const lab=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.title||e.className||e.tagName).toString().trim().replace(/\s+/g,' ').slice(0,28);
  // 1. касания меньше 44px
  const tap=[];
  root.querySelectorAll('button,a[href],a[onclick],input:not([type=hidden]),select,textarea,summary,[onclick]').forEach(e=>{
    if(!vis(e))return;if(e.closest('.tbl')&&e.tagName==='TR')return;if(e.tagName==='TR'||e.tagName==='TD'||e.tagName==='TBODY')return;
    const r=e.getBoundingClientRect();if(r.height>=44&&r.width>=44)return;
    if(e.matches('.mcard,.kcard,.deal-card,.crow,.pr,.cphhdr,.inv-end-row,.gs-it,.sc,.card,.dsh-col,.inv-bc'))return; // большие карточки — не кнопки
    tap.push(lab(e)+' '+Math.round(r.width)+'×'+Math.round(r.height));});
  // 2. размеры шрифтов текста
  const sizes={};const low=[];
  const parseC=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const bodyBg=parseC(getComputedStyle(document.body).backgroundColor);
  const bgOf=e=>{let stack=[];let a=e;while(a){const s=getComputedStyle(a);const c=parseC(s.backgroundColor);if(c&&c.a>0){stack.push(c);if(c.a>=0.99)break;}
      if(s.backgroundImage&&s.backgroundImage.includes('gradient')){const m=s.backgroundImage.match(/rgba?\([^)]+\)/g);if(m){const c2=parseC(m[m.length-1]);if(c2&&c2.a>=0.99){stack.push(c2);break;}}}
      a=a.parentElement;}
    let base=stack.length&&stack[stack.length-1].a>=0.99?stack.pop():bodyBg;
    while(stack.length){const c=stack.pop();base={r:c.r*c.a+base.r*(1-c.a),g:c.g*c.a+base.g*(1-c.a),b:c.b*c.a+base.b*(1-c.a),a:1};}return base;};
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
  while((n=walker.nextNode())){const t=n.textContent.trim();if(!t)continue;const e=n.parentElement;if(!e||!vis(e))continue;
    const s=getComputedStyle(e);const fs=Math.round(parseFloat(s.fontSize)*10)/10;sizes[fs]=(sizes[fs]||0)+1;
    let col=parseC(s.color);if(!col)continue;const op=parseFloat(s.opacity);let a=e.parentElement,opa=op;while(a){opa*=parseFloat(getComputedStyle(a).opacity);a=a.parentElement;}
    const bg=bgOf(e);const ca=col.a*opa;col={r:col.r*ca+bg.r*(1-ca),g:col.g*ca+bg.g*(1-ca),b:col.b*ca+bg.b*(1-ca)};
    const L1=lum(col),L2=lum(bg),cr=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const big=fs>=18.6||(fs>=14&&parseInt(s.fontWeight)>=700);
    if(cr<(big?3:4.5))low.push(t.slice(0,24)+' ('+fs+'px, '+cr.toFixed(1)+':1)');}
  return{tap,sizes,low:[...new Set(low)]};
};

await start();await reseed();
const report=[];
for(const [dev,o] of [['mobile',{vp:{width:390,height:844},mobile:true}],['desktop',{vp:{width:1280,height:850}}]]){
  const {p,ctx}=await device(o);
  // настоящие шрифты (Manrope, Roboto Condensed) — из локальной копии, как их увидит iPhone
  const FD=process.env.FONTS_DIR;
  if(FD){await ctx.route(/fonts\.googleapis\.com/,r=>r.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(FD,'fonts.css'))}));
    await ctx.route(/fontlocal/,r=>r.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(FD,r.request().url().split('/').pop()))}));}
  // экран входа
  for(const theme of ['dark','light']){
    await p.goto((await import('./lib.mjs')).URL_CRM);await p.evaluate(t=>{try{localStorage.setItem('amana_theme',t);}catch(e){}},theme);await p.reload();await wait(p,900);
    await p.evaluate(t=>{if(typeof applyTheme==='function')applyTheme(t);},theme);await wait(p,200);
    await p.screenshot({path:path.join(OUT,`00-login-${dev}-${theme}.png`)});
  }
  await login(p);
  const list=dev==='mobile'?SHOTS.concat(MOBILE_ONLY):SHOTS;
  for(const theme of ['dark','light']){
    await p.evaluate(t=>{try{localStorage.setItem('amana_theme',t);}catch(e){}applyTheme(t);},theme);
    for(const [file,label,fn,kind] of list){
      await p.evaluate(closeAll);await wait(p,80);
      try{await p.evaluate(fn);}catch(e){console.log('  ! '+label+': '+e.message.split('\n')[0]);continue;}
      await wait(p,file==='16-journal'?800:350);
      const shot=path.join(OUT,`${file}-${dev}-${theme}.png`);
      await p.screenshot({path:shot});
      if(kind==='page'){const h=await p.evaluate(()=>document.documentElement.scrollHeight);
        if(h>o.vp.height*1.3){await p.evaluate(()=>window.scrollTo(0,innerHeight*0.85));await wait(p,120);await p.screenshot({path:shot.replace('.png','-2.png')});await p.evaluate(()=>window.scrollTo(0,0));}}
      if(theme==='dark'){const m=await p.evaluate(MEASURE);report.push({dev,file,label,...m});}
      if(theme==='light'){const m=await p.evaluate(MEASURE);const r=report.find(x=>x.dev===dev&&x.file===file);if(r)r.lowLight=m.low;}
      // окна с длинным содержимым — второй снимок, прокрученный вниз
      if(kind==='modal'){const sc=await p.evaluate(()=>{const m=document.querySelector('.mover.on .modal');if(!m||m.scrollHeight<=m.clientHeight+20)return false;m.scrollTop=m.scrollHeight;return true;});
        if(sc){await wait(p,120);await p.screenshot({path:shot.replace('.png','-bottom.png')});}}
    }
  }
  // клавиатура на телефоне: видно 470 из 844 (как в тесте devices)
  if(dev==='mobile'){
    await p.evaluate(()=>{const P=VisualViewport.prototype;window.__kb={h:470,t:0};
      Object.defineProperty(P,'height',{get(){return window.__kb.h;},configurable:true});Object.defineProperty(P,'offsetTop',{get(){return window.__kb.t;},configurable:true});});
    for(const theme of ['dark']){
      await p.evaluate(t=>applyTheme(t),theme);
      for(const [file,fn,sel] of [['50-kb-new',()=>{goTo('dashboard');openNew();},'#f_price, .mover.on input[type=number]'],['51-kb-pay',()=>{openC('c0');openPay('c0');},'.mover.on .modal textarea, .mover.on .modal input:not([type=hidden])'],['52-kb-kassa',()=>{goTo('kassa');openKassaOp();},'.mover.on .modal textarea, .mover.on .modal input:not([type=hidden])'],['53-kb-person',()=>{goBase('people');openPersonForm();},'.mover.on input[type=tel]']]){
        await p.evaluate(closeAll);await p.evaluate(fn);await wait(p,300);
        await p.evaluate(async sel=>{const els=[...document.querySelectorAll(sel)].filter(e=>e.offsetParent);const el=els[els.length-1];if(!el)return;el.focus();window.__kbFit();await new Promise(r=>setTimeout(r,500));
          const k=document.createElement('div');k.id='__fakekb';k.style.cssText='position:fixed;left:0;right:0;top:470px;bottom:0;background:repeating-linear-gradient(0deg,#888 0 2px,#bbb 2px 40px);opacity:.92;z-index:99999;display:flex;align-items:center;justify-content:center;font:700 18px sans-serif;color:#222';k.textContent='клавиатура';document.body.appendChild(k);},sel);
        await p.screenshot({path:path.join(OUT,`${file}-mobile-${theme}.png`)});
        await p.evaluate(()=>{document.getElementById('__fakekb')?.remove();document.activeElement?.blur();});await wait(p,150);
      }
    }
    await p.evaluate(()=>{window.__kb.h=844;window.__kbFit();});
  }
  await ctx.close();
}
// CSS: какие размеры шрифтов, отступов и скруглений встречаются в стилях
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const count=re=>{const m={};for(const x of html.matchAll(re))m[x[1]]=(m[x[1]]||0)+1;return Object.fromEntries(Object.entries(m).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])));};
const css={fontSizes:count(/font-size:\s*([\d.]+px)/g),radii:count(/border-radius:\s*([\d.]+px)/g),paddings:count(/padding:\s*([\d.]+px(?: [\d.]+px){0,3})/g),gaps:count(/gap:\s*([\d.]+px)/g),inlineStyles:(html.match(/style="/g)||[]).length+(html.match(/style=\\?'/g)||[]).length,important:(html.match(/!important/g)||[]).length};
fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({report,css},null,1));
await stop();
console.log('готово: '+OUT);
