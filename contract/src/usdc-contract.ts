import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as CompiledUSDC from "./managed/usdc/contract/index.js";

export type EmptyPrivateState = Record<string, never>;

export const usdcPrivateStateKey = 'usdcPrivateState' as const;

export type USDCPrivateStateId = typeof usdcPrivateStateKey;

export type USDCPrivateStates = {
  readonly [K in USDCPrivateStateId]: EmptyPrivateState;
};

export type USDCContract = CompiledUSDC.Contract<EmptyPrivateState>;

// Use provable circuits only (excludes myAddr which is impure-only, not submittable)
export type USDCCircuitKeys = Exclude<keyof USDCContract['provableCircuits'], number | symbol>;

export type DeployedUSDCContract = import('@midnight-ntwrk/midnight-js-contracts').FoundContract<USDCContract>;

export type USDCProviders = import('@midnight-ntwrk/midnight-js-types').MidnightProviders<
  USDCCircuitKeys,
  USDCPrivateStateId,
  EmptyPrivateState
>;

// The USDC contract has no witnesses (Witnesses<PS> = {}). The pipe type
// chain resolves the witness param to `never`, so we use @ts-expect-error.
export const CompiledUSDCContract = CompiledContract.make<USDCContract>(
  "Usdc",
  CompiledUSDC.Contract<EmptyPrivateState>,
).pipe(
  // @ts-expect-error: Witnesses<EmptyPrivateState> = {} — no witnesses to provide
  CompiledContract.withWitnesses({}),
  CompiledContract.withCompiledFileAssets("./managed/usdc"),
);
