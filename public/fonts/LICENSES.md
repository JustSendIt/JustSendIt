# Font licences

These typefaces are served from this site instead of Google Fonts, so no visitor's browser contacts Google to draw a page. The files are the Latin and Latin Extended subsets Google Fonts publishes. All are unmodified except Luckiest Guy (see below). They are not covered by this repository's CC0 dedication. Each one keeps its own licence, and the full text sits beside the files.

| Family | Files | Licence | Text |
|---|---|---|---|
| Luckiest Guy | `luckiest-guy-*.woff2` | Apache License 2.0 | `luckiest-guy-LICENSE.txt` |
| Rubik | `rubik-*.woff2` | SIL Open Font License 1.1 | `rubik-LICENSE.txt` |
| Newsreader (whitepaper only) | `newsreader-*.woff2` | SIL Open Font License 1.1 | `newsreader-LICENSE.txt` |
| IBM Plex Mono (whitepaper only) | `ibm-plex-mono-*.woff2` | SIL Open Font License 1.1, Reserved Font Name "Plex" | `ibm-plex-mono-LICENSE.txt` |
| IBM Plex Sans (whitepaper only) | `ibm-plex-sans-*.woff2` | SIL Open Font License 1.1, Reserved Font Name "Plex" | `ibm-plex-sans-LICENSE.txt` |

Source: [github.com/google/fonts](https://github.com/google/fonts).

## Changes to Luckiest Guy

`luckiest-guy-latin-09b57828.woff2` and `luckiest-guy-latin-ext-be6f3912.woff2` are modified copies of the Google Fonts files `luckiest-guy-latin-dc461b6f.woff2` and `luckiest-guy-latin-ext-76d8d95e.woff2` (Apache License 2.0, section 4(b)). Changed on 2026-09-28 by this site: the vertical metrics only. `hhea` ascender 1440 → 1736 and descender −608 → −312; `OS/2` sTypoAscender and sTypoDescender the same (units per em 2048). The sum is unchanged, so the line height is the same; the ascent and descent now sit evenly around the cap height (1424), so text centred in a box has its capitals centred (macOS, iOS, Android and Linux read these values; Windows reads usWinAscent/usWinDescent, which were left as published). No glyph, table size or other value was changed. The new file names follow this folder's convention: the first eight hex digits of the file's SHA-1.
