import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as CompiledHTLC from "./managed/htlc/contract/index.js";

export type EmptyPrivateState = Record<string, never>;

export const htlcPrivateStateKey = 'htlcPrivateState' as const;

export type HTLCPrivateStateId = typeof htlcPrivateStateKey;

export type HTLCPrivateStates = {
  readonly [K in HTLCPrivateStateId]: EmptyPrivateState;
};

export type HTLCContract = CompiledHTLC.Contract<EmptyPrivateState>;

export type HTLCCircuitKeys = Exclude<keyof HTLCContract['provableCircuits'], number | symbol>;

export type DeployedHTLCContract = import('@midnight-ntwrk/midnight-js-contracts').FoundContract<HTLCContract>;

export type HTLCProviders = import('@midnight-ntwrk/midnight-js-types').MidnightProviders<
  HTLCCircuitKeys,
  HTLCPrivateStateId,
  EmptyPrivateState
>;

export const CompiledHTLCContract = CompiledContract.make<HTLCContract>(
  "Htlc",
  CompiledHTLC.Contract<EmptyPrivateState>,
).pipe(
  // @ts-expect-error: Witnesses<EmptyPrivateState> = {} — no witnesses to provide
  CompiledContract.withWitnesses({}),
  CompiledContract.withCompiledFileAssets("./managed/htlc"),
);
