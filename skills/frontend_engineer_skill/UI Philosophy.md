# UI Design Philosophy - Pixel-Level Visual Specifications

**Related:** [[CSS Philosophy]] · [[UX Decisions]] · [[Reusable Patterns]] · [[Developer Profile]]

The developer designs interfaces using a philosophy defined as **Organic Modernism**. They reject standard flat layouts, opting instead for curves, organic SVG silhouettes, overlapping elements, and highly tactile interactive guides.

---

## 1. Dimensional Layout & Geometry

### Curved Page Segments (Ellipse Masking)
The pages are framed using curved boundaries instead of standard horizontal dividers. This is achieved using precise CSS `clip-path` parameters:
- **Top Banner Frame**:
  - Element: `.banner` (used in [[Architecture]] across subpages)
  - Styling: `clip-path: ellipse(150% 100% at 50% 0%);`
  - Visual Effect: Creates a downward-facing curve originating from the top center (X: 50%, Y: 0%) extending to 150% horizontal width.
- **Bottom Footer Frame**:
  - Element: `footer` (global layout container)
  - Styling: `clip-path: ellipse(150% 100% at 50% 100%);`
  - Visual Effect: Creates an upward-curved frame originating from the bottom center (X: 50%, Y: 100%).

```
   [0,0] +------------------[50%,0]-------------------+
         | \         Clip Ellipse Curve              / |
         |  \_______________________________________/  |
         |                                             |
         |               Page Body Content             |
         |   _______________________________________   |
         |  /                                       \  |
         | /         Clip Ellipse Curve              \ |
 [0,100] +-----------------[50%,100]------------------+
```

### Organic Team Bios (Silhouette Masks)
Team member pictures are clipped using custom-curved shape vectors as CSS masks instead of standard square boundaries:
- **Profile 1**: `.team .team-box:nth-child(1) .team-profile`
  - Property: `mask-image: url(/images/team-1.svg);`
  - Geometry: Aspect ratio is exactly `161/202` (width-to-height ratio).
- **Profile 2**: `.team .team-box:nth-child(2) .team-profile`
  - Property: `mask-image: url(/images/team-2.svg);`
- **Profile 3**: `.team .team-box:nth-child(3) .team-profile`
  - Property: `mask-image: url(/images/team-3.svg);`

### Contact Capsule Cards (`.puz` Containers)
The contact info list cards under `Section_1.jsx` use a square aspect ratio:
- **Dimensions**: Width is exactly `300px`, height auto-adjusts using `aspect-ratio: 1 / 1`.
- **Border Radius**: Set to `border-radius: 1.5rem` (24px) for smooth edges.
- **Transitions**: Background-color changes over a `0.3s` linear scale when hovered.

---

## 2. Spatial Hierarchy & Elements Alignment

### Overlapping Grid Cards (The Team Row)
On desktop viewports (`width > 1200px`), card layouts shift to create a stacked, overlapping card structure:
- **Left Bio Overlap**: `.team .team-box:nth-child(1) .team-profile`
  - Rule: `translate: 22% 0px;` (pushes card `22%` of its width to the right, layering it on top of the middle card).
- **Right Bio Overlap**: `.team .team-box:nth-child(3) .team-profile`
  - Rule: `translate: -22% 0px;` (pushes card `22%` to the left, layering it on top of the middle card).
- **Container Hover State**: `.team:hover .team-box:nth-child(1) .team-profile, .team:hover .team-box:nth-child(3) .team-profile`
  - Rule: `translate: 0px 0px !important;`
  - Transition: The layout expands outwards over a `0.3s` ease duration, creating an interactive card-spreading effect when the user hovers over the grid container.

```
Desktop Unhovered:
+-----------+        +-----------+        +-----------+
|  Card 1   |======>>|  Card 2   |<<======|  Card 3   |
| (shifted) |        | (layered) |        | (shifted) |
+-----------+        +-----------+        +-----------+

Desktop Hovered (Graceful Expansion):
+-----------+        +-----------+        +-----------+
|  Card 1   |        |  Card 2   |        |  Card 3   |
|  (0, 0)   |        |  (0, 0)   |        |  (0, 0)   |
+-----------+        +-----------+        +-----------+
```

### Segmented Footer capsule (`.footer-links`)
The footer links row matches the look of segmented buttons, rounding only the outermost corners on desktop:
- **First Link Cornering**: `.footer-links .footer-navlink:first-child .footer-nav-link-a`
  - Border-radius: `100vw 0 0 100vw` (creates a semi-circular left edge).
- **Last Link Cornering**: `.footer-links .footer-navlink:last-child .footer-nav-link-a`
  - Border-radius: `0 100vw 100vw 0` (creates a semi-circular right edge).
- **Inner Link Corners**: All middle elements use a border-radius of `0`, creating a single continuous capsule bar.
- **Mobile Adjustments (`width < 1200px`)**:
  - The row stacks vertically.
  - Border-radius changes to round only the top corners of the first link (`1rem 1rem 0 0`) and the bottom corners of the last dropdown link (`0 0 1rem 1rem`).

---

## 3. Interactive Character Guides

In `CallToAction.jsx`, the design includes an interactive character guide (`.cta-character` and `.left-hand`) positioned adjacent to the mobile input form frame:
- **Visual Alignment**:
  - Parent container: `.cta .cta-img` uses `position: relative` and `isolation: isolate` to contain visual layers.
  - Character Body: `.cta-character` is positioned absolute (`left: 8%`, `bottom: 10%`, `width: 20%`), with a static aspect-ratio of `101.56 / 288.73` and background image `/images/cta-body.svg`.
  - Right arm: `.cta-character::after` matches an aspect ratio of `96.79 / 57.08` using background image `/images/cta-right-hand.svg`, with transform-origin set to `left top`.
  - Left arm: `.left-hand` is positioned absolute (`left: 16%`, `bottom: 47%`, `width: 18%`), with an aspect ratio of `75.57 / 60.53` using background image `/images/cta-left-hand.svg`, with transform-origin set to `10% 46%`.

```
Character Layout Positioning:
+-------------------------------------------------------+
|  .cta-img (Parent Wrapper)                            |
|                                                       |
|   Left Arm (.left-hand)          Right Arm (::after)  |
|   [origin: 10% 46%]              [origin: left top]   |
|       \                              /                |
|      +-----+                    +-----+               |
|      |     |--------------------|     |               |
|      |     |   .cta-character   |     |               |
|      |     |   (Body Trunk)     |     |               |
|      +-----+                    +-----+               |
+-------------------------------------------------------+
```

- **Hover & Focus Interactions**:
  - Name Focus: `.cta-img:has(#cta-name:focus) .cta-character::after` triggers `transform: rotate(-37deg)`. (The arm points up toward the Name field).
  - Email Focus: `.cta-img:has(#cta-email:focus) .cta-character::after` triggers `transform: rotate(-10deg)`. (The arm points toward the middle Email field).
  - Phone Focus: `.cta-img:has(#cta-num:focus) .cta-character::after` triggers `transform: rotate(20deg)`. (The arm points down toward the Phone field).
  - Form validation satisfy: `.cta-img:has(#cta-name:valid):has(#cta-email:valid):has(#cta-num:valid) .left-hand` triggers `transform: rotate(calc(1 * -45deg))` and shifts coordinates to `left: 14%`. (The character shifts its posture to show a thumbs-up).

