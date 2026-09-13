# crm-db = postgres:16 + pgbackrest. pgBackRest must run beside the data directory and be the
# binary PostgreSQL's archive_command calls, so it lives in the database image rather than a
# sidecar.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest \
 && rm -rf /var/lib/apt/lists/*
