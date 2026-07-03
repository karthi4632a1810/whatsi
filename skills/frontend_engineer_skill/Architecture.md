# Project Architecture - Module & Folder Specifications

**Related:** [[CSS Philosophy]] · [[Performance]] · [[JavaScript Style]] · [[Developer Profile]]

This document catalogs the project directory organization, dependencies, routing boundaries, and slice states.

---

## 1. Directory Blueprint

```
transvaal-infotech/
├── public/                       # Static public assets (APK, images, videos)
│   ├── images/                   # Custom curved background assets & SVG masks
│   └── video/                    # Transvaal background intro video loops
├── src/
│   ├── assets/                   # Static theme styling & side plugins
│   │   ├── css/                  # Custom CSS sheets
│   │   │   ├── Home.css          # Monolithic stylesheet for Home page sections
│   │   │   └── Contact.css       # Stylesheet for Contact page features
│   │   ├── loader-plugin/        # Standalone preloader script & styles
│   │   └── logo-dark.svg         # Brand Logo Vector asset
│   ├── components/               # Modular presentation UI blocks
│   │   ├── about/                # Story, Customer components
│   │   ├── contact/              # Section_1, Leaflet Map components
│   │   ├── home/                 # Blog, Team, Service, CTA components
│   │   ├── service/              # Intro, DigitalMarketing layout components
│   │   └── Banner.jsx            # Shared page title banner
│   ├── pages/                    # High-level route views (Home, About, etc.)
│   ├── store/                    # Redux Toolkit global slices
│   │   ├── index.js              # Store configuration setup
│   │   └── themeSlice.js         # UI Dark/Light toggle slice
│   ├── App.css                   # Main application overrides
│   ├── App.jsx                   # Routing, global observers & listeners
│   ├── index.css                 # Global CSS variables & typography imports
│   ├── main.jsx                  # Root React mounting with Bootstrap import
│   ├── Header.css                # Styling overrides for site header
│   ├── Header.jsx                # Responsive header navigation
│   ├── Footer.css                # Styling overrides for site footer
│   └── Footer.jsx                # Site footer links
```

---

## 2. Global State Specifications: Redux Toolkit

The developer configures a lightweight Redux store to manage UI theme state (light vs. dark mode):

### 1. Store Config (`store/index.js`)
Configures the global state tree, registering the theme slice reducer.
```javascript
import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './themeSlice';

const store = configureStore({
  reducer: {
    theme: themeReducer,
  },
});

export default store;
```

### 2. Slice Actions & Local Storage Reducer (`store/themeSlice.js`)
- **Initial Theme Reader (`getInitialTheme`)**:
  - Automatically queries the browser's `localStorage` for the key `'theme'`.
  - Fallback logic: If the key `'theme'` is not set, defaults the UI to `'dark'`.
- **Theme Slice Reducers**:
  - `toggleTheme`: Switches active theme string between `'light'` and `'dark'`, and updates `localStorage`.
  - `setTheme`: Overrides active theme string with the action payload, and updates `localStorage`.

```javascript
import { createSlice } from '@reduxjs/toolkit';

const getInitialTheme = () => {
  const savedTheme = localStorage.getItem('theme');
  return savedTheme ? savedTheme : 'dark';
};

const themeSlice = createSlice({
  name: 'theme',
  initialState: {
    theme: getInitialTheme(),
  },
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', state.theme);
    },
    setTheme: (state, action) => {
      state.theme = action.payload;
      localStorage.setItem('theme', state.theme);
    },
  },
});

export const { toggleTheme, setTheme } = themeSlice.actions;
export default themeSlice.reducer;
```

---

## 3. Package & Dependency Catalog

The application runs on Vite 6.0, leveraging standard dependencies for components, routing, and styling:

### Core Dependencies (`package.json`)
*   **React (`^18.3.1`)**: Component UI generation.
*   **React DOM (`^18.3.1`)**: Real-DOM lifecycle updates.
*   **React Router DOM (`^7.1.3`)**: Routing and page navigation.
*   **React Redux (`^9.2.0`) & Redux Toolkit (`^2.5.0`)**: Global UI theme states.
*   **Bootstrap (`^5.3.3`)**: Grid layout, columns, and flex wrappers.
*   **Swiper (`^11.2.1`)**: Responsive touchscreen carousels.
*   **Leaflet (`^1.9.4`) & React Leaflet (`^4.2.1`)**: Interactive maps.

### Dev Dependencies
*   **Vite (`^6.0.5`)**: Development server and production builds.
*   **ESLint (`^9.17.0`)**: Code style verification.
*   **PostCSS (`^8.5.1`) & Autoprefixer (`^10.4.20`)**: Cross-browser CSS compile prefixes.
*   **TailwindCSS (`^4.0.0`)**: Present in build dependencies, but custom designs are styled using vanilla CSS overrides.

