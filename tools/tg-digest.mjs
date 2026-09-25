// Утренняя сводка в Telegram: кто платит сегодня, ближайшие платежи, просрочка, вчерашние поступления, остатки касс.
// Переменные: FIREBASE_SERVICE_ACCOUNT, TG_BOT_TOKEN, TG_CHAT_ID (можно несколько через запятую).
// DRY_RUN=1 — только напечатать текст, ничего не отправлять.
import { db, readAll, dueRows, fmt, fmtD, toDate, today, R2 } from './lib.mjs';

const fs = db();
const [clients, payments, wallets] = await Promise.all(['clients', 'payments', 'wallets'].map(n => readAll(fs, n)));

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const phone = c => (c.phones || []).find(Boolean) || '';
const line = r => `• ${esc(r.c.name)} — <b>${fmt(r.left)} ₽</b> (№${esc(r.c.contractId || '—')}${phone(r.c) ? ', ' + esc(phone(r.c)) : ''})`;
const sum = list => R2(list.reduce((s, r) => s + r.left, 0));
function block(title, list, limit, render = line) {
  if (!list.length) return '';
  const more = list.length > limit ? `\n…и ещё ${list.length - limit}` : '';
  return `\n\n${title}\n${list.slice(0, limit).map(render).join('\n')}${more}`;
}

const rows = dueRows(clients, payments);
const todayRows = rows.filter(r => r.days === 0);
const soonRows = rows.filter(r => r.days < 0 && r.days >= -3);
const overRows = rows.filter(r => r.days > 0);

// Просрочка по клиентам: сумма и самый старый платёж
const byClient = new Map();
overRows.forEach(r => {
  const g = byClient.get(r.c.id) || { c: r.c, left: 0, days: 0 };
  g.left += r.left; g.days = Math.max(g.days, r.days); byClient.set(r.c.id, g);
});
const debtors = [...byClient.values()].sort((a, b) => b.left - a.left);

const t = today(), y = new Date(t.getTime() - 86400000);
const yPays = payments.filter(p => (p.type === 'payment' || p.type === 'prepay') && (d => d && d >= y && d < t)(toDate(p.date)));
const cash = wallets.reduce((s, w) => s + (parseFloat(w.balance) || 0), 0);

let msg = `📊 <b>Amana CRM — ${fmtD(t)}</b>`;
msg += `\n\n💰 Сегодня к оплате: <b>${todayRows.length}</b> ${plural(todayRows.length, 'платёж', 'платежа', 'платежей')} на <b>${fmt(sum(todayRows))} ₽</b>`;
msg += block('📅 <b>Платят сегодня:</b>', todayRows, 15);
msg += block(`⏰ <b>Ближайшие 3 дня</b> (${fmt(sum(soonRows))} ₽):`, soonRows, 10, r => line(r) + ` — ${fmtD(r.eff)}`);
msg += `\n\n🔴 Просрочка: <b>${fmt(sum(overRows))} ₽</b> у ${debtors.length} ${plural(debtors.length, 'клиента', 'клиентов', 'клиентов')}`;
msg += block('<b>Крупнейшие должники:</b>', debtors, 10,
  g => `• ${esc(g.c.name)} — <b>${fmt(g.left)} ₽</b>, ${g.days} дн. (№${esc(g.c.contractId || '—')}${phone(g.c) ? ', ' + esc(phone(g.c)) : ''})`);
msg += `\n\n💵 Вчера поступило: <b>${fmt(yPays.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0))} ₽</b> (${yPays.length} ${plural(yPays.length, 'платёж', 'платежа', 'платежей')})`;
msg += `\n🏦 В кассах: <b>${fmt(cash)} ₽</b>` + wallets.map(w => `\n   ${esc(w.name)}: ${fmt(w.balance)} ₽`).join('');
if (msg.length > 4000) msg = msg.slice(0, 3990) + '\n…';

if (process.env.DRY_RUN) { console.log(msg); process.exit(0); }
const token = process.env.TG_BOT_TOKEN, chats = String(process.env.TG_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
if (!token || !chats.length) throw new Error('Нет TG_BOT_TOKEN или TG_CHAT_ID');
for (const chat_id of chats) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram (${chat_id}): ${j.description}`);
  console.log(`Отправлено в ${chat_id}`);
}
