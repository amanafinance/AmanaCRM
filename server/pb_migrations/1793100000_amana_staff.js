/// <reference path="../pb_data/types.d.ts" />
// Сотрудники и права.
// users.perms — права через запятую с запятыми по краям (",pay,disc,") или "*" — владелец, всё можно.
// users.disabled — вход отключён (не пускает войти, старые входы сбрасываются в /api/amana/staff).
// Разделы, которые сервер не отдаёт без права на просмотр: инвесторы (v_inv), история действий и корзина (v_journal).
// Себестоимость в договорах без права v_cost вырезается в pb_hooks (onRecordEnrich).
const STAFF = "@request.auth.collectionName = 'users'";
const can = (p) => STAFF + " && (@request.auth.perms = '*' || @request.auth.perms ~ '," + p + ",')";

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.add(new TextField({ name: 'perms', max: 2000 }));
  users.fields.add(new BoolField({ name: 'disabled' }));
  users.authRule = 'disabled = false';
  app.save(users);
  // кто уже есть (до появления прав) — владельцы
  app.findAllRecords('users').forEach((u) => { u.set('perms', '*'); app.saveNoValidate(u); });

  for (const [names, p] of [[['investors', 'invOps', 'invMonths'], 'v_inv'], [['journal', 'trash'], 'v_journal']]) {
    for (const n of names) {
      const c = app.findCollectionByNameOrId(n);
      c.listRule = can(p);
      c.viewRule = can(p);
      app.save(c);
    }
  }
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('perms');
  users.fields.removeByName('disabled');
  users.authRule = '';
  app.save(users);
  for (const n of ['investors', 'invOps', 'invMonths', 'journal', 'trash']) {
    const c = app.findCollectionByNameOrId(n);
    c.listRule = STAFF; c.viewRule = STAFF;
    app.save(c);
  }
});
