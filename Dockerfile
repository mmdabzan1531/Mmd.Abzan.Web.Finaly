FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV CHATROOM_DATA_DIR=/data PORT=8000 CHATROOM_ASYNC=gevent
VOLUME /data
EXPOSE 8000
CMD gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker --workers 1 --worker-connections 2000 --timeout 120 --graceful-timeout 30 --keep-alive 5 --bind 0.0.0.0:$PORT app:app
