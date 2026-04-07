# FileSure Intern Assignment

Tech Operations and Support Intern take-home assignment for FileSure India Private Limited.

## Status

- All parts 1 to 3 are implemented.
- The video walkthrough outline is in `VIDEO_SCRIPT.md`.
- API validation tests are implemented and passing.

## What This Project Builds

1. A Python ingestion pipeline that reads a messy CSV, normalises it, and writes records to MongoDB-compatible storage.
2. A Node.js Express API that exposes paginated, filtered, and aggregated company data.
3. A minimal frontend that renders the API data in a table with filters and pagination.

## Assignment Fit

### Part 1: Python and MongoDB ingestion

- Reads the provided messy CSV.
- Handles missing fields without crashing.
- Normalises inconsistent date formats.
- Cleans `paid_up_capital` into numeric values.
- Flags invalid emails instead of dropping rows.
- Adds an index for the API filter path: `status + state`.

### Part 2: Node.js API layer

- `GET /companies` supports pagination.
- `GET /companies?status=...&state=...` supports filtering.
- `GET /companies/summary` returns counts grouped by status.
- `GET /companies/stats` supports the frontend dashboard.
- If MongoDB is unavailable, the API falls back to `data.json` instead of crashing.
- Unsupported query params and malformed pagination return clear `400` responses.

### Part 3: Frontend display layer

- Minimal page served from `/`.
- Table renders company records.
- Filter controls call the API.
- Pagination is implemented.

## Project Structure

```text
filesure-assign/
├── .env.example
├── README.md
├── VIDEO_SCRIPT.md
├── ingest.py
├── server.js
├── data.json
├── company_records.csv
├── requirements.txt
├── package.json
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── tests/
    └── api.test.js
```

## Environment

Copy the public template and keep the real `.env` local.

```bash
cp .env.example .env
```

`.env.example` contains:

```dotenv
PORT=3000
MONGODB_URI=mongodb://localhost:27017/
DB_NAME=filesure
COLLECTION_NAME=companies
USE_MONGOMOCK=true
```

The checked-in `.gitignore` excludes `.env`, `.venv/`, `venv/`, `node_modules/`, and local-only planning/source artifacts so the repo can be kept public safely.

## Setup

```bash
cd filesure-assign
cp .env.example .env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm install
python3 ingest.py company_records.csv
npm start
```

Open:

```text
http://localhost:3000/
```

## Tests

Run the API integration tests with:

```bash
npm test
```

Current result:

- 5 tests passed.
- Coverage includes unsupported query params, malformed pagination, fallback-backed listing, and summary response validation.

## API Endpoints

### `GET /health`

Returns server status and the active data source.

### `GET /companies`

Supported query params:

- `page`
- `limit`
- `status`
- `state`

Examples:

```bash
curl 'http://localhost:3000/companies?page=1&limit=10'
curl 'http://localhost:3000/companies?status=active&state=Telangana'
```

Validation behavior:

- `?foo=bar` returns `400`.
- `?page=abc` returns `400`.
- `?limit=101` returns `400`.

### `GET /companies/summary`

Returns counts grouped by status.

### `GET /companies/stats`

Returns frontend-facing summary data by status, state, and email validity.

## Data Handling Decisions

- Status values are normalized to a consistent internal form.
- Dates are parsed with `dateutil` for mixed source formats.
- `paid_up_capital` is cleaned into a numeric value.
- `director_1` and `director_2` are stored as a `directors` array.
- Invalid emails are preserved with `email_valid: false`.
- Rows with missing `cin` are kept if the company record is still otherwise usable.

## MongoDB Note

The brief asks for a local MongoDB-backed flow. The code supports that through `MONGODB_URI`, `DB_NAME`, and `COLLECTION_NAME`.

In this environment, MongoDB is not available, so the API falls back to `data.json` and reports that state through `GET /health`.

That means the project still satisfies the assignment's non-crash requirement for database connectivity problems while remaining runnable locally.

## Video Walkthrough

Use `VIDEO_SCRIPT.md` as the talk track for the 6 to 8 minute submission video.

## Publishing Status

The repository is published publicly at:

[filesure-assign](https://github.com/Mohammad-Ghouse-virtuoso/filesure-assign)
