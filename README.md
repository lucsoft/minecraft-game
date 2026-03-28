# A Miencraft Renderer on Babylon.js

## Asset Pipeline

The pipeline fetches and caches ZIP archives, collects mcmeta files within them, and precomputes custom atlas maps. It serves the resulting blockstates, models, and prebuilt atlas. It is hosted at `https://asset-cdn.lucsoft.de/`.

**Required parameter:**
- `url` — URL of a ZIP archive to fetch and cache

**Optional response format parameters:**
- `atlaspng` — returns the precomputed texture atlas as a PNG
- `atlas` — returns the atlas with UV rect metadata as a CBOR file
- `file` — returns a specific file from the archive by path
- _(none)_ — returns JSON with blockstates and models

**Example** (texture atlas PNG for 1.21.4):

```
https://asset-pipeline.lucsoft.de/?url=https://piston-data.mojang.com/v1/objects/d3bdf582a7fa723ce199f3665588dcfe6bf9aca8/client.jar&atlaspng
```
