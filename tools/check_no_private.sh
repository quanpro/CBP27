#!/bin/sh
# Wrapper kept for the name used in specs/17 step 0.
exec node "$(dirname "$0")/check_no_private.mjs" "$@"
