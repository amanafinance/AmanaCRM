// Подключение CRM к базе Firebase (Firestore + вход по почте).
// Выбирается в index.html, когда CRM открыта не на своём сервере. Наружу отдаёт window.DB, window.AUTH, SIGN_IN, SIGN_OUT, ON_AUTH.
import{initializeApp}from"./vendor/firebase-11.0.0/firebase-app.js";
import{initializeFirestore,persistentLocalCache,persistentMultipleTabManager,CACHE_SIZE_UNLIMITED,connectFirestoreEmulator,collection,doc,addDoc,updateDoc,getDocs,getDocsFromCache,getDocsFromServer,getDoc,getDocFromServer,terminate,clearIndexedDbPersistence,query,orderBy,limit,startAfter,where,onSnapshot,setDoc,writeBatch,runTransaction,increment,arrayUnion,arrayRemove,deleteField,serverTimestamp,Timestamp}from"./vendor/firebase-11.0.0/firebase-firestore.js";
import{getAuth,connectAuthEmulator,signInWithEmailAndPassword,onAuthStateChanged,signOut}from"./vendor/firebase-11.0.0/firebase-auth.js";
const app=initializeApp({apiKey:"AIzaSyCZZCJiPUfZ2OqAa2CaQXKeHGh5MGR9uuo",authDomain:"amana-crm-16033.firebaseapp.com",projectId:"amana-crm-16033",storageBucket:"amana-crm-16033.firebasestorage.app",messagingSenderId:"21151729250",appId:"1:21151729250:web:06fe4021102a8ac8c9333b"});
// База хранится и на устройстве (кэш без ограничения размера), поэтому при открытии
// с сервера скачиваются только изменения — это экономит лимит чтений Firebase.
let db;
try{db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager(),cacheSizeBytes:CACHE_SIZE_UNLIMITED})});}
catch(e){console.warn('Кэш на устройстве недоступен:',e);db=initializeFirestore(app,{});}
const auth=getAuth(app);
if(window.__AMANA_EMU){connectFirestoreEmulator(db,'127.0.0.1',window.__AMANA_EMU.fs);connectAuthEmulator(auth,'http://127.0.0.1:'+window.__AMANA_EMU.auth,{disableWarnings:true});}

// ---- Каждая запись получает метку времени изменения _u (время сервера) ----
// По ней при следующем открытии запрашиваются только изменённые документы.
// Удаления оставляют «надгробие» в коллекции deleted, чтобы запись пропала и на других устройствах.
const U='_u',TOMB='deleted';
const stamp=d=>Object.assign({},d,{[U]:serverTimestamp()});
const tomb=(bt,ref)=>bt.set(doc(collection(db,TOMB)),{c:ref.parent.id,id:ref.id,[U]:serverTimestamp()});
// ---- Запись только при интернете ----
// Без связи с сервером ничего не сохраняется: перед записью проверяем, что сервер отвечает.
// Читать (смотреть данные) без интернета можно — они хранятся на устройстве.
let netOkAt=0,netDown=false;
const netBadge=()=>{let el=document.getElementById('netBadge');if(!el){el=document.createElement('div');el.id='netBadge';document.body.appendChild(el);}
  const off=!navigator.onLine||netDown;el.textContent=off?'Нет интернета · только просмотр, изменения не сохраняются':'';el.classList.toggle('on',off);};
window.addEventListener('online',()=>{netOkAt=0;netDown=false;netBadge();});window.addEventListener('offline',()=>{netOkAt=0;netBadge();});netBadge();
const NET_ERR='Нет интернета — изменение не сохранено. Подключитесь к сети и повторите.';
const netFail=()=>{netDown=true;netOkAt=0;netBadge();return Object.assign(new Error(NET_ERR),{code:'offline'});};
// «Нет интернета», «Недостаточно средств», «Договор изменился» — ожидаемые ситуации, а не сбой: в консоли это предупреждение, а не ошибка
// При перезагрузке базы (восстановление из копии, «перечитать всё») подписки закрываются — их «Firestore shutting down» не ошибка
let closing=false;
const _cErr=console.error.bind(console);console.error=(...a)=>closing||a[0]&&['offline','short','stale'].includes(a[0].code)?console.warn(...a):_cErr(...a);
const withTimeout=(pr,ms)=>Promise.race([pr,new Promise((_,no)=>setTimeout(()=>no(new Error('timeout')),ms))]);
// Сервер отвечал недавно (15 с) — не спрашиваем снова: одно действие часто пишет несколько раз
const netCheck=async()=>{
  if(!navigator.onLine)throw netFail();
  if(Date.now()-netOkAt<15000)return;
  try{await withTimeout(getDocFromServer(doc(db,'settings','meta')),7000);netOkAt=Date.now();if(netDown){netDown=false;netBadge();}}
  catch(e){throw netFail();}
};
// Запись ждём не дольше 15 с: если связь пропала прямо во время сохранения, честно говорим об этом
const send=pr=>withTimeout(pr,15000).catch(e=>{if(e&&e.message==='timeout'){netFail();throw new Error('Связь пропала во время сохранения. Изменение отправится само, когда сеть вернётся — не повторяйте его, а проверьте через минуту.');}throw e;});
const setDocU=(ref,d,o)=>netCheck().then(()=>send(o?setDoc(ref,stamp(d),o):setDoc(ref,stamp(d))));
const updateDocU=(ref,d)=>netCheck().then(()=>send(updateDoc(ref,stamp(d))));
const addDocU=(c,d)=>{const r=doc(c);return netCheck().then(()=>send(setDoc(r,stamp(d)))).then(()=>r);};
const deleteDocU=ref=>netCheck().then(()=>{const b=writeBatch(db);b.delete(ref);tomb(b,ref);return send(b.commit());});
// Пачка записей. commit() — обычная пачка; commit({wallets,deal}) — транзакция, в которой сервер
// сам сверяет остатки в момент записи: счёт не уходит в минус (wallets: {id: изменение}), а оплату по
// договору нельзя провести, если договор изменился на другом устройстве (deal: {id, seq}).
const writeBatchU=()=>{const ops=[],w={
  set:(r,d,o)=>{ops.push(['set',r,stamp(d),o]);return w;},
  update:(r,d)=>{ops.push(['update',r,stamp(d)]);return w;},
  delete:r=>{ops.push(['delete',r]);ops.push(['set',doc(collection(db,TOMB)),{c:r.parent.id,id:r.id,[U]:serverTimestamp()}]);return w;},
  commit:chk=>netCheck().then(()=>send(chk?checkedTx(chk,ops):(()=>{const b=writeBatch(db);ops.forEach(o=>applyOp(b,o));return b.commit();})()))};return w;};
const applyOp=(b,[t,r,d,o])=>t==='set'?(o?b.set(r,d,o):b.set(r,d)):t==='update'?b.update(r,d):b.delete(r);
const r2=v=>Math.round(v*100)/100;
const checkedTx=(chk,ops)=>runTransaction(db,async tx=>{
  const ws=Object.entries(chk.wallets||{}).filter(([,d])=>d<-0.004),snaps=[];
  for(const [id] of ws)snaps.push(await tx.get(doc(db,'wallets',id)));
  const dref=chk.deal?doc(db,'clients',chk.deal.id):null,ds=dref?await tx.get(dref):null;
  ws.forEach(([id,d],i)=>{const sn=snaps[i];if(!sn.exists())return;const x=sn.data(),b=r2(parseFloat(x.balance)||0);
    if(r2(b+d)<-0.004)throw Object.assign(new Error('Недостаточно средств: на счёте «'+(x.name||'')+'» '+b.toLocaleString('ru-RU')+' ₽, а нужно '+(-d).toLocaleString('ru-RU')+' ₽. Счёт не может уйти в минус.'),{code:'short'});});
  let seq=0;
  if(dref){seq=ds.exists()?(ds.data().paySeq||0):0;
    if(seq!==(chk.deal.seq||0))throw Object.assign(new Error('Договор изменился: только что на другом устройстве по нему провели оплату или скидку. Проверьте остаток и повторите.'),{code:'stale'});}
  ops.forEach(o=>applyOp(tx,o));
  if(dref)tx.update(dref,{paySeq:seq+1,[U]:serverTimestamp()});
});
// Следующие номера (договоров — settings/counter, клиентов — settings/pcounter).
// Транзакция: два человека не получат один номер. n — сколько номеров занять сразу; возвращается первый.
const nextCounter=async(id,n)=>{await netCheck();id=id||'counter';n=n||1;const ref=doc(db,'settings',id);return runTransaction(db,async tx=>{const s=await tx.get(ref),first=(s.exists()?(s.data().lastId||0):0)+1;tx.set(ref,{lastId:first+n-1,[U]:serverTimestamp()},{merge:true});return first;});};
// Записать документ, только если его ещё нет (вместе с сопутствующими записями) — защита от двойного
// действия с двух устройств. Если документ уже есть, бросает ошибку с code:'exists'.
const createOnce=async(ref,data,more)=>{await netCheck();return runTransaction(db,async tx=>{const s=await tx.get(ref);if(s.exists())throw Object.assign(new Error('exists'),{code:'exists'});
  tx.set(ref,stamp(data));(more||[]).forEach(([r,d])=>tx.set(r,stamp(d)));});};

// ---- Живая коллекция: кэш устройства + только изменения с сервера ----
const FULL_EVERY=7*864e5,OVERLAP=5*60e3,SYNC_KEY='amana_sync_v2';
const syncGet=()=>{try{return JSON.parse(localStorage.getItem(SYNC_KEY)||'{}');}catch(e){return{};}};
const syncSet=(c,v)=>{try{const s=syncGet();s[c]=Object.assign(s[c]||{},v);localStorage.setItem(SYNC_KEY,JSON.stringify(s));}catch(e){}};
const uMs=d=>{const t=d&&d[U];return t&&t.toMillis?t.toMillis():0;};
const tombs=new Map(),liveEmit={};
const syncStats={server:{},cache:{}};window.SYNC_STATS=syncStats;
async function live(name,opts,cb,onErr){
  opts=opts||{};
  const map=new Map(),st=syncGet()[name]||{};
  let last=st.last||0;
  const emit=()=>{
    let arr=[];
    map.forEach((d,id)=>{const t=name!==TOMB&&tombs.get(name+'/'+id);if(t&&(!d[U]||uMs(d)<=t)&&d[U]!==null)return;arr.push({id,d});});
    if(opts.order){const f=opts.order,v=x=>{const y=x.d[f];return y&&y.toMillis?y.toMillis():(y instanceof Date?y.getTime():0);};arr.sort((a,b)=>v(b)-v(a));}
    cb({docs:arr.map(x=>({id:x.id,data:()=>x.d}))});
  };
  const take=(docs,src)=>{docs.forEach(x=>{map.set(x.id,x.data());});syncStats[src][name]=(syncStats[src][name]||0)+docs.length;};
  try{
    let cached=[];
    try{cached=(await getDocsFromCache(collection(db,name))).docs;}catch(e){}
    const full=!last||!cached.length||Date.now()-(st.full||0)>FULL_EVERY;
    if(full){
      const s=await getDocsFromServer(collection(db,name));
      take(s.docs,'server');
      last=s.docs.reduce((m,x)=>Math.max(m,uMs(x.data())),0)||Date.now()-OVERLAP;
      syncSet(name,{last,full:Date.now()});
    }else take(cached,'cache');
    emit();
    liveEmit[name]=emit; // перерисовка по надгробиям — только когда данные уже загружены
  }catch(e){console.error(name,e);if(onErr)onErr(e);}
  // Свои изменения, ещё не отправленные на сервер (нет интернета или он медленный), показываем сразу:
  // они уже лежат в памяти устройства, а запрос «только изменения с сервера» их не видит, пока нет метки времени сервера.
  onSnapshot(collection(db,name),{source:'cache'},s=>{
    let changed=false;
    s.docChanges().forEach(ch=>{if(ch.type!=='removed'&&ch.doc.metadata.hasPendingWrites){map.set(ch.doc.id,ch.doc.data());changed=true;}});
    if(changed&&liveEmit[name])emit();
  },e=>console.warn(name,e));
  const since=Timestamp.fromMillis(Math.max(0,last-OVERLAP));
  return onSnapshot(query(collection(db,name),where(U,'>',since)),s=>{
    let changed=false;
    s.docChanges().forEach(ch=>{
      // «removed» приходит и когда запись просто сохраняется (метка времени ещё не проставлена сервером),
      // поэтому удалённой запись считаем только по надгробию. Локальную версию оставляем на экране.
      if(ch.type==='removed'){if(ch.doc.metadata.hasPendingWrites){map.set(ch.doc.id,ch.doc.data());changed=true;}return;}
      map.set(ch.doc.id,ch.doc.data());changed=true;
      if(!ch.doc.metadata.fromCache)syncStats.server[name]=(syncStats.server[name]||0)+1;
      if(!ch.doc.metadata.hasPendingWrites){const t=uMs(ch.doc.data());if(t>last)last=t;}
    });
    if(!s.metadata.fromCache)syncSet(name,{last});
    if(changed)emit();
  },e=>{console.error(name,e);if(onErr)onErr(e);});
}
// Надгробия загружаются первыми, чтобы удалённое не мелькало
async function liveTombs(){
  let first=true,res;const ready=new Promise(r=>res=r);
  live(TOMB,{},s=>{tombs.clear();s.docs.forEach(x=>{const d=x.data();const k=d.c+'/'+d.id,t=uMs(d)||Date.now();if(!tombs.has(k)||tombs.get(k)<t)tombs.set(k,t);});
    if(first){first=false;res();}else Object.keys(liveEmit).forEach(n=>{if(n!==TOMB)liveEmit[n]();});});
  await Promise.race([ready,new Promise(r=>setTimeout(r,8000))]);
}
// ---- База очищена в консоли Firebase? ----
// В settings/meta лежит метка базы. Если её нет или она не совпадает с запомненной на устройстве,
// данные на устройстве устарели: стираем их и загружаем всё заново (1 чтение при каждом открытии).
const EPOCH_KEY='amana_epoch';
async function checkEpoch(){
  let ep;
  try{
    const ref=doc(db,'settings','meta'),s=await getDocFromServer(ref);
    ep=s.exists()&&s.data().epoch;
    if(!ep)ep=await runTransaction(db,async tx=>{const t=await tx.get(ref);if(t.exists()&&t.data().epoch)return t.data().epoch;const e=Date.now().toString(36)+Math.random().toString(36).slice(2,8);tx.set(ref,{epoch:e,[U]:serverTimestamp()});return e;});
  }catch(e){return;} // нет интернета — работаем с данными устройства
  let mine=null,had=false;try{mine=localStorage.getItem(EPOCH_KEY);had=!!localStorage.getItem(SYNC_KEY);}catch(e){}
  if(mine===ep)return;
  try{localStorage.removeItem(SYNC_KEY);localStorage.setItem(EPOCH_KEY,ep);}catch(e){}
  if(!had)return; // на устройстве ещё ничего не загружали — стирать нечего
  closing=true;try{await terminate(db);await clearIndexedDbPersistence(db);}catch(e){console.warn('Кэш не очищен:',e);}
  location.reload();await new Promise(()=>{});
}
// Полностью перечитать базу с сервера (кнопка в настройках)
async function resyncAll(){try{localStorage.removeItem(SYNC_KEY);}catch(e){}closing=true;try{await terminate(db);await clearIndexedDbPersistence(db);}catch(e){}location.reload();}

// Номер договора и сам договор пишутся одной транзакцией: если сохранить не удалось, номер не тратится.
// fn(w,last) делает записи через w и возвращает новое значение счётчика.
const counterTx=async(id,fn)=>{await netCheck();const ref=doc(db,'settings',id);return runTransaction(db,async tx=>{
  const s=await tx.get(ref),last=s.exists()?(s.data().lastId||0):0;
  const w={set:(r,d,o)=>{o?tx.set(r,stamp(d),o):tx.set(r,stamp(d));return w;},update:(r,d)=>{tx.update(r,stamp(d));return w;},delete:r=>{tx.delete(r);tomb(tx,r);return w;}};
  const nv=await fn(w,last);if(nv!==last)tx.set(ref,{lastId:nv,[U]:serverTimestamp()},{merge:true});return nv;});};
// ---- Резервная копия: вся база в одном файле JSON ----
// Формат переносимый: даты — {"$date":"ISO-время"}, суммы — числа, номера записей (id) сохраняются, связи между записями не меняются.
// Служебное для синхронизации (метка _u, надгробия, settings/meta) в копию не входит.
// История действий и корзина входят в копию для переноса, но при восстановлении не трогаются (они только дописываются).
const BK_COLS=['clients','payments','kassaOps','wallets','persons','investors','invOps','invMonths','settings'],BK_LOGS=['journal','trash'];
const bkOut=v=>v instanceof Timestamp?{$date:v.toDate().toISOString()}:Array.isArray(v)?v.map(bkOut)
  :v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,bkOut(x)])):(typeof v==='number'&&!isFinite(v))?null:v;
const bkIn=v=>Array.isArray(v)?v.map(bkIn):v&&typeof v==='object'?(Object.keys(v).length===1&&typeof v.$date==='string'?Timestamp.fromDate(new Date(v.$date))
  :Object.fromEntries(Object.entries(v).map(([k,x])=>[k,bkIn(x)]))):v;
const bkSkip=(c,id)=>c==='settings'&&id==='meta';
// Читаем с сервера; если сервер недоступен — из памяти устройства (копия может быть не самой свежей, это отмечается в файле)
async function bkDump(){
  const cols=[...BK_COLS,...BK_LOGS];
  let src='server',got;
  const one=async(c,server)=>{const s=server?await withTimeout(getDocsFromServer(collection(db,c)),30000):await getDocsFromCache(collection(db,c));
    return s.docs.filter(x=>{if(bkSkip(c,x.id))return false;if(server)return true;const t=tombs.get(c+'/'+x.id),d=x.data();return!(t&&(!d[U]||uMs(d)<=t));});};
  try{if(!navigator.onLine)throw new Error('offline');got=await Promise.all(cols.map(c=>one(c,true)));}
  catch(e){src='device';got=await Promise.all(cols.map(c=>one(c,false).catch(()=>[])));}
  const collections={},counts={};
  cols.forEach((c,i)=>{const o={};got[i].forEach(x=>{const d=Object.assign({},x.data());delete d[U];o[x.id]=bkOut(d);});collections[c]=o;counts[c]=got[i].length;});
  return{format:'amana-crm-backup',version:1,createdAt:new Date().toISOString(),source:src,counts,collections};
}
// Проверка файла копии: только известные разделы, у каждой записи допустимый номер и данные-объект
function bkCheck(B){
  if(!B||B.format!=='amana-crm-backup'||!B.collections||typeof B.collections!=='object')return'Это не файл копии Amana CRM';
  if(B.version!==1)return'Копия сделана более новой версией CRM — обновите страницу и попробуйте снова';
  for(const c of BK_COLS){const o=B.collections[c];if(o===undefined)continue;if(!o||typeof o!=='object'||Array.isArray(o))return'Файл копии повреждён (раздел '+c+')';
    for(const [id,d] of Object.entries(o))if(!id||id.includes('/')||id==='.'||id==='..'||/^__.*__$/.test(id)||id.length>700||!d||typeof d!=='object'||Array.isArray(d))return'Файл копии повреждён (запись '+c+'/'+String(id).slice(0,40)+')';}
  if(!B.collections.clients||!B.collections.wallets)return'В файле нет договоров или счетов — это не полная копия';
  return'';
}
// Восстановление: база становится точно такой, как в копии. Записи, которых в копии нет, удаляются (с надгробием —
// чтобы пропали и на других устройствах), остальные записываются целиком. Повторный запуск с тем же файлом даёт тот же результат.
// В конце меняется метка базы: все устройства при открытии заново загрузят данные с сервера.
async function bkRestore(B,prog){
  const err=bkCheck(B);if(err)throw new Error(err);
  await netCheck();
  const ops=[];let put=0,del=0;
  for(const c of BK_COLS){
    const want=B.collections[c]||{},cur=(await withTimeout(getDocsFromServer(collection(db,c)),30000)).docs;
    cur.forEach(x=>{if(bkSkip(c,x.id)||Object.prototype.hasOwnProperty.call(want,x.id))return;
      ops.push(['delete',x.ref],['set',doc(collection(db,TOMB)),{c,id:x.id,[U]:serverTimestamp()}]);del++;});
    Object.entries(want).forEach(([id,d])=>{if(bkSkip(c,id))return;ops.push(['set',doc(db,c,id),stamp(bkIn(d))]);put++;});
  }
  for(let i=0;i<ops.length;i+=400){const b=writeBatch(db);ops.slice(i,i+400).forEach(o=>applyOp(b,o));await withTimeout(b.commit(),60000);if(prog)prog(Math.min(i+400,ops.length),ops.length);}
  const ep=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  await withTimeout(setDoc(doc(db,'settings','meta'),{epoch:ep,[U]:serverTimestamp()}),30000);
  return{put,del};
}
window.DB={db,counterTx,collection,doc,addDoc:addDocU,updateDoc:updateDocU,deleteDoc:deleteDocU,getDocs,getDoc,query,orderBy,limit,startAfter,where,onSnapshot,setDoc:setDocU,writeBatch:writeBatchU,increment,arrayUnion,arrayRemove,deleteField,nextCounter,createOnce,live,liveTombs,resyncAll,checkEpoch,bkDump,bkRestore,bkCheck};
window.AUTH=auth;window.SIGN_IN=signInWithEmailAndPassword;window.SIGN_OUT=signOut;window.ON_AUTH=onAuthStateChanged;
window.dispatchEvent(new Event('dbReady'));
