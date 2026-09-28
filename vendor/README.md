# Библиотеки CRM

Копии лежат в репозитории, чтобы CRM загружалась с того же адреса, что и `index.html`,
и не зависела от чужих серверов со скриптами.

- `firebase-11.0.0/` — Firebase JS SDK 11.0.0 (app, firestore, auth), собран из npm-пакета `firebase@11.0.0`
  (esbuild, ESM, minify; `firebase-firestore.js` и `firebase-auth.js` импортируют `./firebase-app.js`). Лицензия Apache-2.0.
- `xlsx-0.18.5/` — SheetJS 0.18.5 (`dist/xlsx.full.min.js` из npm-пакета `xlsx@0.18.5`). Лицензия Apache-2.0.
  Загружается только при нажатии «Excel».

Обновлять версии — только вместе с прогоном автотестов (`tests/`).
