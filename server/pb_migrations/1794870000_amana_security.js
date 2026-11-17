migrate(app=>{
  const trash=app.findCollectionByNameOrId('trash');
  const investorVisibility=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule+=investorVisibility;trash.viewRule+=investorVisibility;app.save(trash);
  const users=app.findCollectionByNameOrId('users');
  users.otp.enabled=false;
  users.mfa.enabled=false;users.authToken.duration=8*3600;
  app.save(users);
  app.findAllRecords('users').forEach(u=>{u.refreshTokenKey();app.save(u);});
},app=>{
  const u=app.findCollectionByNameOrId('users');u.mfa.enabled=false;app.save(u);
  const trash=app.findCollectionByNameOrId('trash'),suffix=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule=trash.listRule.replace(suffix,'');trash.viewRule=trash.viewRule.replace(suffix,'');app.save(trash);
});
