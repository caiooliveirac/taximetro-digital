FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Chave única da instância — ver src/lib/instance.ts. Vazio = SAMU, então o
# build oficial do GHA continua idêntico ao que sempre foi.
ARG NEXT_PUBLIC_ORG=""
# Override do link do grupo Telegram, para o dia em que o grupo for recriado
# sem precisar de deploy de código. Vazio = o padrão da instância.
ARG NEXT_PUBLIC_TELEGRAM_GROUP_LINK=""
ENV NEXT_PUBLIC_ORG=${NEXT_PUBLIC_ORG} \
    NEXT_PUBLIC_TELEGRAM_GROUP_LINK=${NEXT_PUBLIC_TELEGRAM_GROUP_LINK}
RUN npx drizzle-kit generate
RUN npm run build

FROM base AS runner
WORKDIR /app
RUN apk add --no-cache postgresql-client tzdata
# Chromium headless converte o relatório de presenças em PDF. Opt-in por build
# arg para não inflar a imagem da instância que não usa PDF; sem ele o relatório
# ainda sai, como HTML (ver htmlToPdf em scripts/attendance-report-lib.mjs).
ARG INSTALL_CHROMIUM=""
RUN if [ -n "$INSTALL_CHROMIUM" ]; then apk add --no-cache chromium font-dejavu font-noto-emoji; fi
# A mesma chave do build, agora também em runtime: os scripts .mjs (backup diário
# e /relatorio) rodam fora do bundler e leem NEXT_PUBLIC_ORG de process.env para
# saber como nomear CRU/USA no relatório.
ARG NEXT_PUBLIC_ORG=""
ENV NEXT_PUBLIC_ORG=${NEXT_PUBLIC_ORG}
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV TZ=America/Bahia

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts

# drizzle-orm + postgres driver for runtime migrations
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres
# nodemailer for password reset emails
COPY --from=deps /app/node_modules/nodemailer ./node_modules/nodemailer

RUN chmod +x /app/scripts/container-entrypoint.sh /app/scripts/restore-db-backup.sh

EXPOSE 3000
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
