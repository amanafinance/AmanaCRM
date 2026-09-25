// Полная выгрузка всех коллекций Firestore в один JSON-файл.
// Запуск: FIREBASE_SERVICE_ACCOUNT='{...}' node tools/backup.mjs [папка]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db } from './lib.mjs';

const out = process.argv[2] || 'backup';
const firestore = db();
const cols = await firestore.listCollections();
const data = {};
let total = 0;
for (const col of cols) {
  const snap = await col.get();
  // Подколлекций в CRM нет, поэтому хватает верхнего уровня
  data[col.id] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
  total += snap.size;
  console.log(`${col.id}: ${snap.size}`);
}
// Timestamp → ISO-строка, чтобы файл читался без Firebase
const json = JSON.stringify({ exportedAt: new Date().toISOString(), collections: data },
  (k, v) => (v && typeof v === 'object' && typeof v.toDate === 'function' ? { __ts: v.toDate().toISOString() } : v));
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `amana-crm-${new Date().toISOString().slice(0, 10)}.json.gz`);
fs.writeFileSync(file, zlib.gzipSync(json));
console.log(`Готово: ${total} документов → ${file}`);
