# Hardware h264 encoding using vaapi

This plugin is a work in progress and use features not (yet) available in current version of Peertube.
You can use this fork: https://github.com/TheoLeCalvar/PeerTube


For more information on vaapi and hardware acceleration:

- https://jellyfin.org/docs/general/administration/hardware-acceleration.html#enabling-hardware-acceleration
- https://wiki.archlinux.org/index.php/Hardware_video_acceleration#Comparison_tables


# Building a compatible docker image

Official docker images do not ship with required libraries for hardware transcode.
You can build your own image with this docker compose:

```yaml
FROM node:12-buster-slim

# Allow to pass extra options to the npm run build
# eg: --light --light-fr to not build all client languages
#     (speed up build time if i18n is not required)
ARG NPM_RUN_BUILD_OPTS

# Install dependencies
RUN apt update \
 && apt install -y --no-install-recommends openssl ffmpeg python ca-certificates gnupg gosu build-essential wget apt-transport-https git \
 && echo "deb http://deb.debian.org/debian/ $( awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release ) non-free" | tee /etc/apt/sources.list.d/non-free.list \
 && apt update \
 && apt install -y --no-install-recommends vainfo i965-va-driver-shaders \
 && gosu nobody true \
 && rm /var/lib/apt/lists/* -fR

# Add peertube user
RUN groupadd -r peertube \
    && useradd -r -g peertube -m peertube

# Install PeerTube
COPY --chown=peertube:peertube . /app
WORKDIR /app

USER peertube

RUN yarn install --pure-lockfile \
    && npm run build -- $NPM_RUN_BUILD_OPTS \
    && rm -r ./node_modules ./client/node_modules \
    && yarn install --pure-lockfile --production \
    && yarn cache clean

USER root

RUN mkdir /data /config
RUN chown -R peertube:peertube /data /config

ENV NODE_ENV production
ENV NODE_CONFIG_DIR /config

VOLUME /data
VOLUME /config

COPY ./support/docker/production/entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Expose API and RTMP
EXPOSE 9000 1935

# Run the application
CMD ["npm", "start"]
```

If you are using a recent Intel CPU (generation 8 and newer), replace `i965-va-driver-shaders` by `intel-media-va-driver-non-free`.


# Running the docker image

In order to access the GPU inside docker, the `docker-compose.yml` should be adapted as follow.
Note that you must find the id of the `render` group on your machine.
You can use `grep render /etc/group | cut -d':' -f3`  to find the id.

```yaml
version: "2"

services:

  # You can comment this webserver section if you want to use another webserver/proxy
  webserver:
    image: chocobozzz/peertube-webserver:latest
    # If you don't want to use the official image and build one from sources:
    # build:
    #   context: .
    #   dockerfile: Dockerfile.nginx
    env_file:
      - .env
    ports:
     - "80:80"
     - "443:443"
    volumes:
      - type: bind
        # Switch sources if you downloaded the whole repository
        #source: ../../nginx/peertube
        source: ./docker-volume/nginx/peertube
        target: /etc/nginx/conf.d/peertube.template
      - assets:/var/www/peertube/peertube-latest/client/dist:ro
      - ./docker-volume/data:/var/www/peertube/storage
      - certbot-www:/var/www/certbot
      - ./docker-volume/certbot/conf:/etc/letsencrypt
    depends_on:
      - peertube
    restart: "always"

  # You can comment this certbot section if you want to use another webserver/proxy
  certbot:
    container_name: certbot
    image: certbot/certbot
    volumes:
      - ./docker-volume/certbot/conf:/etc/letsencrypt
      - certbot-www:/var/www/certbot
    restart: unless-stopped
    entrypoint: /bin/sh -c "trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot; sleep 12h & wait $${!}; done;"
    depends_on:
      - webserver

  peertube:
    # If you don't want to use the official image and build one from sources:
    # build:
    #   context: .
    #   dockerfile: ./support/docker/production/Dockerfile.buster
    image: chocobozzz/peertube:production-buster
    # Use a static IP for this container because nginx does not handle proxy host change without reload
    # This container could be restarted on crash or until the postgresql database is ready for connection
    networks:
      default:
        ipv4_address: 172.18.0.42
    env_file:
      - .env

    ports:
     - "1935:1935" # If you don't want to use the live feature, you can comment this line
    #  - "9000:9000" # If you provide your own webserver and reverse-proxy, otherwise not suitable for production
    volumes:
      - assets:/app/client/dist
      - ./docker-volume/data:/data
      - ./docker-volume/config:/config
    group_add:
      - <replace with the id of the render group>
    devices:
      # VAAPI Devices
      - /dev/dri:/dev/dri
    depends_on:
      - postgres
      - redis
      - postfix
    restart: "always"

  postgres:
    image: postgres:13-alpine
    env_file:
      - .env
    volumes:
      - ./docker-volume/db:/var/lib/postgresql/data
    restart: "always"

  redis:
    image: redis:6-alpine
    volumes:
      - ./docker-volume/redis:/data
    restart: "always"

  postfix:
    image: mwader/postfix-relay
    env_file:
      - .env
    volumes:
      - ./docker-volume/opendkim/keys:/etc/opendkim/keys
    restart: "always"

networks:
  default:
    ipam:
      driver: default
      config:
      - subnet: 172.18.0.0/16

volumes:
  assets:
  certbot-www:
```