// Tests for the FungibleToken-aware HTLC contract.
//
// This contract uses OpenZeppelin's FungibleToken module for balance-based
// token management instead of raw Zswap shielded coins. The HTLC escrow
// logic (preimage verification, deadline enforcement) is identical.

import { HTLCFTSimulator } from "./htlc-ft-simulator.js";
import {
  persistentHash,
  Bytes32Descriptor,
} from "@midnight-ntwrk/compact-runtime";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hashPreimage(preimage: Uint8Array): Uint8Array {
  return persistentHash(Bytes32Descriptor, preimage);
}

const ZERO_BYTES_32 = new Uint8Array(32);
const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;

function createSimulator(
  coinPublicKey: string,
  blockTime?: number,
): HTLCFTSimulator {
  return new HTLCFTSimulator(coinPublicKey, "SwapToken", "SWAP", 6n, blockTime);
}

describe("FungibleToken HTLC contract", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Initialization and FungibleToken basics
  // ─────────────────────────────────────────────────────────────────────

  it("initializes with inactive HTLC and zero balances", () => {
    const sim = createSimulator(toHex(randomBytes(32)));
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(state.htlcHash).toEqual(ZERO_BYTES_32);
    expect(state.htlcAmount).toBe(0n);
    expect(state.htlcExpiryTime).toBe(0n);

    const callerAddr = sim.callerAddress();
    expect(sim.balanceOf(callerAddr)).toBe(0n);
    expect(sim.totalSupply()).toBe(0n);
  });

  it("mints tokens and tracks balances correctly", () => {
    const sim = createSimulator(toHex(randomBytes(32)));
    const addr = sim.callerAddress();

    sim.mint(addr, 10_000n);
    expect(sim.balanceOf(addr)).toBe(10_000n);
    expect(sim.totalSupply()).toBe(10_000n);

    sim.mint(addr, 5_000n);
    expect(sim.balanceOf(addr)).toBe(15_000n);
    expect(sim.totalSupply()).toBe(15_000n);
  });

  it("transfers tokens between users", () => {
    const aliceKey = toHex(randomBytes(32));
    const bobKey = toHex(randomBytes(32));
    const sim = createSimulator(aliceKey);

    // Mint to Alice
    const aliceAddr = sim.callerAddress();
    sim.mint(aliceAddr, 1000n);

    // Get Bob's address
    sim.switchUser(bobKey);
    const bobAddr = sim.callerAddress();

    // Transfer from Alice to Bob
    sim.switchUser(aliceKey);
    sim.transfer(bobAddr, 300n);
    expect(sim.balanceOf(aliceAddr)).toBe(700n);
    expect(sim.balanceOf(bobAddr)).toBe(300n);
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Deposit
  // ─────────────────────────────────────────────────────────────────────

  it("deposits tokens into HTLC escrow", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    // Mint tokens to sender
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    // Get receiver address
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    // Deposit into HTLC
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);
    sim.deposit(500n, hash, expiryTime, receiverAddrBytes);

    // Verify ledger state
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(true);
    expect(state.htlcHash).toEqual(hash);
    expect(state.htlcAmount).toBe(500n);
    expect(state.htlcExpiryTime).toBe(expiryTime);

    // Sender's balance should be reduced
    expect(sim.balanceOf(senderAddr)).toBe(500n);
  });

  it("rejects deposit when HTLC is already active", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    const receiverAddr = randomBytes(32);
    const hash = hashPreimage(randomBytes(32));

    sim.deposit(500n, hash, BigInt(NOW + ONE_HOUR), receiverAddr);
    expect(() =>
      sim.deposit(500n, hash, BigInt(NOW + ONE_HOUR), receiverAddr),
    ).toThrow("HTLC already active");
  });

  it("rejects deposit with past expiry time", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    expect(() =>
      sim.deposit(500n, hashPreimage(randomBytes(32)), BigInt(NOW - ONE_HOUR), randomBytes(32)),
    ).toThrow("Expiry time must be in the future");
  });

  it("rejects deposit with insufficient balance", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 100n);

    expect(() =>
      sim.deposit(500n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32)),
    ).toThrow("insufficient balance");
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Withdraw
  // ─────────────────────────────────────────────────────────────────────

  it("allows receiver to withdraw with correct preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    // Setup: mint, get addresses, deposit
    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);

    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    const receiverAddr = sim.callerAddress();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    sim.deposit(1000n, hash, BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    // Receiver withdraws
    sim.switchUser(receiverKey);
    sim.withdraw(preimage);

    // Verify: HTLC cleared, receiver got tokens
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(state.htlcAmount).toBe(0n);
    expect(sim.balanceOf(receiverAddr)).toBe(1000n);
    expect(sim.balanceOf(senderAddr)).toBe(0n);
  });

  it("rejects withdraw with wrong preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    sim.switchUser(receiverKey);
    expect(() => sim.withdraw(randomBytes(32))).toThrow("Invalid preimage");
  });

  it("rejects withdraw by non-receiver", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    sim.switchUser(attackerKey);
    expect(() => sim.withdraw(preimage)).toThrow(
      "Only designated receiver can withdraw",
    );
  });

  it("rejects withdraw after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    const preimage = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage), BigInt(NOW + ONE_HOUR), receiverAddrBytes);

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(receiverKey);
    expect(() => sim.withdraw(preimage)).toThrow("HTLC has expired");
  });

  // ─────────────────────────────────────────────────────────────────────
  // HTLC Reclaim
  // ─────────────────────────────────────────────────────────────────────

  it("allows sender to reclaim after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    sim.deposit(1000n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    expect(sim.balanceOf(senderAddr)).toBe(0n);

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.reclaim();

    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(sim.balanceOf(senderAddr)).toBe(1000n);
  });

  it("rejects reclaim before expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.deposit(1000n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32));

    expect(() => sim.reclaim()).toThrow("HTLC has not expired yet");
  });

  it("rejects reclaim by non-sender", () => {
    const senderKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 1000n);
    sim.deposit(1000n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32));

    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(attackerKey);
    expect(() => sim.reclaim()).toThrow("Only original sender can reclaim");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────

  it("rejects withdraw/reclaim when no HTLC is active", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    expect(() => sim.withdraw(randomBytes(32))).toThrow("No active HTLC");
    expect(() => sim.reclaim()).toThrow("No active HTLC");
  });

  it("allows new deposit after successful withdraw", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = createSimulator(senderKey, NOW);

    const senderAddr = sim.callerAddress();
    sim.mint(senderAddr, 2000n);
    sim.switchUser(receiverKey);
    const receiverAddrBytes = sim.myAddr();
    sim.switchUser(senderKey);

    // Round 1: deposit and withdraw
    const preimage1 = randomBytes(32);
    sim.deposit(1000n, hashPreimage(preimage1), BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    sim.switchUser(receiverKey);
    sim.withdraw(preimage1);

    // Round 2: new deposit succeeds
    sim.switchUser(senderKey);
    const preimage2 = randomBytes(32);
    sim.deposit(500n, hashPreimage(preimage2), BigInt(NOW + ONE_HOUR), receiverAddrBytes);
    expect(sim.getLedger().htlcActive).toBe(true);
    expect(sim.getLedger().htlcAmount).toBe(500n);
  });

  it("preserves remaining balance after partial deposit", () => {
    const sim = createSimulator(toHex(randomBytes(32)), NOW);
    const addr = sim.callerAddress();
    sim.mint(addr, 1000n);

    sim.deposit(400n, hashPreimage(randomBytes(32)), BigInt(NOW + ONE_HOUR), randomBytes(32));
    expect(sim.balanceOf(addr)).toBe(600n);
    expect(sim.totalSupply()).toBe(1000n); // total supply unchanged
  });
});
