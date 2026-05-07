# LinkedIn Toolkit

**The open-source alternative to Waalaxy and PhantomBuster.**
Take control of your LinkedIn -- no subscriptions, no tracking, no limits.

Everything runs locally in your browser. Your data never leaves your machine.

If you find this useful, please give it a star -- it helps others discover the project.

---

## Features

### Profile Export
Export any LinkedIn profile to JSON with a single click. Works from profile pages or search results. Get clean, structured data including name, title, company, location, skills, education, and more.

### Search & Export CSV
Search LinkedIn by keywords and export results to CSV. Paginated fetching with human-paced delays. Export 25 or 500 profiles -- your choice.

### Mass Unfollow
Unfollow everyone on your following list in one click. Uses DOM-based clicking with randomized delays to mimic human behavior. Includes pagination support for large lists.

### Campaign Manager
Build multi-step outreach sequences:
- **View Profile** -- warm up before connecting
- **Send Invite** -- with optional personalized note
- **Send Message** -- to existing connections
- **Wait** -- configurable delay between steps

Campaigns run automatically during business hours with rate limiting. Template variables (`{{firstName}}`, `{{company}}`, etc.) for personalization.

### Quick Actions
Send connection invites or messages directly from the popup when viewing a profile.

### Smart Rate Limiting
- Configurable min/max delays with jitter
- Hourly action caps
- Daily invite and message quotas
- Business hours window (weekdays only option)
- Automatic backoff on LinkedIn rate limits (429)
- Security challenge detection (451)

---

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `linkedin-toolkit` folder
5. The extension icon appears in your toolbar

---

## Usage

### Export a Profile
1. Navigate to any LinkedIn profile
2. Click the extension icon
3. Click **Export Current Profile (JSON)**
4. A JSON file downloads with the full profile data

### Search & Export
1. Click the extension icon
2. Enter keywords (e.g., "CTO fintech London")
3. Set the result count
4. Click **Search & Export CSV**
5. A CSV file downloads with all results

### Mass Unfollow
1. Click the extension icon
2. Expand the **Mass Unfollow** section
3. Click **Check Count** to see how many people you follow
4. Click **Unfollow All** to start unfollowing
5. Watch the progress bar -- the process runs with 2-5 second delays

### Create a Campaign
1. Click the extension icon
2. Expand the **Campaign Manager** section
3. Enter a campaign name
4. Add steps (view profile, send invite, send message, wait)
5. Use template variables in messages: `{{firstName}}`, `{{lastName}}`, `{{fullName}}`, `{{company}}`, `{{title}}`, `{{headline}}`
6. Click **Create Campaign**
7. The campaign runs automatically every 5 minutes during business hours

### Configure Settings
1. Click the extension icon
2. Expand the **Settings** section
3. Adjust delays, rate limits, and business hours
4. Click **Save Settings**

Or open the full settings page: right-click the extension icon > Options

---

## Disclaimer

**THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.** The authors and contributors of this project accept **no responsibility or liability** for any consequences arising from the use of this extension, including but not limited to:

- LinkedIn account restrictions, suspensions, or permanent bans
- Loss of connections, data, or account access
- Violation of LinkedIn's Terms of Service or User Agreement
- Any direct, indirect, incidental, or consequential damages

**By using this extension, you acknowledge that:**
1. LinkedIn's Terms of Service prohibit automated tools and scraping
2. Using this extension may result in action against your LinkedIn account
3. You are solely responsible for any actions taken with this tool
4. The authors bear no responsibility for how you use it
5. You use this extension entirely at your own risk

This tool is provided for educational and research purposes. We do not encourage or endorse violation of any platform's terms of service.

---

## Safety & Rate Limiting

**Risk mitigation built in:**
- Human-paced random delays between all actions (8-15 seconds default)
- Hourly and daily rate caps
- Business hours enforcement
- Automatic backoff when LinkedIn returns rate limit responses
- Security challenge detection with automatic pause

**Recommendations:**
- Start with conservative settings
- Don't run multiple automation tools simultaneously
- Keep daily invite count under 25
- Don't automate on a brand-new or low-activity account
- Monitor your account for restriction notices

---

## How It Works

### Voyager API
LinkedIn's web app communicates with its backend via the Voyager API (`/voyager/api/`). This extension makes the same requests your browser would, using your existing session cookies (JSESSIONID) for authentication. No external APIs, no proxies, no third-party servers.

### DOM Automation
Some features (like Mass Unfollow) use DOM-based automation -- the extension finds buttons on the page and clicks them using `dispatchEvent`, simulating real user interactions in the MAIN world context.

### Architecture
- **Service Worker** (`src/background/`) -- handles all API calls, campaign scheduling, rate limiting
- **Content Scripts** (`src/content/`) -- inject UI overlays on LinkedIn pages
- **Popup** (`src/popup/`) -- main control panel
- **Options** (`src/options/`) -- full settings page

All data is stored in `chrome.storage.local` -- nothing leaves your browser.

---

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test thoroughly with a LinkedIn account you can afford to lose
5. Submit a pull request

### Development
- No build step required -- load the extension directly as unpacked
- Manifest V3 with ES modules
- No external dependencies

---

## License

MIT License -- see [LICENSE](LICENSE) for details.

---

## Credits

Built and open-sourced by [Dominic Gonsalves](https://www.linkedin.com/in/dominic-g-6a9a5680/).

If you find this tool useful, connect with me on [LinkedIn](https://www.linkedin.com/in/dominic-g-6a9a5680/).
