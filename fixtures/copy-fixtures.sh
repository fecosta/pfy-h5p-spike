#!/bin/bash
# Copies the selected legacy fixtures out of the local PFY corpus.
#
# The corpus is real course content, so nothing here is committed: fixtures/
# gitignores *.h5p and only MANIFEST.md (names, sizes, sha256) is tracked.
set -euo pipefail

CORPUS="${PFY_H5P_CORPUS:-/Users/felipecosta/projects/code/repos/study/fala-gringo/_temp/h5p/exports}"
EXTRA="${PFY_H5P_EXTRA:-$HOME/Desktop/H5P/conectores_funcoes_discursivas_documentation_tool.h5p}"
DEST="$(cd "$(dirname "$0")" && pwd)/sample-h5p"

mkdir -p "$DEST"

FIXTURES=(
  "1-de-acordo-com-o-texto-e-possivel-afirmar-que-141.h5p"      # Multiple Choice
  "4-encontre-no-texto-sinonimos-das-palavras-abaixo-124.h5p"   # Fill in the Blanks
  "as-horas-em-portugues-196.h5p"                               # Drag and Drop
  "escute-e-repite-audio-207.h5p"                               # image + audio (26 hotspots)
  "quiz-question-set-7.h5p"                                     # structurally complex, aggregate score
  "verdadeiro-ou-falso-a-85.h5p"                                # most common type in the corpus
  "a-quais-perguntas-abaixo-o-texto-audio-responde-208.h5p"     # newer library patch levels
)

if [ ! -d "$CORPUS" ]; then
  echo "corpus not found: $CORPUS" >&2
  echo "set PFY_H5P_CORPUS to the directory holding the legacy .h5p exports" >&2
  exit 1
fi

for f in "${FIXTURES[@]}"; do
  if [ -f "$CORPUS/$f" ]; then
    cp -f "$CORPUS/$f" "$DEST/$f"
    echo "copied $f"
  else
    echo "MISSING $f" >&2
  fi
done

# The library-less export: declares 5 dependencies and bundles none of them.
if [ -f "$EXTRA" ]; then
  cp -f "$EXTRA" "$DEST/$(basename "$EXTRA")"
  echo "copied $(basename "$EXTRA")"
else
  echo "MISSING $EXTRA (library-less fixture)" >&2
fi

echo
echo "fixtures in $DEST:"
ls -la "$DEST"/*.h5p | awk '{print "  " $5 "  " $NF}'
