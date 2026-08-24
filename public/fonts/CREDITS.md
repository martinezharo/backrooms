# Fonts

The only web font in the game. Everything typed on paper — the briefing sheet,
the record lines on the pause, death and escape screens, the HUD — stays on
Courier, which every machine already has.

| file | family | author | licence |
| --- | --- | --- | --- |
| `archivo-latin-var.woff2` | [Archivo](https://fonts.google.com/specimen/Archivo) | Omnibus-Type | [SIL Open Font License 1.1](https://openfontlicense.org/) |

Self-hosted rather than loaded from Google Fonts: one fewer origin on the
critical path, and the landing page keeps working with the network as bad as
the room it is describing.

It is the **variable** cut, latin subset (`U+0000–00FF` and friends), carrying
both axes — weight `100–900` and width `62–125%`. Both are used: the signage
is wide and heavy (`wght 800 / wdth 112–125`), and every small label under it
is narrow and quiet (`wght 600 / wdth 62–70`). Dropping the width axis would
save about 55 kB and cost the design the contrast it is built on.

Fetched from the Google Fonts CSS API, which serves the same OFL files:

```sh
curl -s "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900" \
  | grep -o 'https://[^)]*woff2' | tail -1 \
  | xargs curl -o public/fonts/archivo-latin-var.woff2
```
