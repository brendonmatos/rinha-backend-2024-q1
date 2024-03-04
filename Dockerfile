FROM oven/bun:alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN bun i

COPY . .

CMD [ "bun", "run", "dev" ]