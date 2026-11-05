/// <reference path="../pb_data/types.d.ts" />
// Amana CRM: все изменения данных — одной транзакцией через этот адрес (см. amana_lib.js)
routerAdd('POST', '/api/amana/commit', (e) => {
  return require(`${__hooks}/amana_lib.js`).commit(e, $app);
}, $apis.requireAuth('users', '_superusers'));

// Сотрудники и права (Настройки → Сотрудники): список, добавить/изменить, удалить. Нужно право staff.
routerAdd('GET', '/api/amana/staff', (e) => require(`${__hooks}/amana_lib.js`).staffList(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('POST', '/api/amana/staff', (e) => require(`${__hooks}/amana_lib.js`).staffSave(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('POST', '/api/amana/staff/{id}', (e) => require(`${__hooks}/amana_lib.js`).staffSave(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('DELETE', '/api/amana/staff/{id}', (e) => require(`${__hooks}/amana_lib.js`).staffDelete(e, $app), $apis.requireAuth('users', '_superusers'));

// Вход и продление входа сотрудника: запоминаем устройство и время (ошибка записи не мешает войти)
onRecordAuthRequest((e) => { e.next(); try { require(`${__hooks}/amana_lib.js`).noteDevice(e, $app); } catch (x) { console.log('devices:', x); } }, 'users');

// Себестоимость в договорах — только тем, у кого есть право её видеть
onRecordEnrich((e) => { require(`${__hooks}/amana_lib.js`).enrichClient(e); e.next(); }, 'clients');

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
