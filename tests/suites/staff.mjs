// Сотрудники и права (свой сервер): владелец заводит сотрудника, выбирает набор и галочки;
// у сотрудника скрыты чужие разделы и кнопки, а сервер не выполняет действия без права и не отдаёт скрытые данные.
import {reseed,device,login,check,noErrors,wait,autoConfirm,BACKEND,URL_CRM} from '../lib.mjs';
async function loginAs(p,email,pw){
  await p.goto(URL_CRM);await wait(p,800);
  await p.fill('#lemail',email);await p.fill('#lpass',pw);await p.click('#loginFields button');
  await p.waitForFunction(()=>typeof S!=='undefined'&&S.clients.length>0&&S.wallets.length>0,null,{timeout:90000});await wait(p,1500);
}
const vis=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return!!e&&getComputedStyle(e).display!=='none'&&e.offsetParent!==null;},sel);
export default async function(){
  await reseed();
  const O=await device();await login(O.p);await autoConfirm(O.p);
  if(BACKEND!=='pb'){
    await O.p.evaluate(()=>goTo('settings'));await wait(O.p,300);
    check('старая база: раздела «Сотрудники» нет',!(await vis(O.p,'#staffCard')));
    noErrors('сотрудники (Firebase)',O.errs);await O.ctx.close();return;
  }
  // 1. Владелец: раздел есть, готовый набор ставит галочки, зависимые права ставятся сами
  await O.p.evaluate(()=>goTo('settings'));await O.p.waitForSelector('#staffBody .st-row',{timeout:20000});
  check('владелец видит раздел «Сотрудники и права», себя в списке',/это вы/.test(await O.p.textContent('#staffBody')));
  await O.p.click('#staffBody button:has-text("+ Сотрудник")');await O.p.waitForSelector('#mStaff.on');
  const pre=await O.p.evaluate(()=>{const on=()=>[...document.querySelectorAll('#stPerms input:checked')].map(b=>b.dataset.k).sort().join();
    stPreset('manager');const m=on();stPreset('owner');const own=[...document.querySelectorAll('#stPerms input')].every(b=>b.checked&&b.disabled);
    stPreset('');document.querySelectorAll('#stPerms input').forEach(b=>{b.disabled=false;b.checked=false;});
    const dn=document.querySelector('#stPerms input[data-k="deal_new"]');dn.checked=true;staffCk(dn);const dep=on();
    const vc=document.querySelector('#stPerms input[data-k="v_cost"]');vc.checked=false;staffCk(vc);const undep=on();
    return{m,own,dep,undep,groups:document.querySelectorAll('#stPerms .st-g').length,boxes:document.querySelectorAll('#stPerms input').length};});
  check('набор «Менеджер» ставит свои галочки',pre.m==='deal_arch,deal_edit,deal_new,disc,pay,people,v_cost',pre.m);
  check('набор «Владелец» — все права',pre.own);
  check('«Создавать договоры» сам включает «себестоимость» и «клиенты»; без себестоимости договоры выключаются',pre.dep==='deal_new,people,v_cost'&&pre.undep==='people',pre);
  check('20 прав в 5 группах',pre.boxes===20&&pre.groups===5,pre);
  // кассир: оплаты и касса, без договоров, себестоимости, инвесторов, истории
  await O.p.fill('#stName','Кассир Тест');await O.p.fill('#stEmail','kassa@test.ru');await O.p.fill('#stPw','kassa12345');
  await O.p.selectOption('#stPreset','cashier');await O.p.click('#stSave');
  await O.p.waitForFunction(()=>!document.getElementById('mStaff').classList.contains('on'),null,{timeout:20000});await wait(O.p,800);
  const lst=await O.p.textContent('#staffBody');
  check('сотрудник добавлен в список с набором «Кассир»',/Кассир Тест/.test(lst)&&/Кассир · 4 права/.test(lst),lst.slice(0,300));

  // 2. Сотрудник: видит только своё
  const K=await device();await loginAs(K.p,'kassa@test.ru','kassa12345');
  const st=await K.p.evaluate(()=>({perms:window.AUTH.perms,inv:S.inv.length,cost:S.clients.filter(c=>c.cost!==undefined).length,page:['dashboard','clients','kassa'].find(x=>pageOn(x))}));
  check('сотруднику не приходят инвесторы и себестоимость',st.inv===0&&st.cost===0,st);
  check('без права на дашборд открывается «База»',st.page!=='dashboard',st);
  const nav={dash:await vis(K.p,'#nav-dashboard'),inv:await vis(K.p,'#nav-investors'),jr:await vis(K.p,'#nav-journal'),kassa:await vis(K.p,'#nav-kassa')};
  check('в меню нет дашборда, инвесторов и истории; касса есть',!nav.dash&&!nav.inv&&!nav.jr&&nav.kassa,nav);
  await K.p.evaluate(()=>goBase('clients'));await wait(K.p,400);
  check('нет кнопки «Новый договор»',!(await K.p.evaluate(()=>[...document.querySelectorAll('[onclick^="openNew("]')].some(b=>b.offsetParent!==null))));
  const blocked=await K.p.evaluate(async()=>{const r={};const t=document.getElementById('toast');openNew();await new Promise(x=>setTimeout(x,100));r.toast=t.textContent;r.modal=document.getElementById('mClient').classList.contains('on');
    try{await window.DB.addDoc(window.DB.collection(window.DB.db,'payments'),{clientId:'c1',amount:5,type:'discount'});r.disc='ok';}catch(e){r.disc=e.message;}
    try{await window.DB.updateDoc(window.DB.doc(window.DB.db,'clients','c1'),{price:1});r.edit='ok';}catch(e){r.edit=e.message;}
    goTo('investors');r.invPage=pageOn('investors');return r;});
  check('вызов без права — понятное сообщение, окно не открывается',/Нет права/.test(blocked.toast)&&!blocked.modal,blocked);
  check('сервер не даёт сделать скидку и править договор без права',/Нет права/.test(blocked.disc)&&/Нет права/.test(blocked.edit),blocked);
  check('страница инвесторов не открывается',!blocked.invPage);
  const pay=await K.p.evaluate(async()=>{const c=S.clients.find(x=>x.id==='c3');_cid=c.id;const n=S.payments.length;await savePay(777,'w1');await new Promise(r=>setTimeout(r,1500));return{was:n,now:S.payments.length,has:S.payments.some(x=>x.amount===777)};});
  check('кассир принимает оплату',pay.has&&pay.now===pay.was+1,pay);
  await K.p.evaluate(()=>goTo('settings'));await wait(K.p,300);
  check('кассиру не виден раздел «Сотрудники» и настройки',!(await vis(K.p,'#staffCard'))&&!(await vis(K.p,'#walletList'))&&!(await vis(K.p,'#nav-settings')));

  // 3. Владелец отключает вход — у сотрудника всё перестаёт работать
  await O.p.evaluate(()=>{_staffAt=0;renderStaff();});await wait(O.p,1200);
  await O.p.evaluate(()=>{const u=_staff.list.find(x=>x.email==='kassa@test.ru');staffToggle(u.id);});await wait(O.p,1500);
  check('в списке отмечено «вход отключён»',/вход отключён/.test(await O.p.textContent('#staffBody')));
  const off=await K.p.evaluate(async()=>{try{await window.DB.updateDoc(window.DB.doc(window.DB.db,'clients','c3'),{comment:'x'});return'ok';}catch(e){return e.code||e.message;}});
  check('отключённый сотрудник больше ничего не сохраняет',off!=='ok',off);
  const K2=await device();await K2.p.goto(URL_CRM);await wait(K2.p,800);
  await K2.p.fill('#lemail','kassa@test.ru');await K2.p.fill('#lpass','kassa12345');await K2.p.click('#loginFields button');await wait(K2.p,2500);
  check('отключённый сотрудник не может войти',await K2.p.isVisible('#lerr'));
  noErrors('владелец',O.errs);
  await O.ctx.close();await K.ctx.close();await K2.ctx.close();
}
