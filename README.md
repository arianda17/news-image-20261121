[![make.fun · news-image-20261121](https://make.fun/badge/news-image-20261121.svg)](https://make.fun/bounty/news-image-20261121?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)
[![rank](https://make.fun/badge/news-image-20261121/arianda17/news-image-20261121/rank.svg)](https://make.fun/bounty/news-image-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)
[![reward](https://make.fun/badge/news-image-20261121/arianda17/news-image-20261121/reward.svg)](https://make.fun/bounty/news-image-20261121?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)

# The World Today — 36 Stories: Saturday 21 November 2026

A one-image summary of Saturday 21 November 2026's world news, drawn
programmatically (Node 22, standard library only, no network, fully
deterministic). 36 verified stories: 13 featured + 23 one-liners.

## How to run

```sh
node main.ts
# writes out/entry.png (1024x1024, ~470 KB)
# or set MAKEFUN_OUTPUT_DIR to choose the output directory
```

No dependencies, no network at runtime, no clock, no randomness: two
runs produce a byte-identical PNG (sha256 verified).

## Layout (1024x1024)

| Band | Content |
| --- | --- |
| Masthead 0–84 | "SATURDAY 21 NOVEMBER 2026", "THE WORLD TODAY - 36 STORIES - ONE DAY" |
| Region tabs 84–108 | ASIA 5 · EUROPE 11 · MIDDLE EAST 3 · AMERICAS 12 · AFRICA 1 · GLOBAL 4 (= 36) |
| Day strip 108–140 | "THE DAY, IN ORDER" — overnight / morning / midday / afternoon / late |
| Lead cards 142–338 | Two large cards: (1) COP31 runs into overtime, (2) Kyiv's biggest barrage this year |
| Numbers strip 342–390 | 8 boxes: 400+ DRONES · 110 MISSILES · 9 KILLED IN KYIV · -3.7% S&P 500 · 300,000 EVACUATED · 423 RESCUE TEAMS · 100,000 YOUTH VISAS · 8 YEARS TO MERCURY |
| Featured grid 394–662 | 11 cards (4 + 4 + 3): Poland, Wall Street, BepiColombo, Denmark, Riyadh, Akvan, cyber breach, Senate, UK-EU, AI guardrails, Mata |
| World map 666–800 | Schematic continents, 8 pins numbered to match, labels in open sea |
| Also on 806–974 | "ALSO ON SATURDAY 21 NOVEMBER", 23 one-liners numbered 14–36, region dot per item |
| Date check 978–994 | "NOT 21 NOV" strip (see below) |
| Footer 998–1024 | SOURCES: REUTERS - AP - CNN - WSJ - ESA - IMD - UN NEWS - AFP |

Every story is numbered 1–36; map pins are numbered to match.

## Technique

A 3x-supersampled RGB framebuffer, filled shapes rasterised at
supersample resolution, text drawn from a hand-built single-stroke
vector alphabet (each glyph is a set of polylines on a 10x14 grid,
stamped as soft-edged discs along every segment), then a box-filter
downsample to 1024x1024 and a hand-rolled PNG encoder (zlib deflate,
CRC32). The face is caps-only: lowercase input is set as capitals.

## The 36 stories

Featured (numbered 1–13): COP31 overtime, Antalya · Kyiv's biggest
barrage this year, 400+ drones / 110+ missiles, 9 killed · Missiles
land in Poland, NATO calls it a grave violation · Wall Street enters
correction, S&P -3.7% to 6,910 · BepiColombo reaches Mercury, 8 years
in flight · Denmark expels Russian attache over Kyivstoner plot ·
Missile hits Riyadh's tallest tower · Cyclone Akvan crosses Odisha,
300,000 evacuated · JPMorgan, Visa, Mastercard breached via vendor ·
Senate blocks Iran war-powers vote, 51-48 · UK-EU youth mobility deal,
100,000 a year · Trump, Xi agree AI guardrails · Juan Mata retires.

Also on (14–36): France calls UNSC meeting over Kyiv · EU €1bn
military aid to Ukraine · UNICEF: children killed already top 2025 ·
Gold -4%, Bitcoin below $59,000 · Bayer $7.25bn Roundup deal approved ·
YouTube to pay ~$3bn to school districts · Gupta 19y7m over Pannun
plot · Iran parks 14+ tankers at Kharg · Tanker afire off Khasab,
Brent $91.95 · Trump: Iran-strike decision can wait until Jan 1 ·
Florida flood emergency, 21 counties · Argentina 7-0 Costa Rica ·
FIFA confirms 3 candidates for 2027 race · Zverev into ATP Finals
semis · India women 4-1 Malaysia hockey · Pakistan beat Sri Lanka by
8 wickets · Earthshot winners pitch fixes in Mumbai · Malaysia ends
visa-free entry for Indians · Jepchirchir banned 3 years · LA jury
convicts Palisades Fire starter · French Senate passes police law
205-110 · European Commission hit by AI-assisted cyberattack ·
Goldy Brar on Canada's most-wanted, $250,000 bounty.

## Date check

NOT 21 NOV: SHENZHEN SUMMIT 19 NOV - ICJ MYANMAR RULING 19 NOV -
KYIV BARRAGE OVERNIGHT 19-20 NOV - AKVAN LANDFALL 20 NOV -
WALL ST CLOSE 20 NOV. All reported in Saturday's news cycle; the
strip says so on the image, so nothing stale is passed off as today's.

## Verification

Every figure was checked against a named source on 21 November 2026
(see NEWS.md in the work dir for the source list). Render verified
by eye at full resolution and at 300 px; determinism verified
(byte-identical PNG across two independent renders).
