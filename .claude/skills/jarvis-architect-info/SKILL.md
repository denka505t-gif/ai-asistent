---
name: jarvis-architect-info
description: Use when DNA files still contain {{placeholders}} (setup not done yet), or the user asks what this project/template is, how to use it, or wants to reinstall/set up on a new machine or server.
---

# jarvis-architect — справка и установка

Шаблон архитектуры персонального AI-агента. Часть курса «Архитектор нейросотрудников» Дмитрия Ледовских. Репозиторий: github.com/Ntmib/jarvis-architect.

Архитектура = набор markdown-файлов + настроек + бота, которые превращают Claude Code в персонального Агента:
- CLAUDE.md — правила работы
- SOUL.md — личность и стиль
- MEMORY.md — долгосрочная память
- GOALS.md — цели
- memory/ — дневники по дням
- knowledge/ — справочники и инструкции
- .claude/settings.json — настройки разрешений Claude Code (светофор: зелёное/жёлтое/красное)
- .claude/skills/ — специализированные скиллы
- bot/ — Telegram-бот на Grammy + Claude Code CLI (опционально, устанавливается на VPS)
- server/INSTALL-SERVER.md — пошаговая инструкция для установки на VPS

## Если файлы содержат {{плейсхолдеры}}

Установка ещё не пройдена. Спроси пользователя: **куда ставим Агента?**

- **A) На сервер (VPS, работает 24/7)** — прочитай `server/INSTALL-SERVER.md` и выполняй по шагам. Сначала полная установка на сервер (Node.js, Claude Code, VS Code Tunnel, Telegram-бот), потом интервью из 10 вопросов — INSTALL-SERVER.md сам направит тебя к `INSTALL.md` когда придёт время. Понадобятся: IP сервера, пароль root, опционально токен Telegram-бота.
- **B) На этот компьютер** — прочитай `INSTALL.md` и проведи интервью из 10 вопросов.

## Если пользователь спрашивает «что это» / «как пользоваться»

Объясни простым языком: «Это архитектура вашего личного AI-агента. 4 файла описывают кто вы, как я должен общаться, что помнить и к чему стремиться. Плюс настроенные правила безопасности (settings.json), скиллы-специалисты и опционально Telegram-бот. Могу помочь заполнить файлы под вас (10 коротких вопросов) или установить на ваш сервер.»

## Установка на новый сервер / VPS

Используй скилл `server-setup` (`.claude/skills/server-setup/SKILL.md`) — там пошаговая инструкция: подключение по SSH, установка системы, копирование файлов, настройка VS Code Tunnel.
