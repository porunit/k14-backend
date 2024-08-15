FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npm run rebuild
COPY . .
ENV PORT=3000
EXPOSE $PORT
#CMD ["npm", "start"]
CMD ["pm2", "start", "dist/main.js"]