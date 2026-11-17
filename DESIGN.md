# DoubtDesk Design System

## Identity

**The good notebook, with a glass layer:** calm and precise, with a premium frosted surface over a soft, warm mesh. DoubtDesk remains a study tool, not a marketing page or AI dashboard. Use real room and doubt data; keep long lists dense and readable.

## Tokens

### Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#FAF7F2` | `#1C1D24` | Page and reading surfaces |
| `--paper-raised` | `#FFFDF9` | `#292A31` | Inputs and distinct content regions |
| `--ink` | `#1A1A1A` | `#F2EEE7` | Primary text |
| `--ink-muted` | `#68645F` | `#B9B2A8` | Secondary labels |
| `--line` | `#D9D2C8` | `#52515A` | Hairline borders and separators |
| `--accent` | `#D9421C` | `#F06A43` | Primary actions, focus, active navigation |
| `--solved` | `#426B50` | `#83AD8B` | Solved status only |
| `--ai-paper` | `#F1ECE3` | `#34312C` | AI draft background |
| `--glass-bg` | `rgba(255,255,255,0.55)` | `rgba(24,24,32,0.45)` | Sidebar, top bar, and light panels |
| `--glass-bg-strong` | `rgba(255,255,255,0.86)` | `rgba(24,24,32,0.84)` | Reading surfaces, replies, controls; opacity is raised for legibility |
| `--glass-border` | `rgba(255,255,255,0.72)` | `rgba(255,255,255,0.16)` | Glass edges |
| `--glass-highlight` | `rgba(255,255,255,0.62)` | `rgba(255,255,255,0.10)` | Inset top edge |
| `--glass-shadow` | `0 8px 32px rgba(74,54,38,0.10)` | `0 8px 32px rgba(0,0,0,0.22)` | Raised glass only |

The fixed mesh uses restrained peach, blue-lilac, mint, and warm yellow orbs; it is decorative only. A subtle vermilion-tinted gradient is limited to the greeting and primary buttons. Subject identifiers may use muted colors. Avoid neon, glows, and extra status colors.

Glass uses `backdrop-filter: blur(18px) saturate(160%)` and its WebKit equivalent on a few large surfaces only. Reading text uses the stronger glass token. Never blur each row in a long list or stack more than two blurred layers. Reduce blur to 10–12 px on small screens; use solid surfaces when backdrop filters are unavailable, transparency is reduced, or contrast is increased.

## Type

- **Headings and doubt titles:** Newsreader serif, 24/20/18 px, regular to semibold.
- **Interface and body:** IBM Plex Sans, 16 px body, 14 px secondary, 13 px compact controls.
- **Labels and metadata:** IBM Plex Mono, 11/12 px, uppercase where used for statuses and section labels.
- Keep line-height comfortable for reading (1.45–1.6); use weight and size, not color alone, to establish hierarchy.

## Spacing and shape

- Spacing scale: `4, 8, 12, 16, 24, 32` px.
- Radii: `4 px` for compact controls, `12 px` for controls, and `16–24 px` for glass panels.
- Borders: crisp `1 px` glass edges with a subtle inset highlight; use soft shadows only on raised glass.
- Reading column: maximum width `720 px`; application shell: maximum width `1440 px`.

## Components

- **App shell:** persistent left navigation on desktop; fixed bottom tab bar at widths up to 720 px. Sidebar and sticky top bar use a single frosted layer.
- **Navigation:** Dashboard, Rooms, My doubts, Answer bank; simple Lucide line icons with visible text labels.
- **Top bar:** room/context title, global search trigger (`⌘K`), and theme toggle.
- **Dashboard:** greeting based on the signed-in name, computed counts and a “Needs an answer” list; no fabricated metrics.
- **Room list:** compact subject rows with code, muted subject color, and real open-doubt count.
- **Doubt row/card:** readable serif question, author and server timestamp, uppercase OPEN/SOLVED label, strong-opacity reading surface, threaded replies and a floating composer.
- **AI reply:** strong-opacity muted surface, monospace “AI DRAFT” label, and the note “Check with a senior or your teacher.”
- **Answer bank:** solved doubts and their replies, filtered by search over loaded history.
- **Forms and states:** visible labels, clear validation, focused controls, glass surfaces, and loading/empty/error copy that explains what happened and what to do next.
- **Actions:** one vermilion primary action per context; secondary actions are text or outline buttons. Solved state uses muted green. Hover lift is limited to 150–200 ms.

## Interaction and accessibility

- Motion is functional only, at most `200 ms`; the background orbs drift very slowly and stop under `prefers-reduced-motion`.
- Preserve keyboard operation and a visible focus ring. Maintain WCAG AA text contrast.
- At `360 px`, keep the reading column full width with `16 px` side padding and move navigation to a labeled bottom bar.
- Use labels alongside icons; never rely on emoji or color alone to communicate meaning.
- Prefer solid, high-opacity surfaces under `prefers-reduced-transparency` and `prefers-contrast: more`; use a solid fallback without backdrop-filter support.
