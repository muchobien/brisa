# Brisa design system

Brisa uses its own CSS tokens and React primitives. Its soft translucent surfaces
draw inspiration from Monocode’s restrained chrome and iOS’s floating materials.
No Monocode code or artwork is included.

## Foundations

`src/design-system/tokens.css` defines semantic ink, surfaces, strokes, accent,
topic colors, radii, spacing, shadows, and motion. Light mode uses a pale lavender
canvas, crisp slate ink, and a violet accent. Dark mode changes the semantic
tokens rather than applying filters. System fonts keep the app familiar on each
platform and avoid external font requests.

Glass panels use a translucent fill, background blur/saturation, a bright edge,
and a quiet shadow. Glass is reserved for surfaces and floating controls; body
text remains solid. Topic colors pair a dot/icon with a written label, and alert
priorities are written out rather than relying on color.

## Components

`src/design-system/components.tsx` exposes Button, IconButton, Field, Modal,
EmptyState, and Logo. Component CSS lives beside the primitives. Compose new
features from these pieces before adding a new visual language.

- Primary actions use a violet pill; secondary actions use a soft outlined pill.
- Inputs have visible labels, focus indicators, and native validation.
- Modal uses the native dialog element for focus trapping and Escape dismissal.
- Destructive actions require a contextual confirmation.
- Empty states explain the next meaningful action.

Product layouts live in `src/styles.css`. Desktop uses a translucent fixed
sidebar and a single readable content column. Mobile uses a floating tab bar
with safe-area spacing, vertically stacked forms, and iOS-friendly input sizes.
The inbox groups each notification into a scannable card with source, topic,
time, priority, and read state.

## Preferences and accessibility

Appearance is stored per browser. Reduced-motion preferences disable entrance
animation and transitions; reduced-transparency uses solid surfaces; higher
contrast uses stronger text and boundaries. Controls include accessible names,
visible focus, keyboard interaction, and live-region feedback. Validate desktop
and 390px mobile layouts before changing shared components.
