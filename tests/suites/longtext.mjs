// Длинный текст без пробелов (комментарий, адрес, товар, заметка, описание в кассе) не растягивает страницу:
// на телефоне и ПК страница не шире экрана, блоки не вылезают за свои края.
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
const W='оаоаавлвлвлвлчлчдчлччлчллчлвлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлчлч';
function stuff(W){
  const c=S.clients.find(x=>!x.archived&&getStats(x).balance>0);
  c.comment=W;c.commentDate='07.11.2026';c.addr=W;c.product=W;c.partner=W;
  const p=S.persons.find(x=>x.id===c.clientPid)||S.persons[0];p.note=W;p.addr=W;
  S.kassaOps.slice(0,3).forEach(k=>{k.desc=W;});
  S.payments.filter(x=>x.clientId===c.id).forEach(x=>{x.note=W;});
  if(S.inv[1])S.inv[1].note=W;
  return{cid:c.id,pid:p.id};
}
const over=()=>{const vw=document.documentElement.clientWidth,pg=[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none'&&x.offsetParent);
  const bad=[];if(document.documentElement.scrollWidth>vw+1)bad.push('страница шире экрана: '+document.documentElement.scrollWidth+' > '+vw);
  // блоки с текстом не вылезают за край своей карточки (таблицы с прокруткой внутри — можно)
  (pg?pg.querySelectorAll('.card,.sc,.mcard,.kcard,.cd-cmt,.ii,.cd-head'):[]).forEach(e=>{if(!e.offsetParent||e.closest('.tbl-wrap')||/auto|scroll/.test(getComputedStyle(e).overflowX))return;if(e.scrollWidth>e.clientWidth+2)bad.push((e.className||e.tagName).toString().slice(0,30)+' '+e.scrollWidth+'>'+e.clientWidth);});
  return bad.slice(0,5);};
export default async function(){
  await reseed();
  for(const [label,o] of [['телефон',{vp:{width:390,height:844},mobile:true}],['ПК',{vp:{width:1280,height:850}}]]){
    const {p,errs,ctx}=await device(o);await login(p);
    const ids=await p.evaluate(stuff,W);
    const pages=[['сделка',`openC('${ids.cid}');document.querySelectorAll('#cDetail .cphbody').forEach(b=>b.classList.add('on'))`],['карточка клиента',`openPerson('p:${ids.pid}')`],
      ['сделки',`goBase('clients');renderClients()`],['клиенты',`goBase('people')`],['контроль платежей',`goBase('reminders')`],['касса',`goTo('kassa')`],['инвестор',`openInv('INV1')`]];
    const bad=[];
    for(const [n,js] of pages){await p.evaluate(js);await wait(p,300);const b=await p.evaluate(over);if(b.length)bad.push(n+': '+b.join('; '));}
    check(label+': длинный текст без пробелов не растягивает страницу и не вылезает из блоков',!bad.length,bad);
    noErrors('длинный текст, '+label,errs);await ctx.close();
  }
}
