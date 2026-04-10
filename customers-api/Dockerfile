FROM node:22-alpine

WORKDIR /app

# Instalar curl para el healthcheck
RUN apk add --no-cache curl

# Copiar dependencias primero para aprovechar cache de Docker
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/app.js"]
