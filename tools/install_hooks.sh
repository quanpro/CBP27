#!/bin/sh
# Run once after cloning: makes git use .githooks/ (privacy pre-commit check).
git config core.hooksPath .githooks && echo "Hooks installed: .githooks/pre-commit runs tools/check_no_private.mjs"
