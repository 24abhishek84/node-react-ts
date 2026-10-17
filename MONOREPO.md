# TaskFlow – Monorepo Setup

This is a full-stack application with a root-level package.json configured as a Node workspace.

## Quick Start

### Install dependencies for all packages:
```bash
npm install
```

### Development - Run both server and client together:
```bash
npm run dev
```
This starts:
- **API Server** on `http://localhost:3000` (Express with TypeScript)
- **React UI** on `http://localhost:5173` (Vite with React 19)

The client automatically proxies `/api/*` requests to the server.

### Production Build
```bash
npm run build
```

### Run production server
```bash
npm start
```

### Run tests
```bash
npm test
```

## Project Structure

```
taskflow/
├── server/                    # Node.js/Express backend
│   ├── src/
│   │   ├── config.ts         # Configuration & environment validation
│   │   ├── logger.ts         # Logging with request context
│   │   ├── db.ts             # PostgreSQL connection & migrations
│   │   ├── errors.ts         # Custom error classes
│   │   ├── events.ts         # Event bus
│   │   ├── app.ts            # Express app factory
│   │   ├── server.ts         # Server entry point
│   │   ├── middleware/       # Express middleware
│   │   └── modules/
│   │       ├── auth/         # Authentication (JWT, bcrypt)
│   │       └── tasks/        # Task management
│   ├── dist/                 # Compiled JavaScript (generated)
│   ├── tsconfig.json
│   └── package.json
│
├── client/                    # React frontend
│   ├── src/
│   │   ├── main.tsx          # React entry point
│   │   ├── App.tsx           # Main component
│   │   └── api.ts            # API client with token refresh
│   ├── index.html
│   ├── vite.config.ts        # Vite config with API proxy
│   ├── tsconfig.json
│   └── package.json
│
├── package.json              # Root workspace config
└── README.md
```

## Workspace Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install all dependencies for server & client |
| `npm run build` | Build both server & client |
| `npm run dev` | Run server & client concurrently |
| `npm start` | Run production server |
| `npm test` | Run server tests |
| `npm run clean` | Remove all build artifacts & node_modules |

### Run workspace-specific commands:
```bash
npm run dev -w server      # Only run server dev
npm run dev -w client      # Only run client dev
npm run build -w server    # Only build server
```

## Environment Setup

### Create `.env` file in `server/`:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://taskflow:taskflow@localhost:5433/taskflow
JWT_SECRET=your-secret-key-here-min-16-chars
```

### Start PostgreSQL (if using Docker):
```bash
docker compose up -d
```

## Key Features

- **TypeScript** throughout (strict mode)
- **React 19** with hooks and TypeScript
- **Express 5** with async/await support
- **PostgreSQL** with migrations and transactions
- **JWT** authentication with rotating refresh tokens
- **Optimistic updates** with concurrency control (ETag)
- **Event-driven** architecture for audit logging
- **Request IDs** via AsyncLocalStorage
- **Rate limiting** middleware
- **Keyset pagination** for efficient data loading

## Architecture

### Backend (TypeScript + Express)
- **Middleware**: Request IDs, CORS, auth, rate limiting, validation
- **Services**: Business logic (auth, tasks)
- **Routes**: API endpoints
- **Database**: pg with type-safe queries
- **Events**: Decoupled event bus for audit logging

### Frontend (TypeScript + React)
- **Components**: Login, Tasks, useDebounced hook
- **API Client**: Single-flight token refresh, retry logic
- **State**: useState for UI state, useCallback for stable references
- **Optimization**: Debounced search, optimistic updates with rollback
