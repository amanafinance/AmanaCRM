// Подключение CRM к своему серверу (PocketBase).
// Наружу отдаёт window.DB (документы, пачки записей, живые коллекции, номера, копия),
// window.AUTH, SIGN_IN, SIGN_OUT, ON_AUTH — общий интерфейс работы с базой для экранов CRM.
//
// Как устроено:
// - каждая запись хранится на сервере как {id, data (поля в JSON), u (время изменения)}; даты — {"$date": ISO};
// - все изменения идут одной транзакцией через /api/amana/commit — сервер сам проверяет остатки, номера,
//   «договор изменился», не даёт менять историю действий (см. server/pb_hooks);
// - живые коллекции хранятся на устройстве (IndexedDB): при открытии показываются сразу, с сервера
//   докачиваются только изменения, дальше изменения приходят сами (realtime);
// - удаления оставляют «надгробие» в коллекции deleted, чтобы запись пропала и на устройствах, которые были офлайн.
import PocketBase from './vendor/pocketbase-0.28.1/pocketbase.es.js';

const BASE = String(window.__AMANA_PB || location.origin).replace(/\/$/, '');
const pb = new PocketBase(BASE);
pb.autoCancellation(false);
// Номер этого устройства (случайный, хранится на устройстве) и «приложение на экране Домой» — для списка устройств сотрудника
const DEV_KEY = 'amana_device';
let devId = ''; try { devId = localStorage.getItem(DEV_KEY) || ''; if (!devId) { devId = Array.from(crypto.getRandomValues(new Uint8Array(12)), x => x.toString(36).padStart(2, '0')).join('').slice(0, 20); localStorage.setItem(DEV_KEY, devId); } } catch (e) {}
const isApp = (() => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } })();
pb.beforeSend = (url, options) => { options.headers = Object.assign({}, options.headers, devId ? { 'X-Amana-Device': devId } : {}, { 'X-Amana-App': isApp ? '1' : '0' }); return { url, options }; };
const TOMB = 'deleted';

// ---------- Дата/время (у CRM везде .toDate()) ----------
class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
  static fromDate(d) { const ms = d.getTime(); return new Timestamp(Math.floor(ms / 1000), ((ms % 1000) + 1000) % 1000 * 1e6); }
  static fromMillis(ms) { return Timestamp.fromDate(new Date(ms)); }
  static now() { return Timestamp.fromDate(new Date()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
  valueOf() { return String(this.toMillis()).padStart(16, '0'); }
  toJSON() { return { $date: this.toDate().toISOString() }; }
  toString() { return 'Timestamp(' + this.toDate().toISOString() + ')'; }
}
// Особые значения для записи (увеличение, изменение списков, удаление поля и время сервера)
class Sentinel { constructor(op, v) { this.$op = op; if (v !== undefined) this.v = v; } }
const increment = n => new Sentinel('inc', n);
const arrayUnion = (...v) => new Sentinel('union', v.map(enc));
const arrayRemove = (...v) => new Sentinel('remove', v.map(enc));
const deleteField = () => new Sentinel('del');
const serverTimestamp = () => new Sentinel('now');

const isPlain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
// В формат сервера: даты → {$date}, особые значения → {$op}
function enc(v) {
  if (v instanceof Date) return { $date: isNaN(v) ? new Date(0).toISOString() : v.toISOString() };
  if (v instanceof Timestamp) return { $date: v.toDate().toISOString() };
  if (v instanceof Sentinel) return Object.assign({}, v);
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { if (v[k] !== undefined) o[k] = enc(v[k]); }); return o; }
  if (typeof v === 'number' && !isFinite(v)) return null;
  return v;
}
// Из формата сервера: {$date} → Timestamp
function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (ks.length === 1 && typeof v.$date === 'string') return Timestamp.fromDate(new Date(v.$date));
    const o = {}; ks.sort().forEach(k => { o[k] = dec(v[k]); }); return o; // поля по алфавиту — порядок всегда одинаковый
  }
  return v;
}
const encTop = d => { const o = enc(d || {}); delete o._u; return o; };

// ---------- Ссылки на коллекции и записи ----------
const db = { pb };
const AUTO_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const autoId = () => { const a = crypto.getRandomValues(new Uint8Array(20)); let s = ''; a.forEach(x => { s += AUTO_ABC[x % 62]; }); return s; };
function collection(_db, name) { return { type: 'collection', id: name, path: name }; }
function doc(a, c, id) {
  if (a && a.type === 'collection') { const i = c || autoId(); return { type: 'document', id: i, parent: a, path: a.id + '/' + i }; }
  const i = id || autoId(); return { type: 'document', id: i, parent: collection(null, c), path: c + '/' + i };
}

// ---------- Связь с сервером ----------
// Запись отправляется сразу. Одна попытка до 30 секунд; при обрыве проверяется только результат.
let netDown=false,closing=false;
const netBadge=()=>{let el=document.getElementById('netBadge');if(!el){el=document.createElement('div');el.id='netBadge';document.body.appendChild(el);}const off=!navigator.onLine||netDown;el.textContent=!navigator.onLine?'Нет интернета · только просмотр, изменения не сохраняются':netDown?'Ответ сервера не получен · проверяем результат сохранения':'';el.classList.toggle('on',off);};
const NET_ERR='Нет интернета — изменение не сохранено. Подключитесь к сети и повторите.';
const netFail=()=>{netDown=true;netBadge();return Object.assign(new Error(NET_ERR),{code:'offline'});};
const _cErr=console.error.bind(console);console.error=(...a)=>closing||a[0]&&['offline','short','stale','pending','busy','cancelled','already-saved'].includes(a[0].code)?console.warn(...a):_cErr(...a);
const withTimeout=(pr,ms)=>new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error('timeout')),ms);Promise.resolve(pr).then(v=>{clearTimeout(t);ok(v);},e=>{clearTimeout(t);no(e);});});
const netCheck=async()=>{if(!navigator.onLine)throw netFail();};
const ERR_CODE={short:'short',stale:'stale',exists:'exists',denied:'permission-denied',missing:'not-found',bad:'invalid-argument',cancelled:'cancelled'};
const WRITE_MS=30000;
const tabId=autoId();let writing=false,recovery=null;
const pendingKey=()=>pb.authStore.record?'amana_pending_write_'+pb.authStore.record.id:null;
const pendingRead=()=>{const k=pendingKey();if(!k)return null;try{const raw=localStorage.getItem(k);if(!raw)return null;const p=JSON.parse(raw);if(!p||!/^[A-Za-z0-9_-]{20,80}$/.test(p.id))throw new Error('bad');return p;}catch(e){throw new Error('Не удалось прочитать состояние предыдущего сохранения. Не повторяйте денежную операцию; проверьте данные.');}};
function pendingPut(p){const k=pendingKey();if(!k)throw new Error('Войдите в CRM');try{localStorage.setItem(k,JSON.stringify(p));if(localStorage.getItem(k)!==JSON.stringify(p))throw new Error('storage');}catch(e){throw new Error('Не удалось сохранить номер операции на устройстве. Изменение не отправлено. Освободите место в браузере.');}}
function pendingClear(id){const p=pendingRead();if(p&&p.id===id)localStorage.removeItem(pendingKey());}
function writeStatus(message,actions=false){
 let el=document.getElementById('writeStatus');if(!el){el=document.createElement('div');el.id='writeStatus';el.innerHTML='<span role="status" aria-live="polite"></span><div><button type="button">Проверить результат</button><button type="button">Отменить, если не сохранено</button></div>';document.body.appendChild(el);const b=el.querySelectorAll('button');b[0].onclick=()=>recoverPending(false,true).catch(()=>{});b[1].onclick=()=>recoverPending(true,true).catch(()=>{});}
 const modal=[...document.querySelectorAll('.mover.on .modal')].at(-1),footer=modal&&modal.querySelector('.mft');
 if(modal){if(footer)footer.before(el);else modal.appendChild(el);}else document.body.appendChild(el);el.classList.toggle('in-form',!!modal);
 el.querySelector('span').textContent=message;el.querySelector('div').hidden=!actions;el.classList.toggle('on',!!message);
}
function responseError(e){const st=e&&e.status,d=e&&e.response||{},code=d.code||(d.data&&d.data.code);if(st===401){authLost();return Object.assign(new Error('Вход больше не действует — войдите заново.'),{code:'unauthenticated'});}return Object.assign(new Error(d.message&&d.message.includes('__amana_write_v1')?'Сервер применяет обновление. Подождите минуту и обновите страницу.':st===429?'Слишком много запросов. Подождите немного.':d.message||('Ошибка сервера '+st)),{code:ERR_CODE[code]||code||'unknown'});}
async function sendOnce(path,options,ms){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);try{return await pb.send(path,{...options,signal:controller.signal,requestKey:null});}finally{clearTimeout(timer);}}
const actionLabels={
  mPay:'оплату',mDisc:'скидку',mComment:'комментарий',mClient:'договор',
  mPerson:'карточку клиента',mDefer:'отсрочку',mKassa:'операцию кассы',
  mInvOp:'операцию инвестора',mInvDep:'вклад',mInvForm:'карточку участника',
  mInvMonth:'закрытие месяца',mStaff:'настройки сотрудника'
};
function unknownWrite(p){
  const action=actionLabels[p?.formId] || 'операцию';
  return 'Не удалось подтвердить '+action+'. Проверьте результат перед повтором.';
}
function pendingError(p){return Object.assign(new Error(unknownWrite(p)),{code:'pending'});}
function applyRecovered(p,result,notify){
 if(result&&result.docs)applyServerDocs(result.docs);const active=pendingRead();if(!active||active.id!==p.id)return;pendingClear(p.id);netDown=false;netBadge();writeStatus('');
 if(notify){window.dispatchEvent(new CustomEvent('amanaWriteRecovered',{detail:{formId:p.formId,requestId:p.id}}));if(typeof window.toast==='function')window.toast('Сохранение подтверждено.','tok');}
}
async function inspectPending(p,cancel,notify){
 const data=await sendOnce('/api/amana/requests/'+encodeURIComponent(p.id)+(cancel?'/cancel':''),{method:cancel?'POST':'GET'},10000);const active=pendingRead();if(!active||active.id!==p.id)return data;netDown=false;netBadge();
 if(data.state==='saved'){applyRecovered(p,data.result,notify);return{state:'saved',result:data.result};}
 if(data.state==='cancelled'){pendingClear(p.id);writeStatus('');if(notify&&typeof window.toast==='function')window.toast('Операция не была сохранена и отменена. Данные в форме можно исправить и отправить заново.','tok');return{state:'cancelled'};}
 writeStatus(unknownWrite(p),true);return{state:'unknown'};
}
async function recoverPending(cancel=false,notify=true){
 if(recovery){const existing=await recovery;if(!cancel||!pendingRead())return existing;}
 if(recovery)return recovery;
 let p;try{p=pendingRead();}catch(e){writeStatus(e.message);return;}
 if(!p)return;
 if(writing){writeStatus('Сохраняем… Дождитесь ответа сервера.');return{state:'unknown'};}
 writeStatus(cancel?'Проверяем, можно ли отменить несохранённую операцию…':'Проверяем результат сохранения…');
 recovery=inspectPending(p,cancel,notify).catch(e=>{if(e&&e.status===401)throw responseError(e);writeStatus(unknownWrite(p),true);return{state:'unknown'};}).finally(()=>{recovery=null;});return recovery;
}
function freezeForm(){const form=[...document.querySelectorAll('.mover.on[id]')].at(-1);const items=form?[...form.querySelectorAll('input,select,textarea,button')].map(el=>({el,disabled:el.disabled})):[];items.forEach(x=>x.el.disabled=true);return()=>items.forEach(x=>{if(x.el.isConnected)x.el.disabled=x.disabled;});}
async function writeRequest(path,body,ms,method='POST'){
 const execute=async()=>{
  if(writing)throw Object.assign(new Error('Изменение уже отправляется. Дождитесь результата.'),{code:'busy'});
  const old=pendingRead();if(old){const checked=await recoverPending(false,true);if(checked&&checked.state==='saved')throw Object.assign(new Error('Предыдущее изменение уже сохранено. Проверьте данные перед новой операцией.'),{code:'already-saved'});if(checked&&checked.state==='cancelled')throw Object.assign(new Error('Предыдущее изменение отменено и не сохранено. Теперь можно отправить новое.'),{code:'cancelled'});throw pendingError(old);}
  await netCheck();
  const p={id:autoId(),tab:tabId,at:Date.now(),formId:[...document.querySelectorAll('.mover.on[id]')].at(-1)?.id||''};
  pendingPut(p);if(p.formId)document.getElementById(p.formId).dataset.pendingWrite=p.id;writing=true;const unfreeze=freezeForm();writeStatus('Сохраняем '+(actionLabels[p.formId]||'изменение')+'…');
  try{
   const result=await sendOnce(path,{method,body:{...(body||{}),requestId:p.id}},ms||WRITE_MS);
   applyRecovered(p,result,false);return result;
  }catch(e){
   const st=e&&e.status;
   if(st>=400&&st<500&&st!==408){pendingClear(p.id);writeStatus('');throw responseError(e);}
   // Запрос мог дойти: не посылаем его снова, даже когда сеть вернётся.
   writeStatus('Ответ потерялся. Проверяем, сохранилось ли изменение…');
   let queried=false;try{const checked=await inspectPending(p,false,false);queried=true;if(checked.state==='saved')return checked.result;if(checked.state==='cancelled')throw Object.assign(new Error('Операция отменена и не сохранена'),{code:'cancelled'});}catch(x){if(x.code==='cancelled')throw x;}
   netDown=!queried;netBadge();writeStatus(unknownWrite(p),true);throw pendingError(p);
  }finally{writing=false;unfreeze();}
 };
 const key=pendingKey();
 if(navigator.locks&&key)return navigator.locks.request('amana-write:'+key,{ifAvailable:true},lock=>{if(!lock)throw Object.assign(new Error('В другой вкладке уже сохраняется изменение. Дождитесь результата.'),{code:'busy'});return execute();});
 return execute();
}
window.addEventListener('online',()=>{netDown=false;netBadge();recoverPending().catch(()=>{});});window.addEventListener('offline',()=>netBadge());
window.addEventListener('storage',e=>{if(e.key===pendingKey()&&!writing){if(!pendingRead())writeStatus('');else recoverPending().catch(()=>{});}});
for(const event of ['input','change'])document.addEventListener(event,e=>{const form=e.target.closest&&e.target.closest('.mover');if(form)delete form.dataset.pendingWrite;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)recoverPending().catch(()=>{});});
setInterval(()=>{try{if(!document.hidden&&!writing&&pb.authStore.isValid&&pendingRead())recoverPending().catch(()=>{});}catch(e){writeStatus(e.message);}},10000);netBadge();
async function commitOps(ops,checks,ms,mode){const guarded={...(checks||{}),expect:[{c:'__amana_write_v1',id:'protocol'},...((checks&&checks.expect)||[])]};return writeRequest('/api/amana/commit',{ops,checks:guarded,...(mode?{mode}:{})},ms);}

const refOp = (t, ref, d, merge) => ({ t, c: ref.parent.id, id: ref.id, ...(d !== undefined ? { d: encTop(d) } : {}), ...(merge ? { merge: true } : {}) });

// ---------- Запись ----------
const setDocU = (ref, d, o) => commitOps([refOp('set', ref, d, o && o.merge)]).then(() => {});
const updateDocU = (ref, d) => commitOps([refOp('update', ref, d)]).then(() => {});
const addDocU = (c, d) => { const r = doc(c); return commitOps([refOp('set', r, d)]).then(() => r); };
const deleteDocU = ref => commitOps([{ t: 'delete', c: ref.parent.id, id: ref.id }]).then(() => {});
// Пачка записей. commit() — обычная пачка; commit({wallets,deal}) — сервер в той же транзакции сверяет остатки
// (счёт не уходит в минус) и что договор не изменился на другом устройстве.
const writeBatchU = () => { const ops = [], w = {
  set: (r, d, o) => { ops.push(refOp('set', r, d, o && o.merge)); return w; },
  update: (r, d) => { ops.push(refOp('update', r, d)); return w; },
  delete: r => { ops.push({ t: 'delete', c: r.parent.id, id: r.id }); return w; },
  commit: chk => commitOps(ops, chk ? { wallets: chk.wallets || {}, ...(chk.deal ? { deal: chk.deal } : {}) } : null).then(() => {}) }; return w; };
// Следующие номера (договоров — settings/counter-ГГ, клиентов — settings/pcounter); n номеров сразу, возвращается первый
const nextCounter = async (id, n) => { id = id || 'counter'; const r = await commitOps([{ t: 'counter', c: 'settings', id, n: n || 1 }]); return r.counters[id]; };
// Записать документ, только если его ещё нет (защита от двойного действия с двух устройств): иначе ошибка code:'exists'
const createOnce = async (ref, data, more) => {
  await commitOps([refOp('set', ref, data), ...(more || []).map(([r, d]) => refOp('set', r, d))], { expect: [{ c: ref.parent.id, id: ref.id, exists: false }] });
};
// Номер и сами записи — одной транзакцией: fn(w,last) делает записи и возвращает новое значение счётчика.
// Если номер за это время занял кто-то другой, всё повторяется с новым номером.
const counterTx = async (id, fn) => {
  for (let i = 0; ; i++) {
    await netCheck();
    let raw = null;
    try { const rec = await sendOnce('/api/collections/settings/records/'+encodeURIComponent(id),{method:'GET'},WRITE_MS); const d = rec.data || {}; raw = d.lastId === undefined ? null : d.lastId; } catch (e) { if (e && e.status && e.status !== 404) throw e; if (!e || !e.status) throw netFail(); }
    const last = raw || 0, ops = [];
    const w = { set: (r, d, o) => { ops.push(refOp('set', r, d, o && o.merge)); return w; }, update: (r, d) => { ops.push(refOp('update', r, d)); return w; }, delete: r => { ops.push({ t: 'delete', c: r.parent.id, id: r.id }); return w; } };
    const nv = await fn(w, last);
    if (nv !== last) ops.push({ t: 'set', c: 'settings', id, d: { lastId: nv }, merge: true });
    try { await commitOps(ops, { expect: [{ c: 'settings', id, f: 'lastId', v: raw }] }); return nv; }
    catch (e) { if (e && e.code === 'stale' && i < 5) continue; throw e; }
  }
};

// ---------- Чтение ----------
const snapOf = (c, rec) => ({ id: rec.id, ref: doc(null, c, rec.id), _d: rec.d || 0, exists: () => true, data: () => dec(rec.data || {}) });
const docsResult = docs => ({ docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) });
const where = (f, op, v) => ({ kind: 'where', f, op, v });
const orderBy = (f, dir) => ({ kind: 'orderBy', f, dir: dir || 'asc' });
const limit = n => ({ kind: 'limit', n });
const startAfter = s => ({ kind: 'startAfter', s });
const query = (c, ...parts) => ({ type: 'query', c, parts });
const msOf = v => v instanceof Date ? v.getTime() : v instanceof Timestamp ? v.toMillis() : Number(v) || 0;
async function searchJournal(filters,cursor){
  const query={
    ...(filters.from?{from:filters.from.getTime()}:{}),
    ...(filters.to?{to:filters.to.getTime()}:{}),
    description:filters.desc||'',type:filters.type||'',day:filters.date_q||'',
    ...(cursor||{})
  };
  return sendOnce('/api/amana/journal',{method:'GET',query},15000);
}
async function getDocs(q) {
  const c = q.type === 'query' ? q.c.id : q.id, parts = q.type === 'query' ? q.parts : [];
  try {
    if (!parts.length) { const all = await pb.collection(c).getFullList({ batch: 1000, requestKey: null }); return docsResult(all.map(r => snapOf(c, r))); }
    // поддерживаются выборки по полю date (история действий): на сервере это колонка d
    const flt = [], OPS = { '>=': '>=', '>': '>', '<': '<', '<=': '<=', '==': '=' };
    let sort = '', lim = 0;
    parts.forEach(p => {
      if (p.kind === 'where' && p.f === 'date' && OPS[p.op]) flt.push('d ' + OPS[p.op] + ' ' + msOf(p.v));
      else if (p.kind === 'orderBy' && p.f === 'date') sort = (p.dir === 'desc' ? '-d,-id' : 'd,id');
      else if (p.kind === 'limit') lim = p.n;
      else if (p.kind === 'startAfter') { const s = p.s, D = s._d || 0, id = String(s.id).replace(/'/g, ''); flt.push(sort.startsWith('-') || !sort ? "(d < " + D + " || (d = " + D + " && id < '" + id + "'))" : "(d > " + D + " || (d = " + D + " && id > '" + id + "'))"); }
      else throw new Error('Выборка не поддерживается: ' + JSON.stringify(p));
    });
    const opt = { filter: flt.join(' && '), sort: sort || '-d,-id', requestKey: null, skipTotal: true };
    const res = lim ? (await pb.collection(c).getList(1, lim, opt)).items : await pb.collection(c).getFullList({ ...opt, batch: 1000 });
    return docsResult(res.map(r => snapOf(c, r)));
  } catch (e) { if (e && !e.status) throw netFail(); throw e; }
}
async function getDoc(ref) {
  try { const r = await pb.collection(ref.parent.id).getOne(ref.id, { requestKey: null }); return snapOf(ref.parent.id, r); }
  catch (e) { if (e && e.status === 404) return { id: ref.id, ref, exists: () => false, data: () => undefined }; if (e && !e.status) throw netFail(); throw e; }
}

// ---------- Память устройства (IndexedDB) ----------
// Коллекция целиком: {docs: {id: {data, u}}, last, full}. Пишется не чаще раза в полсекунды.
const cacheScope = () => {
  const user = pb.authStore.record;
  return user ? user.id + '_' + (user.perms || '') : 'signed_out';
};
const cacheName = () => 'amana_pb_' + cacheScope();
const EPOCH_KEY = 'amana_pb_epoch';
let _idb = null;
const idb = () => _idb || (_idb = new Promise((ok, no) => { const r = indexedDB.open(cacheName(), 1); r.onupgradeneeded = () => r.result.createObjectStore('cols'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }).catch(() => null));
const idbGet = async k => { const d = await idb(); if (!d) return null; return new Promise(ok => { try { const r = d.transaction('cols').objectStore('cols').get(k); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); } catch (e) { ok(null); } }); };
const idbPut = async (k, v) => { const d = await idb(); if (!d) return; return new Promise(ok => { try { const t = d.transaction('cols', 'readwrite'); t.objectStore('cols').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ok(); } catch (e) { ok(); } }); };
const idbClear = async () => { const d = await idb(); if (d) { try { d.close(); } catch (e) {} } _idb = null; await new Promise(ok => { const r = indexedDB.deleteDatabase(cacheName()); r.onsuccess = r.onerror = r.onblocked = () => ok(); }); };

// ---------- Живые коллекции ----------
const FULL_EVERY = 7 * 864e5, OVERLAP = 5 * 60e3;
const tombs = new Map(), liveEmit = {}, cols = {};
const syncStats = { server: {}, cache: {} }; window.SYNC_STATS = syncStats;
// col: {name, map: Map(id → {data, u}), last, full, emit(), save()}
function colState(name) {
  if (cols[name]) return cols[name];
  const st = { name, map: new Map(), last: 0, full: 0, subs: [], _t: 0, _s: 0 };
  st.save = () => { clearTimeout(st._s); st._s = setTimeout(() => { const docs = {}; st.map.forEach((v, k) => { docs[k] = v; }); idbPut(name, { docs, last: st.last, full: st.full }); }, 500); };
  st.emitNow = () => { st.subs.forEach(fn => fn()); };
  st.emit = () => { clearTimeout(st._t); st._t = setTimeout(st.emitNow, 30); };
  cols[name] = st; return st;
}
function applyRecord(name, rec, src) {
  const st = colState(name), u = rec.u || 0;
  const cur = st.map.get(rec.id);
  if (cur && cur.u >= u) return false; // эта или более свежая версия уже есть
  st.map.set(rec.id, { data: rec.data || {}, u });
  if (u > st.last) st.last = u;
  if (name === TOMB) addTomb(rec.data, u);
  if (src) syncStats[src][name] = (syncStats[src][name] || 0) + 1;
  return true;
}
function addTomb(d, u) { if (!d || !d.c) return; const k = d.c + '/' + d.id; if (!tombs.has(k) || tombs.get(k) < u) tombs.set(k, u); }
// Ответ сервера на запись — сразу в память, не дожидаясь realtime
function applyServerDocs(list) {
  const touched = new Set();
  list.forEach(x => {
    const st = colState(x.c);
    if (x.del) { st.map.delete(x.id); addTomb({ c: x.c, id: x.id }, x.u); touched.add(x.c); return; }
    applyRecord(x.c, { id: x.id, data: x.data, u: x.u });
    // Realtime мог прийти раньше ответа. К завершению сохранения экран всё равно должен видеть запись.
    touched.add(x.c);
  });
  touched.forEach(c => { const st = cols[c]; st.save(); st.emit(); });
  if (touched.size && cols[TOMB]) Object.keys(liveEmit).forEach(n => { if (n !== TOMB) liveEmit[n](); });
}
// Докачать с сервера всё, что изменилось после since
async function pullSince(name, since) {
  const st = colState(name), filter = since ? 'u > ' + Math.max(0, since - OVERLAP) : '';
  const items = await withTimeout(pb.collection(name).getFullList({ batch: 1000, filter, requestKey: null, fields: 'id,data,u' }), 60000);
  items.forEach(r => applyRecord(name, r, 'server'));
  return items.length;
}
let _rtCount = 0;
async function live(name, opts, cb, onErr) {
  if ((name === 'wallets' || name === 'kassaOps') && !hasRight('v_kassa')) {
    if (name === 'kassaOps') { cb({ docs: [] }); return; }
    const update = async () => {
      try {
        const options = await pb.send('/api/amana/wallet-options', { method: 'GET', requestKey: null });
        cb({ docs: options.map(w => ({ id: w.id, data: () => ({ name: w.name, isDefault: w.isDefault }) })) });
      } catch (e) { if (onErr) onErr(e); }
    };
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    await update();
    return;
  }
  opts = opts || {};
  const st = colState(name);
  const emit = () => {
    let arr = [];
    st.map.forEach((v, id) => { const t = name !== TOMB && tombs.get(name + '/' + id); if (t && v.u <= t) return; arr.push({ id, d: dec(v.data) }); });
    arr.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // по номеру записи
    if (opts.order) { const f = opts.order, val = x => { const y = x.d[f]; return y && y.toMillis ? y.toMillis() : (y instanceof Date ? y.getTime() : 0); }; arr.sort((a, b) => val(b) - val(a)); }
    cb({ docs: arr.map(x => ({ id: x.id, data: () => x.d })) });
  };
  st.subs.push(emit);
  try {
    const cached = await idbGet(name);
    if (cached && cached.docs) { Object.keys(cached.docs).forEach(id => { if (!st.map.has(id)) st.map.set(id, cached.docs[id]); }); st.last = Math.max(st.last, cached.last || 0); st.full = cached.full || 0; syncStats.cache[name] = (syncStats.cache[name] || 0) + Object.keys(cached.docs).length; if (name === TOMB) st.map.forEach(v => addTomb(v.data, v.u)); }
    const full = !st.last || !st.map.size || Date.now() - (st.full || 0) > FULL_EVERY;
    try {
      if (!navigator.onLine) throw new Error('offline');
      if (full) {
        const items = await withTimeout(pb.collection(name).getFullList({ batch: 1000, requestKey: null, fields: 'id,data,u' }), 60000);
        st.map.clear(); items.forEach(r => applyRecord(name, r, 'server'));
        if (name === TOMB) { tombs.clear(); st.map.forEach(v => addTomb(v.data, v.u)); }
        st.full = Date.now(); if (!st.last) st.last = Date.now() - OVERLAP;
      } else await pullSince(name, st.last);
      st.save();
    } catch (e) {
      if (!st.map.size) throw e; // на устройстве ничего нет и сервер недоступен
      netDown = true; netBadge();
    }
    emit();
    liveEmit[name] = emit;
  } catch (e) { console.error(name, e); if (onErr) onErr(e); }
  // Дальше изменения приходят сами
  try {
    await pb.collection(name).subscribe('*', ev => {
      const r = ev.record; if (!r) return;
      if (ev.action === 'delete') { st.map.delete(r.id); st.save(); st.emit(); return; }
      if (applyRecord(name, { id: r.id, data: r.data, u: r.u }, 'server')) {
        st.save(); st.emit();
        if (name === TOMB) Object.keys(liveEmit).forEach(n => { if (n !== TOMB) liveEmit[n](); });
      }
    }, { fields: 'id,data,u' });
    _rtCount++;
  } catch (e) { console.warn('realtime ' + name, e); }
}
// После обрыва связи realtime переподключается сам; пропущенное за это время докачиваем
let _rtSeen = false;
pb.realtime.subscribe('PB_CONNECT', async () => {
  if (!_rtSeen) { _rtSeen = true; return; }
  for (const name of Object.keys(cols)) { try { const n = await pullSince(name, cols[name].last); if (n) { cols[name].save(); cols[name].emit(); } } catch (e) {} }
  if (cols[TOMB]) Object.keys(liveEmit).forEach(n => { if (n !== TOMB) liveEmit[n](); });
}).catch(() => {});
// Надгробия загружаются первыми, чтобы удалённое не мелькало
async function liveTombs() {
  let first = true, res; const ready = new Promise(r => res = r);
  live(TOMB, {}, () => { if (first) { first = false; res(); } else Object.keys(liveEmit).forEach(n => { if (n !== TOMB) liveEmit[n](); }); });
  await Promise.race([ready, new Promise(r => setTimeout(r, 8000))]);
}
// ---- База заменена (восстановление из копии / очистка)? ----
// В settings/meta лежит метка базы. Если она не совпадает с запомненной на устройстве, данные устройства устарели:
// стираем их и загружаем всё заново.
async function checkEpoch() {
  let ep;
  try {
    const s = await getDoc(doc(null, 'settings', 'meta'));
    ep = s.exists() && s.data().epoch;
    if (!ep) {
      const e = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { await commitOps([{ t: 'set', c: 'settings', id: 'meta', d: { epoch: e } }], { expect: [{ c: 'settings', id: 'meta', exists: false }] }); ep = e; }
      catch (x) { const s2 = await getDoc(doc(null, 'settings', 'meta')); ep = s2.exists() && s2.data().epoch; if (!ep) return; }
    }
  } catch (e) { return; } // нет интернета — работаем с данными устройства
  const epochKey = EPOCH_KEY + '_' + cacheScope();
  let mine = null; try { mine = localStorage.getItem(epochKey); } catch (e) {}
  if (mine === ep) return;
  try { localStorage.setItem(epochKey, ep); } catch (e) {}
  const had = !!(await idbGet('clients'));
  if (!had) return;
  closing = true; await idbClear(); location.reload(); await new Promise(() => {});
}
// Полностью перечитать базу с сервера
async function resyncAll() { closing = true; await idbClear(); location.reload(); }

// ---------- Резервная копия ----------
// Формат файла совпадает с хранением на сервере: даты — {"$date": ISO}, id сохраняются.
const BK_COLS = ['clients', 'payments', 'kassaOps', 'wallets', 'persons', 'investors', 'invOps', 'invMonths', 'settings'], BK_LOGS = ['journal', 'trash'];
const bkSkip = (c, id) => c === 'settings' && id === 'meta';
async function bkDump() {
  const all = [...BK_COLS, ...BK_LOGS];
  let src = 'server', got;
  try {
    if (!navigator.onLine) throw new Error('offline');
    await pb.collection('users').authRefresh({requestKey:null});
    got = await Promise.all(all.map(c => withTimeout(pb.collection(c).getFullList({ batch: 1000, requestKey: null, fields: 'id,data' }), 60000).then(l => l.map(r => [r.id, r.data || {}]))));
  } catch (e) {
    src = 'device';
    got = await Promise.all(all.map(async c => {
      const st = cols[c]; let m = st && st.map.size ? st.map : null;
      if (!m) { const cached = await idbGet(c); m = new Map(Object.entries((cached && cached.docs) || {})); }
      const out = []; m.forEach((v, id) => { const t = tombs.get(c + '/' + id); if (t && v.u <= t) return; out.push([id, v.data || {}]); }); return out;
    }));
  }
  const collections = {}, counts = {};
  all.forEach((c, i) => { const o = {}; got[i].forEach(([id, d]) => { if (bkSkip(c, id)) return; const x = Object.assign({}, d); delete x._u; o[id] = x; }); collections[c] = o; counts[c] = Object.keys(o).length; });
  const partial = !['v_cost', 'v_kassa', 'v_inv', 'v_journal'].every(hasRight);
  return { format: 'amana-crm-backup', version: 1, createdAt: new Date().toISOString(), source: src, partial, counts, collections };
}
function bkCheck(B) {
  if (!B || B.format !== 'amana-crm-backup' || !B.collections || typeof B.collections !== 'object') return 'Это не файл копии Amana CRM';
  if (B.version !== 1) return 'Копия сделана более новой версией CRM — обновите страницу и попробуйте снова';
  if (B.source !== 'server' || B.partial) return 'Для восстановления нужна полная копия с сервера';
  for (const c of BK_COLS) {
    const o = B.collections[c];
    if (o === undefined) return 'В копии отсутствует раздел ' + c;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return 'Файл копии повреждён (раздел ' + c + ')';
    if (!B.counts || B.counts[c] !== Object.keys(o).length) return 'В копии не совпадает число записей раздела ' + c;
    for (const [id, d] of Object.entries(o)) if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !d || typeof d !== 'object' || Array.isArray(d)) return 'Файл копии повреждён (запись ' + c + '/' + String(id).slice(0, 40) + ')'; }
  return '';
}
// Восстановление: база становится точно такой, как в копии (история действий и корзина не трогаются).
// Повторный запуск с тем же файлом даёт тот же результат. В конце меняется метка базы — все устройства перезагрузят данные.
async function bkRestore(B, prog) {
  const err = bkCheck(B); if (err) throw new Error(err);
  await netCheck();
  const ops = []; let put = 0, del = 0;
  for (const c of BK_COLS) {
    const want = B.collections[c];
    const cur = await withTimeout(pb.collection(c).getFullList({ batch: 1000, requestKey: null, fields: 'id' }), 60000);
    cur.forEach(r => { if (bkSkip(c, r.id) || Object.prototype.hasOwnProperty.call(want, r.id)) return; ops.push({ t: 'delete', c, id: r.id }); del++; });
    Object.entries(want).forEach(([id, d]) => { if (bkSkip(c, id)) return; const x = Object.assign({}, d); delete x._u; ops.push({ t: 'set', c, id, d: x }); put++; });
  }
  for (let i = 0; i < ops.length; i += 400) { await commitOps(ops.slice(i, i + 400), null, 120000, 'restore'); if (prog) prog(Math.min(i + 400, ops.length), ops.length); }
  const ep = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await commitOps([{ t: 'set', c: 'settings', id: 'meta', d: { epoch: ep } }]);
  return { put, del };
}

// ---------- Вход ----------
// Токен входа действует 30 дней и продлевается при каждом открытии CRM
const AUTH = { get currentUser() { const r = pb.authStore.isValid && pb.authStore.record; return r ? { email: r.email, uid: r.id, name: r.name || '' } : null; },
  // права: "*" — владелец (всё), иначе ",право,право,"
  get perms() { const r = pb.authStore.isValid && pb.authStore.record; return r ? (r.perms || '') : ''; } };
const hasRight = p => AUTH.perms === '*' || AUTH.perms.includes(',' + p + ',');
const SIGN_IN = async (_a, email, pw) => {
  try { await pb.collection('users').authWithPassword(email, pw, { requestKey: null }); }
  catch (e) { const st = e && e.status; throw Object.assign(new Error('auth'), { code: st === 429 ? 'auth/too-many-requests' : !st ? 'auth/network-request-failed' : 'auth/invalid-credential' }); }
};
// Вход перестал действовать (вход отключён, «Выйти на всех устройствах», сменён пароль): показываем экран входа
let _authLost = false;
function authLost() { if (_authLost) return; _authLost = true; try { pb.realtime.unsubscribe(); } catch (e) {} pb.authStore.clear(); setTimeout(() => location.reload(), 1200); }
const SIGN_OUT = async () => { try { pb.realtime.unsubscribe(); } catch (e) {} pb.authStore.clear(); };
const ON_AUTH = (_a, cb) => {
  let last = AUTH.currentUser && AUTH.currentUser.uid, scope = cacheScope();
  pb.authStore.onChange(() => {
    const u = AUTH.currentUser, id = u && u.uid, next = cacheScope();
    if (last && id && scope !== next) { location.reload(); return; }
    scope = next;
    if (id !== last) { last = id; cb(u); }
  });
  setTimeout(() => {cb(AUTH.currentUser);if(AUTH.currentUser)recoverPending().catch(()=>{});}, 0);
  if (pb.authStore.isValid && navigator.onLine) pb.collection('users').authRefresh({ requestKey: null }).then(() => window.dispatchEvent(new Event('permsChanged'))).catch(e => { if (e && (e.status === 401 || e.status === 403 || e.status === 404)) authLost(); });
};

// ---------- Сотрудники и права (нужно право staff) ----------
async function staffCall(method,path,body){
 if(method!=='GET')return writeRequest(path,body,WRITE_MS,method);
 await netCheck();try{return await sendOnce(path,{method},WRITE_MS);}catch(e){if(e&&e.status)throw responseError(e);throw new Error('Сервер не ответил. Проверьте соединение и обновите список.');}
}
const staff = {
  list: () => staffCall('GET', '/api/amana/staff'),
  save: (id, data) => staffCall('POST', '/api/amana/staff' + (id ? '/' + encodeURIComponent(id) : ''), data),
  remove: id => staffCall('DELETE', '/api/amana/staff/' + encodeURIComponent(id)),
};

window.DB = { db, counterTx, collection, doc, addDoc: addDocU, updateDoc: updateDocU, deleteDoc: deleteDocU, getDocs, searchJournal, getDoc, query, orderBy, limit, startAfter, where,
  setDoc: setDocU, writeBatch: writeBatchU, increment, arrayUnion, arrayRemove, deleteField, serverTimestamp, Timestamp, nextCounter, createOnce, live, liveTombs, resyncAll, checkEpoch,
  bkDump, bkRestore, bkCheck, staff, deviceId: devId, backend: 'pocketbase', pb };
window.DB.writeState=()=>({writing,pending:pendingRead(),timeout:WRITE_MS});
window.DB.checkWrite=()=>recoverPending(false,true);
window.DB.cancelWrite=()=>recoverPending(true,true);
window.DB.reconcile=(id,balance)=>commitOps([{t:'update',c:'wallets',id,d:{balance}}],null,null,'reconcile');
window.DB.note=type=>staffCall('POST','/api/amana/note',{type});
window.AUTH = AUTH; window.SIGN_IN = SIGN_IN; window.SIGN_OUT = SIGN_OUT; window.ON_AUTH = ON_AUTH;
window.dispatchEvent(new Event('dbReady'));
