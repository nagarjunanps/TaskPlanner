#!/bin/sh
set -e

# seed.py is idempotent — every section checks for existing rows before
# inserting, so it's safe to run on every boot. This means a fresh deploy
# (or a restart that lost its disk, e.g. no persistent disk attached) comes
# back up with org/team/staff/shift/cert data instead of an empty DB.
echo "Running seed.py..."
python seed.py

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
