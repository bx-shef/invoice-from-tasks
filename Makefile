.PHONY: build-local prod-up prod-down prod-pull prod-redeploy logs ps health doctor backup proxy-timeout \
        compose-update self-update help

# Голый `make` на сервере печатает справку, а не запускает первую цель.
.DEFAULT_GOAL := help

# Обёртки над командами выката — как в эталоне client-bank-alfa-by. Подробности — docs/DEPLOY.md.
# Прод-цели читают ./.env рядом с docker-compose.prod.yml (DOMAIN, ключи — см. .env.example).

# Ветка или тег репозитория, откуда self-update берёт свежий Makefile.
REF ?= main
# compose подставляет ${DOMAIN}, ${LETSENCRYPT_EMAIL} и ${B24_TOKEN_ENC_KEY} из окружения оболочки
# РАНЬШЕ, чем из ./.env: экспортированный на общем хосте DOMAIN соседнего проекта увёл бы наш
# VIRTUAL_HOST (и сертификат) на чужой домен. Поэтому compose запускается без них — источник один, ./.env.
COMPOSE_ENV = env -u DOMAIN -u LETSENCRYPT_EMAIL -u B24_TOKEN_ENC_KEY docker compose
COMPOSE = $(COMPOSE_ENV) -f docker-compose.prod.yml
# Имя контейнера приложения — container_name в docker-compose.prod.yml (сверяет tests/makefileProd.test.ts).
# override: ни `make … APP_CONTAINER=…`, ни MAKEFLAGS не подменят, чей VIRTUAL_HOST берёт proxy-timeout.
override APP_CONTAINER := invoice-from-tasks

# Общие shell-функции proxy-timeout и doctor. make склеивает `\`-переносы присваивания в одну
# строку, поэтому команды разделены `;`. Ошибку функции кладут в $$err и возвращают 1.
#   app_domain — d: VIRTUAL_HOST работающего контейнера приложения (одна строка, формат домена);
#   find_proxy — p: контейнер nginx-proxy — PROXY из командной строки или единственный по образу
#                (acme, companion и docker-gen не считаются).
SH_LIB = one_line() { [ "$$(printf '%s' "$$1" | wc -l)" -eq 0 ]; }; \
	app_domain() { \
	  d=$$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $(APP_CONTAINER) 2>/dev/null | sed -n 's/^VIRTUAL_HOST=//p'); \
	  [ -n "$$d" ] || { err="контейнер $(APP_CONTAINER) не запущен или без VIRTUAL_HOST — сначала make prod-up"; return 1; }; \
	  { one_line "$$d" && printf '%s' "$$d" | grep -Eqx '[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+'; } \
	    || { err="VIRTUAL_HOST контейнера не похож на один домен: '$$d'"; return 1; }; \
	}; \
	find_proxy() { \
	  p="$$PT_PROXY"; \
	  [ -n "$$p" ] || p=$$(docker ps --format '{{.Names}} {{.Image}}' | awk '$$2 ~ /nginx-proxy/ && $$2 !~ /acme|letsencrypt|companion|docker-gen/ {print $$1}'); \
	  n=$$(printf '%s\n' "$$p" | grep -c . || true); \
	  [ "$$n" = 1 ] || { err="контейнеров nginx-proxy найдено: $$n. Укажите нужный: make $@ PROXY=<имя>"; return 1; }; \
	  { one_line "$$p" && printf '%s' "$$p" | grep -Eqx '[A-Za-z0-9][A-Za-z0-9_.-]*'; } || { err="странное имя контейнера: '$$p'"; return 1; }; \
	};

# ─── Локально ────────────────────────────────────────────────────────

## Собрать образ из исходников и запустить на 127.0.0.1:3000 на переднем плане (docker-compose.yml)
build-local:
	docker compose up --build

# ─── Прод (на сервере, /home/bitrix/invoice-from-tasks) ──────────────
# Нужны общий nginx-proxy + acme-companion, Watchtower и docker-сеть proxy-net на хосте.
# Свой Watchtower НЕ поднимаем — хостовый подхватывает контейнер по метке.

## Запустить / обновить контейнер приложения
prod-up:
	$(COMPOSE) up -d

## Остановить приложение (том с токенами установки остаётся)
prod-down:
	$(COMPOSE) down

## Скачать свежий образ, не перезапуская контейнер
prod-pull:
	$(COMPOSE) pull

## Обновить прямо сейчас, не дожидаясь Watchtower
#
# Чистим только свои висящие образы (метка source ставится при сборке в CI): хост общий, и чужие
# проекты свои образы убирают сами.
prod-redeploy:
	$(COMPOSE) pull && \
	$(COMPOSE) up -d && \
	docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/bx-shef/invoice-from-tasks"

## Живой лог приложения (Ctrl+C — выйти)
logs:
	$(COMPOSE) logs -f app

## Состояние контейнера и его healthcheck
ps:
	$(COMPOSE) ps

## Что не настроено на сервере: GET /api/health изнутри контейнера (флаги «задано / нет», без секретов)
#
# Проверку через прокси (request.forwardedFor = used) делайте снаружи:
#   curl -s https://<DOMAIN>/api/health
health:
	$(COMPOSE) exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(t => console.log(t))"

## Проверить выкат одной командой: контейнер, настройки, прокси, https, сертификат, Watchtower, диск
#
#   make doctor               # только читает, ничего не меняет
#   make doctor PROXY=<имя>   # если прокси не нашёлся или их несколько
#
# Каждая строка — ✓ или ✗ и после «→» что делать; есть ✗ — make завершится с ошибкой. Как в эталоне client-bank
# (make doctor): одна команда вместо ручного обхода. Что проверяет, кроме контейнера и /api/health:
# - прокси ходит в приложение без keepalive — иначе 502 на POST из портала (метка в compose);
# - таймаут прокси для домена подключён (make proxy-timeout);
# - https снаружи отвечает и видит адрес клиента; сертификат не истекает в ближайшие 14 дней;
# - Watchtower запущен, диск docker занят меньше чем на 90 %.
# https проверяется с самого сервера: если он не видит себя по внешнему адресу, проверьте с другого
# компьютера — curl -s https://<домен>/api/health.
doctor: export PT_PROXY = $(if $(filter command line,$(origin PROXY)),$(PROXY))
doctor:
	@$(SH_LIB) \
	bad=0; ok() { echo "  ✓ $$*"; }; fail() { echo "  ✗ $$*"; bad=$$((bad + 1)); }; \
	s=$$(docker inspect -f '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' $(APP_CONTAINER) 2>/dev/null); \
	case "$$s" in \
	  "running healthy") ok "контейнер $(APP_CONTAINER) работает, healthcheck зелёный";; \
	  "") fail "контейнера $(APP_CONTAINER) нет → make prod-up"; echo "[make] проблем: 1"; exit 1;; \
	  *) fail "контейнер $(APP_CONTAINER): $$s → make logs";; \
	esac; \
	h=$$(docker exec $(APP_CONTAINER) node -e "const n = { siteUrl: 'DOMAIN', oauth: 'B24_CLIENT_ID/B24_CLIENT_SECRET', tokenKey: 'B24_TOKEN_ENC_KEY', appCode: 'B24_APP_CODE', trustProxy: 'TRUST_PROXY', bitrixGpt: 'VIBE_API_KEY' }; fetch('http://127.0.0.1:3000/api/health').then(r => r.json()).then(j => { const c = j.config || {}; console.log((j.commit || '-') + ' ' + (Object.keys(c).filter(k => c[k] !== true).map(k => n[k] || k).join(',') || '-')) }).catch(() => process.exit(1))" 2>/dev/null); \
	if [ -z "$$h" ]; then fail "GET /api/health изнутри контейнера не ответил → make logs"; \
	elif [ "$${h#* }" = - ]; then ok "настройки сервера заданы, сборка $$(printf '%.7s' "$${h%% *}")"; \
	else fail "не задано в .env: $${h#* } → вписать и make prod-up (таблица переменных — docs/DEPLOY.md)"; fi; \
	[ "$$(docker inspect -f '{{index .Config.Labels "com.github.nginx-proxy.nginx-proxy.keepalive"}}' $(APP_CONTAINER) 2>/dev/null)" = disabled ] \
	  && ok "у контейнера метка keepalive=disabled" \
	  || fail "нет метки keepalive=disabled — жди 502 из портала → make compose-update CONFIRM=1 и make prod-up"; \
	if ! app_domain; then fail "$$err"; else \
	  if ! find_proxy; then fail "$$err"; else \
	    conf=$$(docker exec "$$p" cat /etc/nginx/conf.d/default.conf 2>/dev/null); \
	    up=$$(printf '%s\n' "$$conf" | awk -v h="upstream $$d {" '$$0 == h {f = 1} f {print} f && /^}/ {exit}'); \
	    if [ -z "$$up" ]; then fail "в конфиге прокси $$p нет upstream $$d → make prod-up и снова make doctor"; \
	    elif printf '%s\n' "$$up" | grep -Eq '^[[:space:]]*keepalive[[:space:]]'; then fail "прокси $$p держит соединения с приложением (keepalive) — жди 502 → метка выше, затем make prod-up"; \
	    else ok "прокси $$p ходит в приложение без keepalive"; fi; \
	    f="/etc/nginx/vhost.d/$${d}_location"; \
	    t=$$(docker exec "$$p" cat "$$f" 2>/dev/null | sed -n 's/^[[:space:]]*proxy_read_timeout[[:space:]]*\([^;]*\);.*/\1/p' | tail -n 1); \
	    if [ -n "$$t" ] && printf '%s\n' "$$conf" | grep -qF "include $$f;"; then ok "таймаут прокси для $$d: $$t"; \
	    else fail "таймаут прокси для $$d не подключён — 60 с мало для BitrixGPT → make proxy-timeout"; fi; \
	  fi; \
	  if command -v curl >/dev/null 2>&1; then \
	    r=$$(curl -fsS --max-time 10 "https://$$d/api/health" 2>&1); \
	    if [ $$? -ne 0 ]; then fail "https://$$d/api/health не ответил: $$r"; \
	    else case "$$r" in \
	      *'"forwardedFor":"used"'*) ok "https://$$d отвечает, адрес клиента виден через прокси";; \
	      *) fail "https://$$d отвечает, но адрес клиента не виден (forwardedFor не used) — лимиты по IP общие на всех → TRUST_PROXY";; \
	    esac; fi; \
	  fi; \
	  if command -v openssl >/dev/null 2>&1; then \
	    cert=$$(echo | timeout 10 openssl s_client -servername "$$d" -connect "$$d:443" 2>/dev/null); \
	    e=$$(printf '%s\n' "$$cert" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2); \
	    if [ -z "$$e" ]; then fail "сертификат $$d не прочитан → DNS и docker logs контейнера acme-companion"; \
	    elif printf '%s\n' "$$cert" | openssl x509 -noout -checkend 1209600 >/dev/null 2>&1; then ok "сертификат действует до $$e"; \
	    else fail "сертификат истекает меньше чем через 14 дней ($$e) → docker logs контейнера acme-companion"; fi; \
	  fi; \
	fi; \
	docker ps --format '{{.Image}}' | grep -q watchtower \
	  && ok "Watchtower запущен: новые образы из main приедут сами" \
	  || fail "Watchtower не запущен: обновления сами не приедут (он общий на хост — docs/DEPLOY.md §1)"; \
	u=$$(df -P /var/lib/docker 2>/dev/null | awk 'NR == 2 {sub(/%/, "", $$5); print $$5}'); \
	if [ -n "$$u" ]; then \
	  if [ "$$u" -lt 90 ]; then ok "диск docker занят на $$u%"; \
	  else fail "диск docker занят на $$u% → docker system df; make prod-redeploy убирает старые образы приложения"; fi; \
	fi; \
	if [ "$$bad" -eq 0 ]; then echo "[make] всё в порядке"; \
	else echo "[make] проблем: $$bad — что делать, написано после «→»; частые сбои — docs/DEPLOY.md"; exit 1; fi

## Копия тома с токенами установки в ./backups (токены в нём зашифрованы B24_TOKEN_ENC_KEY)
#
# Без ключа копия бесполезна, ключ — отдельно и вне сервера. Восстановление — docs/DEPLOY.md.
backup:
	@mkdir -p backups && f="backups/portals-$$(date +%Y%m%d-%H%M%S).tgz" \
	  && { $(COMPOSE) exec -T app tar czf - -C /app/.data . > "$$f" || { rm -f "$$f"; exit 1; }; } \
	  && echo "[make] копия: $$f ($$(du -h "$$f" | cut -f1))"

## Поднять таймаут общего nginx-proxy для нашего домена (по умолчанию он ждёт 60 с — мало для BitrixGPT)
#
#   make proxy-timeout                      # прокси найдётся по образу *nginx-proxy* (не acme/companion)
#   make proxy-timeout PROXY=<имя>          # если прокси не нашёлся или их несколько
#   make proxy-timeout PROXY_TIMEOUT=600s   # другой таймаут (по умолчанию 400s: BitrixGPT — до 120 с × 3)
#
# nginx-proxy подключает /etc/nginx/vhost.d/<домен>_location в блок location нашего домена, когда
# перестраивает конфиг. Цель:
# - берёт домен из VIRTUAL_HOST работающего контейнера приложения — того, что прокси реально
#   обслуживает, а не из разбора .env;
# - дописывает в файл строку таймаута, сохраняя другие директивы; новый файл начинает с содержимого
#   default_location, иначе общие настройки прокси перестали бы действовать на наш домен;
# - перестраивает конфиг прямо в прокси (docker-gen → nginx -t → reload), не трогая приложение, и
#   проверяет, что файл подключён. Уже настроено — ничего не пишет, только nginx -t и мягкий reload:
#   так повторный запуск чинит случай, когда в прошлый раз упал reload (ревью на #16).
# Значения передаются аргументами, а не текстом команд, и проверяются по формату (ревью безопасности
# на #16). PROXY и PROXY_TIMEOUT — только из командной строки make (или MAKEFLAGS — для make это то же
# самое), не из окружения: в окружении общего хоста там может оказаться чужое. Формат проверяется всегда.
proxy-timeout: export PT_TIMEOUT = $(if $(filter command line,$(origin PROXY_TIMEOUT)),$(PROXY_TIMEOUT),400s)
proxy-timeout: export PT_PROXY = $(if $(filter command line,$(origin PROXY)),$(PROXY))
proxy-timeout:
	@$(SH_LIB) \
	app_domain || { echo "[make] $$err"; exit 1; }; \
	{ one_line "$$PT_TIMEOUT" && printf '%s' "$$PT_TIMEOUT" | grep -Eqx '[0-9]{1,4}[smh]?'; } \
	  || { echo "[make] PROXY_TIMEOUT — число с s/m/h, например 400s: '$$PT_TIMEOUT'"; exit 1; }; \
	find_proxy || { echo "[make] $$err"; docker ps --format '  {{.Names}}\t{{.Image}}'; exit 1; }; \
	f="/etc/nginx/vhost.d/$${d}_location"; want="proxy_read_timeout $$PT_TIMEOUT;"; \
	echo "[make] прокси: $$p, домен: $$d, таймаут: $$PT_TIMEOUT"; \
	docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$$p" | grep -qx /etc/nginx/vhost.d \
	  || echo "[make] ⚠ /etc/nginx/vhost.d у прокси — не отдельный том: настройка пропадёт, когда прокси пересоздадут"; \
	if docker exec "$$p" grep -qsxF "$$want" "$$f" && docker exec "$$p" grep -rqsF "include $$f;" /etc/nginx/conf.d/; then \
	  docker exec "$$p" nginx -t && docker exec "$$p" nginx -s reload \
	    || { echo "[make] ⚠ файл подключён, но прокси не перечитал конфиг (ошибка выше)"; exit 1; }; \
	  echo "[make] уже настроено: $$f подключён, прокси перечитал конфиг"; exit 0; \
	fi; \
	docker exec "$$p" sh -c 'f=$$1; w=$$2; d=$${f%/*}; mkdir -p "$$d" || exit 1; \
	  if [ ! -f "$$f" ] && [ -f "$$d/default_location" ]; then cp "$$d/default_location" "$$f" || exit 1; fi; \
	  { if [ -f "$$f" ]; then grep -v "^[[:space:]]*proxy_read_timeout[[:space:]]" "$$f"; fi; printf "%s\n" "$$w"; } > "$$f.new" \
	  && mv "$$f.new" "$$f"' _ "$$f" "$$want" \
	  && docker exec "$$p" docker-gen /app/nginx.tmpl /etc/nginx/conf.d/default.conf \
	  && docker exec "$$p" nginx -t \
	  && docker exec "$$p" nginx -s reload \
	  || { echo "[make] ⚠ конфиг прокси не перестроен или не перечитан (ошибка выше). docker-gen не найден — прокси из отдельных контейнеров, перезапустите его docker-gen; упал reload — повторите make proxy-timeout"; exit 1; }; \
	if docker exec "$$p" grep -rqsF "include $$f;" /etc/nginx/conf.d/; then \
	  echo "[make] готово: конфиг прокси подключает $$f"; \
	else \
	  echo "[make] ⚠ конфиг перестроен, но $$f не подключён — проверьте, нет ли для домена своего _location_override"; exit 1; \
	fi

## Обновить docker-compose.prod.yml из репозитория: показать разницу, заменить — только с CONFIRM=1
#
#   make compose-update             # скачать и показать, что изменится; файл не трогается
#   make compose-update CONFIRM=1   # заменить (копия прежнего — рядом), затем make prod-up
#
# Как в эталоне client-bank (compose-update): репозитория на сервере нет, и новые настройки
# контейнера (метки, переменные) приезжают только так — Watchtower обновляет образ, а не этот файл.
# Скачанное проверяет сам compose (`config`) с нашим .env: битый файл не заменит рабочий. Пин
# `:sha-…` (откат, пауза автообновлений) замена вернёт на `:latest` — это видно в разнице.
# CONFIRM — только из командной строки make, не из окружения: как PROXY.
compose-update: export CU_CONFIRM = $(if $(filter command line,$(origin CONFIRM)),$(CONFIRM))
compose-update:
	@t=$$(mktemp ./.docker-compose.prod.yml.XXXXXX) && trap 'rm -f "$$t"' EXIT \
	  && curl -fsSL -o "$$t" "https://raw.githubusercontent.com/bx-shef/invoice-from-tasks/$(REF)/docker-compose.prod.yml" \
	  && grep -q '^services:' "$$t" \
	  && $(COMPOSE_ENV) -f "$$t" config -q \
	  || { echo "[make] новый docker-compose.prod.yml не скачался или не прошёл проверку compose — рабочий не тронут"; exit 1; }; \
	if cmp -s "$$t" docker-compose.prod.yml; then echo "[make] docker-compose.prod.yml уже как в $(REF)"; exit 0; fi; \
	diff -u docker-compose.prod.yml "$$t"; \
	if [ "$$CU_CONFIRM" != 1 ]; then echo "[make] выше — что изменится. Заменить: make compose-update CONFIRM=1"; exit 0; fi; \
	b="./docker-compose.prod.yml.bak-$$(date +%Y%m%d-%H%M%S)"; \
	cp docker-compose.prod.yml "$$b" && cp "$$t" docker-compose.prod.yml \
	  && echo "[make] docker-compose.prod.yml обновлён из $(REF), копия прежнего: $$b. Теперь make prod-up"

## Обновить САМ этот Makefile из репозитория (новые цели появляются на сервере только так)
#
# Репозитория на сервере нет: Makefile кладётся туда один раз и сам не обновляется. Скачанное
# проверяется по признаку, который есть в любой версии файла (.PHONY и цель prod-redeploy), —
# иначе проверка не пропустила бы как раз то обновление, ради которого написана (грабли эталона).
self-update:
	@t=$$(mktemp /tmp/Makefile.XXXXXX) && trap 'rm -f "$$t"' EXIT \
	  && curl -fsSL -o "$$t" "https://raw.githubusercontent.com/bx-shef/invoice-from-tasks/$(REF)/Makefile" \
	  && grep -q '^\.PHONY:' "$$t" \
	  && $(MAKE) -n -f "$$t" prod-redeploy >/dev/null 2>&1 \
	  && { b="./Makefile.bak-$$(date +%Y%m%d-%H%M%S)"; \
	       cp ./Makefile "$$b" && cp "$$t" ./Makefile \
	       && echo "[make] Makefile обновлён из $(REF), копия прежнего: $$b"; \
	       $(MAKE) --no-print-directory help; }

## Список целей с описаниями
#
# Запоминает последнюю строку `##` и печатает её у ближайшей следующей цели: между описанием и
# целью бывают строки комментария, и наивный `grep -B1` их терял.
help:
	@awk '/^## /{d=substr($$0,4)} \
	      /^[A-Za-z0-9_][A-Za-z0-9_.-]*:/{if(d!=""){printf "  %-15s %s\n", substr($$1,1,length($$1)-1), d; d=""}}' \
	      $(MAKEFILE_LIST)
