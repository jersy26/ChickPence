---
name: ChickPence
description: Cream and gold poultry records with supplied animated chicken companions.
colors:
  bg: "#F7F2E7"
  card: "#FFFDF8"
  ln: "#ECE3D0"
  ink: "#2B2A26"
  mut: "#6B6457"
  acc: "#C08A2B"
  home-action: "#2B2A26"
  home-action-hover: "#48463E"
  link: "#8F6210"
  selected: "#F7DF8A"
  soft-gold: "#FCF1C7"
  fill: "#F4EEE1"
  ok: "#2F6B3F"
  ok-soft: "#E1EEDC"
  bad: "#9A3A26"
  bad-soft: "#FBE3DA"
  watch: "#84570C"
  watch-soft: "#FCEFD0"
  info: "#2E5A78"
  info-soft: "#E3ECF2"
typography:
  headline:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.55
  label:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "12px"
rounded:
  field: "14px"
  inset: "18px"
  filter: "22px"
  card: "24px"
  feature: "28px"
  home-panel: "26px"
  pill: "999px"
spacing:
  compact: "8px"
  small: "12px"
  base: "16px"
  inset: "20px"
  panel: "24px"
  feature: "28px"
components:
  button-primary:
    backgroundColor: "{colors.acc}"
    textColor: "#2B2110"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  button-home:
    backgroundColor: "{colors.home-action}"
    textColor: "{colors.card}"
    rounded: "{rounded.pill}"
    padding: "9px 12px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "#59451D"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 14px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "24px"
  chip:
    backgroundColor: "{colors.fill}"
    textColor: "#655B49"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  navigation-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
---

# Design System: ChickPence

## Overview

The approved world is the user's supplied cream-and-gold farm interface: friendly animated chickens, faint footprints, off-white rounded surfaces and clear Poppins records. The nine-section Markdown brief governs its accompanying HTML boards; the confirmed Staff phone navigation and centered striped Login resolve the conflicting reference layouts. No new brand metaphor is inferred.

Warm imagery supports practical work. State explanations, record labels and financial signs stay readable alongside the companion and colored surfaces. This refresh records the implemented world in `src/redesign.css`, which overrides the older stylesheet; it does not change PRODUCT.md's calculation or service boundaries.

**Key Characteristics:**
- Cream canvas, off-white cards, warm borders and gold actions.
- Locally hosted Poppins and supplied animated SVG chickens.
- Broad rounded panels, pill actions and labeled operational records.
- Responsive record cards and visible keyboard focus.

## Colors

### Primary

Gold (`acc`) marks shared primary actions and selected controls; Home locally uses charcoal primary actions, including Manage batches and See answer. This context override does not replace gold actions on other pages. Selected and soft-gold fills distinguish active navigation and supportive notices. Link gold (`link`) provides darker text and focus outlines.

### Neutral

Cream (`bg`) carries the canvas; off-white (`card`) carries records and dialogs. Warm border (`ln`) separates surfaces. Ink (`ink`) and muted brown (`mut`) organize text. Warm fill (`fill`) supports inset regions, field groups and neutral chips.

### Semantic

Success, danger, watch and information each have a text color and soft background. Calendar profit/loss, task status, mortality and insight cards retain words and numbers alongside these colors. Green age bars mean within target; red bars mean past target.

**The Labeled State Rule.** Keep financial signs, state labels and explanatory text alongside color.

## Typography

Poppins is locally served in weights 400, 500, 600 and 700 from `public/fonts`; retain its included OFL license. Body, headline, title and label roles are recorded above. Headings balance their lines, while names and copy can wrap. Main phone headings reduce to 28px; the Home greeting uses a responsive 28–40px scale and the companion title is 26px. Smaller calendar annotations are a local density choice.

Tables, bold values and numeric classes use tabular numerals. KPI sizes vary with context and viewport. Compact large values show two decimal places for millions and one for thousands, with full peso amounts in tooltips; calculations are unchanged. Preserve complete currency values and their existing formatting; labels and tooltips explain the basis rather than inventing new financial semantics.

## Layout

The signed-in canvas has faint repeating chicken footprints under a translucent cream layer (300px tile). Desktop uses 24px shell padding and gap, a sticky 248px sidebar with 28px corners, and flexible content capped at 1600px. Main sections and grids generally use 24px gaps. At 1200px shell padding/gaps become 16px and the sidebar narrows to 218px. At 950px it becomes a 270px menu-controlled drawer. At 719px and below, page gutters become 12px and the top bar compacts.

Staff phones keep the website header and four links underneath: Home, Batches, Logbook and Settings. Owner/Admin have nine section destinations through the sidebar/drawer. The implemented phone layout has no bottom tab navigation. The compact Home top row pairs horizontal companion art/copy with compact to-do rows; its lower row pairs flock health with the calendar. Performance uses the full-width row below. At 1100px and below the top/lower rows become one column; phones stack the companion and records. Today’s Questions uses four desktop columns, two tablet columns and explicit one-column row flow on phones, including expanded cards. Staff retain the same companion sizing rules.

Record tables become labeled stacked cards at 719px and below, with collapsed filters exposed by a Filters control. The seven-day Team board remains a compact table. Entry dialogs become bottom sheets on phones. The calendar remains seven columns and its existing date-details dialog stays viewport bounded. Login and welcome use their local painted-stripe background.

## Elevation & Depth

Cards, sidebar and top bar are flat at rest: thin warm borders and tonal fills provide separation. Temporary layers retain localized shadows: notification panels, entry drawers, the undo notice and Login card. The floating feather uses a warm contact shadow and subtle ring. Exact values live in the sidecar; do not restore the superseded dark calendar or egg-shaped financial cards.

## Shapes

Cards use broad 24px corners; compact Home feature panels use 26px, while other feature and Login/welcome surfaces retain their observed 28px roles. Inputs and navigation rows use 14px, inset KPIs 18px and filter panels 22px. Actions and tabs are pills. Phone record rows use 20px corners. Desktop entry drawers round their left edge; phone entry sheets round their top edge. These are implemented roles, not a requirement to give every nested region the same shape.

## Components

Buttons use gold primary and off-white secondary fills, compact Poppins and a 44px minimum control height. Hover warms the fill; disabled controls reduce opacity. Visible focus is a 3px dark-gold outline with 3px offset. Fields use a 2px outline with 2px offset.

Cards use off-white, warm borders and 24px padding, generally reducing to 20px on phones. Inputs use off-white, a warm stroke and 11px/14px padding. Status chips carry visible text on neutral or semantic soft fills. Tabs use outlined pills with pale-gold active fill.

Navigation pairs icons and text; active groups use pale gold, with darker readable text. Sidebar subitems retain their hierarchy. Preserve the four Staff phone links and menu drawer behavior.

Home uses real See answer buttons inside question articles, with checked states and progress dots. Its date sits above the compact greeting; five Performance KPIs occupy one desktop row and wrap on phones. Concern cards and threads use the same warm surfaces, semantic status labels and shared entry drawer.

The supplied `public/images/chickens/chicken-{happy,alerted,annoyed,sad,sleepy,hello}.svg` assets and `logo-mark.svg` carry the chosen illustration language. Home mood explanations and life-stage labels remain text; the new assets vary mood, not separate chick/pullet/ready sprite columns. Login and welcome use hello; password focus uses sleepy. Faint footprints remain behind content on all signed-in routes.

The companion greeting and floating feather add short or passive movement. The stylesheet disables CSS animation, transitions and smooth scrolling for reduced motion; welcome uses immediate scroll and opaque content. Supplied SVG assets also contain their own internal reduced-motion media overrides. Runtime preference behavior was not independently tested. The Concern helper sits in normal flow after thread/status controls, preserving Add reply; elsewhere the fixed helper avoids visible controls while scrolling.

## Do's and Don'ts

- **Do** use the approved cream, off-white, gold and locally hosted Poppins across app sections.
- **Do** preserve the supplied animated SVG chickens, logo and quiet footprint canvas.
- **Do** preserve readable state labels, visible focus and reduced-motion handling.
- **Do** keep daily recorded P&L distinct from completed batch profit and device previews explicitly labeled.
- **Don't** restore the superseded charcoal calendar, egg-shaped financial totals or sprite-column companion art.
- **Don't** add a bottom tab bar to Staff phones or replace the centered striped Login composition.
- **Don't** turn visual role controls or local previews into claims of server authorization or completed shared workflows.
