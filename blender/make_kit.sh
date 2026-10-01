#!/bin/sh
# Rebuild the kit (KIT_SPEC.md §9). Set BLENDER to use another Blender binary (5.1+).
#   sh blender/make_kit.sh       build_kit.py -> preview_kit.py -> export_kit.py   (npm run kit)
#   sh blender/make_kit.sh tex   bake.py: texture sets + railing patterns          (npm run tex)
set -e
cd "$(dirname "$0")/.."
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [ "$1" = "tex" ]; then
  "$B" --background --factory-startup --python-exit-code 1 \
    --python blender/bake.py -- public/assets/tex --save blender/textures.blend
  exit 0
fi
"$B" --background --factory-startup --python-exit-code 1 \
  --python blender/build_kit.py -- blender/european_kit.blend
"$B" --background blender/european_kit.blend --python-exit-code 1 \
  --python blender/preview_kit.py -- blender/kit_preview.jpg
"$B" --background blender/european_kit.blend --python-exit-code 1 \
  --python blender/export_kit.py -- public/assets/kit.glb public/assets/kit_manifest.json
