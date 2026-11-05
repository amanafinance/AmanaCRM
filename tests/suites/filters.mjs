// Фильтры и раскрывающиеся блоки: пустой результат не прячет фильтры, сброс одного столбца не трогает другие,
// вкладка «С просрочкой» и фильтры на всех столбцах сделок, блоки свёрнуты после входа, вкладка «Безопасность».
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  // 1. Клиенты: фильтр без результатов — заголовки и «Сбросить фильтры» на месте
  const r1=await p.evaluate(()=>{goBase('people');S.PF={addr:{q:'нет такого адреса'}};renderPeople();
    const th=document.querySelectorAll('#pplList .ppl-desk thead .th-cell').length,btn=[...document.querySelectorAll('#pplList button')].find(b=>/Сбросить фильтры/.test(b.textContent));
    if(btn)btn.click();return{th,btn:!!btn,after:Object.keys(S.PF).length,rows:document.querySelectorAll('#pplList .ppl-desk tbody tr').length};});
  check('клиенты: при пустом результате заголовки с фильтрами остаются, есть «Сбросить фильтры»',r1.th>1&&r1.btn,r1);
  check('клиенты: «Сбросить фильтры» возвращает список',r1.after===0&&r1.rows>10,r1);
  // 1б. «№ клиента» ищет только нынешний номер, а не номер до перенумерации
  const rn=await p.evaluate(()=>{goBase('people');const ps=S.persons.filter(x=>x.no).slice(0,2),a=ps[0],b=ps[1],was=b.oldNo;b.oldNo=a.no;
    S.PF={no:{q:a.no}};renderPeople();const rows=[...document.querySelectorAll('#pplList .ppl-desk tbody tr')].map(r=>r.textContent);
    b.oldNo=was;S.PF={};renderPeople();return{n:rows.length,a:a.no,b:b.no,hasA:rows.some(t=>t.includes(a.no)),hasB:rows.some(t=>t.includes(b.no))};});
  check('клиенты: фильтр «№ клиента» не находит клиента по старому номеру',rn.n===1&&rn.hasA&&!rn.hasB,rn);
  // 2. Сделки: «Сбросить» в одном столбце не трогает фильтр другого
  const r2=await p.evaluate(()=>{goBase('clients');S.CF={...CF_EMPTY,product:'Товар 1',name:'Клиент 1'};renderClients();
    toggleDrop({stopPropagation(){}},'product','clients',document.querySelector('#cList th .th-cell'));document.getElementById('fdo_reset').click();
    return{product:S.CF.product,name:S.CF.name};});
  check('сделки: сброс фильтра «Товар» оставляет фильтр «Клиент»',r2.product===''&&r2.name==='Клиент 1',r2);
  // 3. Вкладка «С просрочкой» и фильтры на новых столбцах
  const r3=await p.evaluate(()=>{S.CF={...CF_EMPTY};const b=[...document.querySelectorAll('#page-clients .ft')].find(x=>/просрочкой/.test(x.textContent));b.click();
    const n=parseInt(document.getElementById('cCount').textContent),exp=S.clients.filter(c=>!c.archived&&getStats(c).overdue>0.004).length;
    const base=S.clients.filter(c=>!c.archived).map(c=>{const s=getStats(c);return{...c,_st:effStatus(c,s),_bal:s.balance,_over:s.overdue,_mi:getMonthlyInfo(c),_s:s};});
    const all=filterClientList(base,{}).length;
    const fin=filterClientList(base,{x_status:{q:'завершён'}}),act=filterClientList(base,{x_status:{q:'активный'}});
    const price=filterClientList(base,{x_price:{from:'70000',to:'80000'}}),okP=price.every(c=>c.price>=70000&&c.price<=80000);
    const g=filterClientList(base,{x_gname:{q:'Клиент 1'}}),okG=g.every(c=>guarList(c).some(x=>/клиент 1/i.test(x.name)));
    const withF=Object.keys(CL_COLS).filter(k=>CL_COLS[k].f).length,total=Object.keys(CL_COLS).length;
    return{tab:b.classList.contains('on'),n,exp,all,fin:fin.length,act:act.length,price:price.length,okP,g:g.length,okG,withF,total};});
  check('сделки: вкладка «С просрочкой» показывает договоры с просрочкой',r3.tab&&r3.n===r3.exp&&r3.exp>0,r3);
  check('сделки: фильтры есть на всех столбцах',r3.withF===r3.total,r3);
  check('сделки: фильтр «Статус» делит договоры на активные и завершённые',r3.fin+r3.act===r3.all&&r3.act>0,r3);
  check('сделки: фильтр «Цена от–до» и «Поручитель» работают',r3.price>0&&r3.okP&&r3.g>0&&r3.okG,r3);
  // 4. Раскрывающиеся блоки свёрнуты после входа (даже при расхождениях), раскрытое держится до перезахода
  const r4=await p.evaluate(async()=>{const w=S.wallets[0];w.balance+=5;goTo('kassa');renderRecon();await new Promise(r=>setTimeout(r,200));
    const a={recon:document.getElementById('kRecon').open,check:document.getElementById('kCheck').open};document.getElementById('kRecon').open=true;
    goTo('dashboard');goTo('kassa');a.kept=document.getElementById('kRecon').open;w.balance-=5;return a;});
  check('касса: «Сверка касс» и «Проверка базы» свёрнуты, даже если есть расхождение',!r4.recon&&!r4.check,r4);
  check('касса: раскрытое остаётся раскрытым при переходах между вкладками',r4.kept,r4);
  await p.reload();await login(p,{again:true});
  const r5=await p.evaluate(()=>({recon:document.getElementById('kRecon').open,menu:localStorage.getItem('menuMoneyExpanded')}));
  check('после перезахода всё снова свёрнуто',!r5.recon&&!r5.menu,r5);
  // 5. Вкладка «Безопасность»: сотрудники и копия там, «Справочники» — без них
  const r6=await p.evaluate(()=>{goTo('security');const sec=document.getElementById('page-security');const a={bk:sec.contains(document.getElementById('bkCard')),staff:sec.contains(document.getElementById('staffCard')),title:sec.querySelector('.pt').textContent,nav:document.getElementById('nav-security').classList.contains('on')};
    goTo('settings');const st=document.getElementById('page-settings');a.stTitle=st.querySelector('.pt').textContent;a.stHasBk=!!st.querySelector('#bkCard');a.navName=document.getElementById('nav-settings').textContent.trim();return a;});
  check('«Безопасность»: здесь сотрудники и резервная копия',r6.bk&&r6.staff&&r6.title==='Безопасность'&&r6.nav,r6);
  check('«Настройки» теперь «Справочники», без копии и сотрудников',r6.stTitle==='Справочники'&&!r6.stHasBk&&r6.navName==='Справочники',r6);
  // 7. Повторный клиент — значок у имени вместо надписи; под сроком нет даты WhatsApp
  const rp=await p.evaluate(()=>{const c=S.clients.find(x=>!x.archived&&findDups(x.name,x.id).length);S.CF={...CF_EMPTY,name:c.name};goBase('clients');renderClients();
    const row=document.querySelector('#cList tbody tr'),ic=row&&row.querySelector('.rep-ic'),nm=ic&&ic.closest('.nm-end');
    const r={icon:!!ic,label:ic&&ic.getAttribute('aria-label'),word:!!document.querySelector('#cList .rbadge')||/Повторный<\/span>/.test(row.innerHTML),glued:!!nm};
    S.CF={...CF_EMPTY};renderClients();goTo('dashboard');r.wa=document.body.innerHTML.includes('WhatsApp: ');return r;});
  check('сделки: у повторного клиента значок рядом с именем, без надписи «Повторный»',rp.icon&&rp.glued&&!rp.word&&/договоров — \d/.test(rp.label),rp);
  check('под сроком платежа нет даты отправки в WhatsApp',!rp.wa,rp);
  // 8. Касса: по описанию оплаты клиента открывается его сделка, «Назад» возвращает в кассу
  const kd=await p.evaluate(async()=>{goTo('kassa');renderKassa();await new Promise(r=>setTimeout(r,200));
    const el=document.querySelector('#kList tbody .k-deal');if(!el)return{none:true};const tr=el.closest('tr'),op=S.kassaOps.find(o=>tr.textContent.includes(o.desc));
    el.click();const r={client:pageOn('client'),cur:S.curClient,want:op&&op.refId};document.querySelector('#page-client .bback').click();r.back=pageOn('kassa');
    const c=S.clients[5],fake={desc:'Оплата от '+c.name+' (№'+c.contractId+')'};r.byDesc=kOpClient(fake)===c.id;r.other=kOpClient({desc:'Аренда',refType:''})==='';
    r.plain=[...document.querySelectorAll('#kList tbody tr')].some(x=>!x.querySelector('.k-deal')&&x.children.length>5);return r;});
  check('касса: нажатие на «Оплата от …» открывает сделку клиента, «Назад» — обратно в кассу',kd.client&&kd.cur&&kd.cur===kd.want&&kd.back,kd);
  check('касса: старые записи находят сделку по номеру в описании, прочие операции — без ссылки',kd.byDesc&&kd.other,kd);
  noErrors('фильтры и блоки',errs);await ctx.close();
  // 6. Телефон: нижняя панель без наложений, «Безопасность» — в «Ещё»; окна «Фильтры» со всеми столбцами
  const M=await device({mobile:true,vp:{width:390,height:844}});await login(M.p);
  const m1=await M.p.evaluate(()=>{const vis=[...document.querySelectorAll('.sidebar > div > .nb')].filter(b=>b.offsetParent!==null&&getComputedStyle(b).display!=='none');
    const clip=vis.filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.textContent.trim());
    const secMain=vis.some(b=>b.id==='nav-security'),secMore=!!document.getElementById('nav-security2');return{n:vis.length,names:vis.map(b=>b.textContent.trim()),clip,secMain,secMore};});
  check('телефон: «Безопасность» не в нижней панели, а в «Ещё»',!m1.secMain&&m1.secMore,m1);
  check('телефон: подписи нижней панели не наезжают друг на друга',m1.clip.length===0&&m1.n<=5,m1);
  const m2=await M.p.evaluate(()=>{goBase('people');openPplFilter();const ids=[...document.querySelectorAll('#mfOver input')].map(i=>i.id);
    document.getElementById('pflt_active_from').value='1';document.getElementById('pflt_note').value='';applyPplFilter();const pf=JSON.parse(JSON.stringify(S.PF));S.PF={};renderPeople();
    goBase('clients');openMobileFilter('clients');const dids=[...document.querySelectorAll('#mfOver input,#mfOver select')].map(i=>i.id);
    document.getElementById('mf_xnext_from').value='1';applyMobileFilter('clients');const cf=S.CF.x_next;S.CF={...CF_EMPTY};return{ids,pf,dids,cf};});
  const needP=['pflt_name','pflt_no','pflt_phone','pflt_addr','pflt_note','pflt_deals_from','pflt_active_from','pflt_done_from','pflt_debt_from','pflt_over_from'];
  check('телефон: в фильтрах клиентов есть все столбцы, фильтр применяется',needP.every(x=>m2.ids.includes(x))&&m2.pf.active&&m2.pf.active.from==='1',{miss:needP.filter(x=>!m2.ids.includes(x)),pf:m2.pf});
  const needD=['mf_xstatus','mf_xgname','mf_xcomment','mf_xnext_from','mf_xpaid_from','mf_xlastpay_from','mf_xprepay_from','mf_xcost_from','mf_xmargin_from'];
  check('телефон: в фильтрах сделок есть новые столбцы, фильтр применяется',needD.every(x=>m2.dids.includes(x))&&m2.cf&&m2.cf.from==='1',{miss:needD.filter(x=>!m2.dids.includes(x)),cf:m2.cf});
  // ввод ФИО в окне «Фильтры» по-настоящему (набор и нажатия), как на iPhone
  await M.p.evaluate(()=>goBase('people'));await wait(M.p,300);
  await M.p.click('#page-people .mobile-filter-btn');await M.p.waitForSelector('#mfOver');
  await M.p.fill('#mfOver #pflt_name','Клиент 12');await M.p.click('#mfOver button:has-text("Применить")');await wait(M.p,400);
  const nm=await M.p.evaluate(()=>({q:S.PF.name&&S.PF.name.q,shown:document.querySelectorAll('#pplList .ppl-mob .mcard').length,names:[...document.querySelectorAll('#pplList .ppl-mob .mcard-name')].map(x=>x.textContent)}));
  check('телефон: фильтр по ФИО находит клиентов',nm.q==='Клиент 12'&&nm.shown>0&&nm.shown<150&&nm.names.every(n=>/клиент 12/i.test(n)),nm);
  await M.p.evaluate(()=>{S.PF={};renderPeople();});
  // ни у каких двух полей нет одного имени: из-за такого совпадения фильтр ФИО читал поле карточки клиента
  const dup=await M.p.evaluate(()=>{const res=[];const scan=n=>{const m={};document.querySelectorAll('[id]').forEach(e=>{m[e.id]=(m[e.id]||0)+1;});Object.keys(m).filter(k=>m[k]>1).forEach(k=>res.push(n+': '+k));};
    scan('страница');openPplFilter();scan('фильтры клиентов');closeMobileFilter();goBase('clients');openMobileFilter('clients');scan('фильтры сделок');closeMobileFilter();return res;});
  check('нигде нет двух полей с одинаковым именем',!dup.length,dup);
  // касса на телефоне: нажатие на карточку оплаты открывает сделку
  await M.p.evaluate(()=>goTo('kassa'));await wait(M.p,400);
  await M.p.locator('#kList .kcards .kcard-link .kcard-bot').first().click();await wait(M.p,300);
  check('телефон: из кассы по оплате переходит в сделку клиента',await M.p.evaluate(()=>pageOn('client')&&!!S.curClient));
  noErrors('телефон',M.errs);await M.ctx.close();
}
