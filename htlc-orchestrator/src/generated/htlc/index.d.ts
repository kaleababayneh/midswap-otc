import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type ZswapCoinPublicKey = { bytes: Uint8Array };

export type ContractAddress = { bytes: Uint8Array };

export type UserAddress = { bytes: Uint8Array };

export type Either<A, B> = { is_left: boolean; left: A; right: B };

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  deposit(context: __compactRuntime.CircuitContext<PS>,
          color_0: Uint8Array,
          amount_0: bigint,
          hash_0: Uint8Array,
          expiryTime_0: bigint,
          receiverAuth_0: Uint8Array,
          receiverPayout_0: Either<ContractAddress, UserAddress>,
          senderPayout_0: Either<ContractAddress, UserAddress>): __compactRuntime.CircuitResults<PS, []>;
  withdrawWithPreimage(context: __compactRuntime.CircuitContext<PS>,
                       preimage_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reclaimAfterExpiry(context: __compactRuntime.CircuitContext<PS>,
                     hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  deposit(context: __compactRuntime.CircuitContext<PS>,
          color_0: Uint8Array,
          amount_0: bigint,
          hash_0: Uint8Array,
          expiryTime_0: bigint,
          receiverAuth_0: Uint8Array,
          receiverPayout_0: Either<ContractAddress, UserAddress>,
          senderPayout_0: Either<ContractAddress, UserAddress>): __compactRuntime.CircuitResults<PS, []>;
  withdrawWithPreimage(context: __compactRuntime.CircuitContext<PS>,
                       preimage_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reclaimAfterExpiry(context: __compactRuntime.CircuitContext<PS>,
                     hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  deposit(context: __compactRuntime.CircuitContext<PS>,
          color_0: Uint8Array,
          amount_0: bigint,
          hash_0: Uint8Array,
          expiryTime_0: bigint,
          receiverAuth_0: Uint8Array,
          receiverPayout_0: Either<ContractAddress, UserAddress>,
          senderPayout_0: Either<ContractAddress, UserAddress>): __compactRuntime.CircuitResults<PS, []>;
  withdrawWithPreimage(context: __compactRuntime.CircuitContext<PS>,
                       preimage_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reclaimAfterExpiry(context: __compactRuntime.CircuitContext<PS>,
                     hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  htlcAmounts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  htlcExpiries: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  htlcColors: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  htlcSenderAuth: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  htlcReceiverAuth: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  htlcSenderPayout: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Either<ContractAddress, UserAddress>;
    [Symbol.iterator](): Iterator<[Uint8Array, Either<ContractAddress, UserAddress>]>
  };
  htlcReceiverPayout: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Either<ContractAddress, UserAddress>;
    [Symbol.iterator](): Iterator<[Uint8Array, Either<ContractAddress, UserAddress>]>
  };
  revealedPreimages: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
