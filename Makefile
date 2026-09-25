.PHONY: build-local prod-up prod-down prod-pull prod-redeploy logs ps health backup proxy-timeout \
        self-update help

# Голый `make` на сервере печатает справку, а не запускает первую цель.
.DEFAULT_GOAL := help

# Обёртки над командами выката — как в эталоне client-bank-alfa-by. Подробности — docs/DEPLOY.md.
# Прод-цели читают ./.env рядом с docker-compose.prod.yml (DOMAIN, ключи — см. .env.example).

# Ветка или тег репозитория, откуда self-update берёт свежий Makefile.
REF ?= main
COMPOSE = docker compose -f docker-compose.prod.yml

# Прочитать ОДНО значение из ./.env, не исполняя файл (макрос эталона client-bank-alfa-by, #487
# там). Берёт первую строку `КЛЮЧ=значение`, понимает `export`, пробелы вокруг `=`, комментарий в
# конце строки, обрамляющие кавычки; CR из CRLF уходит вместе с хвостовыми пробелами. Файл не
# исполняется, лишнего в окружение не попадает. Поведение закреплено tests/makefileEnv.test.ts.
env-value = $$(sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}$(1)[[:space:]]*=//p" ./.env 2>/dev/null \
	  | head -1 \
	  | sed -e "s/^[[:space:]]*//" -e "s/[[:space:]][[:space:]]*\#.*\$$//" -e "s/[[:space:]]*\$$//" \
	        -e "s/^\"\(.*\)\"\$$/\1/" -e "s/^'\(.*\)'\$$/\1/")

# Сколько общий nginx-proxy ждёт ответа приложения: BitrixGPT с повторами — до 120 с × 3.
PROXY_TIMEOUT ?= 400s

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
#   make proxy-timeout                 # прокси найдётся по образу *nginx-proxy* (не acme/companion)
#   make proxy-timeout PROXY=<имя>     # если прокси не нашёлся или их несколько
#
# nginx-proxy подключает /etc/nginx/vhost.d/<домен>_location в блок location нашего домена, но
# только когда перестраивает конфигурацию. Поэтому после записи пересоздаём СВОЙ контейнер
# (прокси видит событие и перестраивает конфиг) и проверяем, что файл в конфиг попал. Повторный
# запуск безопасен: файл перезапишется тем же, приложение перезапустится.
# Домен — из ./.env или явно `make proxy-timeout DOMAIN=…`. Переменную DOMAIN из окружения оболочки
# НЕ берём: на общем хосте в ней легко оказаться домену соседнего проекта, и таймаут записался бы в
# чужой vhost. Значения идут в оболочку переменными окружения, а не текстом рецепта, и проверяются по
# формату: подставленный текстом домен с `$(…)` выполнился бы на хосте, `'` в таймауте — внутри
# общего контейнера прокси, `../` писал бы мимо vhost.d (находки ревью безопасности).
proxy-timeout: export PT_DOMAIN = $(if $(filter command line,$(origin DOMAIN)),$(DOMAIN))
proxy-timeout: export PT_TIMEOUT = $(PROXY_TIMEOUT)
proxy-timeout: export PT_PROXY = $(PROXY)
proxy-timeout:
	@d="$${PT_DOMAIN:-$(call env-value,DOMAIN)}"; \
	printf '%s' "$$d" | grep -Eqx '[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+' \
	  || { echo "[make] DOMAIN (из ./.env или DOMAIN=…) не похож на домен: '$$d'"; exit 1; }; \
	printf '%s' "$$PT_TIMEOUT" | grep -Eqx '[0-9]{1,4}[smh]?' \
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
	printf '%s' "$$p" | grep -Eqx '[A-Za-z0-9][A-Za-z0-9_.-]*' || { echo "[make] странное имя контейнера: '$$p'"; exit 1; }; \
	f="/etc/nginx/vhost.d/$${d}_location"; want="proxy_read_timeout $$PT_TIMEOUT;"; \
	echo "[make] прокси: $$p, домен: $$d, таймаут: $$PT_TIMEOUT"; \
	if [ "$$(docker exec "$$p" cat "$$f" 2>/dev/null)" = "$$want" ] \
	   && docker exec "$$p" grep -rqs "$$f" /etc/nginx/conf.d/; then \
	  echo "[make] уже настроено: $$f подключён — приложение не трогаю"; exit 0; \
	fi; \
	docker exec "$$p" sh -c "mkdir -p /etc/nginx/vhost.d && echo '$$want' > $$f" \
	  && $(COMPOSE) up -d --force-recreate app \
	  && sleep $${PT_SETTLE:-5} \
	  && if docker exec "$$p" grep -rqs "$$f" /etc/nginx/conf.d/; then \
	       echo "[make] готово: конфиг прокси подключает $$f"; \
	     else \
	       echo "[make] ⚠ файл записан, но прокси ещё не перестроил конфиг — через минуту повторите: make proxy-timeout"; exit 1; \
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
