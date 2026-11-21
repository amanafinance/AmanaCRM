import {reseed,device,login,check,noErrors,PB_URL,pbAdmin,authToken,URL_CRM} from '../lib.mjs';

export default async function(){
  await reseed();
  const admin=await pbAdmin();
  const logs=Array.from({length:162},(_,i)=>({
    c:'journal',id:'uxjournal'+i,
    data:{type:i===161?'Редкое действие':i===160?'Редкое действие отменено':'Учебная запись',description:i===161?'Редкая запись КИРИЛЛИЦА':'Событие '+i,
      date:{$date:new Date(Date.now()-i*60000).toISOString()},dateStr:'01.11.2026',time:'12:00'}
  }));
  const seed=await fetch(PB_URL+'/api/amana/test/seed',{method:'POST',
    headers:{Authorization:admin,'Content-Type':'application/json'},body:JSON.stringify({docs:logs})});
  check('тестовая история создана',seed.ok);

  const {p,ctx,errs}=await device({vp:{width:390,height:844},mobile:true});
  await p.goto(URL_CRM);
  await p.fill('#lpass','test-password');
  await p.getByRole('button',{name:'Показать пароль'}).click();
  const revealed=await p.locator('#lpass').getAttribute('type')==='text';
  await p.getByRole('button',{name:'Скрыть пароль'}).click();
  check('значок глаза переключает видимость пароля из его строки',
    revealed && await p.locator('#lpass').getAttribute('type')==='password' &&
    await p.locator('.login-password #show-password svg').count()===1 &&
    !(await p.getByText('Забыли пароль?',{exact:true}).count()));
  await login(p);
  for (const view of ['people','clients']){
    const result=await p.evaluate(async page=>{
      goBase(page);
      const section=document.getElementById('page-'+page);
      const search=section.querySelector('.quick-find');
      const list=page==='people'?section.querySelector('#pplList'):section.querySelector('.tbl-wrap');
      window.scrollTo(0,search.getBoundingClientRect().top+window.scrollY+100);
      await new Promise(requestAnimationFrame);
      return {
        header:section.querySelector('h1').getBoundingClientRect().bottom,
        search:search.getBoundingClientRect().top,
        nestedScroll:getComputedStyle(list).overflowY,
        viewport:window.scrollY
      };
    },view);
    check('телефон: '+view+' прокручивает страницу целиком и оставляет поиск сверху',
      result.header<0 && Math.abs(result.search)<2 && result.nestedScroll==='visible' && result.viewport>100,result);
  }
  await p.evaluate(()=>goBase('people'));
  await p.fill('#peopleFind','00001');
  check('быстрый поиск клиента находит его по номеру договора',
    await p.locator('.ppl-mob .mcard').count()===1 && (await p.locator('.ppl-mob .mcard').innerText()).includes('Клиент 0'));
  await p.evaluate(()=>openPerson('p:P0'));
  const address=p.url();
  await p.goBack();
  check('браузер возвращает в список и сохраняет фильтр',await p.isVisible('#page-people') && await p.inputValue('#peopleFind')==='00001');
  check('при возврате заголовок получает фокус без рамки',await p.locator('#page-people h1').evaluate(heading=>
    document.activeElement===heading && getComputedStyle(heading).outlineStyle==='none'));
  await p.goto(address);
  await p.reload();
  await p.waitForFunction(()=>document.querySelector('#personBody h1')?.textContent.includes('Клиент 0'));
  check('прямая ссылка на клиента работает после перезагрузки',await p.isVisible('#page-person'));

  await p.evaluate(()=>goTo('dashboard'));
  const trigger=p.locator('#page-dashboard button').filter({hasText:'Новый договор'}).first();
  // На телефоне браузер не всегда даёт кнопке фокус при касании.
  await trigger.focus();
  await trigger.click();
  check('фокус внутри окна и фон недоступен',await p.evaluate(()=>document.getElementById('app').inert && !!document.activeElement.closest('#mClient')));
  await p.keyboard.press('Shift+Tab');
  check('при Tab фокус остаётся в форме',await p.evaluate(()=>!!document.activeElement.closest('#mClient')));
  await p.fill('#f_product','Черновой товар');
  await p.click('#mCBtn');
  check('ошибка нового договора привязана к полю',await p.locator('#f_name').getAttribute('aria-invalid')==='true' && await p.isVisible('#field-error-f_name'));
  await p.fill('#f_name','Клиент 0');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  check('клиента можно выбрать клавиатурой',await p.locator('#f_name').getAttribute('data-key')==='p:P0');
  await p.locator('#mClient .m-x').click();
  check('закрытие заполненной формы требует выбора',await p.isVisible('#cfAlternate') && await p.isVisible('#cfCancel'));
  await p.click('#cfAlternate');
  check('возврат фокуса при закрытии',await trigger.evaluate(el=>document.activeElement===el));
  await trigger.click();
  check('черновик возвращает товар и выбранного клиента',await p.inputValue('#f_product')==='Черновой товар' && await p.locator('#f_name').getAttribute('data-key')==='p:P0');
  await p.locator('#mClient .m-x').click();
  await p.click('#cfOk');

  await p.setViewportSize({width:320,height:844});
  await p.evaluate(()=>goBase('reminders'));
  const reminderScroll=await p.evaluate(async()=>{
    const page=document.getElementById('page-reminders');
    const list=page.querySelector('.tbl-wrap');
    window.scrollTo(0,list.getBoundingClientRect().top+window.scrollY+100);
    await new Promise(requestAnimationFrame);
    const result={y:window.scrollY,heading:page.querySelector('h1').getBoundingClientRect().bottom,overflow:getComputedStyle(list).overflowY};
    window.scrollTo(0,0);
    return result;
  });
  check('на телефоне контроль платежей прокручивается всей страницей',
    reminderScroll.y>100 && reminderScroll.heading<0 && reminderScroll.overflow==='visible',reminderScroll);
  const card=p.locator('.rem-mob .mcard').first();
  check('на 320 все действия платежа помещаются в карточку',await card.evaluate(el=>{
    const end=el.getBoundingClientRect().right;
    return [...el.querySelectorAll('.rem-btns .btn')].every(b=>b.getBoundingClientRect().right<=end+1);
  }));
  await card.getByRole('button',{name:'+ Оплата',exact:true}).click();
  check('форма оплаты содержит договор, остаток и сумму выбранного платежа',await p.evaluate(()=>{
    const text=document.getElementById('mpName').textContent;
    return text.includes('Договор №')&&text.includes('К оплате по графику')&&text.includes('Всего осталось');
  }));
  await p.click('#mpFill');
  check('сумму можно подставить и отредактировать',Number((await p.inputValue('#mpAmt')).replace(/\s/g,''))>0 && await p.locator('#mpAmt').isEditable());
  await p.evaluate(()=>closeM('mPay'));

  await p.evaluate(()=>openContract('c0'));
  await p.evaluate(()=>previewContract());
  check('серия и номер остаются на одной строке на узком экране даже при ошибке ввода',await p.evaluate(()=>{
    const field=k=>document.querySelector('#mContract [data-person="0"][data-field="'+k+'"]');
    const series=field('passportSeries'),number=field('passportNumber');
    return series.getAttribute('aria-invalid')==='true' && Math.abs(series.getBoundingClientRect().y-number.getBoundingClientRect().y)<1;
  }));
  await p.evaluate(()=>closeContract());

  await p.setViewportSize({width:1280,height:850});
  await p.evaluate(()=>openInv('INV1'));
  const month=p.locator('#invPg .chx-col[onclick]').first();
  await month.focus();
  await p.keyboard.press('Enter');
  check('месяц на графике открывается клавиатурой',await p.isVisible('#mInvMonth'));
  check('к широкой таблице месяца можно перейти клавиатурой',await p.locator('#imBody .tbl-wrap').getAttribute('tabindex')==='0');
  await p.keyboard.press('Escape');
  check('Escape закрывает окно и возвращает фокус на график',!(await p.isVisible('#mInvMonth')) &&
    await month.evaluate(el=>el===document.activeElement));

  await p.setViewportSize({width:390,height:844});
  await p.evaluate(()=>goTo('journal'));
  await p.waitForFunction(()=>!journalBusy && _jd.length>=100);
  check('редкого действия нет в первой загруженной странице истории',
    await p.evaluate(()=>!_jd.some(row=>row.type==='Редкое действие')));
  await p.locator('.j-filters').getByRole('button',{name:'Действие',exact:true}).click();
  const actions=p.locator('#fdOverlay select#fdi_v');
  await p.waitForFunction(()=>document.querySelector('#fdOverlay select#fdi_v:enabled'));
  check('список действий содержит редкие варианты из всей истории',
    await actions.locator('option').evaluateAll(options=>['','Редкое действие','Редкое действие отменено'].every(value=>options.some(o=>o.value===value))));
  await actions.selectOption('Редкое действие');
  await p.click('#fdo_apply');
  await p.waitForFunction(()=>!journalBusy);
  check('выбор действия показывает только точные совпадения',
    await p.evaluate(()=>_jd.length===1 && _jd[0].type==='Редкое действие'));
  await p.locator('.j-filters').getByRole('button',{name:'Действие',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('#fdOverlay select#fdi_v:enabled'));
  await actions.selectOption('');
  await p.click('#fdo_apply');
  await p.waitForFunction(()=>!journalBusy && _jd.length>=100);
  check('история снова показывает компактные записи без раздела «Что изменилось»',
    !(await p.getByText('Что изменилось',{exact:true}).count()));
  await p.evaluate(()=>{S.JF.desc='кириллица';return loadJournal();});
  check('поиск по всей истории находит старое событие без учёта регистра',await p.evaluate(()=>_jd.length===1 && _jd[0].description==='Редкая запись КИРИЛЛИЦА'));
  await ctx.route('**/api/amana/journal*',r=>r.abort());
  await p.evaluate(()=>loadJournal());
  check('при сбое история и кнопка повторной загрузки остаются на экране',
    await p.isVisible('.j-error button') && await p.evaluate(()=>_jd.length===1));
  await ctx.unroute('**/api/amana/journal*');
  await p.locator('.j-error button').click();
  await p.waitForFunction(()=>!journalBusy);
  check('повторная загрузка восстанавливает историю',!(await p.locator('.j-error').count()));

  await p.evaluate(async()=>{
    goTo('kassa');
    openKassaEdit('manual1');
    document.getElementById('koAmt').value='1200';
    await saveKassaOp();
  });
  await p.evaluate(()=>{S.JF={desc:'сумма 1000'};return loadJournal();});
  check('история показывает сумму до и после и название счёта',await p.evaluate(()=>_jd.some(j=>
    j.details?.some(d=>d.replace(/\u00a0/g,'').includes('1000 ₽ → 1200 ₽')) && j.details?.some(d=>d.includes('Наличные')))));
  const owner=await authToken('a@test.ru','test12345');
  const viewer=await fetch(PB_URL+'/api/amana/staff',{method:'POST',
    headers:{Authorization:owner,'Content-Type':'application/json'},
    body:JSON.stringify({name:'Проверка истории',email:'uxviewer@test.ru',password:'test-viewer-123',perms:['v_journal']})});
  check('создан тестовый пользователь с правом на историю',viewer.ok);
  const token=await authToken('uxviewer@test.ru','test-viewer-123');
  const restricted=await fetch(PB_URL+'/api/amana/journal?description=1200',{headers:{Authorization:token}});
  check('поиск не раскрывает закрытую сумму кассы',restricted.ok && !(await restricted.json()).rows.length);
  noErrors('новый интерфейс',errs);
  await ctx.close();
}
