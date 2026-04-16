import { HTLCSimulator } from "./htlc-simulator.js";
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

describe("HTLC atomic swap contract", () => {
  it("initializes with inactive HTLC state", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)));
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(state.htlcHash).toEqual(ZERO_BYTES_32);
    expect(state.htlcCoinNonce).toEqual(ZERO_BYTES_32);
    expect(state.htlcCoinColor).toEqual(ZERO_BYTES_32);
    expect(state.htlcCoinValue).toBe(0n);
    expect(state.htlcExpiryTime).toBe(0n);
    expect(state.htlcSender).toEqual(ZERO_BYTES_32);
    expect(state.htlcReceiver).toEqual(ZERO_BYTES_32);
  });

  it("returns a consistent public key via myAddr()", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)));
    const addr1 = sim.myAddr();
    const addr2 = sim.myAddr();
    expect(addr1).toEqual(addr2);
    expect(addr1.length).toBe(32);
  });

  it("returns different addresses for different users", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)));
    const addr1 = sim.myAddr();
    sim.switchUser(toHex(randomBytes(32)));
    const addr2 = sim.myAddr();
    expect(addr1).not.toEqual(addr2);
  });

  it("allows deposit with valid hash and future expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    // Get addresses
    const senderAddr = sim.myAddr();
    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    // Mint a coin
    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));

    // Create hash lock
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);

    // Deposit
    const result = sim.deposit(coin, hash, expiryTime, receiverAddr);

    // Verify ledger state
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(true);
    expect(state.htlcHash).toEqual(hash);
    expect(state.htlcExpiryTime).toBe(expiryTime);
    expect(state.htlcSender).toEqual(senderAddr);
    expect(state.htlcReceiver).toEqual(receiverAddr);
    expect(state.htlcCoinValue).toBeGreaterThan(0n);
    expect(result.sent.value).toBeGreaterThan(0n);
  });

  it("rejects deposit when HTLC is already active", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)), NOW);
    sim.switchUser(toHex(randomBytes(32)));
    const receiverAddr = sim.myAddr();
    sim.switchUser(toHex(randomBytes(32)));

    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);

    // First deposit
    const coin1 = sim.mintQualifiedCoin(randomBytes(32), 500n, randomBytes(32));
    sim.deposit(coin1, hash, expiryTime, receiverAddr);

    // Second deposit should fail
    const coin2 = sim.mintQualifiedCoin(randomBytes(32), 500n, randomBytes(32));
    expect(() => sim.deposit(coin2, hash, expiryTime, receiverAddr)).toThrow(
      "HTLC already active",
    );
  });

  it("rejects deposit with past expiry time", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)), NOW);
    const receiverAddr = randomBytes(32);
    const coin = sim.mintQualifiedCoin(randomBytes(32), 500n, randomBytes(32));
    const hash = hashPreimage(randomBytes(32));
    const pastExpiry = BigInt(NOW - ONE_HOUR);

    expect(() => sim.deposit(coin, hash, pastExpiry, receiverAddr)).toThrow(
      "Expiry time must be in the future",
    );
  });

  it("allows receiver to withdraw with correct preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    // Get receiver address
    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    // Mint, compute hash, deposit
    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);
    sim.deposit(coin, hash, expiryTime, receiverAddr);

    // Get the mt_index for the locked coin
    const lockedCoinMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Switch to receiver and withdraw
    sim.switchUser(receiverKey);
    sim.withdraw(preimage, lockedCoinMtIndex);

    // Verify state is cleared
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(state.htlcHash).toEqual(ZERO_BYTES_32);
    expect(state.htlcCoinValue).toBe(0n);
    expect(state.htlcExpiryTime).toBe(0n);
    expect(state.htlcSender).toEqual(ZERO_BYTES_32);
    expect(state.htlcReceiver).toEqual(ZERO_BYTES_32);
  });

  it("rejects withdraw with wrong preimage", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    sim.deposit(coin, hash, BigInt(NOW + ONE_HOUR), receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Switch to receiver but use wrong preimage
    sim.switchUser(receiverKey);
    const wrongPreimage = randomBytes(32);
    expect(() => sim.withdraw(wrongPreimage, lockedMtIndex)).toThrow(
      "Invalid preimage",
    );
  });

  it("rejects withdraw by non-receiver", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    sim.deposit(coin, hash, BigInt(NOW + ONE_HOUR), receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Attacker tries to withdraw with the correct preimage
    sim.switchUser(attackerKey);
    expect(() => sim.withdraw(preimage, lockedMtIndex)).toThrow(
      "Only designated receiver can withdraw",
    );
  });

  it("rejects withdraw after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);
    sim.deposit(coin, hash, expiryTime, receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Advance time past expiry
    sim.setBlockTime(NOW + ONE_HOUR + 1);
    sim.switchUser(receiverKey);
    expect(() => sim.withdraw(preimage, lockedMtIndex)).toThrow(
      "HTLC has expired",
    );
  });

  it("allows sender to reclaim after expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    //const senderAddr = sim.myAddr();
    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const preimage = randomBytes(32);
    const hash = hashPreimage(preimage);
    const expiryTime = BigInt(NOW + ONE_HOUR);
    sim.deposit(coin, hash, expiryTime, receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Advance time past expiry
    sim.setBlockTime(NOW + ONE_HOUR + 1);

    // Sender reclaims
    sim.switchUser(senderKey);
    sim.reclaim(lockedMtIndex);

    // Verify state is cleared
    const state = sim.getLedger();
    expect(state.htlcActive).toBe(false);
    expect(state.htlcCoinValue).toBe(0n);
  });

  it("rejects reclaim before expiry", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const hash = hashPreimage(randomBytes(32));
    sim.deposit(coin, hash, BigInt(NOW + ONE_HOUR), receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Try to reclaim before expiry
    expect(() => sim.reclaim(lockedMtIndex)).toThrow(
      "HTLC has not expired yet",
    );
  });

  it("rejects reclaim by non-sender", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const attackerKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    const coin = sim.mintQualifiedCoin(randomBytes(32), 1000n, randomBytes(32));
    const hash = hashPreimage(randomBytes(32));
    sim.deposit(coin, hash, BigInt(NOW + ONE_HOUR), receiverAddr);

    const lockedMtIndex =
      sim.circuitContext.currentZswapLocalState.currentIndex - 1n;

    // Advance time past expiry
    sim.setBlockTime(NOW + ONE_HOUR + 1);

    // Attacker tries to reclaim
    sim.switchUser(attackerKey);
    expect(() => sim.reclaim(lockedMtIndex)).toThrow(
      "Only original sender can reclaim",
    );
  });

  it("rejects withdraw when no HTLC is active", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)), NOW);
    expect(() => sim.withdraw(randomBytes(32), 0n)).toThrow("No active HTLC");
  });

  it("rejects reclaim when no HTLC is active", () => {
    const sim = new HTLCSimulator(toHex(randomBytes(32)), NOW);
    expect(() => sim.reclaim(0n)).toThrow("No active HTLC");
  });

  it("allows a new deposit after successful withdraw", () => {
    const senderKey = toHex(randomBytes(32));
    const receiverKey = toHex(randomBytes(32));
    const sim = new HTLCSimulator(senderKey, NOW);

    sim.switchUser(receiverKey);
    const receiverAddr = sim.myAddr();
    sim.switchUser(senderKey);

    // First round: deposit and withdraw
    const coin1 = sim.mintQualifiedCoin(randomBytes(32), 500n, randomBytes(32));
    const preimage1 = randomBytes(32);
    sim.deposit(
      coin1,
      hashPreimage(preimage1),
      BigInt(NOW + ONE_HOUR),
      receiverAddr,
    );
    const mt1 = sim.circuitContext.currentZswapLocalState.currentIndex - 1n;
    sim.switchUser(receiverKey);
    sim.withdraw(preimage1, mt1);

    // Second round: new deposit should succeed
    sim.switchUser(senderKey);
    const coin2 = sim.mintQualifiedCoin(randomBytes(32), 700n, randomBytes(32));
    const preimage2 = randomBytes(32);
    sim.deposit(
      coin2,
      hashPreimage(preimage2),
      BigInt(NOW + ONE_HOUR),
      receiverAddr,
    );

    const state = sim.getLedger();
    expect(state.htlcActive).toBe(true);
  });
});
