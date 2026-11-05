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
          cache[k] = { c, id, rec, data: isPlain(data) ? data : {}, exists: !!rec, existed: !!rec, dirty: false, del: false };
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
        out.docs.push({ c: s.c, id: s.id, data: s.data, u: now });
      });
  }
}

module.exports = { commit, Fail };
