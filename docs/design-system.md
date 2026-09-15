# Design and motion system — Revision 2

**Status:** implemented in the maintained `public/` frontend. The supplied
`docs/revised_design/` screens remain the visual reference. Runtime behavior uses
the existing application state, sample fixtures, and personal adapter.

## Stylesheet ownership

`index.html` loads `design-system.css` (tokens, materials, motion), then
`styles.css`, `discovery.css`, and `practice.css` (existing feature layouts),
then `revision.css` (Revision 2 screen composition and material mapping) and
`screens-v2.css` (the supplied Home and Profile v2 layouts).
Shared timing and color roles remain in `design-system.css`.


## Critique of the baseline

The current UI is coherent and honest, but its surface is anonymous. Seven findings, each shown before/after in `Critique.dc.html`:

1. **Surfaces** — panel, editor, badge and card share one grey, a 1px mid-grey border and a 6–8px radius. Nothing is lit or recessed.
2. **Controls** — primary/secondary/quiet differ by hue only; the press scales the label.
3. **Chrome** — app header, session header, guidance band and pane title bars form four strips above the work.
4. **Home** — the lead feature works, but a 9rem decorative arrow takes its best space and every activity row is a bordered card.
5. **Evidence** — the finding’s citation is a text link between dividers; the highlighted line is far away. The product’s strongest relationship is its least visible.
6. **Type and shape** — Windows default fonts at weight 500, one radius, bordered status pills.
7. **Motion** — one 200 ms duration and one ease for everything; no exit, no stagger, no distinction between a settling button and an opening pane.

What stays: the problem/conversation column beside a wider code/results column, visible “fictional” labels, findings with limitations rather than scores, and every keyboard, reduced-motion and forced-colors gate.

## Character

A lit desk, not a dashboard. Graphite neutrals with a trace of green-grey (hue 160, chroma ≈ 0.005). One saturated color, teal, for action and selection. Amber locates evidence and never grades. Lilac is the coach’s voice. The signature composition is a learning statement next to the code line that supports it, with its limitation in view.

## Planes and light

| Role | Token | Construction |
| --- | --- | --- |
| Ground | `--ground` | flat |
| Working plane | `--plane` → `--plane-lit` | 180° gradient, `--ring`, `--light-top`, `--shadow-contact` |
| Recess | `--recess` | `--shadow-recess` (inner top shadow); editor, fields, inset evidence |
| Raised | `--raised` → `--raised-lit` | controls, icon wells, selected pills; ring + top light + contact |
| Float | `--raised` + `--shadow-float` | dialog, drawer, menu; the only ambient shadow |
| Annotation | `--evidence-soft` + `inset 2px 0 0 var(--evidence)` | cited code line, transcript sentence, citation card |

`--ring` is a box-shadow ring, not a border: crisp at 1× and 2×, never doubled with a divider. Dividers separate information (`--divider`, `--divider-dashed`); rings bound a plane; focus is a 2px teal ring outside the control and always beats material highlights.

## Color roles

Ground `oklch(0.165 0.005 160)` · Plane `0.215` → lit `0.245` · Recess `0.14` · Raised `0.285` → lit `0.32` · Ink `0.955` / `0.73` / `0.56` · Accent teal `oklch(0.80 0.10 175)` with dark ink `0.20` · Evidence amber `oklch(0.83 0.11 80)` · Coach lilac `0.80 0.09 300` · Success `0.80 0.12 150` · Error `0.76 0.14 25` · Pending `0.78 0.08 230`. A light theme (`[data-theme="light"]`) inverts the light with the same roles. Every state color pairs with a word; a status is a 6px dot plus text, not a pill.

## Type roles

Gabarito (display) · Geist (interface) · Geist Mono (code, timestamps, line refs). Local fallbacks: Bahnschrift, Segoe UI, Cascadia Code.

| Role | Spec |
| --- | --- |
| Page title | Gabarito 32 / 600 / −.02em / 1.1 |
| Feature (learning moment) | Gabarito 26 / 600 / −.015em / 1.15 |
| Section | Geist 16 / 600 / 1.35 |
| Pane label | Geist 13 / 600 / 1.4 |
| Eyebrow | Geist 11 / 600 / .12em / uppercase / `--ink-3` |
| Reading | Geist 15 / 400 / 1.6 |
| Supporting | Geist 13 / 400 / 1.5 |
| Code / location | Geist Mono 13 / 400 / 1.7 |

## Shape

Radius follows nesting: pane 14 → card 10 → control 8 → inner 6. Circles for avatars and point markers only.

## Controls

Primary: lit teal gradient, dark ink, `--light-top-strong` + contact + soft accent glow. Secondary: raised graphite with ring. Ghost: hairline ring, no fill. Quiet: text. Segmented controls and tab lists are an inset track (`--recess`) with the selected item as a raised pill. Fields are recessed; focus strengthens the boundary. Switches use `--ease-spring` for the knob.

## Motion

Decelerate in, accelerate out. Duration scales with size. Motion never editorializes: passing and failing results enter identically. Code and evidence never move; annotation arrives around them. Gates are unchanged (OS preference, in-app preference, pointer input; hover motion also needs `(hover: hover) and (pointer: fine)`).

| Token | Value | Use |
| --- | --- | --- |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | anything appearing |
| `--ease-settle` | `cubic-bezier(.25,1,.5,1)` | state change, pill move |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | menus and dialogs leaving |
| `--ease-spring` | `cubic-bezier(.34,1.3,.64,1)` | ≤4% overshoot; switches, pills only |
| `--ease-breathe` | `cubic-bezier(.45,0,.55,1)` | voice indicator only |
| `--motion-press` | 150 ms | 1px travel, top light dropped |
| `--motion-feedback` | 200 ms | state |
| `--motion-enter` | 350 ms | entrances |
| `--motion-pane` | 450 ms | drawer, narrow pane switch |
| `--motion-exit` | 120 ms | exits |
| `--stagger` | 40 ms | index-based, capped at 6 |

Moments that earn motion: staggered entrance of sibling panes and list rows; press/settle on small controls; the state track (Attempt → Review → Retry) moving its raised pill; the evidence marker entering from the left when a citation is located; the drawer entering from its spatial origin; the voice indicator’s breathe (period and amplitude change with state, the label stays).

## Screens

Home, Practice, Review, Roadmap, Sessions, Setup, Preferences, and Profile use the floating top navbar. The primary group contains Home, Roadmap, and Sessions; the account group contains Preferences, Design system, and the profile avatar.

## Runtime decisions

- The floating navbar spans the viewport inside its outer padding at the top.
  Any document scroll compacts it to the measured width of its contents, centered.
  Returning to the top expands it. Width uses the shared entrance timing; keyboard
  and reduced-motion paths change immediately. Navigation wraps at narrow widths.
- Vertical and horizontal overscroll are disabled for the page, panes, and dialogs.
  Ordinary page scrolling and horizontal map panning remain available.
- Roadmap retains the reference's 960px graph width, 240px cards, 120px column
  gaps, 18px row gaps, and curved dashed connectors. Cards now size to their text
  instead of a fixed height. The two branches occupy two rows, with the source
  centered between them. Connector endpoints follow the measured card edges.
  Reduced page and graph padding keeps selected subtopics fully visible at the
  checked 1440 × 900 and 1366 × 768 desktop sizes.
- The problem drawer closes with its Close control, Escape, or a pointer click
  beginning and ending outside its bounds. Dismissal restores the originating
  subtopic link's focus.
- Session actions use Geist, the shared body size, weight 600, and unitless 1.4
  line-height. Row actions share a raised surface, trailing arrow, and a common
  content-sized column; labels remain on one line.
- Introductory feature explanations and the Home profile caption are removed.
  Problem requirements, evidence, record provenance, and data choices remain.
- Dark is the default, matching the screen package. Preferences supports light
  and system themes. Theme and reduced motion persist per tab.
- Gabarito, Geist, and Geist Mono load through the same Google Fonts stylesheet
  as the references, with the specified local fallbacks.
- Home excerpts use actual prepared source lines, so line references can differ
  from the visual specimen. Fictional activity remains explicitly labeled.
- Profile uses the reference's sixteen-week calendar ending at the fictional
  September 2026 record date; it does not imply live account activity.
- Sessions filters operate on the displayed fictional record statuses.
- Light accent and syntax colors are darkened where the browser contrast audit
  measured less than WCAG AA contrast; roadmap labels use reading ink in light mode.
- Voice indicator periods follow the specimen: listening 1600ms, speaking 600ms.
- Keyboard input and either reduced-motion preference disable movement.
  Citation animation affects its marker only, leaving code and evidence stationary.
- The personal adapter retains its authenticated flows and voice/data boundaries;
  shared controls, typography, and materials apply there as well.

## Verification

Run `npm run check`, `npm test`, and `npm run lint`. Against a running preview,
set `APP_URL` and run `npm run test:browser`, `npm run test:discovery`, and
`node test/browser/revision-check.mjs`. The revision check covers light-theme
accessibility, saved appearance preferences, session filters, top-navigation
reflow, reduced motion, and forced-color boundaries.
`node test/browser/navbar-roadmap-check.mjs` verifies the measured floating-navbar
widths and graph connections, along with overscroll and narrow layouts.
`node test/browser/roadmap-density-check.mjs` verifies roadmap fit, outside-click
dismissal and focus return, session action typography, and responsive layout.
