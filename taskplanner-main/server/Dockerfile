FROM python:3.12-slim

# Timefold's solver runs on the JVM via JPype — needs a real JDK, which pip
# alone can never provide. JDK 17+ is Timefold's documented minimum.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x start.sh

# Render injects $PORT at runtime; 8000 is just the local-docker-run default.
ENV PORT=8000
EXPOSE 8000

CMD ["./start.sh"]
