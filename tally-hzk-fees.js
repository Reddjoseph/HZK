// tally-hzk-fees.js (ES module) — enhanced: also parses token transfer instructions
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

// tuning
const PAGE_LIMIT = 1000;
const PARSED_TX_DELAY_MS = 80;
const RPC_CALL_TIMEOUT_MS = 10000;
const RPC_RETRIES = 2;
const MAX_PAGES_PER_ACCOUNT = 50;
const MAX_TOTAL_SIGNATURES = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWithTimeoutAndRetries(fnFactory, timeoutMs = RPC_CALL_TIMEOUT_MS, retries = RPC_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const p = fnFactory();
      const res = await Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout")), timeoutMs))
      ]);
      return res;
    } catch (err) {
      const last = attempt > retries;
      console.warn(`RPC attempt ${attempt}/${retries + 1} failed: ${err?.message ?? err}${last ? " — giving up" : " — retrying"}`);
      if (last) throw err;
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
    if (pages > MAX_PAGES_PER_ACCOUNT) break;
    try {
      const page = await callWithTimeoutAndRetries(() => connection.getSignaturesForAddress(new PublicKey(account), { before, limit: PAGE_LIMIT }));
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
      console.warn(`Page fetch failed for ${account}: ${err?.message ?? err}. Skipping remainder of pages for this account.`);
      break;
    }
  }
  return sigs;
}

async function collectAllSignatures() {
  const seen = new Set();
  for (const acc of FEE_ACCOUNTS) {
    console.log(`Fetching signatures for fee account: ${acc}`);
    const list = await fetchSignaturesForAccountSafe(acc);
    console.log(`  fetched ${list.length} signatures`);
    for (const s of list) {
      seen.add(s);
      if (seen.size >= MAX_TOTAL_SIGNATURES) {
        console.warn(`Reached global cap ${MAX_TOTAL_SIGNATURES}`);
        return Array.from(seen);
      }
    }
  }
  return Array.from(seen);
}

/**
 * Helper: get token-account owner by calling getParsedAccountInfo on a token account pubkey
 */
async function getTokenAccountOwner(tokenAccountPubkey) {
  try {
    const info = await callWithTimeoutAndRetries(() => connection.getParsedAccountInfo(new PublicKey(tokenAccountPubkey)));
    if (info?.value?.data?.parsed?.info?.owner) return info.value.data.parsed.info.owner;
  } catch (err) {
    // ignore
  }
  return null;
}

/**
 * Scan parsed transaction for:
 *  - pre/post token balances deltas (ideal), OR
 *  - parsed token-transfer instructions (parsed.type === 'transfer' or 'transferChecked') in top-level or inner instructions.
 *
 * Returns array of { feeAccount, mint, amountBaseUnits(BigInt), sourceTokenAccount, sourceOwner (string|null) }
 */
async function extractFeeDepositsFromParsedTx(parsed) {
  const results = [];
  if (!parsed || !parsed.meta) return results;

  const pre = parsed.meta.preTokenBalances || [];
  const post = parsed.meta.postTokenBalances || [];
  const accountKeys = parsed.transaction.message.accountKeys.map(k => (typeof k === "string" ? k : k.pubkey));

  // build pre/post map: index -> {mint, owner, preAmtStr, postAmtStr, decimals}
  const balanceMap = new Map();
  for (const p of pre) balanceMap.set(p.accountIndex, { mint: p.mint, owner: p.owner || null, preAmtStr: p.uiTokenAmount?.amount ?? "0", decimals: p.uiTokenAmount?.decimals ?? 0 });
  for (const p of post) {
    const prev = balanceMap.get(p.accountIndex) ?? { mint: p.mint, owner: p.owner || null, preAmtStr: "0", decimals: p.uiTokenAmount?.decimals ?? 0 };
    prev.postAmtStr = p.uiTokenAmount?.amount ?? "0";
    if (!prev.decimals && p.uiTokenAmount?.decimals != null) prev.decimals = p.uiTokenAmount.decimals;
    balanceMap.set(p.accountIndex, prev);
  }

  // 1) Try pre/post deltas first
  for (const feeAcc of FEE_ACCOUNTS) {
    const feeIdx = accountKeys.indexOf(feeAcc);
    if (feeIdx === -1) continue;
    const feeEntry = balanceMap.get(feeIdx);
    if (!feeEntry) continue;
    const preAmt = BigInt(feeEntry.preAmtStr ?? "0");
    const postAmt = BigInt(feeEntry.postAmtStr ?? "0");
    const delta = postAmt - preAmt;
    if (delta > 0n) {
      // find source token account(s) with same mint that decreased
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

  // 2) If no pre/post results, scan parsed instructions (top-level) and inner instructions for parsed transfer events
  const allInstructions = [];
  // top-level
  if (Array.isArray(parsed.transaction.message.instructions)) {
    for (const ix of parsed.transaction.message.instructions) allInstructions.push(ix);
  }
  // innerInstructions
  const inner = parsed.meta.innerInstructions || [];
  for (const group of inner) {
    for (const ix of group.instructions) allInstructions.push(ix);
  }

  for (const ix of allInstructions) {
    // many RPC responses use ix.parsed; check for parsed.type === 'transfer' or 'transferChecked'
    const parsedIx = ix.parsed ?? ix;
    const kind = parsedIx.type || parsedIx.parsed?.type;
    const info = parsedIx.info || parsedIx.parsed?.info;
    if (!info || !kind) continue;
    if (!["transfer", "transferChecked", "mintTo", "mintToChecked"].includes(kind)) continue;

    // transfer/transferChecked typically have info.destination and info.amount
    const dest = info.destination ?? info.to ?? info.account; // try common fields
    const src = info.source ?? info.from ?? info.account;
    const amt = info.amount ?? null;
    if (!dest || amt == null) continue;

    // only care if destination is one of our fee accounts
    if (!FEE_ACCOUNTS.includes(dest)) continue;

    // attempt to get mint: instruction-level parsed info may not include mint. Try to resolve via balanceMap or accountKeys
    let mint = null;
    // try to find dest account index in accountKeys and look up balanceMap
    const destIdx = accountKeys.indexOf(dest);
    if (destIdx !== -1 && balanceMap.has(destIdx)) mint = balanceMap.get(destIdx).mint;
    // otherwise try src idx
    const srcIdx = accountKeys.indexOf(src);
    if (!mint && srcIdx !== -1 && balanceMap.has(srcIdx)) mint = balanceMap.get(srcIdx).mint;

    // amount may be string (base units) or number; convert to BigInt base units
    let amountBase;
    try {
      amountBase = BigInt(amt.toString());
    } catch (e) {
      // fallback: skip if cannot parse amount
      continue;
    }

    // find source owner:
    let owner = null;
    if (srcIdx !== -1 && balanceMap.has(srcIdx)) {
      owner = balanceMap.get(srcIdx).owner || null;
    }
    // if owner is still null, attempt to query the source token account for owner (slower)
    if (!owner && src) {
      owner = await getTokenAccountOwner(src).catch(() => null);
    }

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
  console.log("Collecting signatures...");
  const signatures = await collectAllSignatures();
  console.log(`Total signatures: ${signatures.length}`);
  if (signatures.length === 0) return null;

  const totals = new Map(); // owner -> BigInt base units
  let processed = 0;

  for (const sig of signatures) {
    processed++;
    try {
      const parsed = await callWithTimeoutAndRetries(() => connection.getParsedTransaction(sig, "confirmed"));
      await sleep(PARSED_TX_DELAY_MS);
      if (!parsed || !parsed.meta) continue;

      const deposits = await extractFeeDepositsFromParsedTx(parsed);
      for (const d of deposits) {
        const owner = d.sourceOwner || "unknown";
        totals.set(owner, (totals.get(owner) || 0n) + BigInt(d.amountBaseUnits));
      }
    } catch (err) {
      console.warn(`Error processing signature ${sig}: ${err?.message ?? err}`);
    }

    if (processed % 10 === 0) console.log(`Processed ${processed}/${signatures.length}`);
  }

  // convert totals to sorted array and convert base units to human via decimals detection
  // try to find decimals by checking any parsed tx's token balance entries
  let decimals = 0;
  // quick attempt: fetch parsed token account info for first fee account to extract decimals via its mint
  try {
    const info = await connection.getParsedAccountInfo(new PublicKey(FEE_ACCOUNTS[0]));
    const mint = info?.value?.data?.parsed?.info?.mint;
    if (mint) {
      // find mint account to read decimals via token mint account
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
      decimals = mintInfo?.value?.data?.parsed?.info?.decimals ?? 0;
    }
  } catch (e) {
    // ignore
  }

  const rows = Array.from(totals.entries()).map(([owner, baseBig]) => ({
    owner,
    totalBaseUnits: baseBig.toString(),
    burned: decimals ? Number((Number(baseBig.toString()) / Math.pow(10, decimals)).toFixed(Math.max(0, Math.min(6, decimals)))) : Number(baseBig.toString())
  })).sort((a, b) => b.burned - a.burned);

  return {
    generatedAt: new Date().toISOString(),
    cluster: CLUSTER,
    leaderboard: {
      top: rows[0] || null,
      rows: rows.slice(1, 3),
      all: rows
    }
  };
}

function writeToPublic(filename, data) {
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
  const outPath = path.join(publicDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

async function main() {
  console.log("Running enhanced tally...");
  try {
    const result = await buildLeaderboard();
    if (!result) {
      writeToPublic("hzktop3.json", { generatedAt: new Date().toISOString(), cluster: CLUSTER, leaderboard: { top: null, rows: [] } });
      console.log("No deposits found — empty leaderboard written.");
      return;
    }
    writeToPublic("hzktop3.json", result);
    console.log("Done. Top:", result.leaderboard.top);
  } catch (err) {
    console.error("Fatal error:", err);
    writeToPublic("hzktop3.json", { generatedAt: new Date().toISOString(), cluster: CLUSTER, leaderboard: { top: null, rows: [] } });
  }
}

main();
