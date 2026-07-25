#!/usr/bin/env bash
set -euo pipefail

for attempt in $(seq 1 30); do
  if mongosh --host mongo:27017 --quiet --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "MongoDB did not become reachable" >&2
    exit 1
  fi
  sleep 2
done

mongosh --host mongo:27017 --quiet --eval '
try {
  const status = rs.status();
  if (status.ok === 1) quit(0);
} catch (error) {
  if (error.codeName !== "NotYetInitialized" && error.code !== 94) throw error;
}
const result = rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
if (result.ok !== 1) throw new Error(`Replica-set initialization failed: ${JSON.stringify(result)}`);
'

for attempt in $(seq 1 30); do
  if mongosh --host mongo:27017 --quiet --eval 'try { rs.status().myState === 1 ? quit(0) : quit(1) } catch (e) { quit(1) }'; then
    echo "MongoDB replica set rs0 is primary"
    exit 0
  fi
  sleep 2
done

echo "MongoDB replica set did not elect a primary" >&2
exit 1

