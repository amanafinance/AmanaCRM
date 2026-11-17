// Настройки ежедневных почтовых копий.
let _mailConfig=null,_mailLoading=false;
async function renderMailSettings(){
  const card=document.getElementById('mailSettingsCard'),body=document.getElementById('mailSettingsBody');
  if(!card||window.AUTH.perms!=='*')return;card.style.display='block';
  if(body.dataset.ready||_mailLoading)return;_mailLoading=true;
  try{_mailConfig=await window.DB.mail.get();const d=_mailConfig;
    body.innerHTML='<p class="bk-t">Копия отправляется сервером каждый день, даже когда CRM закрыта. Ручная выгрузка остаётся в разделе «Безопасность».</p>'+
      '<label class="lbl" for="mailEnabled"><input id="mailEnabled" type="checkbox" style="width:44px;height:44px;vertical-align:middle" '+(d.enabled?'checked':'')+'> Отправлять каждый день</label>'+
      '<label class="lbl" for="mailEmail">Получатель</label><input class="inp" id="mailEmail" type="email" autocomplete="email" value="'+esc(d.email)+'"/>'+
      '<label class="lbl" for="mailTime">Время по Москве</label><input class="inp" id="mailTime" type="time" value="'+esc(d.time)+'"/>'+
      '<label class="lbl" for="mailEncrypt"><input id="mailEncrypt" type="checkbox" style="width:44px;height:44px;vertical-align:middle" '+(d.encrypt?'checked':'')+' onchange="mailProtectionChanged()"> Защитить файл паролем</label>'+
      '<label class="lbl" for="mailPassword">Пароль копий</label><input class="inp" id="mailPassword" type="password" autocomplete="new-password" placeholder="'+(d.hasPassword?'Уже задан. Введите новый для смены':'Не меньше 8 символов')+'"/>'+
      '<p class="bk-t">Можно отправлять файл без пароля или включить защиту. При включённой защите сохраните пароль отдельно: в письме его не будет.</p>'+
      (!d.smtpReady?'<p class="bk-err">Отправка писем ещё не подключена. Администратору нужно настроить почтовую службу на сервере.</p>':'')+
      '<div class="bk-row"><button class="btn bg" id="mailSave" onclick="saveMailSettings()">Сохранить</button><button class="btn bgh" id="mailSend" onclick="sendMailBackup()">Отправить сейчас</button></div><div id="mailResult" role="status"></div><div id="mailLast"></div>';
    body.dataset.ready='1';mailProtectionChanged();showMailStatus(d);
  }catch(e){body.textContent='Не удалось загрузить настройки: '+e.message;}finally{_mailLoading=false;}
}
function showMailStatus(d){const el=document.getElementById('mailLast');if(el)el.innerHTML='<p class="bk-t">Последняя отправка: '+(d.lastSent?esc(new Date(d.lastSent).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})):'ещё не было')+'</p>'+(d.lastError?'<p class="bk-err">'+esc(d.lastError)+'</p>':'');}
function mailProtectionChanged(){const enabled=document.getElementById('mailEncrypt').checked,p=document.getElementById('mailPassword');p.disabled=!enabled;p.placeholder=enabled?(_mailConfig&&_mailConfig.hasPassword?'Уже задан. Введите новый для смены':'Не меньше 8 символов'):'Файл будет без пароля';if(!enabled)p.value='';}
async function saveMailSettings(){
  const b=document.getElementById('mailSave'),r=document.getElementById('mailResult');if(b.disabled)return;b.disabled=true;r.textContent='Сохраняю…';
  try{_mailConfig=await window.DB.mail.save({enabled:document.getElementById('mailEnabled').checked,email:document.getElementById('mailEmail').value.trim(),time:document.getElementById('mailTime').value,encrypt:document.getElementById('mailEncrypt').checked,password:document.getElementById('mailPassword').value});document.getElementById('mailPassword').value='';mailProtectionChanged();r.textContent='Настройки сохранены';showMailStatus(_mailConfig);}catch(e){r.textContent=e.message;}finally{b.disabled=false;}
}
async function sendMailBackup(){const b=document.getElementById('mailSend'),r=document.getElementById('mailResult');if(b.disabled)return;b.disabled=true;r.textContent='Готовлю и отправляю копию…';try{_mailConfig=await window.DB.mail.send();r.textContent='Письмо отправлено на сохранённый адрес. Проверьте почту и папку «Спам».';showMailStatus(_mailConfig);}catch(e){r.textContent=e.message;}finally{b.disabled=false;}}
