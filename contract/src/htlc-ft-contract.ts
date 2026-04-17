import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as CompiledHTLCFT from "./managed/htlc-ft/contract/index.js";

export type EmptyPrivateState = Record<string, never>;

export const htlcFtPrivateStateKey = 'htlcFtPrivateState' as const;

export type HTLCFTPrivateStateId = typeof htlcFtPrivateStateKey;

export type HTLCFTPrivateStates = {
  readonly [K in HTLCFTPrivateStateId]: EmptyPrivateState;
};

export type HTLCFTContract = CompiledHTLCFT.Contract<EmptyPrivateState>;

// Use provable circuits only (excludes myAddr which is impure-only, not submittable)
export type HTLCFTCircuitKeys = Exclude<keyof HTLCFTContract['provableCircuits'], number | symbol>;

export type DeployedHTLCFTContract = import('@midnight-ntwrk/midnight-js-contracts').FoundContract<HTLCFTContract>;

export type HTLCFTProviders = import('@midnight-ntwrk/midnight-js-types').MidnightProviders<
  HTLCFTCircuitKeys,
  HTLCFTPrivateStateId,
  EmptyPrivateState
>;

// The HTLC-FT contract has no witnesses (Witnesses<PS> = {}). The pipe type
// chain resolves the witness param to `never`, so we use @ts-expect-error.
export const CompiledHTLCFTContract = CompiledContract.make<HTLCFTContract>(
  "HtlcFt",
  CompiledHTLCFT.Contract<EmptyPrivateState>,
).pipe(
  // @ts-expect-error: Witnesses<EmptyPrivateState> = {} — no witnesses to provide
  CompiledContract.withWitnesses({}),
  CompiledContract.withCompiledFileAssets("./managed/htlc-ft"),
);
