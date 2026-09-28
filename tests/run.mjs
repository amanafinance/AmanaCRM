// Запуск всех проверок: npm test (поднимает эмулятор Firebase и запускает этот файл).
// Один набор: node run.mjs money   (эмулятор должен быть уже запущен)
import {start,stop,setSuite,failed,total} from './lib.mjs';
const ALL=['pages','money','investors','sync','people','security','ui','devices','speed'];
const want=process.argv.slice(2).length?process.argv.slice(2):ALL;
await start();
const t0=Date.now();
for(const name of want){
  setSuite(name);
  try{await (await import('./suites/'+name+'.mjs')).default();}
  catch(e){const {check}=await import('./lib.mjs');check('набор завершился без сбоя',false,e&&e.stack||String(e));}
}
await stop();
const bad=failed();
console.log('\nПроверок: '+total()+', не прошло: '+bad.length+', время: '+Math.round((Date.now()-t0)/1000)+' с');
bad.forEach(r=>console.log('  ✗ ['+r.suite+'] '+r.name));
process.exit(bad.length?1:0);
