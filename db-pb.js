// Подключение CRM к своему серверу (PocketBase). Выбирается в index.html, когда CRM открыта на crm-amana.ru.
// Наружу отдаёт то же, что db-fb.js: window.DB (документы, пачки записей, живые коллекции, номера, копия),
// window.AUTH, SIGN_IN, SIGN_OUT, ON_AUTH — поэтому остальной код CRM не знает, с какой базой работает.
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
const TOMB = 'deleted';

// ---------- Дата/время как в Firestore (у CRM везде .toDate()) ----------
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
// Особые значения для записи (как increment / arrayUnion / deleteField / serverTimestamp в Firestore)
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
// Без связи с сервером ничего не сохраняется: перед записью проверяем, что сервер отвечает.
let netOkAt = 0, netDown = false, closing = false;
const netBadge = () => { let el = document.getElementById('netBadge'); if (!el) { el = document.createElement('div'); el.id = 'netBadge'; document.body.appendChild(el); }
  const off = !navigator.onLine || netDown; el.textContent = off ? 'Нет интернета · только просмотр, изменения не сохраняются' : ''; el.classList.toggle('on', off); };
window.addEventListener('online', () => { netOkAt = 0; netDown = false; netBadge(); }); window.addEventListener('offline', () => { netOkAt = 0; netBadge(); }); netBadge();
const NET_ERR = 'Нет интернета — изменение не сохранено. Подключитесь к сети и повторите.';
const netFail = () => { netDown = true; netOkAt = 0; netBadge(); return Object.assign(new Error(NET_ERR), { code: 'offline' }); };
const _cErr = console.error.bind(console); console.error = (...a) => closing || a[0] && ['offline', 'short', 'stale'].includes(a[0].code) ? console.warn(...a) : _cErr(...a);
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
const netCheck = async () => {
  if (!navigator.onLine) throw netFail();
  if (Date.now() - netOkAt < 15000) return;
  try { const r = await withTimeout(fetch(BASE + '/api/health', { cache: 'no-store' }), 7000); if (!r.ok) throw new Error('health'); netOkAt = Date.now(); if (netDown) { netDown = false; netBadge(); } }
  catch (e) { throw netFail(); }
};
const ERR_CODE = { short: 'short', stale: 'stale', exists: 'exists', denied: 'permission-denied', missing: 'not-found', bad: 'invalid-argument' };
// Запрос к серверу; ошибки сервера → Error с понятным текстом и code (как в Firestore)
async function api(path, body, ms) {
  let r;
  try { r = await withTimeout(pb.send(path, { method: 'POST', body }), ms || 15000); }
  catch (e) {
    if (e && e.message === 'timeout') { netFail(); throw new Error('Связь пропала во время сохранения. Изменение могло сохраниться — не повторяйте его, а проверьте через минуту.'); }
    const st = e && e.status, d = (e && e.response) || {};
    if (!st) throw netFail();
    if (st === 401) throw Object.assign(new Error('Вход устарел — выйдите и войдите снова.'), { code: 'unauthenticated' });
    throw Object.assign(new Error(d.message || ('Ошибка сервера ' + st)), { code: ERR_CODE[d.code] || d.code || 'unknown' });
  }
  netOkAt = Date.now(); if (netDown) { netDown = false; netBadge(); }
  return r;
}
// Одна транзакция: ops — изменения, checks — проверки (см. server/pb_hooks/amana_lib.js)
async function commitOps(ops, checks, ms) {
  await netCheck();
  const r = await api('/api/amana/commit', { ops, checks: checks || {} }, ms);
  applyServerDocs(r.docs || []);
  return r;
}
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
    try { const rec = await pb.collection('settings').getOne(id, { requestKey: null }); const d = rec.data || {}; raw = d.lastId === undefined ? null : d.lastId; } catch (e) { if (e && e.status && e.status !== 404) throw e; if (!e || !e.status) throw netFail(); }
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
const IDB_NAME = 'amana_pb', EPOCH_KEY = 'amana_pb_epoch';
let _idb = null;
const idb = () => _idb || (_idb = new Promise((ok, no) => { const r = indexedDB.open(IDB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore('cols'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }).catch(() => null));
const idbGet = async k => { const d = await idb(); if (!d) return null; return new Promise(ok => { try { const r = d.transaction('cols').objectStore('cols').get(k); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); } catch (e) { ok(null); } }); };
const idbPut = async (k, v) => { const d = await idb(); if (!d) return; return new Promise(ok => { try { const t = d.transaction('cols', 'readwrite'); t.objectStore('cols').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ok(); } catch (e) { ok(); } }); };
const idbClear = async () => { const d = await idb(); if (d) { try { d.close(); } catch (e) {} } _idb = null; await new Promise(ok => { const r = indexedDB.deleteDatabase(IDB_NAME); r.onsuccess = r.onerror = r.onblocked = () => ok(); }); };

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
    if (applyRecord(x.c, { id: x.id, data: x.data, u: x.u })) touched.add(x.c);
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
  opts = opts || {};
  const st = colState(name);
  const emit = () => {
    let arr = [];
    st.map.forEach((v, id) => { const t = name !== TOMB && tombs.get(name + '/' + id); if (t && v.u <= t) return; arr.push({ id, d: dec(v.data) }); });
    arr.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // как в Firestore: по номеру записи
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
  let mine = null; try { mine = localStorage.getItem(EPOCH_KEY); } catch (e) {}
  if (mine === ep) return;
  try { localStorage.setItem(EPOCH_KEY, ep); } catch (e) {}
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
  return { format: 'amana-crm-backup', version: 1, createdAt: new Date().toISOString(), source: src, counts, collections };
}
function bkCheck(B) {
  if (!B || B.format !== 'amana-crm-backup' || !B.collections || typeof B.collections !== 'object') return 'Это не файл копии Amana CRM';
  if (B.version !== 1) return 'Копия сделана более новой версией CRM — обновите страницу и попробуйте снова';
  for (const c of BK_COLS) { const o = B.collections[c]; if (o === undefined) continue; if (!o || typeof o !== 'object' || Array.isArray(o)) return 'Файл копии повреждён (раздел ' + c + ')';
    for (const [id, d] of Object.entries(o)) if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !d || typeof d !== 'object' || Array.isArray(d)) return 'Файл копии повреждён (запись ' + c + '/' + String(id).slice(0, 40) + ')'; }
  if (!B.collections.clients || !B.collections.wallets) return 'В файле нет договоров или счетов — это не полная копия';
  return '';
}
// Восстановление: база становится точно такой, как в копии (история действий и корзина не трогаются).
// Повторный запуск с тем же файлом даёт тот же результат. В конце меняется метка базы — все устройства перезагрузят данные.
async function bkRestore(B, prog) {
  const err = bkCheck(B); if (err) throw new Error(err);
  await netCheck();
  const ops = []; let put = 0, del = 0;
  for (const c of BK_COLS) {
    const want = B.collections[c] || {};
    const cur = await withTimeout(pb.collection(c).getFullList({ batch: 1000, requestKey: null, fields: 'id' }), 60000);
    cur.forEach(r => { if (bkSkip(c, r.id) || Object.prototype.hasOwnProperty.call(want, r.id)) return; ops.push({ t: 'delete', c, id: r.id }); del++; });
    Object.entries(want).forEach(([id, d]) => { if (bkSkip(c, id)) return; const x = Object.assign({}, d); delete x._u; ops.push({ t: 'set', c, id, d: x }); put++; });
  }
  for (let i = 0; i < ops.length; i += 400) { await commitOps(ops.slice(i, i + 400), null, 120000); if (prog) prog(Math.min(i + 400, ops.length), ops.length); }
  const ep = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await commitOps([{ t: 'set', c: 'settings', id: 'meta', d: { epoch: ep } }]);
  return { put, del };
}

// ---------- Вход ----------
// Токен входа действует 30 дней и продлевается при каждом открытии CRM
const AUTH = { get currentUser() { const r = pb.authStore.isValid && pb.authStore.record; return r ? { email: r.email, uid: r.id } : null; } };
const SIGN_IN = async (_a, email, pw) => {
  try { await pb.collection('users').authWithPassword(email, pw, { requestKey: null }); }
  catch (e) { const st = e && e.status; throw Object.assign(new Error('auth'), { code: st === 429 ? 'auth/too-many-requests' : !st ? 'auth/network-request-failed' : 'auth/invalid-credential' }); }
};
const SIGN_OUT = async () => { try { pb.realtime.unsubscribe(); } catch (e) {} pb.authStore.clear(); };
const ON_AUTH = (_a, cb) => {
  let last = AUTH.currentUser && AUTH.currentUser.uid;
  pb.authStore.onChange(() => { const u = AUTH.currentUser, id = u && u.uid; if (id !== last) { last = id; cb(u); } });
  setTimeout(() => cb(AUTH.currentUser), 0);
  if (pb.authStore.isValid && navigator.onLine) pb.collection('users').authRefresh({ requestKey: null }).catch(e => { if (e && (e.status === 401 || e.status === 403 || e.status === 404)) pb.authStore.clear(); });
};

window.DB = { db, counterTx, collection, doc, addDoc: addDocU, updateDoc: updateDocU, deleteDoc: deleteDocU, getDocs, getDoc, query, orderBy, limit, startAfter, where,
  setDoc: setDocU, writeBatch: writeBatchU, increment, arrayUnion, arrayRemove, deleteField, serverTimestamp, Timestamp, nextCounter, createOnce, live, liveTombs, resyncAll, checkEpoch,
  bkDump, bkRestore, bkCheck, backend: 'pocketbase', pb };
window.AUTH = AUTH; window.SIGN_IN = SIGN_IN; window.SIGN_OUT = SIGN_OUT; window.ON_AUTH = ON_AUTH;
window.dispatchEvent(new Event('dbReady'));
