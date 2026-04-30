# LenderSearch — Project Overview

Single-page React app for mortgage brokers to evaluate loan scenarios against lender program guidelines.

## Purpose
Given a borrower scenario (loan type, FICO, LTV, DTI, occupancy, state, derogatory events, etc.), determine which lender programs the scenario qualifies for. Surfaces matches, fails (with reasons), and warnings per program.

## Three views
1. **Search** — structured form + natural-language scenario input (parsed via Claude API). Results show pass/fail per program with detailed reasoning.
2. **Guidelines Q&A** — chat-style guideline lookup. Sends loaded program data as context to Claude API for question answering.
3. **Admin** — view all loaded programs, manage Claude API key (localStorage), import custom programs as JSON.

## Data model
- **SEED_LENDERS**: 3 lenders (PennyMac TPO, PRMG, Champions Funding LLC).
- **SEED_PROGRAMS**: ~30+ hardcoded program objects covering Conventional (FNMA/FHLMC), HomeReady, RefiNow, FHA, VA Full Doc / IRRRL / Manufactured, USDA, Jumbo, Non-QM (Activator/Ally/Accelerator DSCR/Super Jumbo).
- **customPrograms**: user-imported programs persisted in `localStorage` under `ls_programs`.
- Each program: `id, lenderId, name, agency, aus, loanTypes, purposes, occupancy, propertyTypes, ineligiblePropertyTypes, terms, minFico, maxDti, ltv (occupancy → purpose → unitKey → maxLtv%), overlays[], derogatoryWaiting{}, specialFeatures[], plus many flags (highBalance, armsAllowed, cashOutAllowed, manualUw, minDscr, supportedIncomeDocs, ineligibleStates, etc.)`.

## Key state
All in `App` component (no Redux/Context). LocalStorage keys: `ls_programs`, `ls_claude_api_key`, `ls_qa_history`.

## External calls
Direct browser → `https://api.anthropic.com/v1/messages` using user-supplied API key. Header `anthropic-dangerous-direct-browser-access: true`. Model: `claude-haiku-4-5-20251001`.
