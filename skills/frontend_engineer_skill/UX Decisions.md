# UX Decisions - Code & Interaction Details

**Related:** [[CSS Philosophy]] · [[UI Philosophy]] · [[JavaScript Style]] · [[Architecture]]

This document catalogs the developer's user experience details, form interactions, validation routines, and responsive transitions.

---

## 1. Contextual Form Animations (Character Tracking)

The character model in `CallToAction.jsx` acts as a visual guide that responds dynamically to user input:

### 1. Right Arm Pointer (`::after`)
The character's right arm rotates dynamically to point at the input container that currently has focus. This is achieved using CSS parent selectors:
- **Name Field Focus**:
  - Selector: `.cta .cta-img:has(#cta-name:focus) .cta-character::after`
  - Action: `transform: rotate(-37deg);` (points upward toward the top input field).
- **Email Field Focus**:
  - Selector: `.cta .cta-img:has(#cta-email:focus) .cta-character::after`
  - Action: `transform: rotate(-10deg);` (points toward the middle email input field).
- **Phone Field Focus**:
  - Selector: `.cta .cta-img:has(#cta-num:focus) .cta-character::after`
  - Action: `transform: rotate(20deg);` (points downward toward the phone input field).

```
[Name Field]   <--- (Focused) --- Arm points up (rotate -37deg)
[Email Field]  <--- (Focused) --- Arm points mid (rotate -10deg)
[Phone Field]  <--- (Focused) --- Arm points down (rotate 20deg)
```

### 2. Left Arm Success Feedback (`.left-hand`)
The character's left arm provides feedback based on form validation and submission states:
- **Default State**: Tilted outward: `transform: rotate(20deg);`.
- **Validation satisfied**:
  - Selector: `.cta .cta-img:has(#cta-name:valid):has(#cta-email:valid):has(#cta-num:valid) .left-hand`
  - Action: Rotates to a thumbs-up pose (`transform: rotate(-45deg);`) and shifts coordinates (`left: 14%`).
- **Submission Complete (`.cta.sended`)**:
  - Selector: `.cta.sended .cta-img .left-hand`
  - Action: Shifts to hold the thank-you screen inside the device frame (`transform: rotate(45deg); left: 17%`).

---

## 2. Interactive Input Status Indicators

Form validation states are updated in real-time using CSS selectors instead of custom JavaScript hooks:
- **Active Validation Outline**:
  - Selectors: `.cta input:valid`, `.cta select:valid`
  - Action: Transitions the bottom border to the brand's primary color: `border-bottom: 1px solid var(--primary-color) !important;`.
- **Preemptive Submit Prevention**:
  - Selector: `.cta .cta-img:not(:has(#cta-name:valid):has(#cta-email:valid):has(#cta-num:valid)) button`
  - Action: Appends `filter: grayscale(1); pointer-events: none;` (turns the submit button gray and disables click interactions until validation is satisfied).
- **Regex Validation Patterns**:
  - Name: `pattern='^\w+(.*?)'` (requires text content).
  - Email: `pattern="[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"` (requires standard email formatting).
  - Phone: `pattern="\d{10,}"` (requires at least 10 digits).

---

## 3. Mobile Navigation Transitions

- **Ripple Menu Reveal**: Mobile navigations use a smooth circular clip-path transition that ripples outward from the hamburger menu instead of a standard side-slide:
  - Menu Hidden: `clip-path: circle(0px at calc(100% - 25px) 35px);` (collapses menu to a tiny point at the top right header area).
  - Menu Shown (`.menu-open` class): `clip-path: circle(150% at calc(100% - 25px) 35px);` (expands container outward in a circular ripple, revealing navigation links).
- **Submenu Slide Flow**: When selecting sub-services on mobile viewports (`width < 1200px`), navigation items slide off-screen:
  - Selector: `.navlinks-sub-active > .navlink`
  - Action: Translates elements off-screen left: `transform: translateX(-100%);` with a `0.3s` easing transition.
  - Submenu Dropdown: `.navlinks-sub-active .drop-down` translates in from the right: `transform: translateY(-50%) translateX(0px);`.

---

## 4. Scroll-Direction Layout Adjustments

The scroll listener in `App.jsx` dynamically updates classes on `document.body` to optimize screen real estate:
- **Scrolling Down**: Adds `scroll-down` class, hiding the fixed header to maximize reading area.
- **Scrolling Up**: Removes `scroll-down` class, instantly revealing the header to provide quick access to navigation links.
- **At Top**: Adds `scroll-on-top` class, resetting the header background to transparent so it blends cleanly with the main page banner.

