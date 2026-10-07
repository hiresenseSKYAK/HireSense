# HireSense — Frontend

DFW tech job board built with React, TypeScript, and Vite.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)

### Installation

```bash
# 1. Navigate into the project folder
cd hiresense

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be running at **http://localhost:5173**

---

## Project Structure

```
hiresense/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── Icons.tsx           # All SVG icons
│   │   ├── JobCard.tsx         # Job listing row card
│   │   ├── JobCard.module.css
│   │   ├── MarketSidebar.tsx   # Market analysis sidebar
│   │   ├── MarketSidebar.module.css
│   │   ├── Navbar.tsx          # Top navigation bar
│   │   └── Navbar.module.css
│   ├── data/
│   │   └── mockData.ts         # All mock data (replace with API calls later)
│   ├── pages/
│   │   ├── HomePage.tsx        # Main job listings page
│   │   ├── HomePage.module.css
│   │   ├── JobDetailPage.tsx   # Individual job detail + interview
│   │   ├── JobDetailPage.module.css
│   │   ├── ResumePage.tsx      # Resume upload + analysis
│   │   └── ResumePage.module.css
│   ├── types/
│   │   └── index.ts            # TypeScript interfaces
│   ├── App.tsx                 # Route definitions
│   ├── index.css               # Global styles + CSS variables
│   └── main.tsx                # App entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Pages

| Route       | Page              | Description                                      |
|-------------|-------------------|--------------------------------------------------|
| `/`         | Home              | Search, filters, market sidebar, job listings    |
| `/resume`   | Upload Resume     | File upload, resume analysis, skill scores       |
| `/jobs/:id` | Job Detail        | Full JD, match score, AI practice interview      |

---

## Connecting to the Backend

All mock data lives in `src/data/mockData.ts`. When your Python backend is ready:

1. Create an `src/api/` folder with fetch helpers
2. Replace mock data imports in pages with API calls
3. Update the `Job` and other types in `src/types/index.ts` to match your DB schema

---

## Available Scripts

| Command         | Description                  |
|-----------------|------------------------------|
| `npm run dev`   | Start dev server             |
| `npm run build` | Build for production         |
| `npm run preview` | Preview production build   |
