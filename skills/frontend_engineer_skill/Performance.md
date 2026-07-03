# Performance Optimization Techniques - Code-Level Specs

**Related:** [[CSS Philosophy]] · [[JavaScript Style]] · [[Architecture]] · [[Weaknesses]]

This document catalogs the custom rendering logic, lazy loaders, viewport triggers, and asset optimization techniques configured in the project.

---

## 1. Native Image Lazy-Loading Observer

The developer optimizes initial page loads by writing a custom image preloader that uses the native browser `IntersectionObserver` API inside `App.jsx`.

### Setup Specifications
- **Trigger Element**: Target elements must declare a custom `img-loader` attribute containing the target image URL (instead of standard `src` tags).
- **Observer Boundaries (`rootMargin`)**: Set to `'0px 0px 300px 0px'`.
  - **Pixel Translation**: Images are fetched and rendered `300px` before their top bounding box enters the bottom edge of the browser viewport.
- **Resource Swapping Routine**:
  1. Once the element intersects (`entry.isIntersecting === true`), the target element is loaded: `const img = entry.target;`.
  2. The actual image URL is written to `src`: `img.src = img.getAttribute('img-loader');`.
  3. A loading indicator class is added: `img.classList.add('loaded');` (triggers a CSS fade-in transition).
  4. The temporary attribute is removed: `img.removeAttribute('img-loader');`.
  5. The target is unobserved: `imgObserver.unobserve(img);` (stops background coordinate checking, freeing up main-thread resources).

```javascript
// Native Lazy Loading Configuration
const imgObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.getAttribute('img-loader');
      img.classList.add('loaded');
      img.removeAttribute('img-loader');
      imgObserver.unobserve(img);
    }
  });
}, {
  rootMargin: '0px 0px 300px 0px',
});
```

---

## 2. Scroll-Driven Preloader animations (`PreLoader` Class)

The custom `PreLoader` class inside `script.js` manages scroll-driven enter/exit transitions:
- **Math Boundary Calculations**:
  - Calculates when elements enter the viewport: `window.scrollY < farFromTop + pre.clientHeight - this.rangeTop && window.scrollY > farFromTop + (-window.innerHeight + this.rangeBottom)`.
  - `farFromTop`: Distance from target element offset to body top (`pre.offsetTop`).
  - `rangeTop`: Target vertical offset buffer.
  - `rangeBottom`: Bottom viewport buffer.
- **Dynamic Class Alteration**:
  - Toggles CSS animations when scroll coordinates fall within target boundaries.
  - Toggles classes using custom data attributes: `(pre.getAttribute('data-show-class')) ? pre.classList.add(pre.getAttribute('data-show-class')) : pre.classList.add(this.showClass);`.
  - This avoids constant React state re-renders of elements, utilizing simple CSS class transitions.

---

## 3. Hardware-Accelerated Animation Pipeline

Animations are optimized to run smoothly at 60fps by targeting hardware-accelerated CSS properties:

- **Viewport Transforms**: Animation keyframes (`fadePopupShow`, `fadePopupHide`, `bounceUp`) target `transform: translateY(...)` and `opacity` properties. This allows layout shifts to bypass recalculating document flow, moving layout operations to the GPU.
- **Rendering Offloads**: Properties like `translate` and `scale` are applied over elements to offload rendering operations from the CPU to the GPU.
- **Clip-Path Interpolations**: Mobile menus utilize `clip-path` ripple math calculations. Browsers animate clip-path polygon points using hardware acceleration, preventing repaints of sub-elements.

---

## 4. Asset Delivery & CDN Caching

- **Iconify CDN Vector Masks**:
  - Social link graphics inside `Footer.jsx` are loaded as inline SVG maps, avoiding extra HTTP requests.
  - Navigation icons (hamburger menu, dropdown arrows, quote marks) use CSS `mask-image` linked directly to CDN endpoints (e.g. `url(https://api.iconify.design/hugeicons:menu-square.svg?color=%23d96b26)`). This keeps raw SVGs and heavy icon packages out of the production build.
- **Stadia Dark Tiles**:
  - Leaflet maps use `tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png` layers.
  - Map tiles are served via CDN, matching the application dark mode theme and preventing map operations from slowing down thread speeds.

