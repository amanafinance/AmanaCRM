// Общие функции для скриптов: подключение к Firestore и расчёт графика платежей
// (та же логика, что getStats/remRows в index.html).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Нет переменной FIREBASE_SERVICE_ACCOUNT (JSON сервисного аккаунта)');
  initializeApp({ credential: cert(JSON.parse(raw)) });
  return getFirestore();
}

export async function readAll(fs, name) {
  const snap = await fs.collection(name).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const R2 = n => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;
export const fmt = n => {
  const v = R2(n), sign = v < 0 ? '-' : '', abs = Math.abs(v);
  const parts = abs.toFixed(Math.abs(abs % 1) < 0.005 ? 0 : 2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + parts.join(',');
};
export const toDate = x => (x ? (x.toDate ? x.toDate() : x instanceof Date ? x : new Date(x)) : null);
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const fmtD = d => ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
export function parseD(s) {
  if (!s) return null;
  s = String(s);
  if (s.includes('-')) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  if (s.includes('.')) { const [d, m, y] = s.split('.').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(s); return isNaN(d) ? null : d;
}

export function getStats(c, payments) {
  const t = today(), mo = parseInt(c.months) || 0, price = parseFloat(c.price) || 0, prepay = parseFloat(c.prepay) || 0;
  const cp = payments.filter(p => p.clientId === c.id);
  const sum = type => cp.filter(p => p.type === type).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const tp = sum('payment'), td = sum('discount');
  const bal = c.returned ? 0 : Math.max(0, price - prepay - tp - td);
  const raw = [];
  for (let m = 0; m < mo; m++) {
    let ds = c['дата' + (m + 1)];
    const sz = parseFloat(c['размер' + (m + 1)]) || 0;
    if (!ds && c.date) { const b = parseD(c.date); if (b) { const a = new Date(b); a.setMonth(a.getMonth() + m + 1); ds = fmtD(a); } }
    raw.push({ month: m + 1, date: ds || '—', origSize: sz });
  }
  let disc = td;
  const eff = raw.map(r => r.origSize);
  for (let i = eff.length - 1; i >= 0 && disc > 0; i--) { const take = Math.min(eff[i], disc); eff[i] -= take; disc -= take; }
  let rem = tp;
  const sch = raw.map((r, i) => {
    const size = eff[i], d = r.date !== '—' ? parseD(r.date) : null;
    if (size === 0) return { month: r.month, date: r.date, size: r.origSize, paid: r.origSize, st: 'paid' };
    let paid, st;
    if (rem >= size) { paid = size; rem -= size; st = 'paid'; }
    else if (rem > 0) { paid = rem; rem = 0; st = d && d < t ? 'partial' : 'partial_future'; }
    else { paid = 0; st = d && d < t ? 'overdue' : 'upcoming'; }
    return { month: r.month, date: r.date, size, paid, st };
  });
  let ov = sch.filter(p => p.st === 'overdue' || p.st === 'partial').reduce((s, p) => s + (p.size - p.paid), 0);
  if (c.returned) ov = 0;
  return { balance: bal, overdue: ov, schedule: sch };
}

// Неоплаченные платежи по графику с учётом отсрочек (как «Контроль платежей»)
export function dueRows(clients, payments) {
  const now = today(), rows = [];
  clients.forEach(c => {
    if (c.archived || c.returned) return;
    const s = getStats(c, payments);
    if ((parseFloat(c.price) || 0) > 0 && s.balance <= 0) return;
    s.schedule.forEach(it => {
      const left = R2(it.size - it.paid);
      if (left <= 0.004 || it.st === 'paid') return;
      const df = (c.defer || {})[it.month];
      const eff = df && df.date ? parseD(df.date) : parseD(it.date);
      const days = eff ? Math.round((now - eff) / 86400000) : 0;
      rows.push({ c, s, month: it.month, left, eff, days, deferred: !!(df && df.date) });
    });
  });
  return rows.sort((a, b) => (a.eff || 0) - (b.eff || 0));
}
