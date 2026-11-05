// Все страницы и окна открываются без ошибок и не вылезают за экран (ПК и телефон, обе темы)
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
export const PAGES=[
 ['Дашборд',()=>goTo('dashboard')],['Показатели',()=>goTo('finance')],['Клиенты',()=>goBase('people')],['Карточка клиента',()=>openPerson('p:P0')],
 ['Сделки',()=>{goBase('clients');renderClients();}],['Карточка сделки',()=>openC('c0')],['Контроль платежей',()=>goBase('reminders')],['Касса',()=>goTo('kassa')],
 ['Инвесторы',()=>goTo('investors')],['Инвестор',()=>openInv('INV1')],['История',()=>goTo('journal')],['Безопасность',()=>goTo('security')],['Настройки',()=>{if(!S.partners.includes('Иса кирпич строймаркет')){S.partners.push('Иса кирпич строймаркет');S.partnerPhones['Иса кирпич строймаркет']='89290000034';}goTo('settings');}],
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
        const wide=await p.evaluate(()=>{if(document.documentElement.scrollWidth>innerWidth+1)return'страница шире экрана';
          const W=innerWidth,sc=document.querySelector('.mover.on .modal')||[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none'&&x.offsetParent);if(!sc)return'';
          for(const e of sc.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.width||!r.height||r.right<=W+1)continue;
            let a=e.parentElement,ok=false;while(a&&a!==document.body){const o=getComputedStyle(a).overflowX;if(o==='auto'||o==='scroll'){ok=true;break;}a=a.parentElement;}
            if(!ok)return(e.id||String(e.className).slice(0,30)||e.tagName)+' до '+Math.round(r.right)+'px';}return'';});
        if(wide)over.push(name+': '+wide);
      }
      check(label+', '+(theme==='dark'?'тёмная':'светлая')+' тема: ни одна страница не вылезает за экран',!over.length,over);
    }
    noErrors(label,errs);
    await ctx.close();
  }
}
