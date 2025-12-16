// tally-hzk-burns.js
// Tracks HZK burns specifically from Hanzenko hatching fees
// ES module. Writes public/hzktop3.json (creates public/ if missing).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, PublicKey } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HanZenKo (HZK) Token Configuration
const HZK_TOKEN_MINT = "8zzDzPCCLd1TaEy35mwN1GJW89QEFP6ypveutcjRpump";
const HZK_DECIMALS = 6;
const HATCH_FEE = 5000; // 5000 HZK per hatch

// Your game's fee collection addresses
const GAME_FEE_ADDRESSES = [
  "64MVZSkwRxKvqzCn3ZTHwkJgB1C4hwEZYGppQPfQWNNh", // DEV (20%)
  "AkbAYnnGWFGzVZLG6paH61qWpBe2DQW2xKZpQXF9WL3V", // Community (18%)
  "C54xp5d7JSxfFgpBF8JjPLDBkGukDdy3jdNS9PnCrCw9", // Incentives (2%)
];

const CLUSTER = "mainnet-beta";
const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=08b42024-9864-4c44-b8bb-8b9ba745505c";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Tuning
const MAX_SIGNATURES_PER_ACCOUNT = 5000;
const BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES_MS = 100;
const RPC_TIMEOUT_MS = 15000;
const RPC_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   RPC WITH RETRY
   ========================= */

async function callWithRetry(fn, retries = RPC_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("RPC timeout")), RPC_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (err) {
      const isLast = attempt > retries;
      if (isLast) throw err;
      console.warn(`  Retry ${attempt}/${retries}: ${err.message}`);
      await sleep(500 * attempt);
    }
  }
}

/* =========================
   GET SIGNATURES FOR FEE ACCOUNT
   ========================= */

async function getSignaturesForFeeAccount(address, limit = MAX_SIGNATURES_PER_ACCOUNT) {
  console.log(`Fetching signatures for: ${address}`);
  const signatures = [];
  let before = undefined;
  
  try {
    while (signatures.length < limit) {
      const batch = await callWithRetry(() =>
        connection.getSignaturesForAddress(
          new PublicKey(address),
          { before, limit: 1000 }
        )
      );
      
      if (!batch || batch.length === 0) break;
      
      for (const sig of batch) {
        signatures.push(sig.signature);
        if (signatures.length >= limit) break;
      }
      
      before = batch[batch.length - 1].signature;
      
      if (batch.length < 1000) break;
      await sleep(100);
    }
  } catch (err) {
    console.warn(`  Error fetching signatures for ${address}: ${err.message}`);
  }
  
  console.log(`  Found ${signatures.length} signatures`);
  return signatures;
}

/* =========================
   EXTRACT HATCHING FEE FROM TX
   ========================= */

async function extractHatchingFeeFromTx(signature) {
  try {
    const tx = await callWithRetry(() =>
      connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
    );
    
    if (!tx || !tx.meta) return null;
    
    const accountKeys = tx.transaction.message.accountKeys.map(k => 
      typeof k === "string" ? k : k.pubkey.toString()
    );
    
    // Check pre/post token balances for HZK transfers to fee addresses
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    
    const balanceMap = new Map();
    
    // Map pre-balances
    for (const pre of preBalances) {
      if (pre.mint !== HZK_TOKEN_MINT) continue;
      balanceMap.set(pre.accountIndex, {
        mint: pre.mint,
        owner: pre.owner,
        preAmount: BigInt(pre.uiTokenAmount?.amount || "0"),
        postAmount: 0n,
      });
    }
    
    // Update with post-balances
    for (const post of postBalances) {
      if (post.mint !== HZK_TOKEN_MINT) continue;
      const existing = balanceMap.get(post.accountIndex) || {
        mint: post.mint,
        owner: post.owner,
        preAmount: 0n,
      };
      existing.postAmount = BigInt(post.uiTokenAmount?.amount || "0");
      balanceMap.set(post.accountIndex, existing);
    }
    
    // Find transfers TO game fee addresses
    let totalFee = 0n;
    let payer = null;
    
    for (const [idx, balance] of balanceMap.entries()) {
      // Check if this is one of our game fee accounts
      const isFeeAccount = GAME_FEE_ADDRESSES.includes(balance.owner);
      
      if (!isFeeAccount) continue;
      
      const delta = balance.postAmount - balance.preAmount;
      if (delta > 0n) {
        totalFee += delta;
        
        // Find the source wallet (who paid the fee)
        if (!payer) {
          for (const [srcIdx, srcBalance] of balanceMap.entries()) {
            if (srcIdx === idx) continue;
            if (srcBalance.mint !== HZK_TOKEN_MINT) continue;
            
            const srcDelta = srcBalance.postAmount - srcBalance.preAmount;
            if (srcDelta < 0n) {
              payer = srcBalance.owner;
              break;
            }
          }
        }
      }
    }
    
    // Only count if this looks like a hatching fee transaction
    // Expected: 40% of 5000 HZK = 2000 HZK (in base units: 2,000,000,000)
    // Allow some variance for rounding: 1900-2100 HZK
    const minExpected = BigInt(1900 * 1_000_000); // 1900 HZK
    const maxExpected = BigInt(2100 * 1_000_000); // 2100 HZK
    
    if (totalFee >= minExpected && totalFee <= maxExpected && payer) {
      // This is a valid hatching fee transaction
      // Calculate full 5000 HZK (totalFee / 0.4)
      const fullHatchFee = BigInt(5000 * 1_000_000); // Exactly 5000 HZK
      
      return {
        payer,
        amount: fullHatchFee,
        signature,
        feeReceived: totalFee,
      };
    }
    
    return null;
  } catch (err) {
    // Silently skip failed transactions
    return null;
  }
}

/* =========================
   BUILD LEADERBOARD
   ========================= */

async function buildLeaderboard() {
  console.log("Collecting hatching transactions from fee accounts...");
  
  // Collect all unique signatures across fee accounts
  const allSignatures = new Set();
  
  for (const address of GAME_FEE_ADDRESSES) {
    const sigs = await getSignaturesForFeeAccount(address);
    for (const sig of sigs) {
      allSignatures.add(sig);
    }
  }
  
  const signatures = Array.from(allSignatures);
  console.log(`\nProcessing ${signatures.length} unique transactions...`);
  
  if (signatures.length === 0) {
    return null;
  }
  
  const burnsByWallet = new Map();
  const hatchesByWallet = new Map();
  let processed = 0;
  let validHatches = 0;
  let skippedWrongAmount = 0;
  let skippedNoData = 0;
  
  // Process in batches
  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const batch = signatures.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(sig => extractHatchingFeeFromTx(sig))
    );
    
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value) {
          const hatch = result.value;
          const current = burnsByWallet.get(hatch.payer) || 0n;
          burnsByWallet.set(hatch.payer, current + hatch.amount);
          
          const currentHatches = hatchesByWallet.get(hatch.payer) || 0;
          hatchesByWallet.set(hatch.payer, currentHatches + 1);
          
          validHatches++;
        } else {
          skippedNoData++;
        }
      } else {
        skippedNoData++;
      }
    }
    
    processed += batch.length;
    if (processed % 500 === 0 || processed === signatures.length) {
      console.log(`  Processed ${processed}/${signatures.length} (${validHatches} valid hatches, ${skippedNoData} skipped)`);
    }
    
    await sleep(DELAY_BETWEEN_BATCHES_MS);
  }
  
  // Convert to leaderboard format
  const rows = Array.from(burnsByWallet.entries())
    .map(([owner, amount]) => ({
      owner,
      totalBaseUnits: amount.toString(),
      burned: Number((Number(amount) / Math.pow(10, HZK_DECIMALS)).toFixed(HZK_DECIMALS)),
      hatches: hatchesByWallet.get(owner) || 0,
    }))
    .sort((a, b) => b.burned - a.burned);
  
  console.log(`\nFound ${rows.length} unique players who hatched Chrysalis NFTs`);
  console.log(`Valid hatches: ${validHatches}, Skipped transactions: ${skippedNoData}`);
  
  return {
    generatedAt: new Date().toISOString(),
    cluster: CLUSTER,
    mint: HZK_TOKEN_MINT,
    unitDecimals: HZK_DECIMALS,
    totalBurned: rows.reduce((sum, r) => sum + r.burned, 0),
    totalHatches: validHatches,
    leaderboard: {
      top: rows[0] || null,
      rows: rows.slice(1, 3),
      all: rows,
    },
  };
}

/* =========================
   FILE WRITING
   ========================= */

function ensurePublicAndWrite(filename, dataObj) {
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) {
    console.log("Creating ./public directory");
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const outPath = path.join(publicDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(dataObj, null, 2), "utf8");
  return outPath;
}

/* =========================
   MAIN
   ========================= */

async function main() {
  console.log("=".repeat(60));
  console.log("HANZENKO HATCHING LEADERBOARD");
  console.log("=".repeat(60));
  console.log(`Token: ${HZK_TOKEN_MINT}`);
  console.log(`Cluster: ${CLUSTER}`);
  console.log(`Hatch Fee: ${HATCH_FEE} HZK`);
  console.log("");
  
  try {
    const result = await buildLeaderboard();
    
    if (!result) {
      console.log("No data found. Writing empty leaderboard.");
      const empty = {
        generatedAt: new Date().toISOString(),
        cluster: CLUSTER,
        mint: HZK_TOKEN_MINT,
        leaderboard: { top: null, rows: [], all: [] },
      };
      const outPath = ensurePublicAndWrite("hzktop3.json", empty);
      console.log(`Wrote: ${outPath}`);
      return;
    }
    
    const outPath = ensurePublicAndWrite("hzktop3.json", result);
    
    console.log("");
    console.log("=".repeat(60));
    console.log("LEADERBOARD SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total HZK Burned: ${result.totalBurned.toLocaleString()}`);
    console.log(`Total Hatches: ${result.totalHatches.toLocaleString()}`);
    console.log(`Total Players: ${result.leaderboard.all.length}`);
    console.log("");
    console.log("Top 3 Players:");
    
    const top3 = [result.leaderboard.top, ...result.leaderboard.rows].filter(Boolean);
    top3.forEach((entry, i) => {
      const wallet = entry.owner;
      const shortWallet = wallet.length > 12 
        ? `${wallet.slice(0, 6)}...${wallet.slice(-6)}`
        : wallet;
      console.log(`  #${i + 1}: ${shortWallet}`);
      console.log(`      Burned: ${entry.burned.toLocaleString()} HZK`);
      console.log(`      Hatches: ${entry.hatches}`);
    });
    
    console.log("");
    console.log(`Output: ${outPath}`);
    console.log("=".repeat(60));
  } catch (err) {
    console.error("Fatal error:", err);
    const empty = {
      generatedAt: new Date().toISOString(),
      cluster: CLUSTER,
      mint: HZK_TOKEN_MINT,
      error: err.message,
      leaderboard: { top: null, rows: [], all: [] },
    };
    const outPath = ensurePublicAndWrite("hzktop3.json", empty);
    console.log(`Wrote error state: ${outPath}`);
  }
}

main();