/**
 * Port of `BrowserDeployedBoardManager` for the HTLC atomic-swap UI.
 *
 * Differences from the bboard version:
 *   1. Manages TWO provider bundles (HTLC + USDC) that share everything except
 *      the per-contract private-state provider.
 *   2. Decodes the connected wallet's bech32m shielded coin public key and
 *      unshielded address into raw 32-byte arrays at bootstrap time. This is
 *      the Landmine #1 fix (CLAUDE.md "Known Incidents" #1) — `receiverAuth`
 *      fields on deposit/withdraw must be the raw Zswap key, not bech32m.
 *   3. No `deploy` path — contracts are pre-deployed (addresses come from
 *      `swap-state.json`). This module only joins.
 */

import {
  type HTLCCircuitKeys,
  type HTLCProviders,
  type USDCCircuitKeys,
  type USDCProviders,
  type EmptyPrivateState,
} from '../api/common-types';
import { fromHex, toHex } from '@midnight-ntwrk/compact-runtime';
import { catchError, concatMap, filter, firstValueFrom, interval, map, take, tap, throwError, timeout } from 'rxjs';
import { pipe as fnPipe } from 'fp-ts/function';
import { type Logger } from 'pino';
import { ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import semver from 'semver';
import {
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/ledger-v8';
import { inMemoryPrivateStateProvider } from '../in-memory-private-state-provider';
import { type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { decodeShieldedCoinPublicKey, decodeUnshieldedAddress } from '../api/key-encoding';

export interface SwapBootstrap {
  readonly networkId: NetworkId;
  readonly htlcProviders: HTLCProviders;
  readonly usdcProviders: USDCProviders;
  /** Raw 32-byte Zswap coin public key of the connected wallet. */
  readonly coinPublicKeyBytes: Uint8Array;
  /** Hex-encoded form of {@link coinPublicKeyBytes} for convenience. */
  readonly coinPublicKeyHex: string;
  /** Bech32m shielded coin public key (as Lace returned it). */
  readonly coinPublicKeyBech32m: string;
  /** Raw 32-byte unshielded address of the connected wallet. */
  readonly unshieldedAddressBytes: Uint8Array;
  /** Hex-encoded form of {@link unshieldedAddressBytes}. */
  readonly unshieldedAddressHex: string;
  /** Bech32m unshielded address (as Lace returned it). */
  readonly unshieldedAddressBech32m: string;
  readonly connectedAPI: ConnectedAPI;
}

export class BrowserHtlcManager {
  #bootstrap: Promise<SwapBootstrap> | undefined;

  constructor(private readonly logger: Logger) {}

  /**
   * Single cached promise — repeated calls return the same bootstrap, so we
   * connect Lace at most once per page load.
   */
  getBootstrap(): Promise<SwapBootstrap> {
    return this.#bootstrap ?? (this.#bootstrap = initializeBootstrap(this.logger));
  }
}

const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

const getFirstCompatibleWallet = (): InitialAPI | undefined => {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

const connectToWallet = (logger: Logger, networkId: string): Promise<ConnectedAPI> =>
  firstValueFrom(
    fnPipe(
      interval(100),
      map(() => getFirstCompatibleWallet()),
      tap((api) => logger.info(api, 'Check for wallet connector API')),
      filter((api): api is InitialAPI => !!api),
      tap((api) => logger.info(api, 'Compatible wallet connector API found. Connecting.')),
      take(1),
      timeout({
        first: 5_000,
        with: () =>
          throwError(() => {
            logger.error('Could not find wallet connector API');
            return new Error('Could not find a Midnight wallet (1AM / Lace). Extension installed?');
          }),
      }),
      concatMap(async (initialAPI) => {
        const connectedAPI = await initialAPI.connect(networkId);
        const connectionStatus = await connectedAPI.getConnectionStatus();
        logger.info(connectionStatus, 'Wallet connector API enabled status');
        return connectedAPI;
      }),
      timeout({
        first: 30_000,
        with: () =>
          throwError(() => {
            logger.error('Wallet connector API has failed to respond');
            return new Error('Midnight wallet has failed to respond. Extension enabled?');
          }),
      }),
      catchError((error, apis) =>
        error
          ? throwError(() => {
              logger.error({ error }, 'Unable to enable connector API');
              return new Error('Application is not authorized');
            })
          : apis,
      ),
    ),
  );

const buildWalletProvider = (
  logger: Logger,
  connectedAPI: ConnectedAPI,
  shieldedCoinPublicKey: string,
  shieldedEncryptionPublicKey: string,
) => ({
  getCoinPublicKey(): string {
    return shieldedCoinPublicKey;
  },
  getEncryptionPublicKey(): string {
    return shieldedEncryptionPublicKey;
  },
  balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> => {
    try {
      logger.info({ tx, ttl }, 'Balancing transaction via wallet');
      const serializedTx = toHex(tx.serialize());
      const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature',
        'proof',
        'binding',
        fromHex(received.tx),
      );
    } catch (e) {
      logger.error({ error: e }, 'Error balancing transaction via wallet');
      throw e;
    }
  },
});

const buildMidnightProvider = (logger: Logger, connectedAPI: ConnectedAPI) => ({
  submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
    await connectedAPI.submitTransaction(toHex(tx.serialize()));
    const txIdentifiers = tx.identifiers();
    const txId = txIdentifiers[0];
    logger.info({ txIdentifiers }, 'Submitted transaction via wallet');
    return txId;
  },
});

const initializeBootstrap = async (logger: Logger): Promise<SwapBootstrap> => {
  const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
  const connectedAPI = await connectToWallet(logger, networkId);

  const zkConfigPath = window.location.origin;
  const htlcZkConfigProvider = new FetchZkConfigProvider<HTLCCircuitKeys>(zkConfigPath, fetch.bind(window));
  const usdcZkConfigProvider = new FetchZkConfigProvider<USDCCircuitKeys>(zkConfigPath, fetch.bind(window));

  const config = await connectedAPI.getConfiguration();
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  const { unshieldedAddress } = await connectedAPI.getUnshieldedAddress();

  const coinPublicKeyBytes = decodeShieldedCoinPublicKey(shieldedAddresses.shieldedCoinPublicKey, networkId);
  const unshieldedAddressBytes = decodeUnshieldedAddress(unshieldedAddress, networkId);

  logger.info({ indexerUri: config.indexerUri, networkId: config.networkId }, 'Wallet configuration');

  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const walletProvider = buildWalletProvider(
    logger,
    connectedAPI,
    shieldedAddresses.shieldedCoinPublicKey,
    shieldedAddresses.shieldedEncryptionPublicKey,
  );
  const midnightProvider = buildMidnightProvider(logger, connectedAPI);

  const htlcPrivateStateProvider = inMemoryPrivateStateProvider<string, EmptyPrivateState>();
  const usdcPrivateStateProvider = inMemoryPrivateStateProvider<string, EmptyPrivateState>();

  const htlcProvingProvider = await connectedAPI.getProvingProvider(htlcZkConfigProvider.asKeyMaterialProvider());
  const usdcProvingProvider = await connectedAPI.getProvingProvider(usdcZkConfigProvider.asKeyMaterialProvider());

  const htlcProviders: HTLCProviders = {
    privateStateProvider: htlcPrivateStateProvider,
    zkConfigProvider: htlcZkConfigProvider,
    proofProvider: createProofProvider(htlcProvingProvider),
    publicDataProvider,
    walletProvider,
    midnightProvider,
  };

  const usdcProviders: USDCProviders = {
    privateStateProvider: usdcPrivateStateProvider,
    zkConfigProvider: usdcZkConfigProvider,
    proofProvider: createProofProvider(usdcProvingProvider),
    publicDataProvider,
    walletProvider,
    midnightProvider,
  };

  return {
    networkId,
    htlcProviders,
    usdcProviders,
    coinPublicKeyBytes,
    coinPublicKeyHex: toHex(coinPublicKeyBytes),
    coinPublicKeyBech32m: shieldedAddresses.shieldedCoinPublicKey,
    unshieldedAddressBytes,
    unshieldedAddressHex: toHex(unshieldedAddressBytes),
    unshieldedAddressBech32m: unshieldedAddress,
    connectedAPI,
  };
};
