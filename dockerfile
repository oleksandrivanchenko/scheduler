# Dynamic Trigger Scheduler

FROM ubuntu
MAINTAINER Michael Terpak
RUN apt-get update
RUN apt-get install -y apt-utils wget
RUN echo 'deb http://www.rabbitmq.com/debian/ testing main' | tee /etc/apt/sources.list.d/rabbitmq.list
RUN wget -O- https://www.rabbitmq.com/rabbitmq-release-signing-key.asc | apt-key add -
RUN apt-get update
RUN apt-get install -y rabbitmq-server
RUN apt-get install -yf