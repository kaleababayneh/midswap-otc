/**
 * Browser-side API for the deployed USDC minter contract.
 *
 * Exposes `_color` via `state$` and a `mint` action. There is no auth check
 * in the USDC contract itself — anyone with tNight for fees can mint to any
 * recipient. This lets Bob seed his own 1AM wallet with native USDC before
 * calling `htlc.deposit`, since the `receiveUnshielded` inside the deposit
 * circuit otherwise fails with no matching-color coins in the caller's wallet.
 */

import { type ContractAddress, type ContractState } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { map, type Observable } from 'rxjs';
import * as USDC from '../../../contract/src/managed/usdc/contract/index';
import type {
  Either,
  ContractAddress as UsdcContractAddress,
  UserAddress as UsdcUserAddress,
} from '../../../contract/src/managed/usdc/contract/index';
import {
  CompiledUSDCContract,
  usdcPrivateStateKey,
  type DeployedUSDCContract,
  type USDCContract,
  type USDCDerivedState,
  type USDCProviders,
} from './common-types';

export class UsdcAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<USDCDerivedState>;

  private constructor(
    public readonly deployedContract: DeployedUSDCContract,
    providers: USDCProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.state$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(
        map((contractState: ContractState) => {
          const ledger = USDC.ledger(contractState.data);
          const emptyColor = ledger._color.every((b) => b === 0);
          return { color: emptyColor ? undefined : new Uint8Array(ledger._color) };
        }),
      );
  }

  async mint(recipient: Either<UsdcContractAddress, UsdcUserAddress>, amount: bigint): Promise<void> {
    this.logger?.info({ amount, recipientIsLeft: recipient.is_left }, 'usdc.mint');
    const txData = await this.deployedContract.callTx.mint(recipient, amount);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'mint',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  static async join(providers: USDCProviders, contractAddress: ContractAddress, logger?: Logger): Promise<UsdcAPI> {
    logger?.info({ joinUSDC: { contractAddress } });
    providers.privateStateProvider.setContractAddress(contractAddress);
    const deployed = await findDeployedContract<USDCContract>(providers, {
      contractAddress,
      compiledContract: CompiledUSDCContract,
      privateStateId: usdcPrivateStateKey,
      initialPrivateState: {},
    });
    return new UsdcAPI(deployed, providers, logger);
  }
}
