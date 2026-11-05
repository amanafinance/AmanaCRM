/// <reference path="../pb_data/types.d.ts" />
// Устройства сотрудников: с какого телефона или компьютера входили и когда (Безопасность → Сотрудники и права).
// Запись обновляется при каждом входе и при каждом открытии CRM (продление входа). Напрямую читать и писать
// эту таблицу нельзя никому, кроме администратора: список отдаёт /api/amana/staff тем, у кого право staff.
migrate((app) => {
  const c = new Collection({
    type: 'base',
    name: 'devices',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'user', type: 'text', required: true, max: 50 },
      { name: 'key', type: 'text', required: true, max: 100 },
      { name: 'name', type: 'text', max: 200 },
      { name: 'ua', type: 'text', max: 1000 },
      { name: 'ip', type: 'text', max: 100 },
      { name: 'first', type: 'number', onlyInt: true },
      { name: 'last', type: 'number', onlyInt: true },
      { name: 'count', type: 'number', onlyInt: true },
    ],
    indexes: ['CREATE UNIQUE INDEX `idx_devices_user_key` ON `devices` (`user`, `key`)'],
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('devices')); } catch (e) {}
});
