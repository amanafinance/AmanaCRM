// История дописывается вместе с действием. Поиск читает все подходящие записи,
// включая старые, по порядку даты и идентификатора.
const has = (p,k) => p === '*' || p.includes(','+k+',');
const rub = value => {
  const [integer, cents] = Number(value || 0).toFixed(2).split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+
    (cents && cents!=='00' ? ','+cents : '')+' ₽';
};
const cashTypes = {
  opex:'Операционный расход',salary:'Зарплата',purchase:'Закупка',transfer:'Перевод',
  payment_in:'Поступление оплаты',other_in:'Прочий приход',other_exp:'Прочий расход',
  inv_in:'Вклад в кассу',inv_out:'Вывод капитала',inv_pay:'Выплата прибыли'
};
const investorTypes = {
  deposit:'Вклад',withdraw:'Вывод капитала',payout:'Выплата прибыли',reinvest:'Прибыль во вклад',
  profit:'Начисление прибыли',loss:'Убыток'
};
const titles = {
  clients:'Договор',persons:'Карточка клиента',wallets:'Счёт',investors:'Участник',
  invMonths:'Месяц инвесторов',settings:'Настройки',payments:'Оплата',
  kassaOps:'Операция кассы',invOps:'Операция инвестора'
};
const rights = {wallets:'v_kassa',kassaOps:'v_kassa',investors:'v_inv',invOps:'v_inv',invMonths:'v_inv'};
const settingsTitles = {
  partners:'Поставщики',contractSeller:'Реквизиты продавца',waTpl:'Шаблоны WhatsApp',
  meta:'Вид CRM',counter:'Нумерация договоров',pcounter:'Нумерация клиентов'
};
function entity(s) {
  const d = s.del ? s.orig : s.data;
  const title = s.c === 'kassaOps' ? cashTypes[d.type] : s.c === 'invOps' ? investorTypes[d.type]
    : s.c === 'payments' && d.type === 'discount' ? 'Скидка' : null;
  return {
    title:title || titles[s.c] || 'Запись',
    name:d.contractId ? 'Договор №'+d.contractId : d.name || d.invName ||
      (s.c === 'settings' ? settingsTitles[s.id] || '' : s.c === 'invMonths' ? s.id : ''),
    verb:s.del ? 'Удалено' : s.existed ? 'Изменено' : 'Создано'
  };
}
function describeChange(s, load) {
  const {title,name,verb} = entity(s);
  const d = s.del ? s.orig : s.data;
  const right = rights[s.c] || '';
  const full = [verb+' · '+title, name].filter(Boolean);
  const changes = [];
  const changed = (key,label,format,required=right) => {
    if (s.del || !s.existed || d[key] === s.orig[key]) return;
    const before = s.orig[key] == null ? '—' : format(s.orig[key]);
    const after = d[key] == null ? '—' : format(d[key]);
    changes.push({right:required,text:label+' '+before+' → '+after});
  };
  if (['payments','kassaOps','invOps'].includes(s.c)) {
    if (s.c==='kassaOps' && d.desc) changes.push({right,text:String(d.desc).slice(0,200)});
    if (!s.existed || s.del) full.push(rub(d.amount));
    changed('amount','Сумма',rub);
    const wallet = id => /^[\w-]{1,100}$/.test(String(id)) ? load('wallets',String(id)).data?.name || String(id) : '—';
    const from = d.wallet && (d.walletName || wallet(d.wallet));
    const to = d.walletTo && (d.walletToName || wallet(d.walletTo));
    if (from) full.push(from+(to?' → '+to:''));
    if (d.dateStr) full.push(d.dateStr);
    changed('wallet','Счёт',wallet,s.c==='payments'?'v_kassa':right);
    changed('walletTo','Счёт назначения',wallet);
    changed('dateStr','Дата',String);
  } else if (s.c === 'wallets') {
    changed('balance','Остаток',rub);
  } else if (s.c === 'clients') {
    changed('price','Цена',rub);
    changed('prepay','Предоплата',rub);
    changed('cost','Себестоимость',rub,'v_cost');
    changed('archived','Архив',v=>v?'да':'нет');
    if (s.existed && !s.del && d.comment !== s.orig.comment) changes.push({right:'',text:'Обновлён комментарий'});
  }
  // Счёт оплаты уже доступен в исходной записи платежа.
  return [{right,text:full.join(' · ').slice(0,350)},...changes];
}
function describe(changes, load, mode) {
  if (mode === 'restore') {
    return {type:'Восстановление из резервной копии',description:'Восстановлена база · записей обработано '+changes.length};
  }
  const primary = changes.find(s=>s.c==='payments') ||
    changes.find(s=>['invMonths','invOps'].includes(s.c)) ||
    changes.find(s=>s.c==='kassaOps') || changes.find(s=>s.c!=='wallets') || changes[0];
  const {title,name,verb} = entity(primary);
  const comment = primary.c==='clients' && primary.existed && !primary.del && primary.data.comment!==primary.orig.comment;
  const description = (name ? name : title)+(changes.length>1?' · записей '+changes.length:'');
  const detailRows = changes.slice(0,40).flatMap(s=>describeChange(s,load));
  const extra = changes.length-40;
  if(extra>0)detailRows.push({right:'',text:'Других обновлённых записей '+extra});
  return {type:comment?'Комментарий к договору':title+' · '+verb.toLowerCase(),description,detailRows};
}
function redact(data,perms) {
  const out = {...data};
  if (Array.isArray(out.detailRows)) {
    out.details = out.detailRows.filter(row=>row && (!row.right || has(perms,row.right)))
      .map(row=>String(row.text||''));
  }
  delete out.detailRows;
  return out;
}
function list(e) {
  const perms=e.auth?.getString('perms')||'';
  if(e.auth?.collection().name==='users' && !['v_cost','v_inv','v_kassa'].every(right=>has(perms,right))){
    const q=e.requestInfo().query || {};
    if(q.filter || (q.sort && !/^-?(?:id|d|u)(,-?(?:id|d|u))*$/.test(q.sort))){
      return e.json(400,{message:'Для поиска используйте историю действий в CRM'});
    }
  }
  return e.next();
}
function enrich(e) {
  const auth=e.requestInfo?.auth;
  if (!auth || auth.collection().name !== 'users') return;
  e.record.set('data',redact(JSON.parse(e.record.getString('data')||'{}'),auth.getString('perms')));
}
const fold = s => String(s || '').trim().toLowerCase().replace(/(\d)[ \u00a0\u202f](?=\d)/g,'$1');
function search(e,app) {
  const perms=e.auth.collection().name==='_superusers'?'*':e.auth.getString('perms');
  if (!has(perms,'v_journal')) return e.json(403,{message:'Нет доступа к истории действий'});
  const q=e.requestInfo().query || {};
  const args={},filters=[];
  for (const [key,operator] of [['from','>='],['to','<']]) {
    if (!q[key]) continue;
    const date=Number(q[key]);
    if (!Number.isSafeInteger(date)) return e.json(400,{message:'Укажите корректный период'});
    args[key]=date;
    filters.push('d '+operator+' {:'+key+'}');
  }
  const description=fold(q.description).slice(0,200);
  const type=fold(q.type).slice(0,120);
  const day=fold(q.day).slice(0,32);
  const matching=data=>(!description||fold([data.description,...(data.details||[])].join(' ')).includes(description)) &&
    (!type||fold(data.type).includes(type)) && (!day||fold(data.dateStr).includes(day));
  let cursor=null;
  if(q.id){
    const date=Number(q.date);
    if(!/^[\w-]{1,100}$/.test(q.id)||!Number.isSafeInteger(date))return e.json(400,{message:'Неверная позиция в истории'});
    cursor={id:q.id,date};
  }
  const rows=[];
  const batch=250, page=100;
  // Ограничиваем работу одного запроса. Продолжение использует последний проверенный ключ.
  for(let scanned=0;scanned<2000;scanned+=batch){
    const where=cursor?[...filters,'(d < {:date} || (d = {:date} && id < {:id}))']:filters;
    const records=app.findRecordsByFilter('journal',where.join(' && '),'-d,-id',batch,0,{...args,...cursor});
    for(const record of records){
      cursor={id:record.id,date:record.getInt('d')};
      const data=redact(JSON.parse(record.getString('data')||'{}'),perms);
      if(matching(data))rows.push(data);
      if(rows.length===page)return e.json(200,{rows,next:cursor});
    }
    if(records.length<batch)return e.json(200,{rows,next:null});
  }
  return e.json(200,{rows,next:cursor});
}
module.exports = {describe,enrich,search,list};
