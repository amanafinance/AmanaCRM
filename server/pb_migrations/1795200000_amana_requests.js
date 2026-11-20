// Подтверждения записей: сохраняются в той же транзакции, что деньги и история.
// Доступ только через маршруты своего пользователя; содержимое операций здесь не хранится.
migrate(app=>{
  app.save(new Collection({name:'amanaRequests',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[
    {name:'id',type:'text',system:true,primaryKey:true,required:true,min:40,max:40,pattern:'^[a-f0-9]{40}$',autogeneratePattern:'[a-f0-9]{40}'},
    {name:'owner',type:'text',required:true,max:100},{name:'fingerprint',type:'text',max:64},
    {name:'kind',type:'text',max:120},{name:'state',type:'text',required:true,max:20},
    {name:'result',type:'json',maxSize:2000000},{name:'at',type:'number',onlyInt:true}
  ]}));
},app=>app.delete(app.findCollectionByNameOrId('amanaRequests')));
