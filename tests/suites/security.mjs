// Безопасность: серверные правила доступа и безопасный вывод текста.
import {reseed,device,login,check,noErrors,wait,PB_URL,pbAdmin,authToken} from '../lib.mjs';

// Свой сервер (PocketBase): те же правила, их проверяет сервер (server/pb_hooks, server/pb_migrations)
async function pbRules(){
  const req=async(m,p,b,t)=>{const r=await fetch(PB_URL+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:t}:{})},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json();}catch(e){}return{s:r.status,j};};
  const A=await pbAdmin(),U=await authToken('a@test.ru','test12345');
  await fetch(PB_URL+'/api/amana/test/seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:A},body:JSON.stringify({docs:[{c:'clients',id:'a',data:{name:'X'}},{c:'journal',id:'j',data:{t:1}},{c:'wallets',id:'w',data:{name:'Сбер',balance:100}},{c:'wallets',id:'neg',data:{name:'Старый',balance:-50}}]})});
  const C=(b,t)=>req('POST','/api/amana/commit',b,t===undefined?U:t);
  const anonList=await req('GET','/api/collections/clients/records'),anonOne=await req('GET','/api/collections/clients/records/a');
  check('без входа база не читается',anonOne.s!==200&&!(anonList.j&&anonList.j.items&&anonList.j.items.length),{one:anonOne.s,list:anonList.j&&anonList.j.items&&anonList.j.items.length});
  check('без входа в базу нельзя писать',(await C({ops:[{t:'set',c:'persons',id:'b',d:{name:'Тест'}}]},null)).s===401);
  check('вошедший сотрудник читает и пишет',(await req('GET','/api/collections/clients/records/a',null,U)).s===200&&(await C({ops:[{t:'set',c:'persons',id:'b',d:{name:'Тест'}}]})).s===200);
  const direct=[await req('POST','/api/collections/clients/records',{id:'zz',data:{x:1}},U),await req('PATCH','/api/collections/clients/records/a',{data:{x:2}},U),await req('DELETE','/api/collections/clients/records/a',null,U)].map(r=>r.s);
  check('напрямую (в обход проверок сервера) записать нельзя',direct.every(s=>s>=400),direct);
  check('самому зарегистрироваться нельзя',(await req('POST','/api/collections/users/records',{email:'x@test.ru',password:'test12345',passwordConfirm:'test12345'})).s>=400);
  check('историю действий нельзя исправить',(await C({ops:[{t:'update',c:'journal',id:'j',d:{t:2}}]})).s===403&&(await C({ops:[{t:'set',c:'journal',id:'j',d:{t:2}}]})).s===403);
  check('историю действий нельзя удалить',(await C({ops:[{t:'delete',c:'journal',id:'j'}]})).s===403);
  check('счёт нельзя увести в минус',(await C({ops:[{t:'update',c:'wallets',id:'w',d:{balance:-10}}]})).s>=400);
  check('счёт можно потратить до нуля',(await C({ops:[{t:'set',c:'kassaOps',id:'spend',d:{type:'opex',amount:100,wallet:'w',date:{$date:new Date().toISOString()}}},{t:'update',c:'wallets',id:'w',d:{balance:0}}]})).s===200);
  check('остаток нельзя менять без кассы; переименование разрешено',(await C({ops:[{t:'update',c:'wallets',id:'neg',d:{balance:-20}}]})).s>=400&&(await C({ops:[{t:'update',c:'wallets',id:'neg',d:{name:'Сбербанк'}}]})).s===200);
  check('новый счёт нельзя создать с минусом',(await C({ops:[{t:'set',c:'wallets',id:'x',d:{name:'X',balance:-1}}]})).s>=400);
  check('служебный раздел надгробий не пишется',(await C({ops:[{t:'set',c:'deleted',id:'q',d:{}}]})).s===400);
}
export default async function(){
  await pbRules();
  await xss();
}
async function xss(){
  // Текст из полей не выполняется как код
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  await p.evaluate(async()=>{const X=k=>'<img src=x onerror="(window.__xss=window.__xss||[]).push(\''+k+'\')">';const{db,doc,updateDoc,addDoc,collection}=window.DB;const c=S.clients.find(x=>x.id==='c10');
    await updateDoc(doc(db,'clients','c10'),{product:X('товар'),comment:X('комментарий'),addr:X('адрес'),name:'Клиент 10'+X('ФИО')});
    await updateDoc(doc(db,'wallets','w2'),{name:'Сбер'+X('счёт')});
    await addDoc(collection(db,'payments'),{clientId:'c10',contractId:c.contractId,name:c.name,amount:1,type:'discount',typeLabel:'Скидка ('+X('причина')+')',payType:'—',date:new Date(),dateStr:fmtD(new Date())});
    const bt=window.DB.writeBatch(db);bt.set(doc(collection(db,'kassaOps')),{type:'opex',amount:1,wallet:'w1',walletName:'Наличные',desc:X('описание'),date:new Date(),dateStr:fmtD(new Date()),auto:false});bt.update(doc(db,'wallets','w1'),{balance:window.DB.increment(-1)});await bt.commit();});
  await wait(p,1500);
  const steps=[()=>{S.ui.cols.forEach(x=>x.on=true);S.ui.card.forEach(x=>x.on=true);S.CF.id='00011';goBase('clients');renderClients();},()=>openC('c160'),()=>openC('c10'),()=>openPay('c10'),()=>{closeM('mPay');openDisc('c10');},
    ()=>{closeM('mDisc');goTo('kassa');toggleCardsExpanded();},()=>openKassaOp(),()=>{closeM('mKassa');goTo('settings');},()=>goBase('reminders'),()=>{S.ui.pcols.forEach(x=>x.on=true);goBase('people');}];
  for(const s of steps){await p.evaluate(s);await wait(p,300);}
  await p.setViewportSize({width:390,height:844});
  for(const s of [steps[0],steps[5],steps[8]]){await p.evaluate(s);await wait(p,300);}
  const hits=await p.evaluate(()=>[...new Set(window.__xss||[])]);
  check('текст из полей нигде не выполняется как код (ПК и телефон)',!hits.length,hits);
  noErrors('безопасность',errs);await ctx.close();
}
