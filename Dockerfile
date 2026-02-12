FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN addgroup -g 1001 smpp && adduser -u 1001 -G smpp -s /bin/sh -D smpp
USER smpp

EXPOSE 2775 2776 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
