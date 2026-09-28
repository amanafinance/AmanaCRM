# Автотесты Amana CRM

Проверяют CRM в настоящем браузере на копии базы Firebase (эмулятор): деньги, инвесторов,
синхронизацию двух устройств, клиентов, безопасность и все страницы на ПК и телефоне.
Настоящая база при этом не используется.

Запускаются сами в GitHub (вкладка **Actions**) на каждое изменение. Зелёная галочка —
всё в порядке, красный крестик — что-то сломалось, изменение публиковать нельзя.

## Запуск на своём компьютере

Нужны Node.js 22 и Java 21.

```
cd tests
npm ci
npx playwright install chromium
npm test
```

Один набор: запустите эмулятор (`npx firebase emulators:start --only firestore,auth --project amana-crm-16033`)
и в другом окне `node run.mjs money`.

Наборы: `pages`, `money`, `investors`, `sync`, `people`, `security`, `ui`, `devices`, `speed` (папка `suites/`).
