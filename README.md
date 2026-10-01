# Event Ticketing System

A concert and theater ticketing website built to learn databases deeply.
PostgreSQL enforces the business rules; the web layer (Node.js + Express + EJS) stays simple.

## Setup

1. Install Node.js and PostgreSQL 17.
2. Create the database:
   ```
   createdb -U postgres ticketing
   ```
3. Copy `.env.example` to `.env` and put in your `postgres` password.
4. Install dependencies and start the server:
   ```
   npm install
   npm start
   ```
5. Open http://localhost:3000

## What I learned

See [db/notes.md](db/notes.md).
