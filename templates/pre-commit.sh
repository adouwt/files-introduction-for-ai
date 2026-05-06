#!/bin/sh

echo "[ai-index] running incremental index..."
ai-file-indexer index --incremental --stage-output || true

exit 0
