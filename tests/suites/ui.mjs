// Интерфейс: перетаскивание колонок, телефоны поставщиков, проверка базы на странице кассы
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  // перетаскивание колонок мышью
  await p.evaluate(()=>openView('cols'));await wait(p,300);
  const names=()=>p.$$eval('#vwList .vw-row span',a=>a.map(x=>x.textContent));
  const n0=await names(),on0=await p.evaluate(()=>_vw.tmp.cols.filter(x=>x.on).map(x=>x.k).sort().join());
  const rows=await p.$$('#vwList .vw-row');const a=await rows[0].boundingBox(),c=await rows[3].boundingBox();
  await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();
  for(let i=1;i<=12;i++){await p.mouse.move(a.x+a.width/2,a.y+a.height/2+(c.y+c.height*0.7-a.y-a.height/2)*i/12);await wait(p,16);}
  await p.mouse.up();await wait(p,200);
  const n1=await names();
  check('колонку можно перетащить мышью',n1[3]===n0[0],[n0.slice(0,4),n1.slice(0,4)]);
  check('галочки при перетаскивании не переключаются',on0===await p.evaluate(()=>_vw.tmp.cols.filter(x=>x.on).map(x=>x.k).sort().join()));
  await p.evaluate(()=>vwSave());await wait(p,500);
  // поставщик с телефоном
  await p.evaluate(async()=>{goTo('settings');document.getElementById('newPart').value='Эльдорадо';document.getElementById('newPartPh').value='89281112233';await addPart();});
  await p.evaluate(()=>openNew('p:P3'));await wait(p,300);
  await p.fill('#f_partnerPhone','89990001122');await p.selectOption('#f_partner','Эльдорадо');
  check('телефон поставщика из настроек подставляется и не редактируется',await p.evaluate(()=>{const i=document.getElementById('f_partnerPhone');return i.value==='89281112233'&&i.readOnly;}));
  await p.selectOption('#f_partner','Сторонний');
  check('у «Стороннего» введённый номер сохраняется',await p.evaluate(()=>document.getElementById('f_partnerPhone').value==='89990001122'));
  await p.evaluate(()=>closeM('mClient'));
  // проверка базы на странице кассы
  await p.evaluate(()=>goTo('kassa'));await wait(p,300);
  check('на странице кассы есть «Проверка базы» без расхождений',/всё в порядке/.test(await p.$eval('#checkBadge',e=>e.textContent)));
  noErrors('интерфейс',errs);await ctx.close();
}
