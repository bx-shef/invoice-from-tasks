.PHONY: build-local prod-up prod-down prod-pull prod-redeploy logs ps health backup proxy-timeout \
        self-update help

# Голый `make` на сервере печатает справку, а не запускает первую цель.
.DEFAULT_GOAL := help

# Обёртки над командами выката — как в эталоне client-bank-alfa-by. Подробности — docs/DEPLOY.md.
# Прод-цели читают ./.env рядом с docker-compose.prod.yml (DOMAIN, ключи — см. .env.example).

# Ветка или тег репозитория, откуда self-update берёт свежий Makefile.
REF ?= main
# compose подставляет ${DOMAIN}, ${LETSENCRYPT_EMAIL} и ${B24_TOKEN_ENC_KEY} из окружения оболочки
# РАНЬШЕ, чем из ./.env: экспортированный на общем хосте DOMAIN соседнего проекта увёл бы наш
# VIRTUAL_HOST (и сертификат) на чужой домен. Поэтому compose запускается без них — источник один, ./.env.
COMPOSE = env -u DOMAIN -u LETSENCRYPT_EMAIL -u B24_TOKEN_ENC_KEY docker compose -f docker-compose.prod.yml
# Имя контейнера приложения — container_name в docker-compose.prod.yml (сверяет tests/makefileProd.test.ts).
APP_CONTAINER = invoice-from-tasks

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
#   проверяет, что файл подключён. Уже настроено — ничего не делает.
# Значения передаются аргументами, а не текстом команд, и проверяются по формату (ревью безопасности
# на #16). PROXY и PROXY_TIMEOUT — только из командной строки: в окружении общего хоста там может
# оказаться чужое.
proxy-timeout: export PT_TIMEOUT = $(if $(filter command line,$(origin PROXY_TIMEOUT)),$(PROXY_TIMEOUT),400s)
proxy-timeout: export PT_PROXY = $(if $(filter command line,$(origin PROXY)),$(PROXY))
proxy-timeout:
	@one_line() { [ "$$(printf '%s' "$$1" | wc -l)" -eq 0 ]; }; \
	d=$$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $(APP_CONTAINER) 2>/dev/null | sed -n 's/^VIRTUAL_HOST=//p'); \
	[ -n "$$d" ] || { echo "[make] контейнер $(APP_CONTAINER) не запущен или без VIRTUAL_HOST — сначала make prod-up"; exit 1; }; \
	{ one_line "$$d" && printf '%s' "$$d" | grep -Eqx '[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+'; } \
	  || { echo "[make] VIRTUAL_HOST контейнера не похож на один домен: '$$d'"; exit 1; }; \
	{ one_line "$$PT_TIMEOUT" && printf '%s' "$$PT_TIMEOUT" | grep -Eqx '[0-9]{1,4}[smh]?'; } \
	  || { echo "[make] PROXY_TIMEOUT — число с s/m/h, например 400s: '$$PT_TIMEOUT'"; exit 1; }; \
	p="$$PT_PROXY"; \
	if [ -z "$$p" ]; then \
	  p=$$(docker ps --format '{{.Names}} {{.Image}}' | awk '$$2 ~ /nginx-proxy/ && $$2 !~ /acme|letsencrypt|companion|docker-gen/ {print $$1}'); \
	fi; \
	n=$$(printf '%s\n' "$$p" | grep -c . || true); \
	if [ "$$n" != 1 ]; then \
	  echo "[make] контейнеров nginx-proxy найдено: $$n. Укажите нужный: make proxy-timeout PROXY=<имя>"; \
	  docker ps --format '  {{.Names}}\t{{.Image}}'; exit 1; \
	fi; \
	{ one_line "$$p" && printf '%s' "$$p" | grep -Eqx '[A-Za-z0-9][A-Za-z0-9_.-]*'; } || { echo "[make] странное имя контейнера: '$$p'"; exit 1; }; \
	f="/etc/nginx/vhost.d/$${d}_location"; want="proxy_read_timeout $$PT_TIMEOUT;"; \
	echo "[make] прокси: $$p, домен: $$d, таймаут: $$PT_TIMEOUT"; \
	docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$$p" | grep -qx /etc/nginx/vhost.d \
	  || echo "[make] ⚠ /etc/nginx/vhost.d у прокси — не отдельный том: настройка пропадёт, когда прокси пересоздадут"; \
	if docker exec "$$p" grep -qsxF "$$want" "$$f" && docker exec "$$p" grep -rqsF "include $$f;" /etc/nginx/conf.d/; then \
	  echo "[make] уже настроено: $$f подключён"; exit 0; \
	fi; \
	docker exec "$$p" sh -c 'f=$$1; w=$$2; d=$${f%/*}; mkdir -p "$$d" || exit 1; \
	  if [ ! -f "$$f" ] && [ -f "$$d/default_location" ]; then cp "$$d/default_location" "$$f" || exit 1; fi; \
	  { if [ -f "$$f" ]; then grep -v "^[[:space:]]*proxy_read_timeout[[:space:]]" "$$f"; fi; printf "%s\n" "$$w"; } > "$$f.new" \
	  && mv "$$f.new" "$$f"' _ "$$f" "$$want" \
	  && docker exec "$$p" docker-gen /app/nginx.tmpl /etc/nginx/conf.d/default.conf \
	  && docker exec "$$p" nginx -t \
	  && docker exec "$$p" nginx -s reload \
	  || { echo "[make] ⚠ конфиг прокси не перестроен (ошибка выше); если docker-gen не найден — прокси из отдельных контейнеров, перезапустите его docker-gen"; exit 1; }; \
	if docker exec "$$p" grep -rqsF "include $$f;" /etc/nginx/conf.d/; then \
	  echo "[make] готово: конфиг прокси подключает $$f"; \
	else \
	  echo "[make] ⚠ конфиг перестроен, но $$f не подключён — проверьте, нет ли для домена своего _location_override"; exit 1; \
	fi

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
	      /^[A-Za-z0-9_][A-Za-z0-9_.-]*:/{if(d!=""){printf "  %-14s %s\n", substr($$1,1,length($$1)-1), d; d=""}}' \
	      $(MAKEFILE_LIST)
