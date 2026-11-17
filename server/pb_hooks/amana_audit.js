// Серверная история для управления сотрудниками и ручного скачивания копии.
function audit(app, e, type) {
  const now = new Date();
  const local = new Date(now.getTime() + 10800000).toISOString();
  const record = new Record(app.findCollectionByNameOrId('journal'));
  record.set('data', {
    type, description: type,
    user: e && e.auth ? e.auth.email() : 'сервер',
    userId: e && e.auth ? e.auth.id : '',
    date: { $date: now.toISOString() },
    dateStr: local.slice(0, 10).split('-').reverse().join('.'),
    time: local.slice(11, 16)
  });
  record.set('u', now.getTime());
  record.set('d', now.getTime());
  app.save(record);
}

function note(e, app) {
  const body = e.requestInfo().body || {};
  const perms = e.auth.collection().name === '_superusers' ? '*' : e.auth.getString('perms');
  if (perms !== '*' && !perms.includes(',backup,')) throw new ForbiddenError('Нет права на копию');
  if (body.type !== 'Скачана резервная копия') throw new BadRequestError('Неизвестное действие');
  audit(app, e, body.type);
  return e.json(200, { ok: true });
}

module.exports = { audit, note };
