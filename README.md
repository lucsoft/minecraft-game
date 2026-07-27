# A Miencraft Renderer on Babylon.js

## Asset Pipeline

The pipeline fetches and caches ZIP archives, collects mcmeta files within them, and precomputes custom atlas maps. It serves the resulting blockstates, models, and prebuilt atlas. It is hosted at `https://asset-cdn.lucsoft.de/`.

**Required parameter:**
- `url` — URL of a ZIP archive to fetch and cache

**Optional response format parameters:**
- `atlaspng` — returns the precomputed texture atlas as a PNG
- `atlas` — returns the atlas with UV rect metadata as a CBOR file
- `file` — returns a specific file from the archive by path
- `sounds` — returns the version's raw `sounds.json`
- `soundlist` — returns every sound file of the version plus the events that play it
- `sound` — returns one sound as ogg, e.g. `sound=random/pop`
- `soundfeatures` — streams one newline delimited analysis row per sound
- _(none)_ — returns JSON with blockstates and models

Sounds live in the version's asset objects rather than the jar, so the pipeline resolves them
through the asset index and caches each file on first use.

## Pages

- `/` — the block renderer
- `/merge` — the merge game
- `/sound` — every sound of the version as a graph, wired up by how alike they actually sound

## Sound analysis

`soundfeatures` decodes each ogg and reduces it to MFCCs plus the usual spectral and envelope
descriptors, which is what the graph on `/sound` measures similarity with. The first run has to
fetch and decode roughly 4200 files, so rows are streamed as they are finished and appended to
`cache/<objectId>/sound-features.jsonl`; every run after that replays that file instantly.

**Example** (texture atlas PNG for 1.21.4):

```
https://asset-pipeline.lucsoft.de/?url=https://piston-data.mojang.com/v1/objects/d3bdf582a7fa723ce199f3665588dcfe6bf9aca8/client.jar&atlaspng
```
