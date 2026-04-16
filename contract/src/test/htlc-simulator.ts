// HTLC contract test simulator
// Wraps the compiled HTLC contract for unit testing.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  emptyZswapLocalState,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/htlc/contract/index.js";
import {
  NetworkId,
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";

setNetworkId("undeployed" as NetworkId);

// The HTLC contract has no witnesses and no private state.
type EmptyPrivateState = Record<string, never>;

export type QualifiedCoin = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
};

export type CoinInfo = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
};

export type SendResult = {
  change: { is_some: boolean; value: CoinInfo };
  sent: CoinInfo;
};

export class HTLCSimulator {
  readonly contract: Contract<EmptyPrivateState>;
  circuitContext: CircuitContext<EmptyPrivateState>;

  constructor(coinPublicKey: string, blockTimeSeconds?: number) {
    this.contract = new Contract<EmptyPrivateState>({});

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({} as EmptyPrivateState, coinPublicKey),
    );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };

    if (blockTimeSeconds !== undefined) {
      this.setBlockTime(blockTimeSeconds);
    }
  }

  setBlockTime(unixSeconds: number): void {
    const qc = this.circuitContext.currentQueryContext as any;
    qc.block = { ...qc.block, secondsSinceEpoch: BigInt(unixSeconds) };
  }

  switchUser(coinPublicKey: string): void {
    const prevIndex =
      this.circuitContext.currentZswapLocalState.currentIndex;
    this.circuitContext.currentZswapLocalState = {
      ...emptyZswapLocalState(coinPublicKey),
      currentIndex: prevIndex,
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  myAddr(): Uint8Array {
    const { context, result } = this.contract.impureCircuits.myAddr(
      this.circuitContext,
    );
    this.circuitContext = context;
    return result;
  }

  mintToSelf(
    domainSep: Uint8Array,
    value: bigint,
    nonce: Uint8Array,
  ): CoinInfo {
    const mtIndexBefore =
      this.circuitContext.currentZswapLocalState.currentIndex;
    const { context, result } = this.contract.impureCircuits.mintToSelf(
      this.circuitContext,
      domainSep,
      value,
      nonce,
    );
    this.circuitContext = context;
    return result;
  }

  /** Mint a coin and return it as a QualifiedCoin ready for deposit/send. */
  mintQualifiedCoin(
    domainSep: Uint8Array,
    value: bigint,
    nonce: Uint8Array,
  ): QualifiedCoin {
    const mtIndex =
      this.circuitContext.currentZswapLocalState.currentIndex;
    const coin = this.mintToSelf(domainSep, value, nonce);
    return { ...coin, mt_index: mtIndex };
  }

  deposit(
    coinInfo: QualifiedCoin,
    hash: Uint8Array,
    expiryTime: bigint,
    receiver: Uint8Array,
  ): SendResult {
    const { context, result } =
      this.contract.impureCircuits.depositWithHashTimeLock(
        this.circuitContext,
        coinInfo,
        hash,
        expiryTime,
        receiver,
      );
    this.circuitContext = context;
    return result;
  }

  withdraw(preimage: Uint8Array, mtIndex: bigint): SendResult {
    const { context, result } =
      this.contract.impureCircuits.withdrawWithPreimage(
        this.circuitContext,
        preimage,
        mtIndex,
      );
    this.circuitContext = context;
    return result;
  }

  reclaim(mtIndex: bigint): SendResult {
    const { context, result } =
      this.contract.impureCircuits.reclaimAfterExpiry(
        this.circuitContext,
        mtIndex,
      );
    this.circuitContext = context;
    return result;
  }
}
