// Скорость: 1 000 договоров и ~4 000 оплат в памяти страницы — перерисовки должны оставаться быстрыми.
// Пороги с большим запасом (старая версия тратила на оплату 1–4,5 с, новая — десятки миллисекунд).
import {reseed,device,login,check,noErrors} from '../lib.mjs';
export default async function(){
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  await p.evaluate(()=>{const base=S.clients,pays=S.payments,ks=S.kassaOps,C=[],P=[],K=[];
    for(let r=0;r<5;r++){base.forEach(c=>C.push({...c,id:c.id+'_'+r,contractId:String(r*1000+parseInt(c.contractId)).padStart(5,'0')}));
      pays.forEach(x=>P.push({...x,id:x.id+'_'+r,clientId:x.clientId+'_'+r}));ks.forEach(x=>K.push({...x,id:x.id+'_'+r}));}
    S.clients=C;S.payments=P;S.kassaOps=K;});
  const t=await p.evaluate(()=>{const T=f=>{const t=performance.now();f();return Math.round(performance.now()-t);};const pay=()=>{S.payments=S.payments.slice();refreshAll();};
    T(()=>goTo('dashboard'));
    return{dash:T(()=>{goTo('dashboard');pay();}),fin:T(()=>goTo('finance')),rem:T(()=>{goBase('reminders');pay();}),card:T(()=>{openC(S.clients[5].id);pay();}),people:T(()=>goBase('people'))};});
  console.log('    мс:',JSON.stringify(t));
  check('после оплаты дашборд перерисовывается быстрее 0,6 с',t.dash<600,t.dash);
  check('показатели бизнеса открываются быстрее 0,8 с',t.fin<800,t.fin);
  check('после оплаты контроль платежей перерисовывается быстрее 0,6 с',t.rem<600,t.rem);
  check('после оплаты карточка сделки перерисовывается быстрее 0,3 с',t.card<300,t.card);
  check('клиенты открываются быстрее 0,6 с',t.people<600,t.people);
  noErrors('скорость',errs);await ctx.close();
}
