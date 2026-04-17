// HTLC-FT CLI: Cross-chain atomic swap on Midnight preprod.
//
// Replaces the bboard CLI with HTLC-FT contract operations:
// deploy, mint, deposit (create swap), withdraw (claim), reclaim (refund),
// balance check, and swap status queries.

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebSocket } from 'ws';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { encodeCoinPublicKey, unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  CompiledHTLCFTContract,
  htlcFtPrivateStateKey,
  type HTLCFTProviders,
  type HTLCFTPrivateStateId,
  type EmptyPrivateState,
  type DeployedHTLCFTContract,
  type HTLCFTContract,
  type HTLCFTCircuitKeys,
} from '../../contract/src/htlc-ft-contract';
import {
  ledger,
  type Ledger,
  type Either,
  type ZswapCoinPublicKey,
  type ContractAddress as CompactContractAddress,
} from '../../contract/src/managed/htlc-ft/contract/index.js';
import { createHash } from 'node:crypto';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─────────────────────────────────────────────────────────────────────
// Hex helpers
// ─────────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string (odd length)');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────
// Contract interaction helpers
// ─────────────────────────────────────────────────────────────────────

function callerAddr(addrBytes: Uint8Array): Either<ZswapCoinPublicKey, CompactContractAddress> {
  return {
    is_left: true,
    left: { bytes: addrBytes },
    right: { bytes: new Uint8Array(32) },
  };
}

const getLedgerState = async (
  providers: HTLCFTProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? ledger(contractState.data) : null;
};

// ─────────────────────────────────────────────────────────────────────
// Deploy or Join
// ─────────────────────────────────────────────────────────────────────

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new HTLC-FT contract
  2. Join an existing HTLC-FT contract
  3. Exit
Which would you like to do? `;

const deployOrJoin = async (
  providers: HTLCFTProviders,
  rli: Interface,
  logger: Logger,
): Promise<DeployedHTLCFTContract | null> => {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1': {
        const tokenName = (await rli.question('Token name [SwapToken]: ')) || 'SwapToken';
        const tokenSymbol = (await rli.question('Token symbol [SWAP]: ')) || 'SWAP';
        const decimalsStr = (await rli.question('Token decimals [6]: ')) || '6';
        const decimals = BigInt(decimalsStr);

        logger.info(`Deploying HTLC-FT contract (${tokenName} / ${tokenSymbol} / ${decimals} decimals)...`);
        const deployed = await deployContract(providers, {
          compiledContract: CompiledHTLCFTContract,
          privateStateId: htlcFtPrivateStateKey,
          initialPrivateState: {} as EmptyPrivateState,
          args: [tokenName, tokenSymbol, decimals],
        });
        const addr = deployed.deployTxData.public.contractAddress;
        logger.info(`Contract deployed at: ${addr}`);
        return deployed;
      }
      case '2': {
        const addr = await rli.question('Contract address (hex): ');
        logger.info(`Joining contract at ${addr}...`);
        const deployed = await findDeployedContract<HTLCFTContract>(providers, {
          contractAddress: addr as ContractAddress,
          compiledContract: CompiledHTLCFTContract,
          privateStateId: htlcFtPrivateStateKey,
          initialPrivateState: {} as EmptyPrivateState,
        });
        logger.info(`Joined contract at: ${deployed.deployTxData.public.contractAddress}`);
        return deployed;
      }
      case '3':
        logger.info('Exiting...');
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────

const MAIN_MENU = `
=== HTLC-FT Cross-Chain Atomic Swap ===
  1.  Mint tokens
  2.  Check balance
  3.  Get my address
  4.  Deposit (create HTLC swap)
  5.  Withdraw (claim with preimage)
  6.  Reclaim (refund after expiry)
  7.  Check swap status
  8.  Generate new preimage
  9.  Transfer tokens
  10. Display contract address
  11. Exit
Which would you like to do? `;

const mainLoop = async (
  providers: HTLCFTProviders,
  contract: DeployedHTLCFTContract,
  myAddressBytes: Uint8Array,
  rli: Interface,
  logger: Logger,
): Promise<void> => {
  const contractAddress = contract.deployTxData.public.contractAddress;
  const myAddr = callerAddr(myAddressBytes);

  while (true) {
    const choice = await rli.question(MAIN_MENU);
    try {
      switch (choice) {
        // ── Mint ──
        case '1': {
          const amountStr = await rli.question('Amount to mint: ');
          const amount = BigInt(amountStr);
          logger.info(`Minting ${amount} tokens to self...`);
          await contract.callTx.mint(myAddr, amount);
          logger.info(`Minted ${amount} tokens successfully.`);
          break;
        }

        // ── Balance ──
        case '2': {
          logger.info('Querying balance...');
          await contract.callTx.balanceOf(myAddr);
          // Also query ledger directly for swap info
          const state = await getLedgerState(providers, contractAddress);
          if (state) {
            logger.info(`Active entries in swap map: ${state.htlcAmounts.size()}`);
          }
          break;
        }

        // ── Get my address ──
        case '3': {
          logger.info(`Your address (coin public key): ${bytesToHex(myAddressBytes)}`);
          break;
        }

        // ── Deposit (create HTLC) ──
        case '4': {
          const amountStr = await rli.question('Amount to escrow: ');
          const amount = BigInt(amountStr);

          const preimageChoice = await rli.question('Use (1) existing preimage hex or (2) generate new? ');
          let preimage: Uint8Array;
          if (preimageChoice === '1') {
            const preimageHex = await rli.question('Preimage (64 hex chars): ');
            preimage = hexToBytes(preimageHex);
          } else {
            preimage = randomBytes(32);
            logger.info(`Generated preimage: ${bytesToHex(preimage)}`);
            logger.info('SAVE THIS PREIMAGE! You need it to claim on the other chain.');
          }

          if (preimage.length !== 32) {
            logger.error('Preimage must be exactly 32 bytes.');
            break;
          }

          const hashLock = sha256(preimage);
          logger.info(`Hash lock: ${bytesToHex(hashLock)}`);

          const receiverHex = await rli.question('Receiver address (64 hex chars): ');
          const receiverBytes = hexToBytes(receiverHex);

          const expiryMinutes = await rli.question('Expiry in minutes from now [60]: ');
          const minutes = parseInt(expiryMinutes || '60', 10);
          const expiryTime = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
          logger.info(`Expiry time: ${new Date(Number(expiryTime) * 1000).toISOString()}`);

          logger.info(`Depositing ${amount} tokens with hash lock...`);
          await contract.callTx.depositWithHashTimeLock(amount, hashLock, expiryTime, receiverBytes);
          logger.info('Deposit successful! HTLC swap created.');
          logger.info(`Hash lock: ${bytesToHex(hashLock)}`);
          break;
        }

        // ── Withdraw (claim with preimage) ──
        case '5': {
          const preimageHex = await rli.question('Preimage (64 hex chars): ');
          const preimage = hexToBytes(preimageHex);
          if (preimage.length !== 32) {
            logger.error('Preimage must be exactly 32 bytes.');
            break;
          }
          const hash = sha256(preimage);
          logger.info(`Computed hash lock: ${bytesToHex(hash)}`);
          logger.info('Withdrawing with preimage...');
          await contract.callTx.withdrawWithPreimage(preimage);
          logger.info('Withdraw successful! Tokens claimed.');
          break;
        }

        // ── Reclaim (refund after expiry) ──
        case '6': {
          const hashHex = await rli.question('Hash lock of swap to reclaim (64 hex chars): ');
          const hash = hexToBytes(hashHex);
          if (hash.length !== 32) {
            logger.error('Hash must be exactly 32 bytes.');
            break;
          }
          logger.info('Reclaiming after expiry...');
          await contract.callTx.reclaimAfterExpiry(hash);
          logger.info('Reclaim successful! Tokens returned.');
          break;
        }

        // ── Check swap status ──
        case '7': {
          const hashHex = await rli.question('Hash lock to check (64 hex chars): ');
          const hash = hexToBytes(hashHex);
          const state = await getLedgerState(providers, contractAddress);
          if (!state) {
            logger.info('Could not fetch contract state.');
            break;
          }
          if (!state.htlcAmounts.member(hash)) {
            logger.info('No swap found for this hash.');
          } else {
            const amount = state.htlcAmounts.lookup(hash);
            const active = amount > 0n;
            logger.info(`Swap active: ${active}`);
            logger.info(`Escrowed amount: ${amount}`);
            if (active) {
              const expiry = state.htlcExpiries.lookup(hash);
              const sender = state.htlcSenders.lookup(hash);
              const receiver = state.htlcReceivers.lookup(hash);
              logger.info(`Expiry: ${new Date(Number(expiry) * 1000).toISOString()}`);
              logger.info(`Sender: ${bytesToHex(sender)}`);
              logger.info(`Receiver: ${bytesToHex(receiver)}`);
              const now = Math.floor(Date.now() / 1000);
              if (now > Number(expiry)) {
                logger.info('Status: EXPIRED (sender can reclaim)');
              } else {
                const remaining = Number(expiry) - now;
                const mins = Math.floor(remaining / 60);
                logger.info(`Status: ACTIVE (${mins} minutes remaining)`);
              }
            } else {
              logger.info('Status: COMPLETED');
            }
          }
          break;
        }

        // ── Generate new preimage ──
        case '8': {
          const preimage = randomBytes(32);
          const hash = sha256(preimage);
          logger.info(`Preimage: ${bytesToHex(preimage)}`);
          logger.info(`Hash:     ${bytesToHex(hash)}`);
          logger.info('Use this preimage for your next deposit or Cardano HTLC.');
          break;
        }

        // ── Transfer tokens ──
        case '9': {
          const toHexStr = await rli.question('Recipient address (64 hex chars): ');
          const toBytes = hexToBytes(toHexStr);
          const amountStr = await rli.question('Amount to transfer: ');
          const amount = BigInt(amountStr);
          const toAddr: Either<ZswapCoinPublicKey, CompactContractAddress> = {
            is_left: true,
            left: { bytes: toBytes },
            right: { bytes: new Uint8Array(32) },
          };
          logger.info(`Transferring ${amount} tokens...`);
          await contract.callTx.transfer(toAddr, amount);
          logger.info('Transfer successful.');
          break;
        }

        // ── Display contract address ──
        case '10': {
          logger.info(`Contract address: ${contractAddress}`);
          break;
        }

        // ── Exit ──
        case '11':
          logger.info('Exiting...');
          return;

        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      logError(logger, e);
      logger.info('Returning to main menu...');
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Wallet setup
// ─────────────────────────────────────────────────────────────────────

const WALLET_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (rli: Interface, logger: Logger): Promise<string | undefined> => {
  while (true) {
    const choice = await rli.question(WALLET_QUESTION);
    switch (choice) {
      case '1':
        return bytesToHex(randomBytes(32));
      case '2':
        return await rli.question('Enter your wallet seed: ');
      case '3':
        logger.info('Exiting...');
        return undefined;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  const providersToBeStopped: MidnightWalletProvider[] = [];
  try {
    logger.info('Starting HTLC-FT CLI for cross-chain atomic swaps...');
    const envConfiguration = await testEnv.start();
    logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);

    const seed = await buildWallet(rli, logger);
    if (seed === undefined) return;

    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;

    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletFacade,
      envConfiguration,
      unshieldedToken(),
      config.requestFaucetTokens,
    );
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      logger.info('No funds received, exiting...');
      return;
    }
    logger.info(`Your NIGHT wallet balance is: ${nightBalance}`);

    if (config.generateDust) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.info(`Submitted dust generation registration transaction: ${dustGeneration}`);
        await syncWallet(logger, walletFacade);
      }
    }

    // Derive the user's coin public key (used as contract address identity)
    const coinPubKey = walletProvider.getCoinPublicKey();
    const myAddressBytes = encodeCoinPublicKey(coinPubKey);

    // Build providers for the HTLC-FT contract
    const zkConfigProvider = new NodeZkConfigProvider<HTLCFTCircuitKeys>(config.zkConfigPath);
    const providers: HTLCFTProviders = {
      privateStateProvider: levelPrivateStateProvider<HTLCFTPrivateStateId, EmptyPrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => 'HtlcFt-Test-2026!',
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };

    // Deploy or join a contract, then enter the main loop
    const contract = await deployOrJoin(providers, rli, logger);
    if (contract === null) return;

    await mainLoop(providers, contract, myAddressBytes, rli, logger);
  } catch (e) {
    logError(logger, e);
    logger.info('Exiting...');
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logError(logger, e);
    } finally {
      try {
        for (const wallet of providersToBeStopped) {
          logger.info('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv) {
          logger.info('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    }
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.error(`Found error '${e.message}'`);
    logger.error(`Stack: ${e.stack}`);
    if (e.cause) logger.error(`Cause: ${e.cause}`);
  } else {
    logger.error(`Found error (unknown type): ${JSON.stringify(e)}`);
  }
}
