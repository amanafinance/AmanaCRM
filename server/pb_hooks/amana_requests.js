// Успешные номера не истекают: старый запрос никогда не должен списать деньги повторно.
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{20,80}$/.test(id);
const owner=e=>e.auth.collection().name+':'+e.auth.id;
const perms=e=>e.auth.collection().name==='_superusers'?'*':e.auth.getString('perms');
const has=(p,k)=>p==='*'||p.includes(','+k+',');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
function ticket(e,body,kind){
  if(body.requestId===undefined)return null; // совместимость с уже открытой прежней версией
  if(!valid(body.requestId))throw new BadRequestError('Некорректный номер операции');
  const data=Object.assign({},body);delete data.requestId;
  const user=owner(e);
  return{id:$security.sha256(user+':'+body.requestId).slice(0,40),owner:user,kind,fingerprint:$security.sha256(kind+':'+stable(data))};
}
function find(app,id){try{return app.findRecordById('amanaRequests',id);}catch(e){return null;}}
function hydrate(app,e,rec){
  const result=JSON.parse(rec.getString('result')||'{}'),p=perms(e);
  if(rec.getString('kind')!=='commit'){
    if(rec.getString('kind').startsWith('staff-')&&!has(p,'staff'))return{ok:true};
    return result;
  }
  const docs=[];
  (result.docs||[]).forEach(ref=>{
    if((ref.c==='wallets'||ref.c==='kassaOps')&&!has(p,'v_kassa'))return;
    if(['investors','invOps','invMonths'].includes(ref.c)&&!has(p,'v_inv'))return;
    if(['journal','trash'].includes(ref.c)&&!has(p,'v_journal'))return;
    let r;try{r=app.findRecordById(ref.c,ref.id);}catch(x){}
    if(!r){docs.push({c:ref.c,id:ref.id,del:true,u:result.u});return;}
    let data=JSON.parse(r.getString('data')||'{}');
    if(ref.c==='clients'&&!has(p,'v_cost')){data=Object.assign({},data);delete data.cost;}
    docs.push({c:ref.c,id:ref.id,data,u:r.getFloat('u')});
  });
  return{u:result.u,docs,counters:result.counters||{}};
}
function previous(app,e,t){
  if(!t)return null;
  const rec=find(app,t.id);if(!rec)return null;
  if(rec.getString('state')==='cancelled')throw new ApiError(409,'Несохранённая операция отменена',{code:'cancelled'});
  if(rec.getString('fingerprint')!==t.fingerprint)throw new BadRequestError('Этот номер уже использован для другого изменения');
  return{value:hydrate(app,e,rec)};
}
function run(app,e,body,kind,fn){
  const t=ticket(e,body,kind);let result;
  app.runInTransaction(tx=>{
    const cached=previous(tx,e,t);if(cached){result=cached.value;return;}
    result=fn(tx);
    if(!t)return;
    const compact=kind==='commit'?{u:result.u,counters:result.counters,docs:(result.docs||[]).map(d=>({c:d.c,id:d.id}))}:result;
    const rec=new Record(tx.findCollectionByNameOrId('amanaRequests'));
    rec.set('id',t.id);rec.set('owner',t.owner);rec.set('kind',kind);rec.set('fingerprint',t.fingerprint);
    rec.set('state','saved');rec.set('result',compact);rec.set('at',Date.now());tx.save(rec);
  });
  return result;
}
function status(e,app,cancel){
  const id=e.request.pathValue('id');if(!valid(id))throw new BadRequestError('Некорректный номер операции');
  const user=owner(e),key=$security.sha256(user+':'+id).slice(0,40);let result;
  const inspect=tx=>{
    let rec=find(tx,key);
    if(!rec&&cancel){
      rec=new Record(tx.findCollectionByNameOrId('amanaRequests'));rec.set('id',key);rec.set('owner',user);
      rec.set('state','cancelled');rec.set('at',Date.now());tx.save(rec);
    }
    result=rec?{state:rec.getString('state'),...(rec.getString('state')==='saved'?{kind:rec.getString('kind'),result:hydrate(tx,e,rec)}:{})}:{state:'unknown'};
  };
  if(cancel)app.runInTransaction(inspect);else inspect(app);
  return e.json(200,result);
}
module.exports={run,ticket,previous,status};
