// Amana CRM: запись в базу одной транзакцией с проверками (то же, что делали правила и транзакции Firebase).
// Подключается из amana.pb.js через require — у каждого запроса свой экземпляр.
//
// Запрос POST /api/amana/commit:
//   { ops: [ {t:'set', c, id, d, merge?}, {t:'update', c, id, d}, {t:'delete', c, id}, {t:'counter', c:'settings', id, n} ],
//     checks: { expect: [{c, id, f?, v?, exists?}], wallets: {id: изменение}, deal: {id, seq} } }
// Особые значения внутри d: {$date: ISO} — дата, {$op:'now'} — время сервера, {$op:'inc', v} — прибавить,
//   {$op:'del'} — удалить поле, {$op:'union', v:[…]} / {$op:'remove', v:[…]} — добавить/убрать из списка.
// Ответ: { u, docs: [{c, id, data, u, del}], counters: {id: первый номер} } или ошибка { code, message }.

const COLS = { clients: 1, payments: 1, kassaOps: 1, wallets: 1, persons: 1, investors: 1, invOps: 1, invMonths: 1, settings: 1, journal: 1, trash: 1 };
const APPEND_ONLY = { journal: 1, trash: 1 };
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_OPS = 1000;

const r2 = (v) => Math.round(v * 100) / 100;
// 12345.5 → «12 345,5» (toLocaleString на сервере недоступен)
const money = (v) => { const n = r2(v), neg = n < 0, p = Math.abs(n).toFixed(2).replace(/\.?0+$/, '').split('.'); return (neg ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (p[1] ? ',' + p[1] : ''); };
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isOp = (v) => isPlain(v) && typeof v.$op === 'string';
const isDate = (v) => isPlain(v) && typeof v.$date === 'string' && Object.keys(v).length === 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Fail(code, message, status) { this.code = code; this.message = message; this.status = status || 409; }

// Значение поля после применения особой операции
function applyOp(cur, op, nowIso) {
  switch (op.$op) {
    case 'now': return { $date: nowIso };
    case 'inc': { const base = typeof cur === 'number' ? cur : 0; return base + Number(op.v || 0); }
    case 'union': { const a = Array.isArray(cur) ? cur.slice() : []; (op.v || []).forEach((x) => { if (!a.some((y) => same(x, y))) a.push(x); }); return a; }
    case 'remove': { const a = Array.isArray(cur) ? cur : []; return a.filter((y) => !(op.v || []).some((x) => same(x, y))); }
    default: throw new Fail('bad', 'Неизвестная операция ' + op.$op, 400);
  }
}
// Значение без особых операций (для полей, которые записываются целиком)
function resolve(v, nowIso) {
  if (isOp(v)) { if (v.$op === 'del') return undefined; return applyOp(undefined, v, nowIso); }
  if (Array.isArray(v)) return v.map((x) => resolve(x, nowIso));
  if (isPlain(v) && !isDate(v)) { const o = {}; Object.keys(v).forEach((k) => { const r = resolve(v[k], nowIso); if (r !== undefined) o[k] = r; }); return o; }
  return v;
}
// set с merge: вложенные объекты сливаются, как в Firestore
function mergeInto(cur, patch, nowIso) {
  const out = isPlain(cur) ? Object.assign({}, cur) : {};
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (isOp(v)) { if (v.$op === 'del') delete out[k]; else out[k] = applyOp(out[k], v, nowIso); }
    else if (isPlain(v) && !isDate(v)) out[k] = mergeInto(isPlain(out[k]) && !isDate(out[k]) ? out[k] : {}, v, nowIso);
    else out[k] = resolve(v, nowIso);
  });
  return out;
}
// update: поля верхнего уровня заменяются целиком (особые операции работают)
function updateInto(cur, patch, nowIso) {
  const out = Object.assign({}, cur);
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (isOp(v)) { if (v.$op === 'del') delete out[k]; else out[k] = applyOp(out[k], v, nowIso); }
    else { const r = resolve(v, nowIso); if (r === undefined) delete out[k]; else out[k] = r; }
  });
  return out;
}
const dateMs = (data) => { const v = data && data.date; if (isDate(v)) { const t = Date.parse(v.$date); return isNaN(t) ? 0 : t; } return 0; };

function commit(e, app) {
  const req = e.requestInfo().body || {};
  const ops = Array.isArray(req.ops) ? req.ops : [];
  const checks = isPlain(req.checks) ? req.checks : {};
  if (ops.length > MAX_OPS) return e.json(400, { code: 'bad', message: 'Слишком много изменений за раз' });
  const isAdmin = e.auth && e.auth.collection().name === '_superusers';
  const perms = isAdmin ? '*' : ((e.auth && e.auth.getString('perms')) || '');
  const now = Date.now(), nowIso = new Date(now).toISOString();
  let failure = null;
  const out = { u: now, docs: [], counters: {} };
  try {
    app.runInTransaction((tx) => {
      try { body(tx); } catch (x) { if (x instanceof Fail) failure = x; throw x; }
    });
  } catch (err) {
    if (failure) return e.json(failure.status, { code: failure.code, message: failure.message });
    throw err;
  }
  return e.json(200, out);

  function body(tx) {
      const cache = {}; // c/id -> {rec, data, exists, dirty, del}
      const load = (c, id) => {
        if (!COLS[c]) throw new Fail('bad', 'Неизвестный раздел ' + c, 400);
        if (typeof id !== 'string' || !ID_RE.test(id)) throw new Fail('bad', 'Недопустимый номер записи', 400);
        const k = c + '/' + id;
        if (!cache[k]) {
          let rec = null;
          try { rec = tx.findRecordById(c, id); } catch (err) { rec = null; }
          let data = null;
          if (rec) { try { data = JSON.parse(rec.getString('data') || 'null'); } catch (err) { data = null; } }
          cache[k] = { c, id, rec, data: isPlain(data) ? data : {}, orig: isPlain(data) ? data : {}, exists: !!rec, existed: !!rec, dirty: false, del: false };
        }
        return cache[k];
      };

      // 1. Проверки до записи
      (Array.isArray(checks.expect) ? checks.expect : []).forEach((x) => {
        const s = load(x.c, x.id);
        if (x.exists !== undefined && s.exists !== !!x.exists) throw new Fail(x.exists ? 'missing' : 'exists', x.exists ? 'Запись не найдена' : 'exists');
        if (x.f !== undefined) {
          const cur = s.exists ? s.data[x.f] : undefined;
          if (!same(cur === undefined ? null : cur, x.v === undefined ? null : x.v)) throw new Fail('stale', 'Данные изменились на другом устройстве. Повторите.');
        }
      });
      if (isPlain(checks.wallets)) Object.keys(checks.wallets).forEach((id) => {
        const d = Number(checks.wallets[id]) || 0; if (d >= -0.004) return;
        const s = load('wallets', id); if (!s.exists) return;
        const b = r2(parseFloat(s.data.balance) || 0);
        if (r2(b + d) < -0.004) throw new Fail('short', 'Недостаточно средств: на счёте «' + (s.data.name || '') + '» ' + money(b) + '\u00a0₽, а нужно ' + money(-d) + '\u00a0₽. Счёт не может уйти в минус.');
      });
      let dealSeq = null;
      if (isPlain(checks.deal) && checks.deal.id) {
        const s = load('clients', checks.deal.id);
        const seq = s.exists ? (s.data.paySeq || 0) : 0;
        if (seq !== (checks.deal.seq || 0)) throw new Fail('stale', 'Договор изменился: только что на другом устройстве по нему провели оплату или скидку. Проверьте остаток и повторите.');
        dealSeq = { s, seq };
      }

      // 2. Изменения по порядку
      ops.forEach((op) => {
        if (!isPlain(op)) throw new Fail('bad', 'Неверная операция', 400);
        const s = load(op.c, op.id);
        const append = APPEND_ONLY[op.c] && !isAdmin;
        if (op.t === 'counter') {
          const n = Math.max(1, Math.floor(Number(op.n) || 1)), first = (s.exists ? (s.data.lastId || 0) : 0) + 1;
          s.data = Object.assign({}, s.data, { lastId: first + n - 1 }); s.exists = true; s.dirty = true; s.del = false;
          out.counters[op.id] = first;
          return;
        }
        if (op.t === 'delete') {
          if (append) throw new Fail('denied', 'Историю действий и корзину нельзя менять', 403);
          if (s.exists) { s.exists = false; s.del = true; s.dirty = true; s.data = {}; }
          return;
        }
        const d = isPlain(op.d) ? op.d : {};
        if (append && (s.exists || op.t !== 'set')) throw new Fail('denied', 'Историю действий и корзину нельзя менять', 403);
        if (op.t === 'set') s.data = op.merge ? mergeInto(s.exists ? s.data : {}, d, nowIso) : resolve(d, nowIso);
        else if (op.t === 'update') { if (!s.exists) throw new Fail('missing', 'Запись не найдена (' + op.c + ')', 404); s.data = updateInto(s.data, d, nowIso); }
        else throw new Fail('bad', 'Неверная операция ' + op.t, 400);
        s.exists = true; s.del = false; s.dirty = true;
      });
      if (dealSeq) { dealSeq.s.data = Object.assign({}, dealSeq.s.data, { paySeq: dealSeq.seq + 1 }); dealSeq.s.exists = true; dealSeq.s.dirty = true; }

      // 2a. Права сотрудника: что меняется → какое право нужно (владелец и администратор — без ограничений)
      if (perms !== '*') {
        if (req.mode === 'restore') { if (!has(perms, 'restore')) throw new Fail('denied', 'Нет права: ' + PERM_LABEL.restore, 403); }
        else permsFor(ops, cache).forEach((p) => { if (!has(perms, p)) throw new Fail('denied', 'Нет права: ' + (PERM_LABEL[p] || p), 403); });
        // без права видеть себестоимость её нельзя и изменить: остаётся прежней
        if (!has(perms, 'v_cost')) Object.keys(cache).forEach((k) => { const x = cache[k]; if (x.c === 'clients' && x.dirty && !x.del && x.existed && x.orig.cost !== undefined) x.data = Object.assign({}, x.data, { cost: x.orig.cost }); });
      }

      // 3. Правило счетов: остаток не уходит в минус (пополнить счёт, который уже в минусе, можно)
      Object.keys(cache).forEach((k) => {
        const s = cache[k]; if (s.c !== 'wallets' || !s.dirty || s.del) return;
        const nb = Number(s.data.balance || 0), ob = s.existed ? Number((s.rec && JSON.parse(s.rec.getString('data') || '{}').balance) || 0) : 0;
        if (nb < -0.004 && (!s.existed || nb < ob)) throw new Fail('short', 'Недостаточно средств: счёт «' + (s.data.name || '') + '» не может уйти в минус.');
      });

      // 4. Сохранение
      Object.keys(cache).forEach((k) => {
        const s = cache[k]; if (!s.dirty) return;
        if (s.del) {
          if (s.rec) tx.delete(s.rec);
          const coll = tx.findCollectionByNameOrId('deleted'), t = new Record(coll);
          t.set('id', $security.randomStringWithAlphabet(20, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'));
          t.set('data', { c: s.c, id: s.id }); t.set('u', now); t.set('d', 0);
          tx.save(t);
          out.docs.push({ c: s.c, id: s.id, del: true, u: now });
          return;
        }
        let rec = s.rec;
        if (!rec) { rec = new Record(tx.findCollectionByNameOrId(s.c)); rec.set('id', s.id); }
        rec.set('data', s.data); rec.set('u', now); rec.set('d', dateMs(s.data));
        tx.save(rec);
        out.docs.push({ c: s.c, id: s.id, data: s.c === 'clients' && !has(perms, 'v_cost') ? stripCost(s.data) : s.data, u: now });
      });
  }
}

// ---------- Права сотрудников ----------
// users.perms: "*" — владелец (всё), иначе ",право,право," . Названия — как в CRM (Настройки → Сотрудники).
const PERM_LABEL = {
  v_fin: 'дашборд и «Обзор»', v_kassa: 'касса и остатки счетов', v_inv: 'инвесторы', v_cost: 'себестоимость и наценка', v_journal: 'история действий',
  deal_new: 'создавать договоры', deal_edit: 'редактировать договоры', deal_arch: 'архив договоров', deal_del: 'удалять договоры', people: 'клиенты (карточки)',
  pay: 'принимать оплату', disc: 'делать скидку', pay_cancel: 'отменять оплату и скидку', kassa_ops: 'операции кассы', purchase: 'закупка товара',
  inv_ops: 'операции инвесторов', settings: 'настройки', backup: 'скачать копию', restore: 'восстановить из копии', staff: 'сотрудники и права',
};
const PERMS = Object.keys(PERM_LABEL);
const has = (perms, p) => perms === '*' || String(perms || '').indexOf(',' + p + ',') >= 0;
const normPerms = (v) => { if (v === '*') return '*'; const a = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter((x) => PERMS.indexOf(x) >= 0); return a.length ? ',' + a.filter((x, i) => a.indexOf(x) === i).join(',') + ',' : ''; };
const stripCost = (d) => { if (!isPlain(d) || d.cost === undefined) return d; const o = Object.assign({}, d); delete o.cost; return o; };
const changed = (a, b) => { a = a || {}; b = b || {}; const ks = {}; Object.keys(a).forEach((k) => { ks[k] = 1; }); Object.keys(b).forEach((k) => { ks[k] = 1; }); return Object.keys(ks).filter((k) => !same(a[k], b[k])); };
const only = (keys, allowed) => keys.every((k) => allowed.indexOf(k) >= 0);
// Какие права нужны для этой транзакции: по тому, что и как меняется
function permsFor(ops, cache) {
  const need = {}, touched = {};
  ops.forEach((o) => { touched[o.c] = 1; });
  const createsDeal = ops.some((o) => o.c === 'clients' && cache['clients/' + o.id] && !cache['clients/' + o.id].existed);
  ops.forEach((o) => {
    const s = cache[o.c + '/' + o.id]; if (!s) return;
    const del = o.t === 'delete', isNew = !s.existed, rec = del ? s.orig : s.data, K = changed(s.orig, s.data).filter((k) => k !== 'paySeq');
    const want = (p) => { need[p] = 1; };
    switch (o.c) {
      case 'journal': case 'trash': return; // только дописываются (проверено выше)
      case 'settings':
        if (o.id === 'meta') { if (s.existed) want('restore'); return; } // метку базы меняет только восстановление из копии
        if (/^(ui|pcounter|counter(-\d+)?)$/.test(o.id)) return;
        return want('settings');
      case 'persons': return want('people');
      case 'investors': case 'invOps': case 'invMonths': return want('inv_ops');
      case 'payments':
        if (del) return want('pay_cancel');
        if (isNew) return want(rec.type === 'payment' ? 'pay' : rec.type === 'discount' ? 'disc' : createsDeal ? 'deal_new' : 'deal_edit');
        if (only(K, ['note', 'comment', 'commentDate'])) return want('pay');
        if (only(K, ['contractId'])) return want('settings');
        return want('deal_edit');
      case 'clients':
        if (del) return want('deal_del');
        if (isNew) return want('deal_new');
        if (!K.length || only(K, ['comment', 'commentDate', 'defer'])) return;
        if (only(K, ['archived', 'archivedAt'])) return want('deal_arch');
        if (only(K, ['contractId', 'oldContractId'])) return want('settings');
        return want('deal_edit');
      case 'wallets':
        if (del || isNew) return want('settings');
        if (only(K, ['balance'])) { if (!touched.kassaOps) want('kassa_ops'); return; }
        return want('settings');
      case 'kassaOps':
        if (rec.refType === 'investor') return want('inv_ops');
        if (rec.type === 'purchase') return want('purchase');
        if (rec.refType === 'client' && rec.auto && touched.payments) return; // операция кассы при оплате/предоплате — право даёт сам платёж
        return want('kassa_ops');
    }
  });
  return Object.keys(need);
}

// ---------- Сотрудники (Настройки → Сотрудники; нужно право staff) ----------
const myPerms = (e) => (e.auth && e.auth.collection().name === '_superusers') ? '*' : ((e.auth && e.auth.getString('perms')) || '');
const staffView = (r) => ({ id: r.id, email: r.email(), name: r.getString('name'), perms: r.getString('perms'), disabled: r.getBool('disabled'), created: r.getString('created') });
function staffGuard(e) { if (!has(myPerms(e), 'staff')) { e.json(403, { code: 'denied', message: 'Нет права: ' + PERM_LABEL.staff }); return false; } return true; }
function staffList(e, app) {
  if (!staffGuard(e)) return;
  const devs = {};
  try { app.findAllRecords('devices').forEach((d) => { const u = d.getString('user'); (devs[u] = devs[u] || []).push({ key: d.getString('key'), name: d.getString('name'), ip: d.getString('ip'), first: d.getInt('first'), last: d.getInt('last'), count: d.getInt('count') }); }); } catch (x) {}
  const list = app.findAllRecords('users').map(staffView).sort((a, b) => (a.created < b.created ? -1 : 1))
    .map((u) => Object.assign(u, { devices: (devs[u.id] || []).sort((a, b) => b.last - a.last) }));
  return e.json(200, { list, me: e.auth.id, perms: PERMS.map((k) => ({ k, label: PERM_LABEL[k] })) });
}
function staffSave(e, app) {
  if (!staffGuard(e)) return;
  const b = e.requestInfo().body || {}, mine = myPerms(e), id = e.request.pathValue('id');
  const bad = (m) => e.json(400, { code: 'bad', message: m });
  let perms = b.perms !== undefined ? normPerms(b.perms) : undefined;
  if (perms === '*' && mine !== '*') return e.json(403, { code: 'denied', message: 'Права владельца может выдать только владелец' });
  let r;
  if (id) {
    try { r = app.findRecordById('users', id); } catch (x) { return e.json(404, { code: 'missing', message: 'Сотрудник не найден' }); }
    const self = e.auth && r.id === e.auth.id;
    if (self && (b.disabled === true || (perms !== undefined && !has(perms, 'staff')))) return bad('Себе нельзя отключить вход или убрать право «сотрудники и права»');
    if (r.getString('perms') === '*' && mine !== '*') return e.json(403, { code: 'denied', message: 'Менять владельца может только владелец' });
  } else {
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Проверьте email');
    if (!b.password) return bad('Укажите пароль');
    r = new Record(app.findCollectionByNameOrId('users'));
    r.set('email', email); r.set('verified', true); r.set('emailVisibility', false);
    if (perms === undefined) perms = '';
  }
  if (b.password) { if (String(b.password).length < 8) return bad('Пароль — не меньше 8 символов'); r.setPassword(String(b.password)); r.refreshTokenKey(); }
  if (b.name !== undefined) r.set('name', String(b.name).slice(0, 100));
  if (perms !== undefined) r.set('perms', perms);
  if (b.disabled !== undefined) { r.set('disabled', !!b.disabled); if (b.disabled) r.refreshTokenKey(); }
  if (b.logoutAll && id) r.refreshTokenKey(); // все входы этого сотрудника перестают действовать
  try { app.save(r); } catch (x) { return bad(/email/i.test(String(x)) ? 'Этот email уже занят' : 'Не сохранилось: ' + String(x).slice(0, 200)); }
  return e.json(200, staffView(r));
}
function staffDelete(e, app) {
  if (!staffGuard(e)) return;
  const id = e.request.pathValue('id');
  if (e.auth && id === e.auth.id) return e.json(400, { code: 'bad', message: 'Себя удалить нельзя' });
  let r; try { r = app.findRecordById('users', id); } catch (x) { return e.json(404, { code: 'missing', message: 'Сотрудник не найден' }); }
  if (r.getString('perms') === '*' && myPerms(e) !== '*') return e.json(403, { code: 'denied', message: 'Удалить владельца может только владелец' });
  app.delete(r);
  try { app.findRecordsByFilter('devices', 'user = {:u}', '', 0, 0, { u: id }).forEach((d) => app.delete(d)); } catch (x) {}
  return e.json(200, { ok: true });
}
// Себестоимость не уходит к тем, кому её видеть нельзя (списки, карточки, realtime)
function enrichClient(e) {
  const a = e.requestInfo && e.requestInfo.auth;
  if (a && a.collection().name === 'users' && !has(a.getString('perms'), 'v_cost')) {
    let d = null; try { d = JSON.parse(e.record.getString('data') || 'null'); } catch (x) { d = null; }
    if (isPlain(d) && d.cost !== undefined) e.record.set('data', stripCost(d));
  }
}


// ---------- Устройства: записываются при каждом входе и продлении входа ----------
function devName(ua, app) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg[A]?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'браузер';
  return os + ' · ' + (app ? 'приложение на экране «Домой»' : br);
}
function noteDevice(e, app) {
  const rec = e.record; if (!rec || rec.collection().name !== 'users') return;
  // заголовки запроса: имена в нижнем регистре, «-» → «_» (так их отдаёт requestInfo)
  const hs = (e.requestInfo().headers) || {}, h = (n) => String(hs[n] || ''), ua = h('user_agent').slice(0, 1000);
  let key = h('x_amana_device').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!key) { let x = 0; for (let i = 0; i < ua.length; i++) x = (x * 31 + ua.charCodeAt(i)) | 0; key = 'ua' + (x >>> 0).toString(36); }
  const isApp = h('x_amana_app') === '1', now = Date.now();
  let d = null;
  try { d = app.findFirstRecordByFilter('devices', 'user = {:u} && key = {:k}', { u: rec.id, k: key }); } catch (x) { d = null; }
  if (!d) { d = new Record(app.findCollectionByNameOrId('devices')); d.set('user', rec.id); d.set('key', key); d.set('first', now); d.set('count', 0); }
  d.set('name', devName(ua, isApp)); d.set('ua', ua); d.set('ip', String(e.realIP() || '').slice(0, 100)); d.set('last', now); d.set('count', d.getInt('count') + 1);
  app.save(d);
  // не больше 30 устройств на сотрудника: самые давние стираются
  try { const all = app.findRecordsByFilter('devices', 'user = {:u}', '-last', 0, 0, { u: rec.id }); all.slice(30).forEach((x) => app.delete(x)); } catch (x) {}
}

module.exports = { commit, Fail, staffList, staffSave, staffDelete, enrichClient, noteDevice, devName, has, PERMS };
