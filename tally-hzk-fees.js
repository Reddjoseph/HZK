// tally-hzk-fees.js
// ES module. Writes public/hzktop3.json (creates public/ if missing).
// Run locally: node tally-hzk-fees.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEE_ACCOUNTS = [
  "CYG9vWJVNQPBm82CQ3Qyrs1S99mVaV1btArfvqSXVamX",
  "HayfSrGjEn6dzdvmd6SoBWi9Xm63qwtTZbDt7CnfNPSD",
  "FM8AMzgJCCmcf97mvWAYr3K4K86mUs4tXKcjBL7N8LS9",
  "37AzogzoPNyGvjmjtx9ztFUuDXLMPinHAc1qGeZULJHm"
];

const CLUSTER = "devnet";
const connection = new Connection(clusterApiUrl(CLUSTER), "confirmed");

// Tuning (safe defaults)
const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_ACCOUNT = 50;
const MAX_TOTAL_SIGNATURES = 20000;
const PARSED_TX_DELAY_MS = 80;
const RPC_CALL_TIMEOUT_MS = 10000;
const RPC_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWithTimeoutAndRetries(fnFactory, timeoutMs = RPC_CALL_TIMEOUT_MS, retries = RPC_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const p = fnFactory();
      const res = await Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout")), timeoutMs)),
      ]);
      return res;
    } catch (err) {
      const isLast = attempt > retries;
      console.warn(`RPC attempt ${attempt}/${retries + 1} failed: ${err?.message ?? err}${isLast ? " — giving up." : " — retrying..."}`);
      if (isLast) throw err;
      await sleep(300 * attempt);
    }
  }
}

async function fetchSignaturesForAccountSafe(account) {
  const sigs = [];
  let before = undefined;
  let pages = 0;
  let lastSeen = null;

  while (true) {
    pages++;
    if (pages > MAX_PAGES_PER_ACCOUNT) {
      console.warn(`Reached max pages (${MAX_PAGES_PER_ACCOUNT}) for ${account}; stopping early.`);
      break;
    }

    try {
      const page = await callWithTimeoutAndRetries(
        () => connection.getSignaturesForAddress(new PublicKey(account), { before, limit: PAGE_LIMIT }),
        RPC_CALL_TIMEOUT_MS,
        RPC_RETRIES
      );

      if (!page || page.length === 0) break;

      const currentLast = page[page.length - 1].signature;
      if (lastSeen && currentLast === lastSeen) {
        for (const p of page) sigs.push(p.signature);
        break;
      }
      lastSeen = currentLast;

      for (const p of page) sigs.push(p.signature);

      if (page.length < PAGE_LIMIT) break;
      before = page[page.length - 1].signature;

      await sleep(50);
    } catch (err) {
      console.warn(`Failed to fetch page ${pages} for ${account}: ${err?.message ?? err}. Skipping remaining pages for this account.`);
      break;
    }
  }

  return sigs;
}

async function collectAllSignatures() {
  const seen = new Set();
  for (const acc of FEE_ACCOUNTS) {
    console.log(`Fetching signatures for fee account: ${acc}`);
    try {
      const list = await fetchSignaturesForAccountSafe(acc);
      console.log(`  fetched ${list.length} signatures for ${acc}`);
      for (const s of list) {
        seen.add(s);
        if (seen.size >= MAX_TOTAL_SIGNATURES) {
          console.warn(`Reached global cap of ${MAX_TOTAL_SIGNATURES} signatures; stopping collection.`);
          return Array.from(seen);
        }
      }
    } catch (err) {
      console.warn(`Skipping ${acc} due to error: ${err?.message ?? err}`);
    }
  }
  return Array.from(seen);
}

async function getTokenAccountOwner(tokenAccountPubkey) {
  try {
    const info = await callWithTimeoutAndRetries(() => connection.getParsedAccountInfo(new PublicKey(tokenAccountPubkey)), RPC_CALL_TIMEOUT_MS, RPC_RETRIES);
    if (info?.value?.data?.parsed?.info?.owner) return info.value.data.parsed.info.owner;
  } catch (err) {
    // ignore
  }
  return null;
}

async function extractFeeDepositsFromParsedTx(parsed) {
  const results = [];
  if (!parsed || !parsed.meta) return results;

  const pre = parsed.meta.preTokenBalances || [];
  const post = parsed.meta.postTokenBalances || [];
  const accountKeys = parsed.transaction.message.accountKeys.map(k => (typeof k === "string" ? k : k.pubkey));

  const balanceMap = new Map();
  for (const p of pre) balanceMap.set(p.accountIndex, { mint: p.mint, owner: p.owner || null, preAmtStr: p.uiTokenAmount?.amount ?? "0", decimals: p.uiTokenAmount?.decimals ?? 0 });
  for (const p of post) {
    const prev = balanceMap.get(p.accountIndex) ?? { mint: p.mint, owner: p.owner || null, preAmtStr: "0", decimals: p.uiTokenAmount?.decimals ?? 0 };
    prev.postAmtStr = p.uiTokenAmount?.amount ?? "0";
    if (!prev.decimals && p.uiTokenAmount?.decimals != null) prev.decimals = p.uiTokenAmount.decimals;
    balanceMap.set(p.accountIndex, prev);
  }

  // pre/post deltas first
  for (const feeAcc of FEE_ACCOUNTS) {
    const feeIdx = accountKeys.indexOf(feeAcc);
    if (feeIdx === -1) continue;
    const feeEntry = balanceMap.get(feeIdx);
    if (!feeEntry) continue;
    const preAmt = BigInt(feeEntry.preAmtStr ?? "0");
    const postAmt = BigInt(feeEntry.postAmtStr ?? "0");
    const delta = postAmt - preAmt;
    if (delta > 0n) {
      for (const [idx, vals] of balanceMap.entries()) {
        if (idx === feeIdx) continue;
        if (vals.mint !== feeEntry.mint) continue;
        const srcPre = BigInt(vals.preAmtStr ?? "0");
        const srcPost = BigInt(vals.postAmtStr ?? "0");
        const srcDelta = srcPost - srcPre;
        if (srcDelta < 0n) {
          const owner = vals.owner || accountKeys[idx] || null;
          results.push({
            feeAccount: feeAcc,
            mint: feeEntry.mint,
            amountBaseUnits: -srcDelta,
            sourceTokenAccount: accountKeys[idx],
            sourceOwner: owner
          });
        }
      }
    }
  }

  if (results.length > 0) return results;

  // otherwise check parsed instructions & inner instructions
  const allInstructions = [];
  if (Array.isArray(parsed.transaction.message.instructions)) {
    for (const ix of parsed.transaction.message.instructions) allInstructions.push(ix);
  }
  const inner = parsed.meta.innerInstructions || [];
  for (const group of inner) {
    for (const ix of group.instructions) allInstructions.push(ix);
  }

  for (const ix of allInstructions) {
    const parsedIx = ix.parsed ?? ix;
    const kind = parsedIx.type || parsedIx.parsed?.type;
    const info = parsedIx.info || parsedIx.parsed?.info;
    if (!info || !kind) continue;
    if (!["transfer", "transferChecked", "mintTo", "mintToChecked"].includes(kind)) continue;
    const dest = info.destination ?? info.to ?? info.account;
    const src = info.source ?? info.from ?? info.account;
    const amt = info.amount ?? null;
    if (!dest || amt == null) continue;
    if (!FEE_ACCOUNTS.includes(dest)) continue;

    let mint = null;
    const destIdx = accountKeys.indexOf(dest);
    if (destIdx !== -1 && balanceMap.has(destIdx)) mint = balanceMap.get(destIdx).mint;
    const srcIdx = accountKeys.indexOf(src);
    if (!mint && srcIdx !== -1 && balanceMap.has(srcIdx)) mint = balanceMap.get(srcIdx).mint;

    let amountBase;
    try {
      amountBase = BigInt(amt.toString());
    } catch (e) {
      continue;
    }

    let owner = null;
    if (srcIdx !== -1 && balanceMap.has(srcIdx)) owner = balanceMap.get(srcIdx).owner || null;
    if (!owner && src) owner = await getTokenAccountOwner(src).catch(() => null);

    results.push({
      feeAccount: dest,
      mint,
      amountBaseUnits: amountBase,
      sourceTokenAccount: src,
      sourceOwner: owner
    });
  }

  return results;
}

async function buildLeaderboard() {
  console.log("Collecting signatures touching fee accounts...");
  const signatures = await collectAllSignatures();
  console.log(`Total unique signatures: ${signatures.length}`);
  if (signatures.length === 0) return null;

  // try to detect dominant mint first (optional)
  const mintTotals = new Map();
  const parsedCache = new Map();
  let processed = 0;

  for (const sig of signatures) {
    processed++;
    try {
      const parsed = await callWithTimeoutAndRetries(() => connection.getParsedTransaction(sig, "confirmed"), RPC_CALL_TIMEOUT_MS, RPC_RETRIES);
      await sleep(PARSED_TX_DELAY_MS);
      if (!parsed || !parsed.meta) continue;
      parsedCache.set(sig, parsed);

      const pre = parsed.meta.preTokenBalances || [];
      const post = parsed.meta.postTokenBalances || [];
      const accountKeys = parsed.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));

      const balanceMap = new Map();
      for (const p of pre) balanceMap.set(p.accountIndex, { mint: p.mint, preAmtStr: p.uiTokenAmount?.amount ?? "0" });
      for (const p of post) {
        const prev = balanceMap.get(p.accountIndex) ?? { mint: p.mint, preAmtStr: "0" };
        prev.postAmtStr = p.uiTokenAmount?.amount ?? "0";
        prev.mint = p.mint;
        balanceMap.set(p.accountIndex, prev);
      }

      for (const feeAcc of FEE_ACCOUNTS) {
        const feeIdx = accountKeys.indexOf(feeAcc);
        if (feeIdx === -1) continue;
        const feeEntry = balanceMap.get(feeIdx);
        if (!feeEntry) continue;
        const preAmt = BigInt(feeEntry.preAmtStr ?? "0");
        const postAmt = BigInt(feeEntry.postAmtStr ?? "0");
        const delta = postAmt - preAmt;
        if (delta > 0n) {
          const prev = mintTotals.get(feeEntry.mint) || 0n;
          mintTotals.set(feeEntry.mint, prev + delta);
        }
      }
    } catch (err) {
      console.warn(`(detect) skipping tx ${sig} due to error: ${err?.message ?? err}`);
    }
    if (processed % 50 === 0) console.log(`Detect pass: processed ${processed}/${signatures.length}`);
  }

  // choose mint (dominant) or null
  const chooseMint = (map) => {
    let pick = null;
    let max = 0n;
    for (const [m, v] of map.entries()) {
      if (v > max) { max = v; pick = m; }
    }
    return pick;
  };

  const chosenMint = chooseMint(mintTotals);
  console.log("Detected mint:", chosenMint);

  // final pass: attribute deposits only for chosenMint (if detected) or all if null
  const totalsByOwner = new Map();
  processed = 0;
  for (const sig of signatures) {
    processed++;
    try {
      let parsed = parsedCache.get(sig);
      if (!parsed) {
        parsed = await callWithTimeoutAndRetries(() => connection.getParsedTransaction(sig, "confirmed"), RPC_CALL_TIMEOUT_MS, RPC_RETRIES);
        await sleep(PARSED_TX_DELAY_MS);
        if (!parsed || !parsed.meta) continue;
      }

      const deposits = await extractFeeDepositsFromParsedTx(parsed);
      for (const d of deposits) {
        if (chosenMint && d.mint && d.mint !== chosenMint) continue;
        const owner = d.sourceOwner || "unknown";
        totalsByOwner.set(owner, (totalsByOwner.get(owner) || 0n) + BigInt(d.amountBaseUnits));
      }
    } catch (err) {
      console.warn(`(final) skipping tx ${sig} due to error: ${err?.message ?? err}`);
    }

    if (processed % 50 === 0) console.log(`Final pass: processed ${processed}/${signatures.length}`);
  }

  // find decimals (try to read from a parsed tx if available)
  let decimals = 0;
  for (const parsed of parsedCache.values()) {
    const list = (parsed.meta?.postTokenBalances || []).concat(parsed.meta?.preTokenBalances || []);
    for (const b of list) {
      if (b.mint === chosenMint && b.uiTokenAmount?.decimals != null) {
        decimals = b.uiTokenAmount.decimals;
        break;
      }
    }
    if (decimals) break;
  }

  const rows = Array.from(totalsByOwner.entries()).map(([owner, baseBig]) => ({
    owner,
    totalBaseUnits: baseBig.toString(),
    burned: decimals ? Number((Number(baseBig.toString()) / Math.pow(10, decimals)).toFixed(Math.max(0, Math.min(6, decimals)))) : Number(baseBig.toString())
  })).sort((a, b) => b.burned - a.burned);

  return {
    generatedAt: new Date().toISOString(),
    cluster: CLUSTER,
    mint: chosenMint,
    unitDecimals: decimals,
    leaderboard: {
      top: rows[0] || null,
      rows: rows.slice(1, 3),
      all: rows
    }
  };
}

function ensurePublicAndWrite(filename, dataObj) {
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) {
    console.log("Public folder not found — creating ./public");
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const outPath = path.join(publicDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(dataObj, null, 2), "utf8");
  return outPath;
}

async function main() {
  console.log("Building filtered HZK leaderboard...");
  try {
    const result = await buildLeaderboard();
    if (!result) {
      console.log("No result (no data). Writing empty leaderboard to public/hzktop3.json");
      const empty = { generatedAt: new Date().toISOString(), cluster: CLUSTER, leaderboard: { top: null, rows: [] } };
      const out = ensurePublicAndWrite("hzktop3.json", empty);
      console.log("Wrote", out);
      return;
    }
    const out = ensurePublicAndWrite("hzktop3.json", result);
    console.log("Wrote", out);
    console.log("Top:", result.leaderboard.top);
  } catch (err) {
    console.error("Fatal error:", err?.stack ?? err);
    const empty = { generatedAt: new Date().toISOString(), cluster: CLUSTER, leaderboard: { top: null, rows: [] } };
    const out = ensurePublicAndWrite("hzktop3.json", empty);
    console.log("Wrote", out);
  }
}

main();
