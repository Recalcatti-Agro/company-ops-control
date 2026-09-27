FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x entrypoint.sh
EXPOSE 8000
# Producción: migra, junta estáticos y arranca gunicorn.
# El docker-compose.yml de desarrollo pisa el command con runserver.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["gunicorn", "server_config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "60"]
