/// <reference path="../pb_data/types.d.ts" />
// Amana CRM: все изменения данных — одной транзакцией через этот адрес (см. amana_lib.js)
routerAdd('POST', '/api/amana/commit', (e) => {
  return require(`${__hooks}/amana_lib.js`).commit(e, $app);
}, $apis.requireAuth('users', '_superusers'));
routerAdd('GET','/api/amana/backup-mail',e=>require(`${__hooks}/amana_mail.js`).settings(e,$app),$apis.requireAuth('users','_superusers'));
routerAdd('POST','/api/amana/backup-mail',e=>require(`${__hooks}/amana_mail.js`).settings(e,$app),$apis.requireAuth('users','_superusers'));
routerAdd('POST','/api/amana/backup-mail/send',e=>require(`${__hooks}/amana_mail.js`).sendNow(e,$app),$apis.requireAuth('users','_superusers'));
routerAdd('POST','/api/amana/note',e=>require(`${__hooks}/amana_mail.js`).note(e,$app),$apis.requireAuth('users','_superusers'));
cronAdd('amana-mail-backup','* * * * *',()=>require(`${__hooks}/amana_mail.js`).send($app,false,null));

// Выбор счёта для оплаты доступен без чтения кассовой книги.
routerAdd('GET', '/api/amana/wallet-options', e => {
  const options = $app.findAllRecords('wallets').map(record => {
    const w = JSON.parse(record.getString('data'));
    return { id: record.id, name: w.name || '', isDefault: !!w.isDefault };
  });
  return e.json(200, options);
}, $apis.requireAuth('users', '_superusers'));

// Сотрудники и права (Настройки → Сотрудники): список, добавить/изменить, удалить. Нужно право staff.
routerAdd('GET', '/api/amana/staff', (e) => require(`${__hooks}/amana_lib.js`).staffList(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('POST', '/api/amana/staff', (e) => require(`${__hooks}/amana_lib.js`).staffSave(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('POST', '/api/amana/staff/{id}', (e) => require(`${__hooks}/amana_lib.js`).staffSave(e, $app), $apis.requireAuth('users', '_superusers'));
routerAdd('DELETE', '/api/amana/staff/{id}', (e) => require(`${__hooks}/amana_lib.js`).staffDelete(e, $app), $apis.requireAuth('users', '_superusers'));

// Вход и продление входа сотрудника: запоминаем устройство и время (ошибка записи не мешает войти)
onRecordAuthRequest((e) => { e.next(); try { require(`${__hooks}/amana_lib.js`).noteDevice(e, $app); } catch (x) { console.log('devices:', x); } }, 'users');

// Себестоимость в договорах — только тем, у кого есть право её видеть
onRecordEnrich((e) => { require(`${__hooks}/amana_lib.js`).enrichClient(e); e.next(); }, 'clients','trash');

// Только для автотестов (переменная окружения AMANA_TEST=1, на настоящем сервере её нет):
// очистить базу и записать тестовые данные напрямую, без проверок. Доступно только администратору.
if ($os.getenv('AMANA_TEST') === '1') {
  onMailerRecordOTPSend(e=>{const code=e.meta.otp||String(e.message.html||e.message.text).match(/\b\d{6}\b/)?.[0];e.app.store().set('testotp_'+e.record.email(),String(code||''));},'users');
  onMailerSend(e=>{const m=e.message;const attachments={};for(const k of Object.keys(m.attachments||{}))attachments[k]=readerToString(m.attachments[k]);e.app.store().set('testmail',{to:m.to,subject:m.subject,attachments});});
  routerAdd('GET','/api/amana/test/otp/{email}',e=>e.json(200,{code:$app.store().get('testotp_'+e.request.pathValue('email'))||''}),$apis.requireSuperuserAuth());
  routerAdd('GET','/api/amana/test/mail',e=>e.json(200,$app.store().get('testmail')||{}),$apis.requireSuperuserAuth());
  // В каждом независимом тестовом входе новая корзина лимитов; на рабочем сервере маршрута нет.
  routerAdd('POST','/api/amana/test/reset-login-limits',e=>{$app.store().remove('__pbRateLimiters__');const email=(e.requestInfo().body||{}).email;if(email)$app.store().remove('testotp_'+email);return e.json(200,{ok:true});},$apis.requireSuperuserAuth());
  routerAdd('POST','/api/amana/test/backup-tick',e=>{const b=e.requestInfo().body||{};$app.store().set('testmailfail',!!b.fail);require(`${__hooks}/amana_mail.js`).send($app,false,null,b.now);return e.json(200,{ok:true});},$apis.requireSuperuserAuth());
  routerAdd('POST', '/api/amana/test/wipe', (e) => {
    ['clients', 'payments', 'kassaOps', 'wallets', 'persons', 'investors', 'invOps', 'invMonths', 'settings', 'journal', 'trash', 'deleted','amanaBackup']
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
