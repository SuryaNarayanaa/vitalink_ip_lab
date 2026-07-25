# Isolated load-test dependencies

This Compose project is intentionally separate from `deploy/docker-compose.yml`. It starts a single-node MongoDB replica set (transactions enabled), Redis with persistence, a small synthetic provider stub, and an Nginx test edge that proxies to a host-run API on port 3001. Ports bind to loopback only.

From the repository root:

```text
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml up -d
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml ps
```

Container-network connection values:

```text
LOAD_TEST_MONGO_URI=mongodb://mongo:27017/vitalink_load_test?replicaSet=rs0
REDIS_URL=redis://redis:6379
```

The test edge is available at `http://127.0.0.1:18081`; its `GET /nginx-health` route and proxy behavior let the mandatory whole-system smoke run use one base URL.

The replica set advertises `mongo:27017`. Containerized clients on
`load-test-net` should use that address. Host-run clients should use
`mongodb://127.0.0.1:27018/vitalink_load_test?replicaSet=rs0&directConnection=true`
so topology discovery does not try to resolve the container-only hostname. The
provider stub is opt-in; current production integrations are not all
endpoint-configurable, so its presence does not imply those application paths
are stubbed.

Stop only this project:

```text
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml down
```

Do not add `--volumes` until fixture finalization has reported clean and the test artifacts are no longer needed.
