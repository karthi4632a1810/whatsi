# CSS Philosophy - Pixel-Level Stylesheet Specifications

**Related:** [[UI Philosophy]] · [[Architecture]] · [[JavaScript Style]] · [[Performance]]

This document catalogs the developer's styling conventions, color systems, typography choices, and animations, extracted from `index.css`, `Home.css`, `Header.css`, and `Footer.css`.

---

## 1. Typography & Font System

The typography is structured around three Google Font families, configured to establish clear visual hierarchy:

- **Headings Font**: `Young Serif`, serif (used on `h1`, `h2`, `h3`, `h4`, `h5`, `h6`). It features auto optical sizing to scale letter details at high display sizes.
- **Body Font**: `Montserrat`, sans-serif (declared at `:root` level with default weight `400` and line-height `1.5`).
- **Accent/Layout Font**: `Lexend`, sans-serif (imported in root `index.html` to style metrics, stats, and badges).
- **Hero Title Font**: `Impact`, sans-serif (wavy background watermark title scaling).

---

## 2. Color System & Variable Palette

Colors are structured using customized HSL parameters to easily define secondary states (like hover borders, transparent glows, and deep background layers):

```css
:root {
  --primary-color: #c76223; /* Brand Primary Orange */
}
```

Within components, color systems are mapped to local scopes to manage transitions cleanly:
- **Primary Buttons (`.custom-btn`)**:
  - Main Background: `var(--k)` defined as `hsl(23, 70%, 50%)`.
  - Border and Base Shadow: `var(--kk)` defined as `hsl(23, 70%, 20%)`.
  - Shadow Glow: `var(--kkk)` defined as `hsla(23, 70%, 50%, 0.245)`.
- **Secondary Buttons (`.follow-btn`)**:
  - Base Color: `var(--btn-color)` defined as `hsl(0, 0%, 5%, 0.3)`.
  - Icon Hover: Transitions to `var(--primary-color)`.
- **System Themes**:
  - `body.light`: Background is solid `white`, text color is deep charcoal `hsl(0, 0%, 10%)`.
  - `body.dark`: Background is near-black `hsl(0, 0%, 7%)`, text color is off-white `hsl(0, 0%, 95%)`.
  - `.blog-box` and `.footer-dropdown`: Background is dark gray `hsl(0, 0%, 5%)`.

---

## 3. Pixel-Level Button Mechanics

### Tactile 3D Buttons (`.custom-btn`)
Buttons are styled to simulate a physical push-button switch when clicked:
- **Base Geometry**: Height is exactly `48px`, shape uses `transform: skew(-10deg)`. Border thickness is `2px solid var(--kk)`. Border-radius is `0.75rem` (12px).
- **Shadow Offset**: `box-shadow: 0 8px 0 var(--kk);` (creates a thick 3D base under the button).
- **Click Behavior (`:active`)**:
  - Push effect: `transform: skew(-10deg) translateY(8px);` (translates the button down by 8px, matching the height of the base shadow).
  - Shadow collapse: `box-shadow: 0 0 0 var(--kkk);` (clears the base shadow, creating a realistic mechanical press feeling).
  - Font tracking transition: `letter-spacing: 0px;` (collapses letters slightly on click, from a base letter spacing of `2px`).

```
Button Up State:
   +---------------+
  /  Click Here   /   <-- Button Body (skewed -10deg)
 +---------------+
 |###############|    <-- 8px Solid Base Shadow (box-shadow)
 +---------------+

Button Active State (Pressed):
                      (translates down by 8px)
   +---------------+
  /  Click Here   /   <-- Button Body
 +---------------+    <-- Base shadow collapsed to 0px
```

### Capsule Social Slider (`.follow-btn`)
- **Hover Reveal**: Inside `Header.jsx`, the button transitions content when hovered:
  - Base Padding: `15px 30px`. Font-size: `16px`. Line-height: `1`.
  - Default State: Standard label text is centered. Inner list links are shifted down via `transform: translateY(55px)`.
  - Hover State: Standard labels shift up via `transform: translateY(-55px)`. Inner links translate up to `translateY(0)`, revealing social icons (Facebook, Instagram, LinkedIn).
  - Timing Function: `transition: 0.3s cubic-bezier(0.215, 0.61, 0.355, 1);` (an ease-out cubic curve that speeds up initial translation and slows down towards completion).

---

## 4. Keyframe Animations & Easing Curves

Animations are configured locally using custom variables to manage duration and timing functions:

- **Local Animation Variables**:
  - `--ani-timing-function: ease-out;`
  - `--ani-dur: 500ms;`
  - `--ani-offset: 3rem;`

### Keyframe Catalog

#### 1. Circular mobile menu ripple reveal (`clip-path`)
- **Menu Close**: `clip-path: circle(0px at calc(100% - 25px) 35px);` (collapses menu to a tiny point at the top right header area).
- **Menu Open**: `clip-path: circle(150% at calc(100% - 25px) 35px);` (expands container outward in a circular ripple, revealing navigation links).
- **Toggle Rotation**: Menu icons rotate via `transform: rotate(-360deg)` over `0.5s` during class swaps.

#### 2. Interactive Service Image Assembly (`.service-bg`)
- Target: `.service-bg` contains 13 layered SVG background images.
- Transition: When `data-pos` changes, keyframe animations shift background positions from off-screen offsets (`--s: 700px`) to page alignments (`50%` or `100%` width).
- Keyframe `service-1` (First position active):
  - `0%`: Background-size: `100%, 100%, 0%`. Positions shifted to `left calc(1 * var(--s)) center` (700px offset).
  - `30%`: First elements align to `left 50% center`.
  - `100%`: Background-size: `100%, 100%, 100%` (reveals the final background layers).
- Timing Curve: Configured using `1.5s cubic-bezier(0.175, 0.885, 0.32, 1.1)` (an anticipatory back-out ease that slightly overshoots its target coordinate before settling).

#### 3. Swinging Testimonials (`testi-line` & `testi-profile`)
- **Hanging String (`testi-line`)**:
  - Animation: `testi-line 1s infinite alternate;`
  - Transform Origin: `left top -100px;` (sets rotation anchor point above the viewport).
  - Keyframe step: `0% { transform: translateX(-50%) rotate(-1deg); }` to `100% { transform: translateX(calc(-50% - 2px)) rotate(1deg); }`.
- **Hanging Profile Avatar (`testi-profile`)**:
  - Animation: `testi-profile 1s infinite alternate;`
  - Transform Origin: `left top -500px;`
  - Keyframe step: `0% { transform: translateX(-50%) rotate(-1deg); }` to `100% { transform: translateX(calc(-50% - 5px)) rotate(1deg); }`.

#### 4. Wavy Header Watermark
- **Element**: `.banner h1::before`
- **Effect**: Uses `content: attr(data-text)` to copy the header title.
- **Positioning**: Centered absolute (`left: 50%`, `top: 50%`, `transform: translate(-50%, -50%) scale(3)`).
- **Opacity**: `0.1` (creates a large, subtle translucent background watermark).

