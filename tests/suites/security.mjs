// Безопасность: правила Firestore (firestore.rules) и вывод текста из базы без выполнения кода
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {reseed,device,login,check,noErrors,wait} from '../lib.mjs';
const RULES=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../firestore.rules');

async function tryOp(pr){try{await pr;return true;}catch(e){return false;}}
export default async function(){
  // Правила — в отдельном проекте эмулятора, чтобы не трогать данные CRM
  const env=await initializeTestEnvironment({projectId:'rules-check',firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync(RULES,'utf8')}});
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'clients/a'),{name:'X'});await setDoc(doc(c.firestore(),'journal/j'),{t:1});});
  const anon=env.unauthenticatedContext().firestore(),user=env.authenticatedContext('u1',{email:'a@test.ru'}).firestore();
  check('без входа база не читается',!(await tryOp(getDoc(doc(anon,'clients/a')))));
  check('без входа в базу нельзя писать',!(await tryOp(setDoc(doc(anon,'clients/b'),{x:1}))));
  check('вошедший сотрудник читает и пишет',await tryOp(getDoc(doc(user,'clients/a')))&&await tryOp(setDoc(doc(user,'clients/b'),{x:1})));
  check('историю действий нельзя исправить',!(await tryOp(updateDoc(doc(user,'journal/j'),{t:2}))));
  check('историю действий нельзя удалить',!(await tryOp(deleteDoc(doc(user,'journal/j')))));
  await env.cleanup();

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
