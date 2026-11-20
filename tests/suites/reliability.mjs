import {reseed,device,login,check,noErrors,PB_URL,pbAdmin,authToken} from '../lib.mjs';
const api=async(method,path,body,token)=>{const r=await fetch(PB_URL+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
const reqId=n=>'request_test_'+String(n).padStart(15,'0');
export default async function(){
 await reseed();const token=await authToken('a@test.ru','test12345'),admin=await pbAdmin();
 const post=b=>api('POST','/api/amana/commit',b,token),status=(id,t=token)=>api('GET','/api/amana/requests/'+id,null,t),cancel=id=>api('POST','/api/amana/requests/'+id+'/cancel',{},token);
 const balance=async()=> (await api('GET','/api/collections/wallets/records/w1',null,token)).data.data.balance;
 const journal=async()=> (await api('GET','/api/collections/journal/records?perPage=1',null,token)).data.totalItems;
 const expense=n=>({requestId:reqId(n),ops:[{t:'set',c:'kassaOps',id:'expense'+n,d:{type:'opex',amount:123,wallet:'w1',desc:'Тест надёжности',date:{$date:new Date().toISOString()}}},{t:'update',c:'wallets',id:'w1',d:{balance:{$op:'inc',v:-123}}}]});
 let b=await balance(),j=await journal();const request=expense(1),one=await post(request),two=await post(request);
 check('повтор одного номера возвращает успех без повторного расхода',one.status===200&&two.status===200&&(await balance())===b-123);
 check('повтор запроса не дублирует историю',(await journal())===j+1);
 const changed=JSON.parse(JSON.stringify(request));changed.ops[0].d.amount=124;
 check('тот же номер нельзя использовать с другими данными',(await post(changed)).status===400);
 b=await balance();j=await journal();const same=expense(2),both=await Promise.all([post(same),post(same)]);
 check('два одновременных одинаковых запроса списывают один раз',both.every(r=>r.status===200)&&(await balance())===b-123&&(await journal())===j+1,both.map(r=>r.status));
 check('результат подтверждён сервером',(await status(reqId(2))).data.state==='saved');
 check('отмена уже сохранённого запроса не отменяет деньги',(await cancel(reqId(2))).data.state==='saved'&&(await balance())===b-123);
 const late=expense(3);b=await balance();j=await journal();await cancel(late.requestId);
 check('отмена несохранённого запроса блокирует его позднее выполнение',(await post(late)).status===409&&(await status(late.requestId)).data.state==='cancelled'&&(await balance())===b&&(await journal())===j);
 const bad={requestId:reqId(4),ops:[{t:'update',c:'wallets',id:'w1',d:{balance:99999999}}]};
 check('денежные ограничения сохраняются для запросов с номером',(await post(bad)).status>=400);
 check('отклонённое действие не получает ложного подтверждения',(await status(reqId(4))).data.state==='unknown'&&(await journal())===j);
 const user=(await api('POST','/api/amana/staff',{name:'Тест надёжности',email:'reliability@test.ru',password:'test-pass-123',perms:['deal_edit','v_cost']},token)).data;
 const limited=await authToken('reliability@test.ru','test-pass-123');
 check('другой пользователь не видит подтверждение чужой операции',(await status(reqId(1),limited)).data.state==='unknown');
 const id=reqId(5),body={requestId:id,ops:[{t:'update',c:'clients',id:'c3',d:{comment:'Тест прав'}}]};
 await api('POST','/api/amana/commit',body,limited);await api('POST','/api/amana/staff/'+user.id,{perms:['deal_edit']},token);
 const reduced=await status(id,limited);
 check('после снятия права подтверждение не раскрывает себестоимость',reduced.data.state==='saved'&&reduced.data.result.docs.every(d=>!d.data||!('cost' in d.data)),reduced.status);
 check('таблица подтверждений закрыта от прямого чтения',(await api('GET','/api/collections/amanaRequests/records',null,token)).status>=400);
 const stored=(await api('GET','/api/collections/amanaRequests/records',null,admin)).data.items;
 check('в подтверждениях денег хранятся ссылки, без сумм и личных полей',stored.filter(r=>r.kind==='commit').every(r=>!JSON.stringify(r.result).includes('amount')&&!JSON.stringify(r.result).includes('cost')));
 // Если не удаётся сохранить подтверждение, деньги и история тоже откатываются.
 const schema=(await api('GET','/api/collections/amanaRequests',null,admin)).data;
 const fields=schema.fields.map(f=>({...f}));fields.find(f=>f.name==='fingerprint').max=1;
 await api('PATCH','/api/collections/amanaRequests',{fields},admin);
 const atomic=expense(6);b=await balance();j=await journal();let failed;
 try{failed=await post(atomic);}finally{await api('PATCH','/api/collections/amanaRequests',{fields:schema.fields},admin);}
 check('ошибка сохранения подтверждения откатывает расход и историю',failed.status>=400&&(await balance())===b&&(await journal())===j,failed.status);
 check('откат не оставляет ложного успешного номера',(await status(atomic.requestId)).data.state==='unknown');
 // Все изменяющие маршруты используют тот же механизм, включая управление сотрудниками.
 const staffBody={requestId:reqId(7),name:'Вымышленный сотрудник',email:'receipt-staff@test.ru',password:'test-staff-123',perms:[]};
 const st1=await api('POST','/api/amana/staff',staffBody,token),st2=await api('POST','/api/amana/staff',staffBody,token);
 check('повтор создания сотрудника возвращает ту же запись',st1.status===200&&st2.status===200&&st1.data.id===st2.data.id);
 const delBody={requestId:reqId(8)};
 check('повтор удаления сотрудника не создаёт вторую историю',(await api('DELETE','/api/amana/staff/'+st1.data.id,delBody,token)).status===200&&(await api('DELETE','/api/amana/staff/'+st1.data.id,delBody,token)).status===200);
 j=await journal();const note={requestId:reqId(9),type:'Скачана резервная копия'};
 await api('POST','/api/amana/note',note,token);await api('POST','/api/amana/note',note,token);
 check('повтор записи скачивания копии не дублирует историю',(await journal())===j+1);
 check('без входа нельзя узнать или отменить результат',(await api('GET','/api/amana/requests/'+reqId(1))).status===401&&(await api('POST','/api/amana/requests/'+reqId(1)+'/cancel',{})).status===401);
 // Медленный POST: проверка /health специально недоступна, запись должна дойти напрямую.
 const D=await device();const p=D.p;await login(p);await p.evaluate(()=>{openComment('c3');document.getElementById('mcText').value='Медленная вымышленная запись';});
 let count=0;await D.ctx.route('**/api/health',r=>r.abort());
 await D.ctx.route('**/api/amana/commit',async r=>{count++;await new Promise(ok=>setTimeout(ok,8000));await r.continue();});
 const slow=p.evaluate(()=>saveComment());await p.waitForFunction(()=>document.getElementById('writeStatus')?.textContent.includes('Сохраняем'));
 check('при медленной связи виден статус сохранения',await p.isVisible('#writeStatus.on'));
 await slow;
 check('задержка 8 секунд не запрещает запись и не требует /health',count===1&&await p.evaluate(()=>S.clients.find(x=>x.id==='c3').comment==='Медленная вымышленная запись'));
 await D.ctx.unroute('**/api/amana/commit');
 // Ответ потерян после реального сохранения: только один POST, проверка GET возвращает результат.
 count=0;await D.ctx.route('**/api/amana/commit',async r=>{count++;await r.fetch();await r.abort('failed');});
 await p.evaluate(()=>{openComment('c3');document.getElementById('mcText').value='Ответ потерян после записи';});await p.evaluate(()=>saveComment());
 check('потеря ответа после записи подтверждается без повторного POST',count===1&&await p.evaluate(()=>S.clients.find(x=>x.id==='c3').comment==='Ответ потерян после записи'&&!window.DB.writeState().pending));
 await D.ctx.unroute('**/api/amana/commit');
 // Запрос вообще не дошёл: сохраняем поля и не разрешаем отправить новый денежный запрос.
 let payload;count=0;await D.ctx.route('**/api/amana/commit',async r=>{count++;payload=r.request().postDataJSON();await r.abort('failed');});
 await p.evaluate(()=>{openComment('c3');document.getElementById('mcText').value='Сохрани поля при обрыве';});await p.evaluate(()=>saveComment());
 check('при неизвестном результате открытая форма и её текст сохранены',await p.isVisible('#mComment')&&await p.inputValue('#mcText')==='Сохрани поля при обрыве');
 check('неизвестный результат хранится до подтверждения',await p.evaluate(()=>!!window.DB.writeState().pending&&document.getElementById('writeStatus').textContent.includes('Проверить результат')));
 await p.evaluate(()=>saveComment());check('повторное нажатие при неизвестном результате не отправляет запрос',count===1);
 await p.reload();await p.waitForFunction(()=>window.AUTH?.currentUser&&window.DB?.writeState().pending&&typeof S!=='undefined'&&S.clients.some(c=>c.id==='c3')&&S.wallets.length>0);
 check('перезагрузка не забывает неподтверждённую запись',await p.evaluate(()=>!!window.DB.writeState().pending));
 await p.evaluate(()=>window.DB.cancelWrite());
 check('несохранённую запись можно безопасно отменить',await p.evaluate(()=>!window.DB.writeState().pending));
 check('опоздавший запрос после отмены не применяется',(await post(payload)).status===409);
 await D.ctx.unroute('**/api/amana/commit');
 // Бизнес-отказ: поля формы остаются, номер освобождается, запреты не обходятся.
 await D.ctx.route('**/api/amana/commit',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'bad',message:'Тестовый отказ проверки'})}));
 await p.evaluate(()=>{openComment('c3');document.getElementById('mcText').value='Не теряй текст при отказе';});await p.evaluate(()=>saveComment());
 const refused=await p.evaluate(()=>({visible:!!document.querySelector('#mComment.on'),value:document.getElementById('mcText').value,toast:document.getElementById('toast').textContent,state:window.DB.writeState()}));
 check('отказ сервера оставляет поля и показывает причину',refused.visible&&refused.value==='Не теряй текст при отказе'&&refused.toast.includes('Тестовый отказ проверки')&&!refused.state.pending,refused);
 await D.ctx.unroute('**/api/amana/commit');
 // Двойное нажатие: второй вызов не должен послать новый номер, пока первый сохраняется.
 count=0;await D.ctx.route('**/api/amana/commit',async r=>{count++;await new Promise(ok=>setTimeout(ok,300));await r.continue();});
 await p.evaluate(async()=>{openComment('c3');document.getElementById('mcText').value='Одно изменение при двойном нажатии';await Promise.all([saveComment(),saveComment()]);});
 check('двойное нажатие отправляет одно изменение',count===1,count);
 // Потерян ответ на оплату: деньги, долг и история меняются ровно один раз.
 await D.ctx.unroute('**/api/amana/commit');count=0;
 await D.ctx.route('**/api/amana/commit',async r=>{count++;await r.fetch();await r.abort('failed');});
 const moneyBefore=await p.evaluate(()=>({wallet:S.wallets.find(w=>w.id==='w1').balance,debt:getStats(S.clients.find(c=>c.id==='c3')).balance}));
 await p.evaluate(async()=>{openPay('c3');await Promise.all([savePay(111,'w1'),savePay(111,'w1')]);});
 const moneyAfter=await p.evaluate(()=>({wallet:S.wallets.find(w=>w.id==='w1').balance,debt:getStats(S.clients.find(c=>c.id==='c3')).balance,payments:S.payments.filter(x=>x.clientId==='c3'&&x.amount===111).length}));
 check('двойное нажатие и потеря ответа оплаты не дублируют деньги',count===1&&moneyAfter.wallet===moneyBefore.wallet+111&&moneyAfter.debt===moneyBefore.debt-111&&moneyAfter.payments===1,{count,moneyBefore,moneyAfter});
 // Если проверка временно недоступна, даже соседняя вкладка не начинает новую запись.
 await D.ctx.route('**/api/amana/requests/**',r=>r.request().method()==='GET'?r.abort('failed'):r.continue());
 await p.evaluate(async()=>{openComment('c3');document.getElementById('mcText').value='Сохранено, но подтверждение временно недоступно';await saveComment();});
 check('потерянное подтверждение не выдаётся за несохранённую операцию',await p.evaluate(()=>!!window.DB.writeState().pending));
 const other=await D.ctx.newPage();await login(other);
 const posts=count;const blocked=await other.evaluate(async()=>{try{await window.DB.updateDoc(window.DB.doc(window.DB.db,'clients','c3'),{comment:'Не должна отправиться'});return false;}catch(e){return e.code==='pending';}});
 check('неподтверждённая запись блокирует повтор и в соседней вкладке',blocked&&count===posts);
 await p.evaluate(()=>{closeM('mComment');openComment('c3');document.getElementById('mcText').value='Новая несохранённая форма';});
 const finished=await p.evaluate(()=>window.DB.cancelWrite());
 check('отмена ожидания подтверждает уже сохранённое без отмены данных',finished.state==='saved'&&await p.evaluate(()=>!window.DB.writeState().pending&&S.clients.find(x=>x.id==='c3').comment==='Сохранено, но подтверждение временно недоступно'));
 check('подтверждение старой записи не закрывает новую открытую форму',await p.isVisible('#mComment.on')&&await p.inputValue('#mcText')==='Новая несохранённая форма');
 await other.close();await D.ctx.unroute('**/api/amana/requests/**');
 // Настоящий предел ожидания 30 секунд: ускоряем только часы браузера.
 await D.ctx.unroute('**/api/amana/commit');await p.clock.install();let held;
 await D.ctx.route('**/api/amana/commit',r=>{held=r;});
 await p.evaluate(()=>{openComment('c3');document.getElementById('mcText').value='Ожидание до 30 секунд';});
 const timed=p.evaluate(()=>saveComment());await p.waitForFunction(()=>window.DB.writeState().writing);
 await p.clock.fastForward(31000);await timed;
 check('после 30 секунд без ответа сохраняется неизвестный статус, а не ложный отказ',await p.evaluate(()=>!!window.DB.writeState().pending&&document.getElementById('mcText').value==='Ожидание до 30 секунд'&&document.getElementById('writeStatus').textContent.includes('Результат пока неизвестен')));
 await p.evaluate(()=>window.DB.cancelWrite());if(held)await held.abort().catch(()=>{});await p.clock.resume();
 // Форма оплаты также остаётся открытой с суммой, если ответ не подтверждён.
 await D.ctx.unroute('**/api/amana/commit');await D.ctx.route('**/api/amana/commit',r=>r.abort('failed'));
 await p.evaluate(()=>{closeM('mComment');openPay('c3');document.getElementById('mpAmt').value='111';document.getElementById('mpPt').value='w1';confirmPay();});
 await p.click('#cfOk');await p.waitForFunction(()=>!!window.DB.writeState().pending&&!window.DB.writeState().writing);
 check('неподтверждённая оплата оставляет открытой форму и введённую сумму',await p.isVisible('#mPay.on')&&await p.inputValue('#mpAmt')==='111');
 await p.evaluate(()=>window.DB.cancelWrite());
 noErrors('медленная связь и восстановление ответа',D.errs);await D.ctx.close();
}
