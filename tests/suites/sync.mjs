// Два устройства: живое обновление, удаления, экономия чтений, очистка базы
import {reseed,device,login,check,noErrors,wait,wipe} from '../lib.mjs';
export default async function(){
  await reseed();
  const A=await device(),B=await device();await login(A.p);await login(B.p);
  const read=p=>p.evaluate(()=>JSON.parse(JSON.stringify(window.SYNC_STATS.server)));
  const first=await read(A.p);
  check('первое открытие загружает базу с сервера',first.clients===200&&first.payments>0,first);
  await A.p.reload();await login(A.p,{again:true});
  const second=await read(A.p);
  check('повторное открытие: 0 документов с сервера',!second.clients&&!second.payments&&!second.kassaOps,second);
  // B принимает оплату и удаляет операцию кассы
  await B.p.evaluate(async()=>{_cid='c0';await savePay(1234,'w1');const{db,doc,writeBatch,increment}=window.DB;const bt=writeBatch(db);bt.delete(doc(db,'kassaOps','manual1'));bt.update(doc(db,'wallets','w1'),{balance:increment(1000)});await bt.commit();});
  await wait(A.p,2500);
  const live=await A.p.evaluate(()=>({pay:S.payments.some(x=>x.amount===1234),del:!S.kassaOps.some(x=>x.id==='manual1')}));
  check('A сразу видит оплату, принятую на B',live.pay);
  check('A сразу видит удаление на B',live.del);
  await A.p.reload();await login(A.p,{again:true});
  const after=await A.p.evaluate(()=>({pay:S.payments.some(x=>x.amount===1234),del:!S.kassaOps.some(x=>x.id==='manual1'),srv:window.SYNC_STATS.server}));
  check('после перезагрузки оплата на месте, удалённое не вернулось',after.pay&&after.del,after);
  check('после перезагрузки с сервера скачаны только изменения',(after.srv.payments||0)<=3&&!after.srv.clients,after.srv);
  const same=await A.p.evaluate(()=>S.wallets.map(w=>w.id+':'+w.balance).sort().join())===await B.p.evaluate(()=>S.wallets.map(w=>w.id+':'+w.balance).sort().join());
  check('остатки касс на двух устройствах одинаковые',same);
  // очистка базы в консоли → CRM перезагружает всё сама
  await wipe();await reseed({investors:false});
  await A.p.reload();await login(A.p,{again:true});
  const w=await A.p.evaluate(()=>({pay:S.payments.some(x=>x.amount===1234),inv:S.inv.length}));
  check('после очистки базы старые данные с устройства не показываются',!w.pay&&w.inv===0,w);
  noErrors('синхронизация A',A.errs);noErrors('синхронизация B',B.errs);
  await A.ctx.close();await B.ctx.close();
}
