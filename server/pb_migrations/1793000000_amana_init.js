/// <reference path="../pb_data/types.d.ts" />
// Таблицы Amana CRM в PocketBase.
// Каждая запись — документ: id (как в копии CRM), data (все поля договора/платежа/… в JSON),
// u (время последнего изменения на сервере, мс — по нему устройства докачивают только изменения),
// d (дата записи, мс — для выборок истории действий по датам).
// Читать может любой вошедший сотрудник. Писать напрямую нельзя никому, кроме администратора:
// все изменения идут через /api/amana/commit (pb_hooks), где проверяются остатки, номера и т. п.
const AMANA_COLS = ['clients', 'payments', 'kassaOps', 'wallets', 'persons', 'investors', 'invOps', 'invMonths', 'settings', 'journal', 'trash', 'deleted'];
const STAFF = "@request.auth.collectionName = 'users'";

migrate((app) => {
  for (const name of AMANA_COLS) {
    const c = new Collection({
      type: 'base',
      name,
      listRule: STAFF,
      viewRule: STAFF,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'id', type: 'text', system: true, primaryKey: true, required: true, min: 1, max: 100, pattern: '^[A-Za-z0-9_-]+$', autogeneratePattern: '[a-zA-Z0-9]{20}' },
        { name: 'data', type: 'json', maxSize: 5000000 },
        { name: 'u', type: 'number', onlyInt: true },
        { name: 'd', type: 'number', onlyInt: true },
      ],
      indexes: [
        'CREATE INDEX `idx_' + name + '_u` ON `' + name + '` (`u`)',
        'CREATE INDEX `idx_' + name + '_d` ON `' + name + '` (`d`)',
      ],
    });
    app.save(c);
  }

  // Сотрудники: аккаунты создаёт только администратор в панели, сами зарегистрироваться нельзя
  const users = app.findCollectionByNameOrId('users');
  users.createRule = null;
  users.updateRule = null;
  users.deleteRule = null;
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  users.authToken.duration = 30 * 24 * 3600; // вход действует 30 дней, при каждом открытии CRM продлевается
  app.save(users);

  const s = app.settings();
  s.meta.appName = 'Amana CRM';
  s.rateLimits.enabled = true; // защита от подбора паролей
  app.save(s);
}, (app) => {
  for (const name of AMANA_COLS) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) {}
  }
});
