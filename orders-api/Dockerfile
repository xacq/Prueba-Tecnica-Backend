FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3002

CMD ["node", "src/app.js"]
