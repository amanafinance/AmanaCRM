migrate(app=>{
  for(const name of ['amanaBackup']){
    const c=new Collection({type:'base',name,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[
      {name:'id',type:'text',system:true,primaryKey:true,required:true,min:1,max:100,pattern:'^[A-Za-z0-9_-]+$',autogeneratePattern:'[a-zA-Z0-9]{20}'},
      {name:'data',type:'json',maxSize:5000000},{name:'u',type:'number',onlyInt:true},{name:'d',type:'number',onlyInt:true}
    ],indexes:['CREATE INDEX `idx_'+name+'_u` ON `'+name+'` (`u`)']});app.save(c);
  }
  const trash=app.findCollectionByNameOrId('trash');
  const investorVisibility=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule+=investorVisibility;trash.viewRule+=investorVisibility;app.save(trash);
  const users=app.findCollectionByNameOrId('users');
  users.otp.enabled=true;users.otp.duration=300;users.otp.length=6;
  users.mfa.enabled=true;users.mfa.duration=300;users.authToken.duration=8*3600;
  app.save(users);
  app.findAllRecords('users').forEach(u=>{u.refreshTokenKey();app.save(u);});
},app=>{
  const u=app.findCollectionByNameOrId('users');u.mfa.enabled=false;app.save(u);
  const trash=app.findCollectionByNameOrId('trash'),suffix=" && (@request.auth.perms = '*' || @request.auth.perms ~ ',v_inv,' || (data.coll != 'investors' && data.coll != 'invOps' && data.coll != 'invMonths'))";
  trash.listRule=trash.listRule.replace(suffix,'');trash.viewRule=trash.viewRule.replace(suffix,'');app.save(trash);
  for(const c of ['amanaBackup'])app.delete(app.findCollectionByNameOrId(c));
});
