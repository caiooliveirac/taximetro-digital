FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Branding por instância (vazio = SAMU Salvador, ver src/lib/branding.ts e docs/vitalmed.md)
ARG NEXT_PUBLIC_ORG_NAME=""
ARG NEXT_PUBLIC_ORG_NAME_SHORT=""
ARG NEXT_PUBLIC_TELEGRAM_GROUP_LINK=""
ENV NEXT_PUBLIC_ORG_NAME=${NEXT_PUBLIC_ORG_NAME} NEXT_PUBLIC_ORG_NAME_SHORT=${NEXT_PUBLIC_ORG_NAME_SHORT} NEXT_PUBLIC_TELEGRAM_GROUP_LINK=${NEXT_PUBLIC_TELEGRAM_GROUP_LINK}
RUN npx drizzle-kit generate
RUN npm run build

FROM base AS runner
WORKDIR /app
RUN apk add --no-cache postgresql-client tzdata
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
