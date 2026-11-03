// Дизайн-система: на телефоне всё нажимаемое не меньше 44 px, текст не мельче 12 px, контраст текста
// по норме (4,5 : 1, крупный — 3 : 1) в обеих темах, размеры шрифтов только из шкалы, фильтры в одну строку,
// окна с закреплённой шапкой и кнопками, карточка сделки с одной главной кнопкой, иконка для экрана «Домой».
import fs from 'node:fs';
import {reseed,device,login,check,noErrors,wait,URL_CRM} from '../lib.mjs';
import {PAGES} from './pages.mjs';

const SCALE=[12,14,16,20,24,32];
// Замер открытого экрана (страница или окно)
const MEASURE=({phone})=>{
  const root=document.querySelector('.mover.on .modal')||document.querySelector('#confirmLayer .confirm-box')||[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none'&&x.offsetParent);
  const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>0.05;};
  const lab=e=>(e.innerText||e.value||e.getAttribute('aria-label')||e.title||e.className||e.tagName).toString().trim().replace(/\s+/g,' ').slice(0,30);
  const small=[],tiny=[],low=[];
  // 1. касания (только телефон)
  if(phone)root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[onclick],[role=button]').forEach(e=>{
    if(!vis(e)||/^(TR|TD|TBODY|TABLE)$/.test(e.tagName))return;
    // крупные карточки и строки — сами по себе большие зоны нажатия
    if(e.matches('.mcard,.kcard,.deal-card,.crow,.pr,.cphhdr,.inv-end-row,.gs-it,.sc,.card,.dsh-col,.inv-bc,.im-card,.mover,.modal'))return;
    const r=e.getBoundingClientRect();if(r.height>=43.5&&r.width>=43.5)return;
    // галочка внутри большой подписи-строки: нажимается вся строка
    const l=e.closest('label');if(l&&l.getBoundingClientRect().height>=43.5)return;
    small.push(lab(e)+' '+Math.round(r.width)+'×'+Math.round(r.height));});
  // 2–3. размер и контраст текста
  const parseC=c=>{const m=c&&c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const bodyBg=parseC(getComputedStyle(document.body).backgroundColor);
  const bgOf=e=>{const stack=[];let a=e;while(a){const s=getComputedStyle(a),c=parseC(s.backgroundColor);if(c&&c.a>0){stack.push(c);if(c.a>=0.99)break;}
      if(s.backgroundImage&&s.backgroundImage.includes('gradient')){const m=s.backgroundImage.match(/rgba?\([^)]+\)/g);if(m){const c2=parseC(m[m.length-1]);if(c2&&c2.a>=0.99){stack.push(c2);break;}}}a=a.parentElement;}
    let base=stack.length&&stack[stack.length-1].a>=0.99?stack.pop():bodyBg;
    while(stack.length){const c=stack.pop();base={r:c.r*c.a+base.r*(1-c.a),g:c.g*c.a+base.g*(1-c.a),b:c.b*c.a+base.b*(1-c.a),a:1};}return base;};
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){const t=n.textContent.trim();if(!t)continue;const e=n.parentElement;if(!e||!vis(e)||e.closest('svg'))continue;
    const s=getComputedStyle(e),fs=parseFloat(s.fontSize);if(fs<11.9)tiny.push(t.slice(0,24)+' '+fs+'px');
    let col=parseC(s.color);if(!col)continue;let op=1,a=e;while(a){op*=parseFloat(getComputedStyle(a).opacity);a=a.parentElement;}
    if(e.closest(':disabled,.btn.saving'))continue; // отключённое намеренно бледнее
    const bg=bgOf(e),ca=col.a*op;col={r:col.r*ca+bg.r*(1-ca),g:col.g*ca+bg.g*(1-ca),b:col.b*ca+bg.b*(1-ca)};
    const L1=lum(col),L2=lum(bg),cr=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05),big=fs>=18.6||(fs>=14&&parseInt(s.fontWeight)>=700);
    if(cr<(big?3:4.5)-0.05)low.push(t.slice(0,24)+' ('+fs+'px, '+cr.toFixed(1)+':1)');}
  return{small:[...new Set(small)],tiny:[...new Set(tiny)],low:[...new Set(low)]};
};

export default async function(){
  await reseed();
  // --- размеры шрифтов в коде — только из шкалы
  const src=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const raw=[...src.matchAll(/font-size:\s*([\d.]+)px/g)].map(m=>+m[1]).filter(v=>!SCALE.includes(v));
  check('размеры шрифтов в коде — только из шкалы 12/14/16/20/24/32',!raw.length,[...new Set(raw)]);

  for(const [label,o,phone] of [['телефон',{vp:{width:390,height:844},mobile:true},true],['ПК',{vp:{width:1280,height:850}},false]]){
    const {p,errs,ctx}=await device(o);await login(p);
    for(const theme of ['dark','light']){
      await p.evaluate(t=>{try{localStorage.setItem('amana_theme',t);}catch(e){}applyTheme(t);},theme);
      await wait(p,600); // тема меняется плавно (0,2 с) — замеряем после смены цветов
      const small=[],tiny=[],low=[];
      for(const [name,fn] of PAGES){
        await p.evaluate(()=>{document.querySelectorAll('.mover.on').forEach(m=>m.classList.remove('on'));document.getElementById('confirmLayer').innerHTML='';});
        await p.evaluate(fn);await wait(p,name==='История'?700:200);
        const m=await p.evaluate(MEASURE,{phone});
        if(m.small.length)small.push(name+': '+m.small.slice(0,4).join('; '));
        if(m.tiny.length)tiny.push(name+': '+m.tiny.slice(0,4).join('; '));
        if(m.low.length)low.push(name+': '+m.low.slice(0,4).join('; '));
      }
      const th=theme==='dark'?'тёмная':'светлая';
      if(phone)check(label+', '+th+': всё нажимаемое не меньше 44 px',!small.length,small);
      check(label+', '+th+': нет текста мельче 12 px',!tiny.length,tiny);
      check(label+', '+th+': контраст текста не ниже нормы',!low.length,low);
    }
    await p.evaluate(()=>applyTheme('dark'));
    noErrors('дизайн, '+label,errs);
    await ctx.close();
  }

  // --- телефон: фильтры, окна, карточка сделки, нижнее меню, окно месяца инвесторов, ОПИУ
  const {p,errs,ctx}=await device({vp:{width:390,height:844},mobile:true});await login(p);
  const rows=await p.evaluate(async()=>{const out={};for(const [k,go] of [['платежи',()=>goBase('reminders')],['касса',()=>goTo('kassa')],['сделки',()=>{goBase('clients');renderClients();}]]){
      go();await new Promise(r=>setTimeout(r,250));const t=[...document.querySelectorAll('.ftabs')].find(x=>x.offsetParent);const tops=new Set([...t.children].map(c=>c.offsetTop));
      out[k]={rows:tops.size,scroll:getComputedStyle(t).overflowX};}return out;});
  check('фильтры на телефоне — в одну строку, листаются вбок',Object.values(rows).every(r=>r.rows===1&&r.scroll==='auto'),rows);
  check('страница на телефоне не шире экрана и с фильтрами в строку',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

  const md=await p.evaluate(async()=>{goTo('dashboard');openNew();await new Promise(r=>setTimeout(r,200));const m=document.querySelector('#mClient .modal'),h=m.querySelector('.m-head'),f=m.querySelector('.mft');
    m.scrollTop=400;await new Promise(r=>setTimeout(r,80));const hr=h.getBoundingClientRect(),mr=m.getBoundingClientRect(),fr=f.getBoundingClientRect();
    const res={head:getComputedStyle(h).position,foot:getComputedStyle(f).position,xInHead:!!h.querySelector('.m-x'),title:parseFloat(getComputedStyle(h.querySelector('.mtitle')).fontSize),
      headTop:Math.round(hr.top-mr.top),footBottom:Math.round(mr.bottom-fr.bottom),saveVisible:fr.bottom<=innerHeight+1};closeM('mClient');return res;});
  check('окно: заголовок и крестик в закреплённой шапке, заголовок не мельче 20 px',md.head==='sticky'&&md.xInHead&&md.title>=20&&Math.abs(md.headTop)<=1,md);
  check('окно: «Отмена / Сохранить» закреплены внизу и видны без прокрутки до конца',md.foot==='sticky'&&md.saveVisible&&Math.abs(md.footBottom)<=1,md);

  const cd=await p.evaluate(async()=>{openC('c0');await new Promise(r=>setTimeout(r,250));const a=document.querySelector('#cDetail .cd-acts');
    const vis=[...a.querySelectorAll('.btn')].filter(b=>b.offsetParent&&!b.closest('.cd-menu'));const more=a.querySelector('details.cd-more');
    const colored=vis.filter(b=>b.matches('.by,.br')||/91, ?143, ?249/.test(b.getAttribute('style')||''));
    const menuText=more?more.querySelector('.cd-menu').textContent:'';more.open=true;await new Promise(r=>setTimeout(r,50));const mi=more.querySelector('.cd-mi').getBoundingClientRect();
    document.body.click();await new Promise(r=>setTimeout(r,50));
    return{main:vis.filter(b=>b.classList.contains('bg')).length,colored:colored.length,menu:/В архив|Вернуть/.test(menuText),delOutside:vis.some(b=>/Удалить|В архив/.test(b.textContent)),miH:Math.round(mi.height),closed:!more.open};});
  check('карточка сделки: одна главная кнопка, без цветных, «В архив» и «Удалить» — в меню «Ещё»',cd.main===1&&!cd.colored&&cd.menu&&!cd.delOutside,cd);
  check('меню «Ещё» открывается, пункты 44 px, закрывается нажатием мимо',cd.miH>=44&&cd.closed,cd);

  const nav=await p.evaluate(()=>{const css=[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules];}catch(e){return[];}});
    const txt=css.map(r=>r.cssText).join('\n');const nb=document.querySelector('.sidebar .nb');
    return{safe:/\.sidebar[^{]*\{[^}]*safe-area-inset-bottom/.test(txt),fs:parseFloat(getComputedStyle(nb).fontSize)};});
  check('нижнее меню: отступ под «полоску Домой», подписи не мельче 12 px',nav.safe&&nav.fs>=12,nav);
  const navOn=await p.evaluate(()=>{const r={};for(const t of ['dark','light']){applyTheme(t);goTo('dashboard');const b=document.getElementById('nav-dashboard'),s=getComputedStyle(b);r[t]={bg:s.backgroundColor,brd:s.borderTopWidth,icon:getComputedStyle(b.querySelector('svg')).backgroundColor};}applyTheme('dark');return r;});
  check('выбранный пункт нижнего меню выглядит одинаково в обеих темах',navOn.dark.brd===navOn.light.brd&&navOn.dark.bg===navOn.light.bg&&navOn.dark.icon!=='rgba(0, 0, 0, 0)'&&navOn.light.icon!=='rgba(0, 0, 0, 0)',navOn);

  const card=await p.evaluate(async()=>{goBase('clients');renderClients();await new Promise(r=>setTimeout(r,250));const c=document.querySelector('#cList .mobile-cards .mcard');
    return{def:S.ui.card.filter(x=>x.on).map(x=>x.k).join(),rows:c.querySelectorAll('.mcard-row').length,h:Math.round(c.getBoundingClientRect().height)};});
  check('список сделок на телефоне: компактная карточка по умолчанию',card.def==='bal,over,next,status'&&card.rows<=4&&card.h<300,card);
  const mig=await p.evaluate(()=>uiNorm(CARD_DEF_OLD.map(k=>({k,on:true})),'card').filter(x=>x.on).map(x=>x.k).join());
  check('сохранённый старый вид карточки «по умолчанию» переходит на компактный',mig==='bal,over,next,status',mig);

  const im=await p.evaluate(async()=>{goTo('investors');openInvMonth(invModel().months[0]);await new Promise(r=>setTimeout(r,200));
    const r={cards:!!document.querySelector('#imBody .im-cards').offsetParent,table:!!document.querySelector('#imBody .tbl-wrap').offsetParent,n:document.querySelectorAll('#imBody .im-card').length,rows:document.querySelectorAll('#imBody tbody tr:not(.inv-subrow)').length};closeM('mInvMonth');return r;});
  check('окно месяца инвесторов на телефоне — карточки участников вместо таблицы',im.cards&&!im.table&&im.n===im.rows&&im.n>0,im);

  const fin=await p.evaluate(async()=>{S.finTab='opiu';goTo('finance');await new Promise(r=>setTimeout(r,250));const l=document.querySelector('.fin-t tbody .fin-l');return{w:Math.round(l.getBoundingClientRect().width),sticky:getComputedStyle(l).position,shadow:getComputedStyle(l).boxShadow!=='none'};});
  check('ОПИУ на телефоне: колонка названий узкая, закреплена, с тенью у края',fin.w<=140&&fin.sticky==='sticky'&&fin.shadow,fin);
  noErrors('дизайн, телефон: экраны',errs);await ctx.close();

  // --- компьютер: таблица в окне месяца, кнопки 36 px, иконка для экрана «Домой»
  const D=await device();await login(D.p);
  const pc=await D.p.evaluate(async()=>{goTo('investors');openInvMonth(invModel().months[0]);await new Promise(r=>setTimeout(r,200));
    const r={table:!!document.querySelector('#imBody .tbl-wrap').offsetParent,cards:!!document.querySelector('#imBody .im-cards').offsetParent};closeM('mInvMonth');goTo('dashboard');
    r.btn=Math.round(document.querySelector('#page-dashboard .pa .btn').getBoundingClientRect().height);
    const i=document.querySelector('link[rel="apple-touch-icon"]');r.icon=i&&i.getAttribute('href');r.theme=!!document.querySelector('meta[name="theme-color"]');return r;});
  check('окно месяца инвесторов на компьютере — таблица',pc.table&&!pc.cards,pc);
  check('кнопки на компьютере — 36 px',pc.btn===36,pc);
  const ic=await fetch(new URL(pc.icon||'x',URL_CRM)).then(r=>({ok:r.ok,type:r.headers.get('content-type')})).catch(e=>({ok:false,e:String(e)}));
  check('есть иконка для экрана «Домой» (PNG 180×180) и цвет верхней полосы',ic.ok&&ic.type==='image/png'&&pc.theme,{pc,ic});
  const tc=await D.p.evaluate(()=>{applyTheme('light');const l=document.querySelector('meta[name="theme-color"]').content;applyTheme('dark');return[l,document.querySelector('meta[name="theme-color"]').content];});
  check('цвет верхней полосы меняется вместе с темой',tc[0]!==tc[1],tc);
  noErrors('дизайн, компьютер',D.errs);await D.ctx.close();
}
