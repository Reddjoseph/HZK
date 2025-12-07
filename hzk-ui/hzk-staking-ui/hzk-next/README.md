# HZK Staking Dashboard (Next.js 14 + TypeScript)

This is a wallet-first, modern UI/UX revamp of the staking dApp, implemented as a separate Next.js app so the original Vite app remains untouched.

## Stack
- Next.js 14 (App Router) + TypeScript
- TailwindCSS
- Local shadcn-like UI primitives (Card, Button, Input)
- @solana/wallet-adapter-react (+ Phantom)
- @project-serum/anchor
- Toasts with `sonner`

## Run
1. Install deps:
   npm install
2. Start dev server:
   npm run dev

The app runs on http://localhost:3000

## Notes
- IDL is served from `/public/idl/hzk_staking.json`.
- All labels, field names, and keys remain EXACTLY as in the original UI.
- Only frontend layout and UX were improved; program interactions and JSON structures are unchanged.
- Two-column responsive layout: Left (Wallet, Pool Info, Pool debug), Right (Actions, Status).
- Addresses are truncated with copy-to-clipboard and show full value on hover via native tooltip.
- Action buttons include loading states and success/error toasts.
- Devnet notice is displayed at the bottom.
