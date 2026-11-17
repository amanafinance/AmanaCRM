// Запуск всех проверок: npm test (скачивает PocketBase и запускает этот файл).
// Один набор: node run.mjs money   (временная база запускается автоматически)
import {start,stop,setSuite,failed,total,debugDevices} from './lib.mjs';
const ALL=['hardening','pages','money','investors','sync','people','filters','longtext','numbers','backup','staff','security','ui','interface','devices','design','speed'];
const want=process.argv.slice(2).length?process.argv.slice(2):ALL;
await start();
const t0=Date.now();
for(const name of want){
  setSuite(name);
  try{await (await import('./suites/'+name+'.mjs')).default();}
  catch(e){const {check}=await import('./lib.mjs');check('набор завершился без сбоя',false,e&&e.stack||String(e));await debugDevices();}
}
await stop();
const bad=failed();
console.log('\nПроверок: '+total()+', не прошло: '+bad.length+', время: '+Math.round((Date.now()-t0)/1000)+' с');
bad.forEach(r=>console.log('  ✗ ['+r.suite+'] '+r.name));
process.exit(bad.length?1:0);
