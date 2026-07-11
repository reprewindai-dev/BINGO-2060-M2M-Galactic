FROM node:18-slim
WORKDIR /app
ENV NODE_ENV=production
ENV BINGO_LEDGER_DIR=/data/bingo
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
VOLUME ["/data/bingo"]
EXPOSE 3000
CMD ["npm", "start"]
