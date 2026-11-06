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
    if(e.matches('.mcard,.kcard,.deal-card,.crow,.pr,.cphhdr,.inv-end-row,.gs-it,.sc,.card,.dsh-col,.inv-bc,.chx-col,.im-card,.mover,.modal'))return;
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
    const vis=[...a.querySelectorAll('.btn')].filter(b=>b.offsetParent);
    const more=a.querySelector('details.cd-more');more.open=true;const mi=[...more.querySelectorAll('.cd-mi')].filter(x=>x.offsetParent).map(x=>x.textContent.trim());
    const call=a.querySelector('.cd-call'),wa=a.querySelector('.cd-wa'),sum=more.querySelector('summary');
    const r={main:vis.filter(b=>b.classList.contains('bg')).length,call:!!call&&/tel:/.test(call.getAttribute('href')||''),wa:!!wa&&/openChat/.test(wa.getAttribute('onclick')),
      sameRow:!!call&&!!wa&&Math.abs(call.getBoundingClientRect().top-wa.getBoundingClientRect().top)<2,h:[call,wa,sum].map(x=>x?Math.round(x.getBoundingClientRect().height):0),mi,
      del:mi.includes('Удалить'),hasMoney:clientHasMoney('c0'),loose:vis.filter(b=>/^(Скидка|Комментарий|Изменить|В архив)$/.test(b.textContent.trim())).length};more.open=false;return r;});
  check('карточка сделки: «+ Оплата», рядом «Позвонить» и WhatsApp (просто чат), остальное — в «Ещё»',cd.main===1&&cd.call&&cd.wa&&cd.sameRow&&cd.loose===0&&['Скидка','Комментарий','Изменить','В архив'].every(x=>cd.mi.includes(x)),cd);
  check('«Удалить» в меню, только если договор можно удалить; кнопки не ниже 44 px',cd.del===!cd.hasMoney&&cd.h.every(h=>h>=44),cd);

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
  // UI-аудит: числа и телефоны не рвутся, поручители столбиком, пустая выбранная колонка видна, «Счёт» вместо «Кошелёк»
  const ua=await p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));const r={};
    r.fmt=!/ /.test(fmt(1234567.5))&&!/ /.test(fmtPhone('89281234567'));
    const P=S.persons.slice(0,3),c={...S.clients.find(x=>x.id==='c0'),guarantors:[{name:P[1].name,pid:P[1].id},{name:P[2].name,pid:P[2].id}]};
    const box=document.createElement('div');box.innerHTML=CARD_F.gname.v(c);r.gs=box.querySelectorAll('.mcard-gs>span').length;
    S.ui.pcols=[{k:'no',on:true},{k:'note',on:true}];goBase('people');await sl(250);
    const card=document.querySelector('.ppl-mob .mcard');r.noteRow=!!card&&[...card.querySelectorAll('.mcard-label')].some(l=>/Заметка/.test(l.textContent));
    goTo('kassa');openKassaOp();await sl(150);r.lbl=document.getElementById('koWalletLbl').textContent;closeM('mKassa');
    openC('c0');await sl(250);r.tel=[...document.querySelectorAll('#cDetail .cd-call')].map(a=>Math.round(a.getBoundingClientRect().height));
    // в шапке договора нет сырых номеров в одной строке с датой
    r.meta=!!document.querySelector('#cDetail .cd-meta');
    return r;});
  check('UI-аудит: суммы и телефоны с неразрывными пробелами, поручители — каждый своей строкой',ua.fmt&&ua.gs===2,ua);
  check('UI-аудит: выбранная колонка «Заметка» видна в карточке клиента даже пустой; в кассе «Счёт», а не «Кошелёк»',ua.noteRow&&ua.lbl==='Счёт',ua);
  check('UI-аудит: шапка договора — номер, дата, статус отдельной строкой, телефоны — кнопки не меньше 44 px',ua.meta&&ua.tel.length>0&&ua.tel.every(h=>h>=44),ua);
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

  // --- графики: один вид на Дашборде, в Обзоре и у Инвесторов
  const ch=await D.p.evaluate(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms)),out={};
    goTo('dashboard');await sl(200);const a=document.getElementById('dshArea'),tip=document.getElementById('dshTip');
    out.dashRest=getComputedStyle(tip).visibility;out.dashTxt=!!tip.textContent;out.glow=getComputedStyle(a.querySelector('svg .ln')).filter;
    const r=a.getBoundingClientRect();a.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:r.left+r.width/2,clientY:r.top+40,bubbles:true}));await sl(200);
    out.dashHover=getComputedStyle(tip).visibility;a.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse',bubbles:false}));await sl(200);out.dashLeave=getComputedStyle(tip).visibility;
    out.dashLegBelow=document.querySelector('.dsh-leg').getBoundingClientRect().top>=a.getBoundingClientRect().bottom;
    // пустые плитки: подпись вместо пустого места
    out.empty=[...document.querySelectorAll('#dStats .kt-empty .kt-msg')].map(x=>x.textContent);
    // Обзор
    S.finTab='sum';goTo('finance');await sl(250);const c=document.querySelector('#finBody .chx');
    out.finTicks=c.querySelectorAll('.chx-y span').length;out.finLegBelow=c.querySelector('.chx-leg').getBoundingClientRect().top>=c.querySelector('.chx-area').getBoundingClientRect().bottom;
    out.finBarW=Math.max(...[...c.querySelectorAll('.chx-b')].map(b=>b.getBoundingClientRect().width));
    const g=c.querySelector('.chx-grid'),gs=getComputedStyle(g);out.grid=gs.borderTopWidth+' '+gs.borderTopStyle;
    out.colors=['b-plan','b-fact','b-net'].map(k=>getComputedStyle(c.querySelector('.chx-b.'+k)).backgroundImage);
    out.negDown=[...c.querySelectorAll('.chx-b.neg')].every(b=>b.style.top&&!b.style.bottom);
    const col=c.querySelectorAll('.chx-col')[2],cr=col.getBoundingClientRect();
    col.dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',clientX:cr.left+2,clientY:cr.top+50,bubbles:true}));await sl(150);
    const t=document.getElementById('chxTip');out.finTip=t.classList.contains('on')&&/План по графику/.test(t.textContent)&&getComputedStyle(t).visibility==='visible';
    document.body.dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',bubbles:true}));await sl(150);out.finTipHide=!t.classList.contains('on');
    // Инвесторы
    goTo('investors');setInvTab('months',document.querySelectorAll('#invTabs .ft')[1]);await sl(250);const iv=document.querySelector('.chx-inv');
    out.inv=!!iv&&iv.querySelectorAll('.chx-y span').length>=3&&!!iv.querySelector('.chx-vl')&&/openInvMonth/.test(iv.querySelector('.chx-col').getAttribute('onclick')||'');
    out.invColor=iv&&getComputedStyle(iv.querySelector('.chx-b.b-fact')).backgroundImage;
    out.oldStyles=!!document.querySelector('.inv-bars,.dsh-bars');
    return out;});
  check('Дашборд: подсказка графика видна сразу и следует за курсором, линия со свечением',ch.dashRest==='visible'&&ch.dashTxt&&ch.dashHover==='visible'&&ch.dashLeave==='visible'&&/drop-shadow/.test(ch.glow),ch);
  check('графики: легенда под графиком, ось с подписями, тонкая сплошная сетка',ch.dashLegBelow&&ch.finLegBelow&&ch.finTicks>=3&&ch.grid==='1px solid',ch);
  check('графики: столбики не толще 24 px, минус — вниз от нуля, цвета рядов разные',ch.finBarW<=24&&ch.negDown&&new Set(ch.colors).size===3&&ch.colors.every(c=>/gradient/.test(c)),ch);
  check('Обзор: подсказка у столбиков по наведению',ch.finTip&&ch.finTipHide,ch);
  check('Инвесторы: график в том же стиле — ось, подписи, нажатие открывает месяц, тот же зелёный',ch.inv&&ch.invColor===ch.colors[1]&&!ch.oldStyles,ch);
  check('Дашборд: пустые плитки с подписью вместо пустого места',ch.empty.length>=1&&ch.empty.every(x=>x.length>10),ch.empty);
  noErrors('дизайн, компьютер',D.errs);await D.ctx.close();

  // --- телефон: подсказка по нажатию, график не шире экрана
  const T=await device({vp:{width:390,height:844},mobile:true});await login(T.p);
  await T.p.evaluate(async()=>{S.finTab='sum';goTo('finance');await new Promise(r=>setTimeout(r,250));document.querySelector('#finBody .chx').scrollIntoView();});await wait(T.p,200);
  const box=await T.p.evaluate(()=>{const c=document.querySelectorAll('#finBody .chx-col')[3].getBoundingClientRect();return{x:c.left+c.width/2,y:c.top+c.height/2};});
  await T.p.touchscreen.tap(box.x,box.y);await wait(T.p,200);
  const tp1=await T.p.evaluate(()=>({on:document.getElementById('chxTip').classList.contains('on'),r:document.getElementById('chxTip').getBoundingClientRect().right,w:innerWidth,wide:document.documentElement.scrollWidth}));
  await T.p.touchscreen.tap(20,20);await wait(T.p,200);
  const tp2=await T.p.evaluate(()=>document.getElementById('chxTip').classList.contains('on'));
  check('телефон: подсказка у столбиков по нажатию, в пределах экрана, прячется нажатием мимо',tp1.on&&tp1.r<=tp1.w&&tp1.wide<=tp1.w&&!tp2,{tp1,tp2});
  noErrors('дизайн, телефон: графики',T.errs);await T.ctx.close();
}
