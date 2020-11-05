FROM node:11.8.0
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN npm install
COPY . /usr/src/app
RUN sed -i 's/<redis_host>/redis-app/g;\
  s/<redis_port>/6379/g;\
  s/<mongo_host>/mongo-app/g;\
  s/<mongo_port>/27017/g;\
  s/<mongo_db>/eventdb/g;\
  s/<mongo_collection>/events/g;\
  s/<mongo_username>/mongoadmin/g;\
  s/<mongo_password>/1234/g' config.json
ADD https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh /
RUN chmod +x /wait-for-it.sh
CMD ["/wait-for-it.sh", "mongo-app:27017", "--", "npm", "start", "--", "-c", "config.json"]
EXPOSE 5665