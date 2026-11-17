// Общее для всех наборов: сервер страниц, браузер, вход, проверки.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {spawn,execFileSync} from 'node:child_process';
import os from 'node:os';
import {seed} from './seed.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=Number(process.env.CRM_PORT||8765);
export const URL_CRM='http://127.0.0.1:'+PORT+'/index.html';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};

// Для проверок запускается отдельная временная база PocketBase.
export const PB_PORT=Number(process.env.PB_PORT||8092),PB_URL='http://127.0.0.1:'+PB_PORT;
const PB_BIN=process.env.PB_BIN||path.join(ROOT,'tests','.pb','pocketbase');
export const PB_ADMIN={identity:'admin@test.ru',password:'adminpass123'};
let pbProc=null,pbDir=null;
async function startPB(){
  pbDir=fs.mkdtempSync(path.join(os.tmpdir(),'amana-pb-'));
  const args=['--dir='+pbDir,'--migrationsDir='+path.join(ROOT,'server','pb_migrations'),'--hooksDir='+path.join(ROOT,'server','pb_hooks'),'--automigrate=false'];
  execFileSync(PB_BIN,['superuser','upsert',PB_ADMIN.identity,PB_ADMIN.password,...args],{stdio:'ignore'});
  pbProc=spawn(PB_BIN,['serve','--http=127.0.0.1:'+PB_PORT,'--hooksWatch=false',...args],{env:{...process.env,AMANA_TEST:'1',AMANA_PUBLIC_DIR:ROOT,TZ:'Europe/Moscow'},stdio:['ignore','ignore','inherit']});
  for(let i=0;i<100;i++){try{if((await fetch(PB_URL+'/api/health')).ok)break;}catch(e){}await new Promise(r=>setTimeout(r,100));}
  const t=(await (await fetch(PB_URL+'/api/collections/_superusers/auth-with-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(PB_ADMIN)})).json()).token;
  _pbTok=t;
  await fetch(PB_URL+'/api/collections/users/records',{method:'POST',headers:{'Content-Type':'application/json',Authorization:t},body:JSON.stringify({email:'a@test.ru',password:'test12345',passwordConfirm:'test12345',verified:true,perms:'*'})}); // владелец
  // ограничение частоты входов (защита от подбора паролей) в тестах выключено: устройства входят десятками подряд
  await fetch(PB_URL+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:t},body:JSON.stringify({rateLimits:{enabled:false}})});
}
let _pbTok=null;
export async function pbAdmin(){return _pbTok;}
export async function resetTestLogin(email){await fetch(PB_URL+'/api/amana/test/reset-login-limits',{method:'POST',headers:{Authorization:await pbAdmin(),'Content-Type':'application/json'},body:JSON.stringify({email})});}
export async function testCode(email){for(let i=0;i<100;i++){const r=await fetch(PB_URL+'/api/amana/test/otp/'+encodeURIComponent(email),{headers:{Authorization:await pbAdmin()}}),code=(await r.json()).code;if(code)return code;await new Promise(r=>setTimeout(r,50));}throw new Error('Не получено тестовое письмо с кодом');}
export async function authToken(email,password){
 await resetTestLogin(email);
 const req=async(path,body)=>await (await fetch(PB_URL+'/api/collections/users/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
 const first=await req('auth-with-password',{identity:email,password});if(first.token)return first.token;
 if(!first.mfaId)throw new Error('Пароль не принят');const otp=await req('request-otp',{email});if(!otp.otpId)throw new Error('Код не запрошен: '+JSON.stringify(otp));
 const last=await req('auth-with-otp',{otpId:otp.otpId,password:await testCode(email),mfaId:first.mfaId});if(!last.token)throw new Error('Код не принят: '+JSON.stringify(last));return last.token;
}

let server=null,browser=null;
const devices=[];
export async function debugDevices(){for(const d of devices)if(!d.p.isClosed())console.log('Диагностика тестового устройства:',{errors:d.errs.slice(-3),state:await d.p.evaluate(()=>({toast:document.getElementById('toast')?.textContent,codeError:document.getElementById('loginCodeError')?.textContent,loginError:document.getElementById('lerr')?.textContent})).catch(()=>null)});}
export async function start(){
  await startPB();
  server=http.createServer((req,res)=>{
    const u=decodeURIComponent(req.url.split('?')[0]),f=path.join(ROOT,u==='/'?'index.html':u);
    if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
}
export async function stop(){if(browser)await browser.close();if(server)server.close();if(pbProc){pbProc.kill();pbProc=null;try{fs.rmSync(pbDir,{recursive:true,force:true});}catch(e){}}}
export const reseed=o=>seed(o);
export const wipe=async()=>fetch(PB_URL+'/api/amana/test/wipe',{method:'POST',headers:{Authorization:await pbAdmin()}});

// Устройство: отдельный браузерный профиль (своя память, свой кэш базы)
export async function device(o={}){
  const ctx=await browser.newContext({viewport:o.vp||{width:1280,height:850},hasTouch:!!o.mobile,isMobile:!!o.mobile,timezoneId:o.tz||'Europe/Moscow',locale:'ru-RU'});
  await ctx.addInitScript(u=>{window.__AMANA_PB=u;},PB_URL);
  // тесты не ходят в интернет: всё нужное CRM лежит в репозитории
  await ctx.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());
  const p=await ctx.newPage(),errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load resource|ERR_FAILED/.test(m.text()))errs.push(m.text().slice(0,300));});
  if(o.clock)await p.clock.install({time:o.clock});
  const result={ctx,p,errs};devices.push(result);return result;
}
export async function login(p,{again=false}={}){
  await p.goto(URL_CRM);await p.waitForTimeout(800);
  if(!again&&await p.$('#lemail:visible')){await resetTestLogin('a@test.ru');await p.fill('#lemail','a@test.ru');await p.fill('#lpass','test12345');await p.click('#loginFields button');}
  await completeCode(p,'a@test.ru');
  // после очистки базы CRM сама перезагружает страницу — ожидание переживает эту перезагрузку
  for(let i=0;;i++){
    try{await p.waitForFunction(()=>typeof S!=='undefined'&&S.clients.length>0&&S.payments.length>0&&S.wallets.length>0,null,{timeout:90000});break;}
    catch(e){if(i>=2||!/context|navigat/i.test(String(e))){console.log('Состояние входа:',await p.evaluate(()=>({code:!!document.querySelector('#loginCode')?.offsetParent,error:document.getElementById('loginCodeError')?.textContent,loginError:document.getElementById('lerr')?.textContent,logged:!!window.AUTH?.currentUser,clients:typeof S!=='undefined'?S.clients.length:-1,payments:typeof S!=='undefined'?S.payments.length:-1,wallets:typeof S!=='undefined'?S.wallets.length:-1})));throw e;}await p.waitForTimeout(1000);}
  }
  await p.waitForTimeout(800);
}
export async function completeCode(p,email){
 try{await p.waitForFunction(()=>document.getElementById('loginCode')?.offsetParent||document.getElementById('app')?.classList.contains('on')||document.getElementById('lerr')?.offsetParent,null,{timeout:10000});}catch{return;}
 if(!await p.isVisible('#loginCode'))return;
 await fetch(PB_URL+'/api/amana/test/reset-login-limits',{method:'POST',headers:{Authorization:await pbAdmin()}});
 await p.fill('#loginCode',await testCode(email));await p.click('#loginCodeFields button');
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
