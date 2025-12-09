"use client";
import React from "react";
import * as anchor from "@project-serum/anchor";
import { PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("CRDwYUDJuhAjUNmxWwHnQD5rWbGnwvUjCNx5fqFYQjkn");
const POOL_PDA = new PublicKey("7JTJnze4Wru7byHHJofnCt5kash5PfDpZowisvNu8s9n");

async function loadIdl() {
  const res = await fetch("/idl/hzk_staking.json");
  if (!res.ok) throw new Error("Failed to load IDL. Place your IDL at /idl/hzk_staking.json in the public folder.");
  return res.json();
}

function deepClone(obj: any) { return JSON.parse(JSON.stringify(obj || {})); }
function collectDefinedTypeNames(obj: any, set = new Set<string>()) {
  if (!obj || typeof obj !== "object") return set;
  if (Array.isArray(obj)) { for (const v of obj) collectDefinedTypeNames(v, set); return set; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "defined" && typeof v === "string") set.add(v as string);
    else if (typeof v === "object" && v !== null) collectDefinedTypeNames(v, set);
  }
  return set;
}
function makePlaceholderType(name: string) { return { name, type: { kind: "struct", fields: [] } }; }
function normalizeFieldType(field: any) {
  if (!field) return field;
  if (typeof field.type === "string") {
    const s = field.type; const normalized = (s === "pubkey" ? "publicKey" : s);
    field.type = { defined: normalized };
  } else if (typeof field.type === "number" || typeof field.type === "boolean") {
    field.type = { defined: String(field.type) };
  }
  return field;
}
function sanitizeIdlForAnchor(rawIdl: any) {
  const idl = deepClone(rawIdl || {});
  if (!Array.isArray((idl as any).accounts) && Array.isArray((idl as any).idlAccounts)) (idl as any).accounts = (idl as any).idlAccounts;
  if (!Array.isArray((idl as any).accounts)) (idl as any).accounts = [];
  if (!Array.isArray((idl as any).types)) (idl as any).types = [];
  (idl as any).types = (idl as any).types.map((t: any, idx: number) => {
    if (!t || typeof t !== "object") return makePlaceholderType(`__MALFORMED_TYPE_${idx}`);
    if (!t.name || typeof t.name !== "string") t.name = t.name || `__ANON_TYPE_${idx}`;
    if (!t.type || typeof t.type !== "object") { t.type = { kind: "struct", fields: [] }; }
    else {
      if (!("kind" in t.type)) {
        if (Array.isArray(t.type.fields)) t.type.kind = "struct";
        else if (Array.isArray(t.type.variants)) t.type.kind = "enum";
        else t.type.kind = "struct";
      }
      if (t.type.kind === "struct" && !Array.isArray(t.type.fields)) t.type.fields = [];
      if (t.type.kind === "enum" && !Array.isArray(t.type.variants)) t.type.variants = [];
    }
    if (t.type.kind === "struct" && Array.isArray(t.type.fields)) t.type.fields = t.type.fields.map((f: any) => normalizeFieldType(f));
    return t;
  });
  (idl as any).accounts = (idl as any).accounts.map((acc: any, idx: number) => {
    if (!acc || typeof acc !== "object") return { name: `__MALFORMED_ACCOUNT_${idx}`, type: { kind: "struct", fields: [] } };
    if (!acc.name || typeof acc.name !== "string") acc.name = acc.name || `__ACCOUNT_${idx}`;
    if (typeof acc.type === "string") acc.type = { defined: acc.type };
    else if (!acc.type || typeof acc.type !== "object") acc.type = { kind: "struct", fields: [] };
    else if (acc.type.kind === "struct" && Array.isArray(acc.type.fields)) acc.type.fields = acc.type.fields.map((f: any) => normalizeFieldType(f));
    return acc;
  });
  if (Array.isArray((idl as any).instructions)) {
    (idl as any).instructions = (idl as any).instructions.map((instr: any) => {
      if (!instr || typeof instr !== "object") return instr;
      if (Array.isArray(instr.args)) instr.args = instr.args.map((arg: any) => { if (arg && typeof arg === "object" && typeof arg.type === "string") arg.type = { defined: arg.type }; return arg; });
      if (Array.isArray(instr.accounts)) instr.accounts = instr.accounts.map((a: any, idx2: number) => ({ name: a?.name || `account_${idx2}`, ...a }));
      return instr;
    });
  }
  const referenced = collectDefinedTypeNames(idl);
  for (const t of (idl as any).types) {
    if (t && t.type && t.type.kind === "struct" && Array.isArray(t.type.fields)) {
      for (const f of t.type.fields) { if (f && f.type && typeof f.type === "object" && typeof f.type.defined === "string") referenced.add(f.type.defined); }
    }
  }
  const existingTypeNames = new Set(((idl as any).types || []).map((tt: any) => tt && tt.name).filter(Boolean));
  for (const name of referenced as Set<string>) { if (!existingTypeNames.has(name)) { (idl as any).types.push(makePlaceholderType(name)); existingTypeNames.add(name); } }
  (idl as any).types = (idl as any).types.map((t: any, idx: number) => {
    if (!t || typeof t !== "object") return makePlaceholderType(`__FINAL_MALFORMED_${idx}`);
    if (!t.name || typeof t.name !== "string") t.name = `__FINAL_TYPE_${idx}`;
    if (!t.type || typeof t.type !== "object") t.type = { kind: "struct", fields: [] };
    if (!("kind" in t.type)) { if (Array.isArray(t.type.fields)) t.type.kind = "struct"; else if (Array.isArray(t.type.variants)) t.type.kind = "enum"; else t.type.kind = "struct"; }
    if (t.type.kind === "struct" && !Array.isArray(t.type.fields)) t.type.fields = [];
    if (t.type.kind === "enum" && !Array.isArray(t.type.variants)) t.type.variants = [];
    if (t.type.kind === "struct") t.type.fields = t.type.fields.map((f: any) => normalizeFieldType(f));
    return t;
  });
  return idl;
}

function readU64LE(buf: Buffer, offset: number) {
  try { if (typeof (buf as any).readBigUInt64LE === "function") return BigInt((buf as any).readBigUInt64LE(offset)); } catch {}
  let res = 0n; for (let i = 0; i < 8; i++) res |= BigInt(buf[offset + i]) << BigInt(8 * i); return res;
}
function readU128LE(buf: Buffer, offset: number) { const low = readU64LE(buf, offset); const high = readU64LE(buf, offset + 8); return (high << 64n) | low; }

export function useStaking() {
  const wallet = useWallet();
  const { connection: providedConnection } = useConnection();
  const connection = providedConnection ?? new Connection(DEFAULT_RPC, "confirmed");
  const [program, setProgram] = React.useState<anchor.Program | null>(null);
  const [idl, setIdl] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [pool, setPool] = React.useState<any>(null);
  const [status, setStatus] = React.useState("");
  const [stakeAmount, setStakeAmount] = React.useState<number | "">("");
  const [userState, setUserState] = React.useState<any>(null);

  const provider = React.useMemo(() => {
    if (!wallet || !wallet.publicKey) return null;
    return new anchor.AnchorProvider(connection, wallet as any, anchor.AnchorProvider.defaultOptions());
  }, [wallet, connection]);

  const dummyWallet = React.useMemo(() => ({
    publicKey: PublicKey.default,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  }), []);

  React.useEffect(() => {
    (async () => {
      try {
        const loaded = await loadIdl();
        const sanitized = sanitizeIdlForAnchor(loaded);
        setIdl(sanitized);
        const effectiveProvider = provider || new anchor.AnchorProvider(connection, dummyWallet as any, anchor.AnchorProvider.defaultOptions());
        const p = new anchor.Program(sanitized as any, PROGRAM_ID, effectiveProvider);
        setProgram(p);
      } catch (err: any) {
        setStatus(`Could not load IDL yet: ${err?.message || err}`);
      }
    })();
  }, [connection, provider, dummyWallet]);

  function getIdlInstructionByName(name: string) { if (!idl?.instructions) return null; return idl.instructions.find((i: any) => i.name === name) || null; }
  function getIdlAccountNamesForInstruction(name: string) { const instr = getIdlInstructionByName(name); return instr?.accounts ? instr.accounts.map((a: any) => a.name) : []; }
  function findProgramAccountKey(programObj: any, desired: string) {
    if (!programObj?.account) return null; const keys = Object.keys(programObj.account);
    let k = keys.find((x) => x === desired) || keys.find((x) => x.toLowerCase() === desired.toLowerCase());
    if (k) return k; const camel = desired.replace(/_([a-z])/g, (_: string, ch: string) => ch.toUpperCase());
    k = keys.find((x) => x === camel || x.toLowerCase() === camel.toLowerCase());
    return k || null;
  }
  function buildAccountsObjectForInstruction(instrName: string, mapping: Record<string, any>) {
    const accountNames = getIdlAccountNamesForInstruction(instrName); const accountsObj: Record<string, any> = {};
    for (const name of accountNames) {
      if (Object.prototype.hasOwnProperty.call(mapping, name)) { accountsObj[name] = mapping[name]; continue; }
      const camel = name.replace(/_([a-z])/g, (_: string, ch: string) => ch.toUpperCase());
      if (Object.prototype.hasOwnProperty.call(mapping, camel)) { accountsObj[name] = mapping[camel]; continue; }
      if (name === "token_program") accountsObj[name] = TOKEN_PROGRAM_ID;
      else if (name === "system_program") accountsObj[name] = SystemProgram.programId;
      else if (name === "rent") accountsObj[name] = (anchor as any).web3.SYSVAR_RENT_PUBKEY;
      else accountsObj[name] = (mapping as any)[name] ?? (mapping as any)[camel];
    }
    return accountsObj;
  }

  const fetchPool = React.useCallback(async () => {
    if (!program) return; setLoading(true);
    try {
      const poolAccountKey = findProgramAccountKey(program, "pool") || findProgramAccountKey(program, "Pool");
      if (!poolAccountKey) throw new Error("Pool account type not found in program.account (check IDL)");
      const poolAccount: any = await (program as any).account[poolAccountKey].fetch(POOL_PDA);
      let info: any = null;
      try { info = await connection.getAccountInfo(POOL_PDA); } catch {}
      const serializable: any = {};
      for (const k of Object.keys(poolAccount || {})) {
        const v: any = (poolAccount as any)[k];
        try {
          if (v && typeof v === "object" && typeof v.toString === "function" && v.toString() !== "[object Object]") serializable[k] = v.toString();
          else if (v && (v as any)._bn) serializable[k] = (v as any)._bn.toString();
          else if (v instanceof Uint8Array || (v && (v as any).buffer && (v as any).byteLength)) serializable[k] = Buffer.from(v as any).toString("hex").slice(0, 64);
          else serializable[k] = JSON.stringify(v);
        } catch { try { serializable[k] = String(v); } catch { serializable[k] = "<unserializable>"; } }
      }
      if (info?.data) {
        try {
          let bytes: Uint8Array | null = null;
          if (Array.isArray(info.data) && typeof info.data[0] === "string") bytes = Uint8Array.from(Buffer.from(info.data[0], "base64"));
          else if (info.data instanceof Uint8Array) bytes = info.data;
          else if (typeof Buffer !== "undefined" && (info.data as any) instanceof Buffer) bytes = Uint8Array.from(info.data as any);
          else try { bytes = Uint8Array.from(info.data as any); } catch { bytes = null; }
          if (bytes) {
            const buf = Buffer.from(bytes);
            const DISC = 8;
            if (buf.length > DISC + 32 * 3) {
              const authorityPk = new PublicKey(buf.slice(DISC, DISC + 32)).toString();
              const rewardMintPk = new PublicKey(buf.slice(DISC + 32, DISC + 64)).toString();
              const rewardVaultPk = new PublicKey(buf.slice(DISC + 64, DISC + 96)).toString();
              const rrOffset = DISC + 96;
              const rewardRatePerSecond = readU64LE(buf, rrOffset);
              const totalStaked = readU128LE(buf, rrOffset + 8);
              const lastUpdated = readU64LE(buf, rrOffset + 8 + 16);
              serializable._parsed = {
                authority: authorityPk,
                rewardMint: rewardMintPk,
                rewardVault: rewardVaultPk,
                rewardRatePerSecond: rewardRatePerSecond.toString(),
                totalStaked: totalStaked.toString(),
                lastUpdated: lastUpdated.toString(),
                rawDataLen: buf.length,
              };
            } else serializable._parseNote = "raw data length too small for best-guess parse";
          } else serializable._parseNote = "could not normalize account.data to bytes";
        } catch (e: any) { serializable._parseError = e?.message || String(e); }
      } else serializable._parseNote = "no raw RPC account data available";
      setPool({ raw: poolAccount, serializable }); setStatus("Pool loaded");
    } catch (err: any) { setStatus(`Failed to fetch pool: ${err?.message || err}`); }
    finally { setLoading(false); }
  }, [program, connection]);

  React.useEffect(() => { if (program) setTimeout(() => { fetchPool(); }, 300); }, [program, fetchPool]);

  const fetchUserInfo = React.useCallback(async () => {
    if (!program || !wallet.publicKey) return;
    try {
      const userPub = wallet.publicKey;
      const [userPda] = await PublicKey.findProgramAddress([Buffer.from("user"), userPub.toBuffer(), POOL_PDA.toBuffer()], PROGRAM_ID);
      const userStateKey = findProgramAccountKey(program, "user_state") || findProgramAccountKey(program, "userState") || findProgramAccountKey(program, "UserState");
      let userAccount: any = null;
      if (userStateKey) {
        try { userAccount = await (program as any).account[userStateKey].fetch(userPda); } catch { userAccount = null; }
      }
      setUserState({ account: userAccount, pubkey: userPda });
    } catch { setUserState(null); }
  }, [program, wallet.publicKey]);

  React.useEffect(() => { if (program && wallet.publicKey) setTimeout(() => { fetchUserInfo(); }, 300); }, [program, wallet.publicKey, fetchUserInfo]);

  const sendTx = React.useCallback(async (txPromise: () => Promise<string>, successMessage = "Done") => {
    setStatus("Sending transaction...");
    try {
      const sig = await txPromise();
      setStatus(`Transaction sent: ${sig}. Waiting confirmation...`);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`${successMessage}: ${sig}`);
      await fetchPool();
      await fetchUserInfo();
      return sig;
    } catch (err: any) { setStatus(`Transaction failed: ${err?.message || err}`); throw err; }
  }, [connection, fetchPool, fetchUserInfo]);

  const getRewardMintPk = () => {
    if (!pool?.raw) return null;
    const rewardMintStr = pool.serializable?.rewardMint || pool.raw.rewardMint || null;
    return rewardMintStr ? new PublicKey(rewardMintStr) : null;
  };

  const stake = React.useCallback(async () => {
    if (!program || !wallet.publicKey) return setStatus("Connect wallet");
    const amount = typeof stakeAmount === "number" ? stakeAmount : Number(stakeAmount);
    if (!amount || amount <= 0) return setStatus("Enter a valid stake amount");
    setStatus("Preparing stake transaction...");
    try {
      const rewardMint = getRewardMintPk(); if (!rewardMint) return setStatus("Pool rewardMint not available");
      const decimals = 9;
      const userStakingAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);
      const poolVault = await getAssociatedTokenAddress(rewardMint, POOL_PDA, true);
      const rawAmount = new anchor.BN(Math.floor(amount * Math.pow(10, decimals)).toString());
      const [userPda] = await PublicKey.findProgramAddress([Buffer.from("user"), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()], PROGRAM_ID);
      const mapping: any = { pool: POOL_PDA, user_state: userPda, user: wallet.publicKey, user_token_account: userStakingAta, pool_vault: poolVault, userState: userPda, userTokenAccount: userStakingAta, poolVault: poolVault };
      const accounts = buildAccountsObjectForInstruction("stake", mapping);
      await sendTx(async () => { const sig = await (program as any).rpc.stake(rawAmount, { accounts }); return sig; }, "Stake successful");
    } catch (err: any) { setStatus(`Stake failed: ${err?.message || err}`); }
  }, [program, wallet.publicKey, stakeAmount, sendTx, pool]);

  const unstake = React.useCallback(async () => {
    if (!program || !wallet.publicKey) return setStatus("Connect wallet");
    setStatus("Sending unstake...");
    try {
      const rewardMint = getRewardMintPk(); if (!rewardMint) return setStatus("Pool rewardMint not available");
      const userStakingAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);
      const poolVault = await getAssociatedTokenAddress(rewardMint, POOL_PDA, true);
      const rawAmount = new anchor.BN(Math.floor((Number(stakeAmount) || 0) * Math.pow(10, 9)).toString());
      const [userPda] = await PublicKey.findProgramAddress([Buffer.from("user"), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()], PROGRAM_ID);
      const mapping: any = { pool: POOL_PDA, user_state: userPda, user: wallet.publicKey, user_token_account: userStakingAta, pool_vault: poolVault, userTokenAccount: userStakingAta, poolVault: poolVault, userState: userPda };
      const accounts = buildAccountsObjectForInstruction("unstake", mapping);
      await sendTx(async () => { const sig = await (program as any).rpc.unstake(rawAmount, { accounts }); return sig; }, "Unstake successful");
    } catch (err: any) { setStatus(`Unstake failed: ${err?.message || err}`); }
  }, [program, wallet.publicKey, stakeAmount, sendTx, pool]);

  const claim = React.useCallback(async () => {
    if (!program || !wallet.publicKey) return setStatus("Connect wallet");
    setStatus("Sending claim...");
    try {
      const rewardMint = getRewardMintPk(); if (!rewardMint) return setStatus("Pool rewardMint not available");
      const userRewardAta = await getAssociatedTokenAddress(rewardMint, wallet.publicKey);
      const [userPda] = await PublicKey.findProgramAddress([Buffer.from("user"), wallet.publicKey.toBuffer(), POOL_PDA.toBuffer()], PROGRAM_ID);
      const rewardVaultStr = pool?.serializable?.rewardVault || pool?.raw?.rewardVault || null; if (!rewardVaultStr) return setStatus("Pool rewardVault not available");
      const mapping: any = { pool: POOL_PDA, user_state: userPda, user: wallet.publicKey, user_reward_account: userRewardAta, reward_vault: new PublicKey(rewardVaultStr), userRewardAccount: userRewardAta, rewardVault: new PublicKey(rewardVaultStr), userState: userPda };
      const accounts = buildAccountsObjectForInstruction("claim_rewards", mapping);
      await sendTx(async () => { const sig = await (program as any).rpc.claimRewards({ accounts }); return sig; }, "Claim successful");
    } catch (err: any) { setStatus(`Claim failed: ${err?.message || err}`); }
  }, [program, wallet.publicKey, sendTx, pool]);

  function formatUnixPair(unixStr?: string) {
    if (!unixStr) return "0 (N/A)";
    const n = Number(unixStr); if (!Number.isFinite(n)) return `${unixStr} (N/A)`;
    const d = new Date(n * 1000).toLocaleString();
    return `${n} (${d})`;
  }

  function formatTokenAmount(rawBN: any, decimals = 9) {
    if (rawBN == null) return "0";
    try {
      const bn = new (anchor as any).BN(rawBN.toString());
      const denom = new (anchor as any).BN(10).pow(new (anchor as any).BN(decimals));
      const whole = bn.div(denom).toString();
      const frac = bn.mod(denom).toString().padStart(decimals, "0");
      return `${whole}.${frac.slice(0, 4)}`;
    } catch {
      return String(rawBN);
    }
  }

  return {
    program,
    pool,
    loading,
    status,
    stakeAmount,
    setStakeAmount,
    userState,
    fetchPool,
    fetchUserInfo,
    stake,
    unstake,
    claim,
    formatUnixPair,
    formatTokenAmount,
  };
}
