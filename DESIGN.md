# DoubtDesk Design System

## Identity

**The good notebook:** calm, precise, and practical. DoubtDesk should feel like a well-kept study tool, not a marketing page or AI dashboard. Use real room and doubt data; prefer lists and hairline dividers over decorative cards.

## Tokens

### Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#FAF7F2` | `#201F1D` | Page and reading surfaces |
| `--paper-raised` | `#FFFDF9` | `#292825` | Inputs and distinct content regions |
| `--ink` | `#1A1A1A` | `#F2EEE7` | Primary text |
| `--ink-muted` | `#68645F` | `#B9B2A8` | Secondary labels |
| `--line` | `#D9D2C8` | `#494640` | Hairline borders and separators |
| `--accent` | `#D9421C` | `#F06A43` | Primary actions, focus, active navigation |
| `--solved` | `#426B50` | `#83AD8B` | Solved status only |
| `--ai-paper` | `#F1ECE3` | `#34312C` | AI draft background |

Do not introduce additional accent colors, gradients, glows, or translucent surfaces.

### Type

- **Headings and doubt titles:** Newsreader serif, 24/20/18 px, regular to semibold.
- **Interface and body:** IBM Plex Sans, 16 px body, 14 px secondary, 13 px compact controls.
- **Labels and metadata:** IBM Plex Mono, 11/12 px, uppercase where used for statuses and section labels.
- Keep line-height comfortable for reading (1.45–1.6); use weight and size, not color alone, to establish hierarchy.

### Spacing and shape

- Spacing scale: `4, 8, 12, 16, 24, 32` px.
- Radii: `4 px` for inputs and compact controls; `6 px` for larger panels; no pill-shaped content cards.
- Borders: `1 px solid var(--line)`. Avoid box shadows.
- Reading column: maximum width `720 px`; application shell: maximum width `1440 px`.

## Components

- **App shell:** persistent left navigation on desktop; fixed bottom tab bar at widths up to 720 px.
- **Navigation:** Dashboard, Rooms, My doubts, Answer bank; simple Lucide line icons with visible text labels.
- **Top bar:** room/context title, global search trigger (`⌘K`), and theme toggle.
- **Dashboard:** computed counts and a “Needs an answer” list only; no fabricated metrics.
- **Room list:** compact subject rows with code and real open-doubt count.
- **Doubt row/card:** readable serif question, author and server timestamp, uppercase OPEN/SOLVED label, threaded replies and a compact composer.
- **AI reply:** muted `--ai-paper` surface, monospace “AI DRAFT” label, and the note “Check with a senior or your teacher.”
- **Answer bank:** solved doubts and their replies, filtered by search over loaded history.
- **Forms and states:** visible labels, clear validation, focused controls, loading/empty/error copy that explains what happened and what to do next.
- **Actions:** one vermilion primary action per context; secondary actions are text or outline buttons. Solved state uses muted green.

## Interaction and accessibility

- Motion is functional only, at most `150 ms`; disable nonessential transitions under `prefers-reduced-motion`.
- Preserve keyboard operation and a visible focus ring. Maintain WCAG AA text contrast.
- At `360 px`, keep the reading column full width with `16 px` side padding and move navigation to a labeled bottom bar.
- Use labels alongside icons; never rely on emoji or color alone to communicate meaning.
