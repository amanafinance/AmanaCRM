migrate(app=>{
  const trash=app.findCollectionByNameOrId('trash');
  const investorVisibility=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule+=investorVisibility;trash.viewRule+=investorVisibility;app.save(trash);
},app=>{
  const trash=app.findCollectionByNameOrId('trash'),suffix=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule=trash.listRule.replace(suffix,'');trash.viewRule=trash.viewRule.replace(suffix,'');app.save(trash);
});
