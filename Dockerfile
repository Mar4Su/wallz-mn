FROM node:24-slim

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci

COPY server ./server
COPY shared ./shared

WORKDIR /app/server
RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "start"]
