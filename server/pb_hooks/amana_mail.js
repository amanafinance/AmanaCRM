const COLS=['clients','payments','kassaOps','wallets','persons','investors','invOps','invMonths','settings','journal','trash','returns'];
function owner(e){if(!e.auth||(e.auth.collection().name!=='_superusers'&&e.auth.getString('perms')!=='*'))throw new ForbiddenError('Настройки почты доступны владельцу');}
function config(app){try{const r=app.findRecordById('amanaBackup','daily');return {record:r,data:JSON.parse(r.getString('data'))};}catch{return {record:null,data:{enabled:false,email:'',time:'03:45'}};}}
function store(app,data){const c=config(app),r=c.record||new Record(app.findCollectionByNameOrId('amanaBackup'));r.set('id','daily');r.set('data',data);r.set('u',Date.now());app.save(r);}
function key(app){const path=app.dataDir()+'/../.amana-mail-key';try{const k=toString($os.readFile(path)).trim();if(k.length!==32)throw new Error('Invalid key');return k;}catch(e){
  // Потерянный ключ нельзя заменять, если уже есть зашифрованный пароль.
  if(config(app).data.password)throw new Error('Не найден ключ почтовых копий. Задайте настройки на сервере');
  const k=$security.randomString(32);$os.writeFile(path,k,0o600);return k;
}}
function publicConfig(app){const d=config(app).data,s=app.settings();return {enabled:!!d.enabled,email:d.email||'',time:d.time||'03:45',timezone:'Europe/Moscow',hasPassword:!!d.password,lastSent:d.lastSent||'',lastError:d.lastError||'',nextRetry:d.nextRetry||0,smtpReady:!!s.smtp.enabled,sender:s.meta.senderAddress||''};}
function settings(e,app){owner(e);if(e.request.method==='GET')return e.json(200,publicConfig(app));
 const b=e.requestInfo().body||{},old=config(app).data;
 if(typeof b.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||'')||!/^\S+@[^\s@]+\.[^\s@]+$/.test(b.email||'')||b.email.length>254)throw new BadRequestError('Проверьте почту и время');
 if(b.enabled&&!app.settings().smtp.enabled&&$os.getenv('AMANA_TEST')!=='1')throw new BadRequestError('Сначала подключите отправку писем на сервере');
 const data={...old,enabled:b.enabled,email:b.email.trim().toLowerCase(),time:b.time};
 if(b.password){if(typeof b.password!=='string'||b.password.length<8||b.password.length>1024)throw new BadRequestError('Пароль копии — от 8 до 1024 символов');data.password=$security.encrypt(b.password,key(app));}
 if(!data.password)throw new BadRequestError('Укажите пароль для копий');
 app.runInTransaction(tx=>{store(tx,data);audit(tx,e,'Настроена отправка резервных копий');});
 return e.json(200,publicConfig(app));
}
function audit(app,e,type){const now=new Date(),local=new Date(now.getTime()+10800000).toISOString(),r=new Record(app.findCollectionByNameOrId('journal'));r.set('data',{type,description:type,user:e&&e.auth?e.auth.email():'сервер',userId:e&&e.auth?e.auth.id:'',date:{$date:now.toISOString()},dateStr:local.slice(0,10).split('-').reverse().join('.'),time:local.slice(11,16)});r.set('u',now.getTime());r.set('d',now.getTime());app.save(r);}
function snapshot(app){const now=new Date(),B={format:'amana-crm-backup',version:1,createdAt:now.toISOString(),source:'server',partial:false,counts:{},collections:{}};
 app.runInTransaction(tx=>{for(const c of COLS){const docs={};tx.findAllRecords(c).forEach(r=>{if(c==='settings'&&r.id==='meta')return;const d=JSON.parse(r.getString('data')||'{}');delete d._u;docs[r.id]=d;});B.collections[c]=docs;B.counts[c]=Object.keys(docs).length;}});return B;
}
function send(app,manual,e,testNow){
 let d;
 const now=$os.getenv('AMANA_TEST')==='1'&&Number.isFinite(testNow)?testNow:Date.now(),date=new Date(now+10800000).toISOString().slice(0,10),clock=new Date(now+10800000).toISOString().slice(11,16),lease=$security.randomString(20);
 // Транзакционная аренда предотвращает параллельную отправку cron и кнопкой.
 let claimed=false;app.runInTransaction(tx=>{d=config(tx).data;if(!d.password||(!manual&&(!d.enabled||clock<d.time||d.lastDay===date||now<(d.nextRetry||0))))return;if(d.leaseUntil>now)return;d={...d,lease,leaseUntil:now+10*60*1000,lastAttempt:new Date(now).toISOString()};store(tx,d);claimed=true;});
 if(!claimed){if(manual)throw new BadRequestError('Укажите настройки или дождитесь завершения отправки');return;}
 let file=null;
 try{
  const payload=JSON.stringify({password:toString($security.decrypt(d.password,key(app))),backup:snapshot(app)});
  const input=$filesystem.fileFromBytes(toBytes(payload),'payload.json');
  const reader=input.reader.open();
  const cmd=$os.cmd('/usr/bin/python3',__hooks+'/amana_backup.py');cmd.stdin=reader;
  let encrypted;try{encrypted=toString(cmd.output());}finally{reader.close();}
  if(encrypted.length>18*1024*1024)throw new Error('Копия слишком большая для письма: используйте ручную выгрузку');
  const parsed=JSON.parse(encrypted);if(parsed.format!=='amana-crm-backup-encrypted')throw new Error('Ошибка шифрования');
  file=$filesystem.fileFromBytes(toBytes(encrypted),'backup.json').reader.open();
  const name='amana-backup-'+new Date(now+10800000).toISOString().slice(0,16).replace('T','_').replace(':','-')+'.json';
  const s=app.settings(),message=new MailerMessage({from:{address:s.meta.senderAddress,name:s.meta.senderName||'Amana CRM'},to:[{address:d.email}],subject:'Amana CRM: резервная копия за '+date,text:'Зашифрованная копия базы во вложении. Пароль выбран в CRM и в письме не передаётся.',attachments:{[name]:file}});
  if($os.getenv('AMANA_TEST')==='1'){
    // В тестах SMTP вообще не вызывается: письмо остаётся только в памяти временного сервера.
    if(app.store().get('testmailfail'))throw new Error('Тест: доставка недоступна');
    const count=(app.store().get('testmailcount')||0)+1;app.store().set('testmailcount',count);
    app.store().set('testmail',{to:message.to,subject:message.subject,attachments:{[name]:encrypted},sentCount:count});
  }else app.newMailClient().send(message);
  app.runInTransaction(tx=>{const current=config(tx).data;if(current.lease!==lease)return;store(tx,{...current,lastSent:new Date(now).toISOString(),lastDay:date,lastError:'',nextRetry:0,leaseUntil:0});audit(tx,e,'Отправлена резервная копия на почту');});
 }catch(err){
  const message=$os.getenv('AMANA_TEST')==='1'?String(err):/Копия слишком/.test(String(err))?String(err):'Не удалось отправить копию. Проверьте настройки почты и журнал сервера.';
  app.runInTransaction(tx=>{const current=config(tx).data;if(current.lease===lease)store(tx,{...current,lastError:message,nextRetry:now+30*60*1000,leaseUntil:0});});
  app.logger().error('Не выполнена почтовая копия');
  if(manual)throw new BadRequestError(message);
 }finally{if(file)file.close();}
}
function sendNow(e,app){owner(e);send(app,true,e);return e.json(200,publicConfig(app));}
function note(e,app){const b=e.requestInfo().body||{};const perms=e.auth.collection().name==='_superusers'?'*':e.auth.getString('perms');if(perms!=='*'&&!perms.includes(',backup,'))throw new ForbiddenError('Нет права на копию');if(b.type!=='Скачана резервная копия')throw new BadRequestError('Неизвестное действие');audit(app,e,b.type);return e.json(200,{ok:true});}
module.exports={settings,sendNow,send,note,snapshot,audit};
