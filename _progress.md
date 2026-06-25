# Прогресс: v2.1.0 — /connect + /reauth

> Портирование двух фич из agent-factory (v4.6 + v4.7) в jarvis-architect.
> Цель: ученики обновляют ботов через `bash update-bot.sh` и получают
> команду `/connect` (VS Code Tunnel) и кнопку «🔑 Переподключить Claude».

Ветка: `feature/connect-and-reauth`
Начало: 2026-06-25
Источник: `~/projects/agent-factory` (templates/bot, templates/vscode-tunnel)

---

## Шаги

- [x] **Шаг 1.** Подготовка ветки + _progress.md
- [ ] **Шаг 2.** Скопировать `templates/vscode-tunnel/` (6 файлов) из agent-factory
- [ ] **Шаг 3.** Скопировать `bot/lib/claude-oauth.js` и `bot/lib/env-write.js`
- [ ] **Шаг 4.** Скопировать `bot/images/` (2 скриншота для onboarding reauth)
- [ ] **Шаг 5.** Портировать `/connect` handler в `bot/index.js` (~250 строк)
- [ ] **Шаг 6.** Портировать `/reauth`: правки в `bot/index.js` + кнопка в `bot/secrets-menu.js`
- [ ] **Шаг 7.** Дописать шаг VS Code Tunnel в `setup-server.sh` (аналог install.sh шага 14.5)
- [ ] **Шаг 8.** Обновить `update-bot.sh` + `VERSION` (2.0.0 → 2.1.0) + `package.json`

---

## Правила работы

- На каждом шаге: план → чек-лист → выполнение → отчёт → самопроверка
- После каждого шага — git commit (формат `[agent] feat/fix/copy: описание`)
- Не пишу файлы целиком — инкрементально
- `node --check bot/index.js` после каждой правки index.js
- Push в origin — ТОЛЬКО после шага 8 с подтверждения клиента

## Важные нюансы

- Пути: в agent-factory `/home/agent/` и `.agent/` — совпадают с jarvis-architect
- Туннель: `agent-{md5(ADMIN_ID).slice(0,8)}` — детерминированно
- Все handlers защищены `isAdmin` (только владелец бота)
- VS Code Tunnel опционален: если шаблона нет — установка не падает
