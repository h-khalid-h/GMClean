# Contributing to GMClean

Thank you for your interest in contributing to GMClean! This document provides guidelines for contributing to the project.

## Development Setup

```bash
git clone https://github.com/h-khalid-h/GMClean.git
cd GMClean
npm install
cp .env.example .env.local
# Edit .env.local with your ENCRYPTION_SECRET (generate with: openssl rand -base64 32)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start developing.

## Project Structure

```
src/
├── app/
│   ├── api/              # Next.js API routes (IMAP, OAuth, AI)
│   │   ├── ai/classify/  # Gemini AI classification proxy
│   │   ├── auth/         # OAuth callback handlers
│   │   └── mail/         # IMAP sync, actions, folders
│   ├── globals.css       # Design tokens & global styles
│   ├── layout.tsx        # Root layout with metadata
│   ├── page.module.css   # All component styles (CSS Modules)
│   ├── page.tsx          # Main SPA entry point
│   └── providers.tsx     # Error boundary wrapper
├── components/
│   ├── connection-screen.tsx   # Auth UI (OAuth + App Password)
│   ├── dashboard-screen.tsx    # Overview, analytics, email table
│   ├── error-boundary.tsx      # Global error recovery
│   ├── newsletter-screen.tsx   # Subscription manager + bulk actions
│   └── settings-drawer.tsx     # Settings panel
└── lib/
    ├── crypto.ts         # AES-256-CBC encryption for sessions
    ├── db.ts             # Dexie.js IndexedDB schema
    └── imap.ts           # ImapFlow wrapper (headers-only fetch)
```

## Code Guidelines

### General
- **TypeScript strict**: All code must pass `npx tsc --noEmit` with zero errors
- **No Tailwind**: We use vanilla CSS with CSS Modules (`page.module.css`)
- **Design tokens**: Use CSS custom properties from `globals.css` (e.g., `var(--primary)`, `var(--muted)`)
- **Privacy-first**: Never fetch email body content. Headers only.

### CSS
- All styles go in `src/app/page.module.css`
- Use existing CSS variables from `globals.css` for colors
- Mobile breakpoints: `768px` (tablet) and `480px` (phone)

### Components
- All components are client-side (`'use client'`)
- Use Lucide React for icons
- IndexedDB operations use Dexie.js (`src/lib/db.ts`)

### API Routes
- Include CSRF origin checks on all POST routes
- Validate and sanitize all user input
- DNS-check unsubscribe URLs to prevent SSRF

## Testing

```bash
# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Full build verification
npm run build
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Ensure all checks pass: `npx tsc --noEmit && npm run lint && npm run build`
5. Commit with a descriptive message
6. Push and open a Pull Request

## Design Principles

- **Privacy**: No telemetry, no analytics, no cloud storage
- **Local-first**: All data in IndexedDB, credentials in encrypted cookies
- **Headers-only**: Email bodies are never downloaded
- **Self-hosted**: Must work entirely on the user's machine
