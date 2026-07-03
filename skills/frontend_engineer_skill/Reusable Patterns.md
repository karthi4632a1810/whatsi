# Reusable Patterns & Blueprints - Full Code Templates

**Related:** [[CSS Philosophy]] · [[JavaScript Style]] · [[Performance]] · [[UI Philosophy]]

This document details the code templates, styles, and markup patterns used throughout the project.

---

## 1. Asynchronous Telegram Form Submission API (Serverless CRM)

This template handles form data validation, submits details to a Telegram group chat, and manages loading and success states.

### React Component Layout
```javascript
import React, { useState } from 'react';

function CustomInquiryForm() {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        service: 'Digital Marketing'
    });

    const botToken = "YOUR_TELEGRAM_BOT_TOKEN";
    const chatId = "YOUR_TELEGRAM_GROUP_CHAT_ID";

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Direct DOM manipulation to trigger submit loading state
        const submitBtn = document.querySelector("[type='submit']");
        const formWrapper = document.querySelector(".inquiry-wrapper");
        if (submitBtn) submitBtn.classList.add("loading");

        const textMessage = `
🚀 *New Inquiry from Website* 🚀
👤 *Name:* ${formData.name}
📧 *Email:* ${formData.email}
📞 *Phone:* ${formData.phone}
💼 *Service:* ${formData.service}
        `;

        const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

        try {
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: textMessage,
                    parse_mode: "Markdown"
                })
            });
            setTimeout(() => {
                if (formWrapper) formWrapper.classList.add("sended");
            }, 1000);
        } catch (error) {
            console.error("Error submitting inquiry:", error);
            if (submitBtn) submitBtn.classList.remove("loading");
        }
    };

    return (
        <div className="inquiry-wrapper">
            <form onSubmit={handleSubmit}>
                <div className="form-floating mb-3">
                    <input 
                        required 
                        pattern="^\w+(.*?)" 
                        type="text" 
                        className="form-control" 
                        id="cta-name" 
                        name="name" 
                        placeholder="Your Name" 
                        onChange={handleChange} 
                    />
                    <label htmlFor="cta-name">Your Name</label>
                </div>
                <div className="form-floating mb-3">
                    <input 
                        required 
                        pattern="[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" 
                        type="email" 
                        className="form-control" 
                        id="cta-email" 
                        name="email" 
                        placeholder="name@example.com" 
                        onChange={handleChange} 
                    />
                    <label htmlFor="cta-email">Email address</label>
                </div>
                <div className="form-floating mb-3">
                    <input 
                        required 
                        pattern="\d{10,}" 
                        type="tel" 
                        className="form-control" 
                        id="cta-phone" 
                        name="phone" 
                        placeholder="Phone Number" 
                        onChange={handleChange} 
                    />
                    <label htmlFor="cta-phone">Phone Number</label>
                </div>
                <button type="submit" className="custom-btn w-100">Submit</button>
            </form>
        </div>
    );
}

export default CustomInquiryForm;
```

---

## 2. Dynamic Star Rating CSS Pattern

This CSS pattern renders an active overlay of colored stars over a row of empty white stars, using a single `--rating` CSS variable passed from React.

### React Component Usage
```javascript
import React from 'react';

function StarRating({ rating }) {
    return (
        <div className="rating-container">
            {/* Inject rating variable as inline CSS style custom property */}
            <div className="stars" style={{ "--rating": rating }}></div>
        </div>
    );
}

export default StarRating;
```

### CSS Style rules
```css
/* Container for rating stars */
.stars {
    height: 20px;
    width: 100px;
    background-image: url(https://api.iconify.design/ic:round-star.svg?color=white);
    background-position: left center;
    background-size: 20px;
    background-repeat: repeat-x;
    position: relative;
}

/* Dynamic overlay based on --rating variable scale */
.stars::after {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    width: calc((100% / 5) * var(--rating));
    height: 100%;
    background-image: url(https://api.iconify.design/ic:round-star.svg?color=%23c76223);
    background-position: left center;
    background-size: 20px;
    background-repeat: repeat-x;
}
```

---

## 3. Pill-Shaped Capsule Link Row

Rounding the outer corners of list items on desktop, transitioning to rounded borders on mobile:

```css
.links-bar {
    display: flex;
    flex-direction: row;
}

.links-bar .link-item {
    background-color: hsl(0, 0%, 10%);
    padding: 14px 25px;
    transition: 0.3s;
    text-decoration: none;
}

.links-bar .link-item:hover {
    background-color: var(--primary-color) !important;
}

/* Round outer corners on desktop */
@media (width > 1200px) {
    .links-bar .link-item:first-child {
        border-radius: 100vw 0 0 100vw;
    }
    .links-bar .link-item:last-child {
        border-radius: 0 100vw 100vw 0;
    }
}

/* Round stack borders on mobile */
@media (width < 1200px) {
    .links-bar {
        flex-direction: column;
    }
    .links-bar .link-item:first-child {
        border-radius: 1rem 1rem 0 0;
    }
    .links-bar .link-item:last-child {
        border-radius: 0 0 1rem 1rem;
    }
}
```

---

## 4. Curved Section Frame Cutouts

The layout patterns for curved headers and footers using clip-paths to break up straight lines:

```css
/* Top header curved section cutout */
.top-curved-banner {
    background-color: black;
    clip-path: ellipse(150% 100% at 50% 0%);
}

/* Bottom footer curved section cutout */
.bottom-curved-footer {
    background-color: black;
    clip-path: ellipse(150% 100% at 50% 100%);
}
```

