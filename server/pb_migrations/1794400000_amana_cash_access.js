/// <reference path="../pb_data/types.d.ts" />
const cashStaff = "@request.auth.collectionName = 'users'";
const cashRead = "(@request.auth.perms = '*' || @request.auth.perms ~ ',v_kassa,')";
const journalRead = "(@request.auth.perms = '*' || @request.auth.perms ~ ',v_journal,')";
function cashRules(app, restricted) {
  for (const name of ['wallets', 'kassaOps', 'trash', 'deleted']) {
    let rule = cashStaff;
    if (name === 'trash') rule += ' && ' + journalRead;
    if (restricted) {
      if (name === 'trash' || name === 'deleted') {
        const field = name === 'trash' ? 'data.coll' : 'data.c';
        rule += " && (" + cashRead + " || (" + field + " != 'wallets' && " + field + " != 'kassaOps'))";
      } else rule += ' && ' + cashRead;
    }
    const c = app.findCollectionByNameOrId(name);
    c.listRule = rule;
    c.viewRule = rule;
    app.save(c);
  }
}
migrate(app => cashRules(app, true), app => cashRules(app, false));
