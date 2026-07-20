# VS Code Tunnel не подключается — диагностика

Тема всплывала дважды (2026-07-15, 2026-07-20), поэтому вынесено сюда. Remote-SSH сейчас основной и рабочий способ подключения (см. `MEMORY.md` → «Инфраструктура»). Эта инструкция — если всё же нужно чинить именно Tunnel.

## Симптом 1: «Не удалось получить удалённую среду» + WebSocket close 1006

Смотреть локальный лог: `%APPDATA%\Code\logs\<последняя папка>\window*\exthost\ms-vscode.remote-server\Remote - Tunnels.log` и `window*\renderer.log`.

**Если в логе есть `error unpacking ... No space left on device`** — диск сервера забит. Проверить:
```
ssh agent-server "df -h /"
ssh agent-server "du -sh /root/.vscode/cli/servers/*"
```
VS Code Tunnel копит на сервере по одной ~570-600 МБ копии серверного компонента на каждую версию клиента (папки `Stable-<hash>`), старые не чистит сам. Решение — удалить всё кроме `lru.json` и перезапустить службу:
```
ssh agent-server "rm -rf /root/.vscode/cli/servers/Stable-<hash1> /root/.vscode/cli/servers/Stable-<hash2> ..."
ssh agent-server "XDG_RUNTIME_DIR=/run/user/0 systemctl --user restart code-tunnel.service"
```
Служба на этом сервере — **`code-tunnel.service` как systemd `--user`-юнит под root** (не под `agent`, и не через шаблоны `templates/vscode-tunnel/*` из этого репозитория — та схема на сервере фактически не установлена, туннель подняли вручную через VNC-консоль при установке). Смотреть статус:
```
ssh agent-server "XDG_RUNTIME_DIR=/run/user/0 systemctl --user status code-tunnel.service"
ssh agent-server "sudo -u root env HOME=/root /usr/local/bin/code --cli-data-dir /root/.vscode/cli tunnel status"
```

**Если в статусе `service_installed:true` и `tunnel:Connected`, но `last_connected_at` — старая дата, а `lsof -p <pid> -a -i` не показывает соединений** — процесс жив, но реальная связь с релеем Microsoft оборвалась и не восстановилась (systemd не замечает, процесс не падает). Лечится тем же `systemctl --user restart code-tunnel.service`.

## Симптом 2: то же WebSocket 1006, но на сервере места достаточно и процесс подключён

Это локальная проблема на ноутбуке Дениса, не серверная. Подтверждено дважды, разными путями:

- **2026-07-15:** решили, что виновата побитая установка VS Code → сделали Remote-SSH как обходной путь (сработало и работает до сих пор)
- **2026-07-20:** переустановка VS Code через winget (`winget uninstall/install Microsoft.VisualStudioCode`) **не помогла** — значит дело не в установке как таковой

**Вероятная причина (не подтверждена окончательно, но косвенных признаков много):** на ноутбуке Дениса постоянно работает **v2RayTun** в режиме TUN (виртуальный адаптер `sing-tun Tunnel`, нужен для доступа к Claude — без него Claude Code не работает, отключать нельзя). VS Code Tunnel всегда открывает локальный WebSocket-мост на случайном порту `127.0.0.1:XXXXX` — похоже, что TUN-адаптер перехватывает и этот трафик тоже, из-за чего соединение рвётся мгновенно (1006 приходит за 10-50 мс, а не через таймаут).

Проверено и исключено:
- Системный HTTP/SOCKS-прокси Windows — выключен (`ProxyEnable: 0` в реестре), не виноват
- `bypassLan: true` уже включён в активном пресете v2RayTun («Россия мимо VPN») — но это правило маршрутизации по доменам/IP для исходящего трафика, к перехвату loopback самим TUN-драйвером отношения не имеет

**Не проверено (риск сломать доступ к Claude, не трогали):** отключение TUN целиком для чистого теста, редактирование конфига v2RayTun/sing-box напрямую. Если Денис захочет продолжить — смотреть в самом приложении v2RayTun настройку вида «bypass localhost/127.0.0.1» или «TUN exceptions», не в файлах конфига.

**Решение по факту (2026-07-20):** не чинить, использовать Remote-SSH — он не заходит через loopback-мост, работает стабильно.

## Накопление старых версий — теперь чистится само

Проблема из Симптома 1 (старые версии `Stable-<hash>` копятся при каждом обновлении VS Code, забивают диск) закрыта автоматически: `/root/scripts/vscode-cleanup.sh` по cron (воскресенье 4:00) держит 2 последние версии в `/root/.vscode/cli/servers/` **и** `/root/.vscode-server/bin/` (Remote-SSH туда же копит дубли), остальное удаляет. Ручная проверка раз в несколько месяцев (старый TODO) больше не нужна — если только cron сам не сломается (`ssh agent-server "crontab -l"` и `cat /var/log/vscode-cleanup.log` — как проверить).
