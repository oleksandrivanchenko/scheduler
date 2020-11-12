# Dynamic Trigger Scheduler

FROM node:11.8.0
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN npm install
COPY . /usr/src/app
ADD https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh /
RUN chmod +x /wait-for-it.sh
CMD ["/wait-for-it.sh", "mongo-app:27017", "--", "npm", "start", "--", "-c", "config.json"]
EXPOSE 5665