FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app
COPY package.json ./
COPY build ./

RUN npm install ./ playwright@1.50.0

ENTRYPOINT ["node", "index.js", "--log", "--http", "--host=0.0.0.0"]
