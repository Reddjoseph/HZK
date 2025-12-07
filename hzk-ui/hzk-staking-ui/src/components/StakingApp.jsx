// <entire file — copy/paste this over your StakingApp.jsx>

import React, { useEffect, useMemo, useState } from "react";
import * as anchor from "@project-serum/anchor";
import { PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

// -----------------------------
// Configuration
// -----------------------------
const DEFAULT_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("CRDwYUDJuhAjUNmxWwHnQD5rWbGnwvUjCNx5fqFYQjkn");
const POOL_PDA = new PublicKey("7JTJnze4Wru7byHHJofnCt5kash5PfDpZowisvNu8s9n");

// -----------------------------
// Load IDL from /public/idl/hzk_staking.json
// -----------------------------
async function loadIdl() {
  const res = await fetch("/idl/hzk_staking.json");
  if (!res.ok) throw new Error("Failed to load IDL. Place your IDL at /idl/hzk_staking.json in the public folder.");
  const idl = await res.json();
  return idl;
}

// -----------------------------
// Helpers for sanitizer
// -----------------------------
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function collectDefinedTypeNames(obj, set = new Set()) {
  if (!obj || typeof obj !== "object") return set;
  if (Array.isArray(obj)) {
    for (const v of obj) collectDefinedTypeNames(v, set);
    return set;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "defined" && typeof v === "string") {
      set.add(v);
    } else if (typeof v === "object" && v !== null) {
      collectDefinedTypeNames(v, set);
    }
  }
  return set;
}

function makePlaceholderType(name) {
  return {
    name,
    type: {
      kind: "struct",
      fields: [],
    },
  };
}

function normalizeFieldType(field) {
  if (!field) return field;
  if (typeof field.type === "string") {
    const s = field.type;
    const normalized = (s === "pubkey" ? "publicKey" : s);
    field.type = { defined: normalized };
  } else if (typeof field.type === "number" || typeof field.type === "boolean") {
    field.type = { defined: String(field.type) };
  }
  return field;
}

function sanitizeIdlForAnchor(rawIdl) {
  const idl = deepClone(rawIdl || {});
  if (!Array.isArray(idl.accounts) && Array.isArray(idl.idlAccounts)) {
    idl.accounts = idl.idlAccounts;
  }
  if (!Array.isArray(idl.accounts)) idl.accounts = [];
  if (!Array.isArray(idl.types)) idl.types = [];

  idl.types = idl.types.map((t, idx) => {
    if (!t || typeof t !== "object") return makePlaceholderType(`__MALFORMED_TYPE_${idx}`);
    if (!t.name || typeof t.name !== "string") t.name = t.name || `__ANON_TYPE_${idx}`;
    if (!t.type || typeof t.type !== "object") {
      t.type = { kind: "struct", fields: [] };
    } else {
      if (!("kind" in t.type)) {
        if (Array.isArray(t.type.fields)) t.type.kind = "struct";
        else if (Array.isArray(t.type.variants)) t.type.kind = "enum";
        else t.type.kind = "struct";
      }
      if (t.type.kind === "struct" && !Array.isArray(t.type.fields)) t.type.fields = [];
      if (t.type.kind === "enum" && !Array.isArray(t.type.variants)) t.type.variants = [];
    }
    if (t.type.kind === "struct" && Array.isArray(t.type.fields)) {
      t.type.fields = t.type.fields.map(f => normalizeFieldType(f));
    }
    return t;
  });

  idl.accounts = idl.accounts.map((acc, idx) => {
    if (!acc || typeof acc !== "object") {
      return { name: `__MALFORMED_ACCOUNT_${idx}`, type: { kind: "struct", fields: [] } };
    }
    if (!acc.name || typeof acc.name !== "string") acc.name = acc.name || `__ACCOUNT_${idx}`;
    if (typeof acc.type === "string") {
      acc.type = { defined: acc.type };
    } else if (!acc.type || typeof acc.type !== "object") {
      acc.type = { kind: "struct", fields: [] };
    } else {
      if (acc.type.kind === "struct" && Array.isArray(acc.type.fields)) {
        acc.type.fields = acc.type.fields.map(f => normalizeFieldType(f));
      }
    }
    return acc;
  });

  if (Array.isArray(idl.instructions)) {
    idl.instructions = idl.instructions.map((instr) => {
      if (!instr || typeof instr !== "object") return instr;
      if (Array.isArray(instr.args)) {
        instr.args = instr.args.map(arg => {
          if (arg && typeof arg === "object" && typeof arg.type === "string") {
            arg.type = { defined: arg.type };
          }
          return arg;
        });
      }
      if (Array.isArray(instr.accounts)) {
        instr.accounts = instr.accounts.map((a, idx) => {
          if (!a || typeof a !== "object") return { name: `__ACC_${idx}`, isMut: false, isSigner: false };
          if (!a.name) a.name = a.name || `account_${idx}`;
          return a;
        });
      }
      return instr;
    });
  }

  const referenced = collectDefinedTypeNames(idl);

  for (const t of idl.types) {
    if (t && t.type && t.type.kind === "struct" && Array.isArray(t.type.fields)) {
      for (const f of t.type.fields) {
        if (f && f.type && typeof f.type === "object" && typeof f.type.defined === "string") {
          referenced.add(f.type.defined);
        }
      }
    }
  }

  const existingTypeNames = new Set((idl.types || []).map(tt => tt && tt.name).filter(Boolean));
  for (const name of referenced) {
    if (!existingTypeNames.has(name)) {
      idl.types.push(makePlaceholderType(name));
      existingTypeNames.add(name);
    }
  }

  idl.types = idl.types.map((t, idx) => {
    if (!t || typeof t !== "object") return makePlaceholderType(`__FINAL_MALFORMED_${idx}`);
    if (!t.name || typeof t.name !== "string") t.name = `__FINAL_TYPE_${idx}`;
    if (!t.type || typeof t.type !== "object") t.type = { kind: "struct", fields: [] };
    if (!("kind" in t.type)) {
      if (Array.isArray(t.type.fields)) t.type.kind = "struct";
      else if (Array.isArray(t.type.variants)) t.type.kind = "enum";
      else t.type.kind = "struct";
    }
    if (t.type.kind === "struct" && !Array.isArray(t.type.fields)) t.type.fields = [];
    if (t.type.kind === "enum" && !Array.isArray(t.type.variants)) t.type.variants = [];
    if (t.type.kind === "struct") {
      t.type.fields = t.type.fields.map(f => normalizeFieldType(f));
    }
    return t;
  });

  return idl;
}

function formatTokenAmount(rawBN, decimals = 9) {
  if (rawBN == null) return "0";
  const bn = new anchor.BN(rawBN.toString());
  const denom = new anchor.BN(10).pow(new anchor.BN(decimals));
  const whole = bn.div(denom).toString();
  const frac = bn.mod(denom).toString().padStart(decimals, "0");
  return `${whole}.${frac.slice(0, 4)}`;
}

// -----------------------------
// Staking App
// -----------------------------
function StakingAppInner() {
  const wallet = useWallet();
  const [connection] = useState(new Connection(DEFAULT_RPC, "confirmed"));
  const [program, setProgram] = useState(null);
  const [idl, setIdl] = useState(null);
  const [loading, setLoading] = useState(false);
  // pool is now stored as { raw: <rawAccount>, serializable: <debug> }
  const [pool, setPool] = useState(null);
  const [status, setStatus] = useState("");
  const [stakeAmount, setStakeAmount] = useState(0);
  const [userState, setUserState] = useState(null);

  const provider = useMemo(() => {
    if (!wallet || !wallet.publicKey) return null;
    return new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
  }, [wallet, connection]);

  const dummyWallet = useMemo(() => {
    return {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadIdl();
        const sanitized = sanitizeIdlForAnchor(loaded);
        setIdl(sanitized);

        // helpful debug log
        console.log("IDL accounts (detailed):", sanitized.accounts);

        if (typeof window !== "undefined") window._debugIdl = sanitized;

        console.log("Loaded IDL (sanitized):", {
          address: sanitized.address,
          instructions: sanitized.instructions ? sanitized.instructions.map(i => i.name) : [],
          accounts: sanitized.accounts ? sanitized.accounts.map(a => a.name) : [],
          types: Array.isArray(sanitized.types) ? sanitized.types.map(t => ({ name: t.name, kind: t.type ? t.type.kind : undefined })) : [],
        });

        try {
          console.log("Attempting to create Anchor Program wrapper...");
          const effectiveProvider = provider || new anchor.AnchorProvider(connection, dummyWallet, anchor.AnchorProvider.defaultOptions());
          const p = new anchor.Program(sanitized, PROGRAM_ID, effectiveProvider);
          setProgram(p);
          console.log("Program creation OK.");
          try {
            const keys = Object.keys(p.account || {});
            console.log("program.account keys:", keys);
          } catch (innerErr) {
            console.warn("program.account inspection failed (non-fatal):", innerErr && innerErr.stack ? innerErr.stack : innerErr);
          }
        } catch (progErr) {
          console.error("Error while creating Anchor Program wrapper:", progErr && progErr.stack ? progErr.stack : progErr);
          setStatus(`Could not create program wrapper: ${progErr.message || progErr}`);
        }
      } catch (err) {
        console.warn("Could not load IDL yet (outer):", err && err.stack ? err.stack : err);
        setStatus(`Could not load IDL yet: ${err.message || err}`);
      }
    })();
  }, [connection, provider, dummyWallet]);

  function getIdlInstructionByName(name) {
    if (!idl || !idl.instructions) return null;
    return idl.instructions.find(i => i.name === name) || null;
  }
  function getIdlAccountNamesForInstruction(name) {
    const instr = getIdlInstructionByName(name);
    return instr && instr.accounts ? instr.accounts.map(a => a.name) : [];
  }
  function findProgramAccountKey(programObj, desired) {
    if (!programObj || !programObj.account) return null;
    const keys = Object.keys(programObj.account);
    let k = keys.find(x => x === desired);
    if (k) return k;
    k = keys.find(x => x.toLowerCase() === desired.toLowerCase());
    if (k) return k;
    const camel = desired.replace(/_([a-z])/g, g => g[1].toUpperCase());
    k = keys.find(x => x === camel || x.toLowerCase() === camel.toLowerCase());
    if (k) return k;
    return null;
  }

  function buildAccountsObjectForInstruction(instrName, mapping) {
    const accountNames = getIdlAccountNamesForInstruction(instrName);
    const accountsObj = {};
    for (const name of accountNames) {
      if (mapping.hasOwnProperty(name)) {
        accountsObj[name] = mapping[name];
        continue;
      }
      const camel = name.replace(/_([a-z])/g, g => g[1].toUpperCase());
      if (mapping.hasOwnProperty(camel)) {
        accountsObj[name] = mapping[camel];
        continue;
      }
      if (name === 'token_program') accountsObj[name] = TOKEN_PROGRAM_ID;
      else if (name === 'system_program') accountsObj[name] = SystemProgram.programId;
      else if (name === 'rent') accountsObj[name] = anchor.web3.SYSVAR_RENT_PUBKEY;
      else accountsObj[name] = mapping[name] ?? mapping[camel];
    }
    return accountsObj;
  }

  // Helper to read u64 and u128 from Buffer little-endian using BigInt
  function readU64LE(buf, offset) {
    // Buffer supports readBigUInt64LE in modern Node; but support gracefully
    try {
      if (typeof buf.readBigUInt64LE === "function") {
        return BigInt(buf.readBigUInt64LE(offset));
      }
    } catch (e) {}
    // Fallback: construct manually
    let res = 0n;
    for (let i = 0; i < 8; i++) {
      res |= BigInt(buf[offset + i]) << BigInt(8 * i);
    }
    return res;
  }
  function readU128LE(buf, offset) {
    const low = readU64LE(buf, offset);
    const high = readU64LE(buf, offset + 8);
    return (high << 64n) | low;
  }

  // -----------------------------
  // Fetch pool account (improved logging + raw RPC inspect + best-guess parsing)
  // -----------------------------
  const fetchPool = async () => {
    if (!program) {
      console.warn("fetchPool called but program is not ready");
      return;
    }
    setLoading(true);
    try {
      const poolAccountKey = findProgramAccountKey(program, 'pool') || findProgramAccountKey(program, 'Pool');
      if (!poolAccountKey) {
        throw new Error('Pool account type not found in program.account (check IDL)');
      }
      console.log('Using poolAccountKey:', poolAccountKey);
      try {
        // 1) Anchor decode (may return {} if IDL mismatch)
        const poolAccount = await program.account[poolAccountKey].fetch(POOL_PDA);

        // expose for console
        if (typeof window !== "undefined") window._debugPool = poolAccount;
        console.log("RAW poolAccount (from program.account.fetch):", poolAccount);
        try {
          console.log("poolAccount keys:", Object.keys(poolAccount));
        } catch (kErr) {
          console.warn("Could not enumerate poolAccount keys:", kErr);
        }

        // 2) Raw RPC inspect to check if on-chain data exists and its length
        let info = null;
        try {
          info = await connection.getAccountInfo(POOL_PDA);
          if (typeof window !== "undefined") window._debugPoolInfo = info;
          if (info === null) {
            console.warn("getAccountInfo returned null — PDA account does not exist on-chain (not initialized).");
          } else {
            console.log("getAccountInfo:", {
              lamports: info.lamports,
              owner: info.owner?.toString(),
              dataLength: info.data ? (Array.isArray(info.data) ? info.data[0].length : (info.data.length || 0)) : 0,
              data_base64: (() => {
                try {
                  if (info.data && info.data.length) {
                    if (typeof Buffer !== "undefined" && info.data instanceof Uint8Array) {
                      return Buffer.from(info.data).toString('base64').slice(0, 200) + (info.data.length > 200 ? '...' : '');
                    }
                    if (Array.isArray(info.data) && typeof info.data[0] === 'string') {
                      return info.data[0].slice(0,200) + (info.data[0].length > 200 ? '...' : '');
                    }
                  }
                } catch (e) {}
                return "(no data preview)";
              })()
            });
          }
        } catch (rpcErr) {
          console.warn("getAccountInfo failed:", rpcErr);
        }

        // 3) Build serializable preview (Anchor-decoded fields if any)
        const serializable = {};
        for (const k of Object.keys(poolAccount || {})) {
          const v = poolAccount[k];
          try {
            if (v && typeof v === "object" && typeof v.toString === "function" && v.toString() !== "[object Object]") {
              serializable[k] = v.toString();
            } else if (v && v._bn) {
              serializable[k] = v._bn.toString();
            } else if (v instanceof Uint8Array || (v && v.buffer && v.byteLength)) {
              try {
                serializable[k] = Buffer.from(v).toString('hex').slice(0, 64) + (v.length > 32 ? '...' : '');
              } catch (bufErr) {
                serializable[k] = `Uint8Array(len=${v.length})`;
              }
            } else {
              serializable[k] = JSON.stringify(v);
            }
          } catch (convErr) {
            try { serializable[k] = String(v); } catch (e) { serializable[k] = "<unserializable>"; }
          }
        }

        // 4) Best-guess parse of raw bytes (if info.data exists)
        if (info && info.data) {
          try {
            // normalize info.data -> Uint8Array
            let bytes;
            if (Array.isArray(info.data) && typeof info.data[0] === "string") {
              // [base64, encoding]
              const b64 = info.data[0];
              bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
            } else if (info.data instanceof Uint8Array) {
              bytes = info.data;
            } else if (typeof Buffer !== "undefined" && info.data instanceof Buffer) {
              bytes = Uint8Array.from(info.data);
            } else {
              // fallback: try convert
              try {
                bytes = Uint8Array.from(info.data);
              } catch (e) {
                bytes = null;
              }
            }

            if (bytes) {
              // Put bytes in Buffer for convenient reads when Buffer is available
              const buf = (typeof Buffer !== "undefined") ? Buffer.from(bytes) : bytes;

              // anchor/account discriminator is 8 bytes — skip it
              const DISC = 8;
              if (buf.length > DISC + 32 * 3) {
                const authorityBuf = buf.slice(DISC, DISC + 32);
                const rewardMintBuf = buf.slice(DISC + 32, DISC + 64);
                const rewardVaultBuf = buf.slice(DISC + 64, DISC + 96);
                const offsetAfterPubkeys = DISC + 96;

                // read u64 rewardRatePerSecond at offset
                const rrOffset = offsetAfterPubkeys;
                const rate = readU64LE(buf, rrOffset);

                // assume totalStaked is u128 next
                const totalOffset = rrOffset + 8;
                const totalStaked = readU128LE(buf, totalOffset);

                // lastUpdated u64 after that
                const lastUpdatedOffset = totalOffset + 16;
                const lastUpdated = readU64LE(buf, lastUpdatedOffset);

                // Convert pubkey buffers to strings
                const authorityPk = (() => {
                  try { return new PublicKey(authorityBuf).toString(); } catch (e) { return null; }
                })();
                const rewardMintPk = (() => {
                  try { return new PublicKey(rewardMintBuf).toString(); } catch (e) { return null; }
                })();
                const rewardVaultPk = (() => {
                  try { return new PublicKey(rewardVaultBuf).toString(); } catch (e) { return null; }
                })();

                // store guessed fields if they look valid
                serializable._parsed = {
                  authority: authorityPk,
                  rewardMint: rewardMintPk,
                  rewardVault: rewardVaultPk,
                  rewardRatePerSecond: rate.toString(),
                  totalStaked: totalStaked.toString(),
                  lastUpdated: lastUpdated.toString(),
                  rawDataLen: buf.length,
                };

                // also include hex preview of remaining tail bytes
                try {
                  serializable._tailHex = buf.slice(lastUpdatedOffset + 8).toString('hex').slice(0, 200) + (buf.length > (lastUpdatedOffset + 8 + 100) ? '...' : '');
                } catch (e) {
                  serializable._tailHex = "(no hex preview)";
                }

                // expose raw bytes in window for debugging
                if (typeof window !== "undefined") {
                  window._debugPoolBytes = buf;
                }
              } else {
                serializable._parseNote = "raw data length too small for best-guess parse";
              }
            } else {
              serializable._parseNote = "could not normalize account.data to bytes";
            }
          } catch (parseErr) {
            serializable._parseError = (parseErr && parseErr.message) ? parseErr.message : String(parseErr);
            console.warn("Best-guess parse failed:", parseErr);
          }
        } else {
          serializable._parseNote = "no raw RPC account data available";
        }

        setPool({ raw: poolAccount, serializable });
        setStatus('Pool loaded');

      } catch (fetchErr) {
        console.error("Error fetching pool account (Anchor):", fetchErr && fetchErr.stack ? fetchErr.stack : fetchErr);
        setStatus(`Failed to fetch pool: ${fetchErr.message || fetchErr}`);
      }
    } catch (err) {
      console.error('fetchPool error', err && err.stack ? err.stack : err);
      setStatus(`Failed to fetch pool: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (program) {
      setTimeout(() => {
        fetchPool();
      }, 300);
    }
  }, [program]);

  const fetchUserInfo = async () => {
    if (!program || !wallet.publicKey) return;
    try {
      const userPub = wallet.publicKey;
      const seeds = [Buffer.from("user"), userPub.toBuffer(), POOL_PDA.toBuffer()];
      const [userPda] = await PublicKey.findProgramAddress(seeds, PROGRAM_ID);

      const userStateKey = findProgramAccountKey(program, 'user_state') || findProgramAccountKey(program, 'userState') || findProgramAccountKey(program, 'UserState');
      let userAccount = null;
      if (userStateKey) {
        try {
          userAccount = await program.account[userStateKey].fetch(userPda);
        } catch (uaErr) {
          console.warn("Could not fetch user account (maybe not initialized):", uaErr && uaErr.message ? uaErr.message : uaErr);
          userAccount = null;
        }
      } else {
        console.warn('user state account key not found in program.account; skipping user fetch');
      }
      setUserState({ account: userAccount, pubkey: userPda });
    } catch (err) {
      console.warn('Could not fetch user info:', err && err.stack ? err.stack : err);
      setUserState(null);
    }
  };

  useEffect(() => {
    if (program && wallet.publicKey) {
      setTimeout(() => {
        fetchUserInfo();
      }, 300);
    }
  }, [program, wallet.publicKey]);

  const sendTx = async (txPromise, successMessage = "Done") => {
    setStatus("Sending transaction...");
    try {
      const sig = await txPromise();
      setStatus(`Transaction sent: ${sig}. Waiting confirmation...`);
      await connection.confirmTransaction(sig, 'confirmed');
      setStatus(`${successMessage}: ${sig}`);
      await fetchPool();
      await fetchUserInfo();
      return sig;
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      setStatus(`Transaction failed: ${err.message || err}`);
      throw err;
    }
  };

  // Stake / Unstake / Claim (use pool.raw if needed)
  const stake = async () => {
    if (!program || !wallet.publicKey) return setStatus('Connect wallet');
    if (!stakeAmount || stakeAmount <= 0) return setStatus('Enter a valid stake amount');

    setStatus('Preparing stake transaction...');
    try {
      if (!pool || !pool.raw) return setStatus('Pool not loaded or reward mint unknown');
      // try to get reward mint from parsed data first, else fallback to pool.raw fields
      const rewardMintStr = pool.serializable && pool.serializable.rewardMint ? pool.serializable.rewardMint : (pool.raw.rewardMint ? pool.raw.rewardMint : null);
      if (!rewardMintStr) return setStatus('Pool rewardMint not available');
      const rewardMint = new PublicKey(rewardMintStr);
      const decimals = 9;

      const userStakingAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);
      const poolVault = await getAssociatedTokenAddress(rewardMint, POOL_PDA, true);
      const rawAmount = new anchor.BN(Math.floor(stakeAmount * Math.pow(10, decimals)).toString());

      const seeds = [Buffer.from('user'), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()];
      const [userPda] = await PublicKey.findProgramAddress(seeds, PROGRAM_ID);

      const mapping = {
        pool: POOL_PDA,
        user_state: userPda,
        user: wallet.publicKey,
        user_token_account: userStakingAta,
        pool_vault: poolVault,
        userState: userPda,
        userTokenAccount: userStakingAta,
        poolVault: poolVault,
      };
      const accounts = buildAccountsObjectForInstruction('stake', mapping);

      await sendTx(async () => {
        const sig = await program.rpc.stake(rawAmount, { accounts });
        return sig;
      }, 'Stake successful');

    } catch (err) {
      console.error('stake error', err && err.stack ? err.stack : err);
      setStatus(`Stake failed: ${err.message || err}`);
    }
  };

  const unstake = async () => {
    if (!program || !wallet.publicKey) return setStatus('Connect wallet');
    setStatus('Sending unstake...');
    try {
      if (!pool || !pool.raw) return setStatus('Pool not loaded or reward mint unknown');
      const rewardMintStr = pool.serializable && pool.serializable.rewardMint ? pool.serializable.rewardMint : (pool.raw.rewardMint ? pool.raw.rewardMint : null);
      if (!rewardMintStr) return setStatus('Pool rewardMint not available');
      const rewardMint = new PublicKey(rewardMintStr);
      const userStakingAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);
      const poolVault = await getAssociatedTokenAddress(rewardMint, POOL_PDA, true);
      const rawAmount = new anchor.BN(Math.floor(stakeAmount * Math.pow(10, 9)).toString());

      const seeds = [Buffer.from('user'), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()];
      const [userPda] = await PublicKey.findProgramAddress(seeds, PROGRAM_ID);

      const mapping = {
        pool: POOL_PDA,
        user_state: userPda,
        user: wallet.publicKey,
        user_token_account: userStakingAta,
        pool_vault: poolVault,
        userTokenAccount: userStakingAta,
        poolVault: poolVault,
        userState: userPda,
      };
      const accounts = buildAccountsObjectForInstruction('unstake', mapping);

      await sendTx(async () => {
        const sig = await program.rpc.unstake(rawAmount, { accounts });
        return sig;
      }, 'Unstake successful');

    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      setStatus(`Unstake failed: ${err.message || err}`);
    }
  };

  const claim = async () => {
    if (!program || !wallet.publicKey) return setStatus('Connect wallet');
    setStatus('Sending claim...');
    try {
      if (!pool || !pool.raw) return setStatus('Pool not loaded or reward mint unknown');
      const rewardMintStr = pool.serializable && pool.serializable.rewardMint ? pool.serializable.rewardMint : (pool.raw.rewardMint ? pool.raw.rewardMint : null);
      if (!rewardMintStr) return setStatus('Pool rewardMint not available');
      const rewardMint = new PublicKey(rewardMintStr);
      const userRewardAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);

      const seeds = [Buffer.from('user'), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()];
      const [userPda] = await PublicKey.findProgramAddress(seeds, PROGRAM_ID);

      const rewardVaultStr = (pool.serializable && pool.serializable.rewardVault) ? pool.serializable.rewardVault : (pool.raw.rewardVault ? pool.raw.rewardVault : null);
      if (!rewardVaultStr) return setStatus('Pool rewardVault not available');

      const mapping = {
        pool: POOL_PDA,
        user_state: userPda,
        user: wallet.publicKey,
        user_reward_account: userRewardAta,
        reward_vault: new PublicKey(rewardVaultStr),
        userRewardAccount: userRewardAta,
        rewardVault: new PublicKey(rewardVaultStr),
        userState: userPda,
      };

      const accounts = buildAccountsObjectForInstruction('claim_rewards', mapping);

      await sendTx(async () => {
        const sig = await program.rpc.claimRewards({ accounts });
        return sig;
      }, 'Claim successful');

    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      setStatus(`Claim failed: ${err.message || err}`);
    }
  };

  // -----------------------------
  // UI render (updated for pool.serializable)
  // -----------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between py-6">
          <h1 className="text-2xl font-semibold">HZK Staking Dashboard</h1>
          <div className="flex items-center space-x-4">
            <WalletMultiButton />
          </div>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-2 bg-white/5 rounded-2xl p-6 shadow-lg">
            <h2 className="text-lg font-medium mb-4">Pool Info</h2>
            {loading && <div>Loading...</div>}

            {!loading && pool && pool.raw && (
              <div className="space-y-3 text-sm">
                {/* Prefer parsed values if available (_parsed), else show serializable anchor fields */}
                {pool.serializable._parsed ? (
                  <>
                    <div><strong>Authority:</strong> {pool.serializable._parsed.authority}</div>
                    <div><strong>Reward Mint:</strong> {pool.serializable._parsed.rewardMint}</div>
                    <div><strong>Reward Vault:</strong> {pool.serializable._parsed.rewardVault}</div>
                    <div><strong>Reward rate / sec:</strong> {pool.serializable._parsed.rewardRatePerSecond}</div>
                    <div><strong>Total staked:</strong> {pool.serializable._parsed.totalStaked}</div>
                    <div><strong>Last updated (unix sec):</strong> {pool.serializable._parsed.lastUpdated} {pool.serializable._parsed.lastUpdated ? `(${new Date(Number(pool.serializable._parsed.lastUpdated)*1000).toLocaleString()})` : ''}</div>
                  </>
                ) : (
                  <>
                    {pool.serializable.authority && <div><strong>Authority:</strong> {pool.serializable.authority}</div>}
                    {pool.serializable.rewardMint && <div><strong>Reward Mint:</strong> {pool.serializable.rewardMint}</div>}
                    {pool.serializable.rewardVault && <div><strong>Reward Vault:</strong> {pool.serializable.rewardVault}</div>}
                    {pool.serializable.rewardRatePerSecond && <div><strong>Reward rate / sec:</strong> {pool.serializable.rewardRatePerSecond}</div>}
                    {pool.serializable.totalStaked && <div><strong>Total staked:</strong> {pool.serializable.totalStaked}</div>}
                    {pool.serializable.lastUpdated && <div><strong>Last updated:</strong> {new Date(Number(pool.serializable.lastUpdated) * 1000).toLocaleString()}</div>}
                  </>
                )}

                {/* Debug info */}
                <div className="mt-2 p-3 bg-white/3 rounded-md text-xs">
                  <div className="font-medium mb-1">Pool debug (serializable):</div>
                  <pre className="whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(pool.serializable, null, 2)}</pre>
                  <div className="mt-2 text-xxs text-slate-400">Console also contains RAW poolAccount and getAccountInfo. If values look wrong, paste pool.serializable._parsed here and I'll refine offsets.</div>
                </div>
              </div>
            )}

            {!loading && (!pool || !pool.raw) && (
              <div className="text-sm text-slate-300">Pool data not available yet. Ensure IDL is in /public/idl/hzk_staking.json and the program id / PDA are configured above.</div>
            )}

            <div className="mt-6">
              <h3 className="text-md font-medium mb-2">Status</h3>
              <div className="p-3 bg-white/5 rounded-md">{status || 'Idle'}</div>
            </div>

          </section>

          <aside className="bg-white/5 rounded-2xl p-6 shadow-lg">
            <h2 className="text-lg font-medium mb-4">Actions</h2>

            <label className="block text-sm mb-2">Amount to stake (whole tokens)</label>
            <input type="number" value={stakeAmount} onChange={e=>setStakeAmount(Number(e.target.value))} className="w-full p-2 rounded-md bg-white/10 mb-3" />
            <button onClick={stake} className="w-full py-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-500">Stake</button>
            <button onClick={unstake} className="w-full py-2 rounded-xl bg-amber-500/90 hover:bg-amber-500 mt-2">Unstake</button>
            <button onClick={claim} className="w-full py-2 rounded-xl bg-indigo-500/90 hover:bg-indigo-500 mt-2">Claim rewards</button>

            <div className="mt-6 text-sm text-slate-300">
              <div><strong>Your address:</strong> {wallet.publicKey ? wallet.publicKey.toString() : 'Not connected'}</div>
              <div><strong>Your staked:</strong> {userState && userState.account ? formatTokenAmount(userState.account.amount) : '—'}</div>
            </div>
          </aside>
        </main>

        <footer className="mt-8 text-center text-xs text-slate-400">Built for devnet. Test with Phantom on devnet.</footer>
      </div>
    </div>
  );
}

// -----------------------------
// Wrapper component
// -----------------------------
export default function StakingApp() {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = DEFAULT_RPC;
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <StakingAppInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
