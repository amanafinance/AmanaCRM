// Все страницы и окна открываются без ошибок и не вылезают за экран (ПК и телефон, обе темы)
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
const PAGES=[
 ['Дашборд',()=>goTo('dashboard')],['Показатели',()=>goTo('finance')],['Клиенты',()=>goBase('people')],['Карточка клиента',()=>openPerson('p:P0')],
 ['Сделки',()=>{goBase('clients');renderClients();}],['Карточка сделки',()=>openC('c0')],['Контроль платежей',()=>goBase('reminders')],['Касса',()=>goTo('kassa')],
 ['Инвесторы',()=>goTo('investors')],['Инвестор',()=>openInv('INV1')],['История',()=>goTo('journal')],['Настройки',()=>goTo('settings')],
 ['Окно: новый договор',()=>{goTo('dashboard');openNew();}],['Окно: оплата',()=>{openC('c0');openPay('c0');}],['Окно: клиент',()=>{goBase('people');openPersonForm('p:P0');}],
 ['Окно: отсрочка',()=>{openC('c0');openDefer('c0',6);}],['Окно: операция кассы',()=>{goTo('kassa');openKassaOp();}],['Окно: вклад',()=>{openInv('INV1');openInvOp('deposit','INV1');}],
 ['Окно: вид',()=>{goBase('clients');openView(window.innerWidth<=768?'card':'cols');}],['Окно: месяц инвесторов',()=>{goTo('investors');openInvMonth(invModel().months[0]);}],
];
export default async function(){
  await reseed();
  for(const [label,o] of [['ПК',{vp:{width:1280,height:850}}],['телефон',{vp:{width:390,height:844},mobile:true}]]){
    const {p,errs,ctx}=await device(o);await login(p);
    for(const theme of ['dark','light']){
      await p.evaluate(t=>{try{localStorage.setItem('amana_theme',t);}catch(e){}applyTheme(t);},theme);
      const over=[];
      for(const [name,fn] of PAGES){
        await p.evaluate(()=>{document.querySelectorAll('.mover.on').forEach(m=>m.classList.remove('on'));document.getElementById('confirmLayer').innerHTML='';});
        await p.evaluate(fn);await wait(p,name==='История'?700:200);
        if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))over.push(name);
      }
      check(label+', '+(theme==='dark'?'тёмная':'светлая')+' тема: ни одна страница не вылезает за экран',!over.length,over);
    }
    noErrors(label,errs);
    await ctx.close();
  }
}
