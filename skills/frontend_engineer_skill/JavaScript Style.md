# JavaScript Style & Thinking - Code Architecture Specs

**Related:** [[Architecture]] · [[Performance]] · [[Reusable Patterns]] · [[UX Decisions]]

This document provides a detailed breakdown of the developer's logic implementation patterns, asynchronous routines, and direct DOM scripting conventions.

---

## 1. Direct DOM Scripting inside React Hooks

A signature habit of this developer is directly targeting DOM elements using vanilla browser APIs instead of relying on React state management bindings. This pattern is implemented in several key sections:

### 1. Scroll-Direction Class Injections (`App.jsx`)
In `App.jsx`, page scrolls are handled by registering a global scroll listener inside a `useEffect` hook. Instead of updating component states, classes are added directly to the body element:

- **Logic**:
  - Initializes `lastScrollTop = 0`.
  - On scroll, checks current offset `scrollTop = window.scrollY || window.pageYOffset`.
  - Scroll direction check: `isScrollingDown = scrollTop > lastScrollTop`.
  - Condition: If `lastScrollTop > 100`, updates layout:
    - If scrolling down: Adds `scroll-down` class (hides header).
    - If scrolling up: Removes `scroll-down` class (reveals header).
  - Condition: If `lastScrollTop <= 100`, adds `scroll-on-top` class (resets header background to transparent).
  - Cleanups: Removes scroll event listener in return block.

```javascript
// Exact scroll listening block inside App.jsx
useEffect(() => {
  let lastScrollTop = 0;
  const handleScroll = () => {
    const scrollTop = window.scrollY || window.pageYOffset;
    const isScrollingDown = scrollTop > lastScrollTop;
    if (lastScrollTop > 100) {
      document.body.classList.remove('scroll-on-top');
      if (isScrollingDown) {
        document.body.classList.add('scroll-down');
      } else {
        document.body.classList.remove('scroll-down');
      }
    } else {
      document.body.classList.add('scroll-on-top');
    }
    lastScrollTop = scrollTop;
  };
  document.addEventListener('scroll', handleScroll);
  return () => {
    document.removeEventListener('scroll', handleScroll);
  };
}, []);
```

### 2. Service Tab Controller (`Service.jsx`)
Active service categories are updated by directly toggling visual styling classes on DOM nodes instead of updating React states:
- **Action**: Selecting a card triggers `handleService(pos, event)`:
  - Sets state attribute on target image: `document.querySelector('.service-bg').setAttribute('data-pos', pos);` (triggers CSS keyframe animation).
  - Clears active classes from navigation items: `document.querySelectorAll('.service-items').forEach(item => item.classList.remove('active'));`
  - Hides previous content sections: `document.querySelectorAll('.service-content-item').forEach(item => item.classList.add('d-none'));`
  - Highlights active selections: Adds `active` class to the clicked tab, and removes the `d-none` class from the corresponding content index.

---

## 2. ES6 Class Custom Plugin Design (`script.js`)

Complex behaviors are structured using ES6 Classes inside the loader plugin (`src/assets/loader-plugin/script.js`):

- **Constructor Configs**: Instantiates options to control viewports and callback scopes:
  - `showClass` / `hideClass`: CSS classes to toggle element visibility on enter/exit.
  - `rangeTop` / `rangeBottom`: Viewport offsets (in pixels) for triggering entering and exiting animations.
  - `setScrollUp` / `setScrollDown`: Callback functions triggered when scrolling direction changes.
- **Scroll Direction Observers**:
  - `handleScroll` checks scroll offsets against `lastScrollTop` to identify changes in direction.
  - Direction changes are routed through the `onScrollUp` or `onScrollDown` callback methods.

```javascript
// Exact ES6 PreLoader Class Constructor
class PreLoader {
    constructor(settings) {
        this.showClass = settings.showClass;
        this.hideClass = settings.hideClass;
        this.rangeTop = settings.rangeTop;
        this.rangeBottom = settings.rangeBottom;
        this.setImgLoaderBottomRange = settings.setImgLoaderBottomRange;
        this.lastScrollTop = 0;
        this.setScrollUp = settings.setScrollUp;
        this.setScrollDown = settings.setScrollDown;
    }
    // ...
}
```

---

## 3. Asynchronous Telegram Form Submission API

Form submissions are sent directly to a Telegram group chat using the Telegram Bot API inside `CallToAction.jsx`:

- **Credentials**:
  - Bot Token: `7705611985:AAHgqolW_zjqLOezUaB1TtJf1xdQ2-rAkDA`
  - Chat Group: `-1002266213746`
- **Submission Workflow**:
  - Intercepts default form submit using `e.preventDefault()`.
  - Appends visual loading state: `document.querySelector("[type='submit']").classList.add("loading");`
  - Constructs a Markdown payload:
    ```javascript
    const message = `
    🚀 *New Inquiry from Website* 🚀
    👤 *Name:* ${formData.name}
    📧 *Email:* ${formData.email}
    📞 *Phone:* ${formData.phone}
    💼 *Service:* ${formData.service}`;
    ```
  - Sends payload via a POST request using the Fetch API:
    - Endpoint: `https://api.telegram.org/bot${botToken}/sendMessage`
    - Configuration: `method: "POST"`, headers `Content-Type: application/json`, passing `chat_id`, `text`, and `parse_mode: "Markdown"`.
  - Transition Success: Once the fetch request completes, updates class properties:
    ```javascript
    setTimeout(() => {
        cta.classList.add("sended");
    }, 1000);
    ```

