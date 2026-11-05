/// <reference path="../pb_data/types.d.ts" />
// Amana CRM: все изменения данных — одной транзакцией через этот адрес (см. amana_lib.js)
routerAdd('POST', '/api/amana/commit', (e) => {
  return require(`${__hooks}/amana_lib.js`).commit(e, $app);
}, $apis.requireAuth('users', '_superusers'));

// Только для автотестов (переменная окружения AMANA_TEST=1, на настоящем сервере её нет):
// очистить базу и записать тестовые данные напрямую, без проверок. Доступно только администратору.
if ($os.getenv('AMANA_TEST') === '1') {
  routerAdd('POST', '/api/amana/test/wipe', (e) => {
    ['clients', 'payments', 'kassaOps', 'wallets', 'persons', 'investors', 'invOps', 'invMonths', 'settings', 'journal', 'trash', 'deleted']
      .forEach((c) => $app.db().newQuery('DELETE FROM `' + c + '`').execute());
    return e.json(200, { ok: true });
  }, $apis.requireSuperuserAuth());
  routerAdd('POST', '/api/amana/test/seed', (e) => {
    const docs = (e.requestInfo().body || {}).docs || [];
    $app.runInTransaction((tx) => {
      docs.forEach((x) => {
        let rec; try { rec = tx.findRecordById(x.c, x.id); } catch (err) { rec = new Record(tx.findCollectionByNameOrId(x.c)); rec.set('id', x.id); }
        const dt = x.data && x.data.date && x.data.date.$date ? Date.parse(x.data.date.$date) : 0;
        rec.set('data', x.data); rec.set('u', x.u || 0); rec.set('d', isNaN(dt) ? 0 : dt);
        tx.save(rec);
      });
    });
    return e.json(200, { n: docs.length });
  }, $apis.requireSuperuserAuth());
}
