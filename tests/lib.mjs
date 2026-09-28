// Общее для всех наборов: сервер страниц, браузер, вход, проверки.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {seed} from './seed.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=Number(process.env.CRM_PORT||8765);
export const URL_CRM='http://127.0.0.1:'+PORT+'/index.html';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};

let server=null,browser=null;
export async function start(){
  server=http.createServer((req,res)=>{
    const u=decodeURIComponent(req.url.split('?')[0]),f=path.join(ROOT,u==='/'?'index.html':u);
    if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
  // пользователь для входа (в эмуляторе); «уже есть» — не ошибка
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'a@test.ru',password:'test12345'})}).catch(()=>{});
}
export async function stop(){if(browser)await browser.close();if(server)server.close();}
export const reseed=o=>seed(o);
export const wipe=()=>fetch('http://127.0.0.1:8085/emulator/v1/projects/amana-crm-16033/databases/(default)/documents',{method:'DELETE'});

// Устройство: отдельный браузерный профиль (своя память, свой кэш базы)
export async function device(o={}){
  const ctx=await browser.newContext({viewport:o.vp||{width:1280,height:850},hasTouch:!!o.mobile,isMobile:!!o.mobile,timezoneId:o.tz||'Europe/Moscow',locale:'ru-RU'});
  await ctx.addInitScript(()=>{window.__AMANA_EMU={fs:8085,auth:9099};});
  // тесты не ходят в интернет: всё нужное CRM лежит в репозитории
  await ctx.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());
  const p=await ctx.newPage(),errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load resource|ERR_FAILED/.test(m.text()))errs.push(m.text().slice(0,300));});
  if(o.clock)await p.clock.install({time:o.clock});
  return{ctx,p,errs};
}
export async function login(p,{again=false}={}){
  await p.goto(URL_CRM);await p.waitForTimeout(800);
  if(!again&&await p.$('#lemail:visible')){await p.fill('#lemail','a@test.ru');await p.fill('#lpass','test12345');await p.click('#loginFields button');}
  // после очистки базы CRM сама перезагружает страницу — ожидание переживает эту перезагрузку
  for(let i=0;;i++){
    try{await p.waitForFunction(()=>typeof S!=='undefined'&&S.clients.length>0&&S.payments.length>0&&S.wallets.length>0,null,{timeout:90000});break;}
    catch(e){if(i>=2||!/context|navigat/i.test(String(e)))throw e;await p.waitForTimeout(1000);}
  }
  await p.waitForTimeout(800);
}
export const wait=(p,ms)=>p.waitForTimeout(ms);
// Подтверждения в CRM — свои окна; в тестах подтверждаем сразу
export const autoConfirm=p=>p.evaluate(()=>{window.showConfirm=(t,m,ok)=>ok&&ok();});

// Проверки
const results=[];let suite='';
export function setSuite(n){suite=n;console.log('\n■ '+n);}
export function check(name,cond,info){results.push({suite,name,ok:!!cond,info});console.log((cond?'  ✓ ':'  ✗ ')+name+(!cond&&info!==undefined?'  → '+(typeof info==='string'?info:JSON.stringify(info)):''));}
export function noErrors(name,errs){check(name+': ошибок в браузере нет',!errs.length,errs.slice(0,3));}
export const failed=()=>results.filter(r=>!r.ok);
export const total=()=>results.length;
