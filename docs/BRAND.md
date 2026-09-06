# WakeLock — Brand & Icon

## The mark

A geometric alarm-clock ring whose **bell arc doubles as a padlock shackle**, with a light
neutral **rising arrow** breaking upward through the dial and short sunrise rays behind it.

One shape, one idea: **alarm + lock + wake-up + control.**

## Concepts considered

| # | Concept | 48px | Distinct | Relevance | Simplicity | Adaptive-safe | Mono | Total |
|---|---|---|---|---|---|---|---|---|
| A | **Shackle-as-bells + rising arrow + rays** | 5 | 5 | 5 | 4 | 5 | 5 | **34** |
| B | Shield containing a clock hand as sunrise beam | 4 | 4 | 4 | 3 | 4 | 4 | 27 |
| C | Keyhole negative space in a sun disc + horizon | 3 | 5 | 4 | 3 | 4 | 3 | 25 |
| D | Clock hands forming a chevron through a horizon | 4 | 3 | 3 | 5 | 5 | 4 | 24 |

**Winner: A.** The shackle/bell pun makes it read as *both* alarm and lock at a glance, it keeps a
single strong silhouette, and the solid arrow survives monochrome and 48 px where the thinner
concepts (B, C) collapse.

## Assets shipped

All marks are **hand-authored Android vector drawables** (no raster redraws, sharp at every density):

| Asset | Path |
|---|---|
| Adaptive foreground | `res/drawable/ic_launcher_foreground.xml` |
| Adaptive background | `res/drawable/ic_launcher_background.xml` |
| Monochrome (themed icons, API 33+) | `res/drawable/ic_launcher_monochrome.xml` |
| Adaptive icon config | `res/mipmap-anydpi-v26/ic_launcher{,_round}.xml` |
| Splash logo | `res/drawable/ic_splash_logo.xml` |
| In-app logo | `res/drawable/ic_wakelock_logo.xml` |
| Notification icon (white silhouette) | `res/drawable/ic_notification.xml` |

Because they are vectors, Android generates every density (48/72/96/144/192 px) from the same
source, and the Play Store 512×512 can be exported from the same paths.

## Adaptive-icon safety

- Canvas 108×108 dp; the mark occupies the central ~64 dp — inside the 66 dp safe circle.
- Verified against circle, squircle, rounded-square and teardrop masks: no clipping.
- Stroke weights are 6–7 units at 108 dp (~3 dp at 48 px), heavy enough to survive downscaling.
- Monochrome layer is a pure white silhouette; the notification icon is simplified further
  (fewer rays, thicker strokes) because it renders at 24 dp.

## Colour

| Token | Hex | Use |
|---|---|---|
| Ink | `#0B0D12` | App/base background, icon background |
| Surface | `#14171F` | Cards |
| Sunrise Amber | `#FFB020` | Primary accent, clock ring, brand |
| Sunrise Orange | `#FF7A18` | Secondary accent, rays |
| Urgency Red | `#FF3B30` | Alarm urgency, final minutes, failure **only** |
| Neutral Light | `#F5F6F8` | Text, the rising arrow |
| Success | `#34C77B` | Verified line, completed dots |

Two accents maximum in the mark. Red is reserved for urgency so it keeps its meaning.

## Wordmark

`WAKELOCK` — uppercase, heavy weight, 3–4 sp letter-spacing. In the lockup the symbol sits left of
the word. The symbol is designed to stand alone without the word.

## Personality

Calm, premium and quiet outside the alarm. Urgent, high-contrast and commanding during it —
but never chaotic, and always readable by a disoriented person at 5 AM.
