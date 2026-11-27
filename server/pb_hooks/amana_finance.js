// Обязательные проверки внутри той же транзакции, что и запись денег.
const cents = v => Math.round(Number(v || 0) * 100);
const day = v => { const ms = v && v.$date ? Date.parse(v.$date) : NaN; return Number.isFinite(ms) ? new Date(ms + 10800000).toISOString().slice(0, 10) : ''; };
const isoDay = v => String(v || '').replace(/^(\d\d)\.(\d\d)\.(\d{4})$/, '$3-$2-$1');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const dirs = {payment_in:1,prepay_in:1,inv_in:1,purchase:-1,opex:-1,salary:-1,other_exp:-1,inv_out:-1,inv_pay:-1,transfer:0};
const standardWallet = w => !!(w.isDefault||(w.name==='Наличные'&&w.type==='cash'));
function validate(ctx) {
  const {tx,cache,load,Fail,now,mode} = ctx;
  const bad = m => { throw new Fail('bad',m,400); };
  const changed = Object.values(cache).filter(s=>s.dirty);
  const rows = (c,original) => {
    const map = {};
    tx.findAllRecords(c).forEach(r=>{map[r.id]={...JSON.parse(r.getString('data')||'{}'),id:r.id};});
    if(!original)Object.values(cache).filter(s=>s.c===c).forEach(s=>{if(s.exists)map[s.id]={...s.data,id:s.id};else delete map[s.id];});
    return Object.values(map);
  };
  const currentDay = new Date(now+10800000).toISOString().slice(0,10);
  const months = rows('invMonths',true).map(m=>m.id).sort(),closed=months[months.length-1]||'';
  const checkDate = (d, label) => {const value=day(d);if(!value)bad(label+': не заполнена дата');if(value>currentDay)bad('Дата не может быть в будущем');if(closed&&value.slice(0,7)<=closed)bad('Этот месяц уже закрыт у инвесторов');};
  const amount = (v,label) => {if(typeof v!=='number'||!Number.isFinite(v)||v<=0||!Number.isSafeInteger(cents(v))||Math.abs(v*100-cents(v))>0.000001)bad('Проверьте сумму: '+label);};
  const payments=rows('payments'),cash=rows('kassaOps'),deals=rows('clients');
  for(const s of changed.filter(s=>s.c==='investors')){
    if(s.exists&&!['founder','investor'].includes(s.data.role))bad('Проверьте роль участника');
    if(!s.exists&&rows('invOps',true).some(o=>o.invId===s.id))bad('У участника есть история денег — удалить нельзя');
    if(s.existed&&s.exists&&s.orig.role!==s.data.role&&rows('invOps',true).some(o=>o.invId===s.id))bad('Нельзя менять роль участника с историей денег');
  }
  const financialKeys = (a,b,keys) => keys.some(k=>!equal(a[k],b[k]));
  const expected = {};
  const bookedBalance = id => cash.reduce((n,o)=>n+(o.wallet===id?(o.type==='transfer'?-cents(o.amount):(dirs[o.type]||0)*cents(o.amount)):0)+(o.type==='transfer'&&o.walletTo===id?cents(o.amount):0),0);
  const usedInCash = (o,id) => o.wallet===id||o.walletTo===id;
  function requireOpenWallet(id) {
    const wallet=load('wallets',id);
    if(!wallet.exists)bad('Счёт операции не найден');
    if(wallet.orig.archived||wallet.data.archived)bad('Счёт «'+(wallet.data.name||'')+'» закрыт. Откройте его в справочниках перед изменением операций.');
  }
  function effect(o,mult) {
    if(!o||!o.type)return;
    if(!(o.type in dirs))bad('Неизвестный вид кассовой операции');
    amount(o.amount,'касса');
    if(!o.wallet)bad('Счёт операции не найден');
    requireOpenWallet(o.wallet);
    const add=(id,n)=>expected[id]=(expected[id]||0)+mult*n;
    if(o.type==='transfer'){
      if(!o.walletTo||o.walletTo===o.wallet)bad('Проверьте счета перевода');
      requireOpenWallet(o.walletTo);
      add(o.wallet,-cents(o.amount));add(o.walletTo,cents(o.amount));
    }else add(o.wallet,dirs[o.type]*cents(o.amount));
  }
  for(const s of changed){
    if(s.c==='kassaOps'){
      const keys=['type','amount','wallet','walletTo','date','refId','refType','paymentId','invOpId'];
      const moneyChanged=!s.existed||!s.exists||financialKeys(s.orig,s.data,keys);
      if(!moneyChanged)continue;
      if(s.existed&&s.exists&&['payment_in','prepay_in','inv_in','inv_out','inv_pay'].includes(s.orig.type)&&financialKeys(s.orig,s.data,['type','refId','refType','paymentId','invOpId']))bad('Связанную операцию нельзя переносить: отмените её целиком');
      if(s.existed){checkDate(s.orig.date,'Исходная операция');effect(s.orig,-1);}
      if(s.exists){checkDate(s.data.date,'Операция кассы');effect(s.data,1);}
      const o=s.exists?s.data:s.orig;
      if(['payment_in','prepay_in'].includes(o.type)){
        const p=load('payments',o.paymentId||'missing');
        const d=s.exists?p.data:p.orig;
        if(!p.dirty||p.exists!==s.exists||d.kassaOpId!==s.id||d.clientId!==o.refId||d.wallet!==o.wallet||cents(d.amount)!==cents(o.amount)||day(d.date)!==day(o.date)||d.type!==(o.type==='payment_in'?'payment':'prepay'))bad('Платёж и касса должны сохраняться вместе');
      }
      if(['inv_in','inv_out','inv_pay'].includes(o.type)){
        const p=load('invOps',o.invOpId||'missing'),d=s.exists?p.data:p.orig;
        if(!p.dirty||p.exists!==s.exists||d.kassaOpId!==s.id||d.invId!==o.refId||d.wallet!==o.wallet||cents(d.amount)!==cents(o.amount)||day(d.date)!==day(o.date)||o.type!==({deposit:'inv_in',withdraw:'inv_out',payout:'inv_pay'})[d.type])bad('Операция инвестора и касса должны совпадать');
      }
    }
    if(s.c==='wallets'){
      if(s.existed&&!s.exists){
        if(cents(s.orig.balance)!==0||standardWallet(s.orig))bad('Нельзя удалить стандартный счёт или счёт с остатком');
        if(cash.some(o=>usedInCash(o,s.id))||rows('kassaOps',true).some(o=>usedInCash(o,s.id))||
          payments.some(p=>p.wallet===s.id)||rows('invOps').some(o=>o.wallet===s.id)||
          deals.some(d=>d.prepayWallet===s.id&&cents(d.prepay)>0))bad('У счёта есть история. Закройте его в справочниках.');
      }else if(s.exists){
        if(typeof s.data.balance!=='number'||!Number.isFinite(s.data.balance)||!Number.isSafeInteger(cents(s.data.balance))||Math.abs(s.data.balance*100-cents(s.data.balance))>0.000001)bad('Проверьте остаток счёта');
        if(!s.existed&&cents(s.data.balance)!==0)bad('Новый счёт создаётся с нулевым остатком');
        if(s.data.archived!==undefined&&typeof s.data.archived!=='boolean')bad('Проверьте статус счёта');
        if(s.data.archived){
          if(standardWallet(s.orig)||standardWallet(s.data))bad('Основной наличный счёт закрыть нельзя');
          if(cents(s.data.balance)!==0)bad('Закрыть можно только счёт с нулевым остатком. Сначала переведите остаток.');
          if(!s.orig.archived&&bookedBalance(s.id)!==0)bad('Сначала сверьте остаток счёта с операциями кассы');
        }
      }
    }
    if(s.c==='payments'){
      const p=s.exists?s.data:s.orig;
      if(p.type==='prepay'&&(!s.existed||!s.exists||financialKeys(s.orig,s.data,['amount','wallet','date']))){
        const deal=load('clients',p.clientId||'missing');
        if(!deal.exists)bad('Договор предоплаты не найден');
        const pp=payments.filter(x=>x.clientId===p.clientId&&x.type==='prepay');
        if(pp.length>1||cents(pp.reduce((n,x)=>n+x.amount,0))!==cents(deal.data.prepay))bad('Предоплата должна совпадать с договором');
        if(s.existed)checkDate(s.orig.date,'Предоплата');
        if(s.exists){amount(p.amount,'предоплата');checkDate(p.date,'Предоплата');}
        const k=load('kassaOps',p.kassaOpId||'missing');
        if(!k.dirty||k.exists!==s.exists)bad('Предоплата должна сохраняться вместе с кассой');
      }
    }
    if(s.c==='clients'){
      if(s.existed&&!s.exists){
        if(cents(s.orig.prepay)>0||rows('payments',true).some(p=>p.clientId===s.id&&p.type!=='discount')||rows('kassaOps',true).some(o=>o.refType==='client'&&o.refId===s.id))bad('У договора есть история денег — удалить нельзя');
        continue;
      }
      const d=s.data;
      const keys=['price','cost','prepay','months','date',...Array.from({length:120},(_,i)=>'размер'+(i+1)),...Array.from({length:120},(_,i)=>'дата'+(i+1))];
      if(!s.existed||financialKeys(s.orig,d,keys)){
        amount(d.price,'цена');amount(d.cost,'себестоимость');
        if(d.cost>=d.price||!Number.isFinite(d.prepay)||d.prepay<0||d.prepay>=d.cost)bad('Проверьте цену, себестоимость и предоплату');
        if(!Number.isInteger(d.months)||d.months<1||d.months>120)bad('Срок — от 1 до 120 месяцев');
        let sum=0,previous=isoDay(d.date);
        if(!/^\d{4}-\d\d-\d\d$/.test(previous))bad('Проверьте дату договора');
        for(let i=1;i<=d.months;i++){amount(d['размер'+i],'график');sum+=cents(d['размер'+i]);const date=isoDay(d['дата'+i]);if(!/^\d{4}-\d\d-\d\d$/.test(date)||date<previous)bad('Даты графика должны идти по порядку');previous=date;}
        if(sum!==cents(d.price)-cents(d.prepay))bad('График не сходится с ценой');
        if(s.existed&&closed&&financialKeys(s.orig,d,['price','cost','prepay','date'])&&rows('payments',true).some(p=>p.clientId===s.id&&day(p.date).slice(0,7)<=closed))bad('Деньги договора относятся к закрытому месяцу');
        if((!s.existed||cents(d.prepay)!==cents(s.orig.prepay))&&cents(d.prepay)!==payments.filter(p=>p.clientId===s.id&&p.type==='prepay').reduce((n,p)=>n+cents(p.amount),0))bad('Предоплата и платёж договора должны совпадать');
      }
      const paid=payments.filter(p=>p.clientId===s.id&&['payment','discount'].includes(p.type)).reduce((n,p)=>n+cents(p.amount),0);
      const debt=cents(d.price)-cents(d.prepay)-paid;
      if(debt<0)bad('Изменение создаёт переплату — проверьте сумму');
      if(d.archived&&(!s.existed||!s.orig.archived)&&debt>0)bad('Нельзя отправить в архив договор с долгом');
    }
  }
  for(const id of new Set([...Object.keys(expected),...changed.filter(s=>s.c==='wallets'&&s.exists).map(s=>s.id)])){
    const w=load('wallets',id),delta=cents(w.data.balance)-cents(w.orig.balance);
    if(mode==='reconcile'){
      if(cents(w.data.balance)!==bookedBalance(id))bad('Остаток сверки не совпадает с операциями');
    }else if(delta!==(expected[id]||0))bad('Изменение остатка счёта не совпадает с кассой');
    if(expected[id]&&!w.dirty)bad('Изменение кассы должно менять остаток счёта');
  }
  for(const s of changed.filter(s=>s.c==='kassaOps'&&s.exists&&s.data.type==='purchase')){
    const d=load('clients',s.data.refId||'missing');if(!d.exists)bad('Договор закупки не найден');
    const total=cash.filter(o=>o.type==='purchase'&&o.refId===d.id).reduce((n,o)=>n+cents(o.amount),0);
    if(total>cents(d.data.cost))bad('Закупка больше себестоимости');
  }
  if(changed.some(s=>['investors','invOps','invMonths'].includes(s.c))){
    if(changed.some(s=>s.c==='invMonths')&&changed.some(s=>s.c!=='invMonths'&&(s.c!=='invOps'||!['profit','loss'].includes((s.exists?s.data:s.orig).type))))bad('Закрытие и отмена месяца выполняются отдельной операцией');
    const data={};for(const c of ['clients','payments','kassaOps','investors','invOps','invMonths','wallets'])data[c]=rows(c);
    const model=require(`${__hooks}/amana_model.js`),before={...data,invOps:rows('invOps',true),invMonths:rows('invMonths',true)};
    const previous=model.build(before),next=model.build(data);
    for(const s of changed.filter(s=>s.c==='investors'&&s.exists&&s.data.archived&&(!s.existed||!s.orig.archived))){const b=next.bal[s.id]||{};if(cents(b.capital)||cents(b.payable))bad('Участника можно архивировать только с нулевым капиталом и прибылью к выплате');}
    for(const s of changed.filter(s=>s.c==='invOps')){
      const d=s.exists?s.data:s.orig;
      if(s.exists&&!data.investors.some(i=>i.id===d.invId))bad('Участник операции не найден');
      if(s.exists&&d.depId){const t=next.tranches[d.depId];if(!t||t.invId!==d.invId||t.date>new Date(d.date&&d.date.$date))bad('Вклад операции не найден или принадлежит другому участнику');}
      if(!s.existed&&['withdraw','payout','reinvest'].includes(d.type)&&!Object.values(next.tranches).some(t=>t.invId===d.invId&&t.id!==s.id&&t.date<=new Date(d.date&&d.date.$date)))bad('У участника нет действующего вклада');
      if(s.existed&&s.exists&&financialKeys(s.orig,s.data,['amount','invId','type','depId','date','wallet','kassaOpId','month','deps']))bad('Операцию инвестора нельзя переписать: отмените её');
      if(s.existed&&s.exists&&s.orig.pct!==s.data.pct&&closed&&day(s.orig.date).slice(0,7)<=closed)bad('Нельзя менять долю вклада, по которому месяц уже закрыт');
      if(!s.exists||!s.existed){
        amount(d.amount,'инвестор');if(!s.existed)checkDate(d.date,'Операция инвестора');
        if(!['deposit','withdraw','payout','reinvest','profit','loss'].includes(d.type))bad('Неизвестный вид операции инвестора');
        if(['profit','loss'].includes(d.type)){
          const m=cache['invMonths/'+d.month];if(!m||!m.dirty||m.exists!==s.exists)bad('Начисления создаются только при закрытии месяца');
          if(day(d.date).slice(0,7)!==d.month)bad('Дата начисления должна относиться к закрываемому месяцу');
        }
        if(['deposit','withdraw','payout'].includes(d.type)){
          const k=load('kassaOps',d.kassaOpId||'missing');if(!k.dirty||k.exists!==s.exists)bad('Операция инвестора должна сохраняться с кассой');
        }
        if(!s.exists&&day(d.date).slice(0,7)<=closed&&!['profit','loss'].includes(d.type))bad('Месяц операции инвестора закрыт');
      }
      if((d.type==='deposit'||(d.type==='reinvest'&&!d.depId))&&(!Number.isFinite(d.pct)||d.pct<0||d.pct>100)&&data.investors.find(i=>i.id===d.invId)?.role!=='founder')bad('Доля инвестора — от 0 до 100%');
    }
    for(const [id,v] of Object.entries(next.tcapNow))if(cents(v)<0&&cents(v)<cents(previous.tcapNow[id]))bad('Недостаточно капитала во вкладе. Данные изменились на другом устройстве');
    for(const [id,v] of Object.entries(next.tpay))if(cents(v)<0&&cents(v)<cents(previous.tpay[id]))bad('Недостаточно прибыли к выплате. Данные изменились на другом устройстве');
    for(const s of changed.filter(s=>s.c==='invMonths')){
      if(s.existed&&s.exists)bad('Закрытый месяц нельзя переписать');
      if(s.exists){
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s.id))bad('Проверьте месяц закрытия');
        if(s.id>=currentDay.slice(0,7)||previous.months.some(m=>m<s.id&&!previous.closed[m]))bad('Месяцы нужно закрывать по порядку после их окончания');
        const computed=model.month(previous,s.id);
        for(const k of ['gross','exp','net','unalloc','poolCap'])if(cents(s.data[k])!==cents(computed[k]))bad('Расчёт месяца изменился — обновите страницу');
        const ops=changed.filter(x=>x.c==='invOps'&&x.exists&&x.data.month===s.id);
        const expectedOps=computed.rows.flatMap(r=>(r.deps||[]).filter(d=>d.total).map(d=>({invId:r.invId,depId:d.depId,type:d.total>0?'profit':'loss',amount:Math.abs(d.total)})));
        if(ops.length!==expectedOps.length||expectedOps.some(o=>!ops.some(x=>x.data.invId===o.invId&&x.data.depId===o.depId&&x.data.type===o.type&&cents(x.data.amount)===cents(o.amount))))bad('Начисления не совпадают с расчётом сервера');
        s.data={...computed,month:s.id,closedAt:{$date:new Date(now).toISOString()}};delete s.data.live;
      }else{
        if(s.id!==closed)bad('Отменить можно только последнее закрытие');
        if(data.invOps.some(o=>o.month===s.id&&['profit','loss'].includes(o.type)))bad('Отмена закрытия должна отменять все начисления месяца');
      }
    }
  }
}
module.exports={validate,cents,day,dirs};
