#!/bin/sh
# Downloads the H5P core + editor CLIENT files, which @lumieducation/h5p-server
# does NOT bundle. Refs are pinned to exactly what upstream's v10.0.5 tag uses
# (scripts/install.sh -> packages/h5p-examples/download-core.sh), so the spike
# runs the same client code the library was released against.
set -e

CORE_REF="${H5P_CORE_REF:-829524eaf81fe3f3a295d0e843812be4735f51fc}"
EDITOR_REF="${H5P_EDITOR_REF:-80b3b281ee9d064b563f242e8ee7a0026b5bf205}"

base="$(cd "$(dirname "$0")/.." && pwd)/h5p"
mkdir -p "$base/tmp/core" "$base/tmp/editor" "$base/core" "$base/editor" "$base/libraries" "$base/content" "$base/temp"

if [ -f "$base/core/js/h5p.js" ] && [ -f "$base/editor/scripts/h5peditor.js" ] && [ "$1" != "--force" ]; then
  echo "H5P core + editor already present (use --force to re-download)."
  exit 0
fi

rm -rf "$base/tmp"/* "$base/core"/* "$base/editor"/*

echo "Downloading H5P core   $CORE_REF"
curl -sSL "https://github.com/h5p/h5p-php-library/archive/$CORE_REF.zip" -o "$base/tmp/core.zip"
echo "Downloading H5P editor $EDITOR_REF"
curl -sSL "https://github.com/h5p/h5p-editor-php-library/archive/$EDITOR_REF.zip" -o "$base/tmp/editor.zip"

unzip -q "$base/tmp/core.zip"   -d "$base/tmp/core"
unzip -q "$base/tmp/editor.zip" -d "$base/tmp/editor"

# The archives unpack into a single <repo>-<ref> directory; flatten it.
mv "$base/tmp/core/"*/*   "$base/core/"
mv "$base/tmp/editor/"*/* "$base/editor/"
rm -rf "$base/tmp"

cat > "$base/CORE_VERSIONS.txt" <<EOT
h5p-php-library         $CORE_REF
h5p-editor-php-library  $EDITOR_REF
downloaded              $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOT

echo "Core   -> $base/core   ($(find "$base/core" -type f | wc -l | tr -d ' ') files)"
echo "Editor -> $base/editor ($(find "$base/editor" -type f | wc -l | tr -d ' ') files)"
