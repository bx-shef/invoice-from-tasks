.PHONY: build-local prod-up prod-down prod-pull prod-redeploy logs ps health backup self-update help

# Голый `make` на сервере печатает справку, а не запускает первую цель.
.DEFAULT_GOAL := help

# Обёртки над командами выката — как в эталоне client-bank-alfa-by. Подробности — docs/DEPLOY.md.
# Прод-цели читают ./.env рядом с docker-compose.prod.yml (DOMAIN, ключи — см. .env.example).

# Ветка или тег репозитория, откуда self-update берёт свежий Makefile.
REF ?= main
COMPOSE = docker compose -f docker-compose.prod.yml

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
