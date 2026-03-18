# StorageOS | Disk Usage Dashboard

A modern, blazing-fast, server-rendered static web dashboard designed to visualize massive amounts of JSON disk usage reports. Built with a "Pro VIP" UI/UX focusing on glassmorphism, fluid animations, and absolute performance.

## ✨ Features

- **Instant Load Architecture:** Avoids browser HTTP limits by aggregating data via a lightweight PHP backend (`api.php`), resulting in load times orders of magnitude faster than frontend-only fetching.
- **Glassmorphic UI:** Modern dark theme utilizing advanced CSS background-filters, CSS variables, and fluid Grid layouts.
- **Interactive Dashboards:** Powered by Chart.js (Line, Doughnut, Horizontal Bar).
- **Responsive Design:** Adapts fluidly from ultra-wide enterprise monitors to mobile viewports.
- **Auto-Sync:** Data automatically loads upon visiting the URL without requiring user interaction.

## 🏗️ Architecture Stack

- **Frontend:** HTML5, Vanilla JavaScript (ES6+), Vanilla CSS3.
- **Backend:** PHP 8+ (for JSON file aggregation).
- **Charting:** Chart.js via CDN.

## 🚀 Setup & Deployment

1. **Clone the repository:**
   ```bash
   git clone https://github.com/hyhy2001/disk_usage.git
   ```
2. **PHP Requirement:** Ensure `php-fpm` (or mod_php) is installed and running on your Linux web server (Nginx or Apache).
3. **Data Configuration:** Open `disks.json` to map your disk configurations and directory paths.
4. **Permissions:** Ensure your Web Server process (e.g., `www-data` or `nginx`) has **Read** permission to access the data directories specified in your config.
5. **Launch:** Access the `/index.html` URL in a browser. The dashboard will instantly process all JSONs and render the charts.

## 📂 File Structure Overview

```text
/
├── index.html           # Main dashboard container
├── api.php              # PHP Endpoint: Aggregates JSON reports blazingly fast
├── disks.json           # Disk directory mappings and configurations
├── css/                 # Modern styling (Variables, Grid Layout, Glass panels)
└── js/                  # Application logic (DataStore, Fetcher, Charts)
```

---

_Developed with focus on Enterprise UI/UX Compliance and High-Performance I/O._
