// Безопасность: правила Firestore (firestore.rules) и вывод текста из базы без выполнения кода
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {reseed,device,login,check,noErrors,wait,BACKEND,PB_URL,pbAdmin} from '../lib.mjs';
const RULES=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../firestore.rules');

async function tryOp(pr){try{await pr;return true;}catch(e){return false;}}
// Свой сервер (PocketBase): те же правила, их проверяет сервер (server/pb_hooks, server/pb_migrations)
async function pbRules(){
  const req=async(m,p,b,t)=>{const r=await fetch(PB_URL+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:t}:{})},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json();}catch(e){}return{s:r.status,j};};
  const A=await pbAdmin(),U=(await req('POST','/api/collections/users/auth-with-password',{identity:'a@test.ru',password:'test12345'})).j.token;
  await fetch(PB_URL+'/api/amana/test/seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:A},body:JSON.stringify({docs:[{c:'clients',id:'a',data:{name:'X'}},{c:'journal',id:'j',data:{t:1}},{c:'wallets',id:'w',data:{name:'Сбер',balance:100}},{c:'wallets',id:'neg',data:{name:'Старый',balance:-50}}]})});
  const C=(b,t)=>req('POST','/api/amana/commit',b,t===undefined?U:t);
  const anonList=await req('GET','/api/collections/clients/records'),anonOne=await req('GET','/api/collections/clients/records/a');
  check('без входа база не читается',anonOne.s!==200&&!(anonList.j&&anonList.j.items&&anonList.j.items.length),{one:anonOne.s,list:anonList.j&&anonList.j.items&&anonList.j.items.length});
  check('без входа в базу нельзя писать',(await C({ops:[{t:'set',c:'clients',id:'b',d:{x:1}}]},null)).s===401);
  check('вошедший сотрудник читает и пишет',(await req('GET','/api/collections/clients/records/a',null,U)).s===200&&(await C({ops:[{t:'set',c:'clients',id:'b',d:{x:1}}]})).s===200);
  const direct=[await req('POST','/api/collections/clients/records',{id:'zz',data:{x:1}},U),await req('PATCH','/api/collections/clients/records/a',{data:{x:2}},U),await req('DELETE','/api/collections/clients/records/a',null,U)].map(r=>r.s);
  check('напрямую (в обход проверок сервера) записать нельзя',direct.every(s=>s>=400),direct);
  check('самому зарегистрироваться нельзя',(await req('POST','/api/collections/users/records',{email:'x@test.ru',password:'test12345',passwordConfirm:'test12345'})).s>=400);
  check('историю действий нельзя исправить',(await C({ops:[{t:'update',c:'journal',id:'j',d:{t:2}}]})).s===403&&(await C({ops:[{t:'set',c:'journal',id:'j',d:{t:2}}]})).s===403);
  check('историю действий нельзя удалить',(await C({ops:[{t:'delete',c:'journal',id:'j'}]})).s===403);
  check('счёт нельзя увести в минус',(await C({ops:[{t:'update',c:'wallets',id:'w',d:{balance:-10}}]})).s===409);
  check('счёт можно потратить до нуля',(await C({ops:[{t:'update',c:'wallets',id:'w',d:{balance:0}}]})).s===200);
  check('счёт в минусе можно пополнить и переименовать',(await C({ops:[{t:'update',c:'wallets',id:'neg',d:{balance:-20}}]})).s===200&&(await C({ops:[{t:'update',c:'wallets',id:'neg',d:{name:'Сбербанк'}}]})).s===200);
  check('новый счёт нельзя создать с минусом',(await C({ops:[{t:'set',c:'wallets',id:'x',d:{name:'X',balance:-1}}]})).s===409);
  check('служебный раздел надгробий не пишется',(await C({ops:[{t:'set',c:'deleted',id:'q',d:{}}]})).s===400);
}
export default async function(){
  if(BACKEND==='pb')await pbRules();else await fbRules();
  await xss();
}
async function fbRules(){
  // Правила — в отдельном проекте эмулятора, чтобы не трогать данные CRM
  const env=await initializeTestEnvironment({projectId:'rules-check',firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync(RULES,'utf8')}});
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'clients/a'),{name:'X'});await setDoc(doc(c.firestore(),'journal/j'),{t:1});});
  const anon=env.unauthenticatedContext().firestore(),user=env.authenticatedContext('u1',{email:'a@test.ru'}).firestore();
  check('без входа база не читается',!(await tryOp(getDoc(doc(anon,'clients/a')))));
  check('без входа в базу нельзя писать',!(await tryOp(setDoc(doc(anon,'clients/b'),{x:1}))));
  check('вошедший сотрудник читает и пишет',await tryOp(getDoc(doc(user,'clients/a')))&&await tryOp(setDoc(doc(user,'clients/b'),{x:1})));
  check('историю действий нельзя исправить',!(await tryOp(updateDoc(doc(user,'journal/j'),{t:2}))));
  check('историю действий нельзя удалить',!(await tryOp(deleteDoc(doc(user,'journal/j')))));
  // Остаток счёта не уходит в минус — даже если запись пришла в обход CRM
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'wallets/w'),{name:'Сбер',balance:100});await setDoc(doc(c.firestore(),'wallets/neg'),{name:'Старый',balance:-50});});
  check('счёт нельзя увести в минус',!(await tryOp(updateDoc(doc(user,'wallets/w'),{balance:-10}))));
  check('счёт можно потратить до нуля',await tryOp(updateDoc(doc(user,'wallets/w'),{balance:0})));
  check('счёт в минусе можно пополнить и переименовать',await tryOp(updateDoc(doc(user,'wallets/neg'),{balance:-20}))&&await tryOp(updateDoc(doc(user,'wallets/neg'),{name:'Сбербанк'})));
  check('новый счёт нельзя создать с минусом',!(await tryOp(setDoc(doc(user,'wallets/x'),{name:'X',balance:-1}))));
  await env.cleanup();
}
async function xss(){
  // Текст из полей не выполняется как код
  await reseed();
  const {p,errs,ctx}=await device();await login(p);
  await p.evaluate(async()=>{const X=k=>'<img src=x onerror="(window.__xss=window.__xss||[]).push(\''+k+'\')">';const{db,doc,updateDoc,addDoc,collection}=window.DB;const c=S.clients.find(x=>x.id==='c10');
    await updateDoc(doc(db,'clients','c10'),{product:X('товар'),comment:X('комментарий'),addr:X('адрес'),name:'Клиент 10'+X('ФИО')});
    await updateDoc(doc(db,'wallets','w2'),{name:'Сбер'+X('счёт')});
    await addDoc(collection(db,'payments'),{clientId:'c10',contractId:c.contractId,name:c.name,amount:1,type:'discount',typeLabel:'Скидка ('+X('причина')+')',payType:'—',date:new Date(),dateStr:fmtD(new Date())});
    await addDoc(collection(db,'kassaOps'),{type:'opex',amount:1,wallet:'w1',walletName:'Наличные',desc:X('описание'),date:new Date(),dateStr:fmtD(new Date()),auto:false});});
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
