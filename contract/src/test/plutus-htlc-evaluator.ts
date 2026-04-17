// Evaluates the compiled Aiken HTLC validator through the real Plutus CEK machine.
// Uses @harmoniclabs packages to parse UPLC and run it with constructed ScriptContext.

import { parseUPLC, Application, UPLCConst } from "@harmoniclabs/uplc";
import { Machine } from "@harmoniclabs/plutus-machine";
import {
  DataConstr,
  DataI,
  DataB,
  DataList,
  DataMap,
  DataPair,
  Data,
} from "@harmoniclabs/plutus-data";
import { Cbor } from "@harmoniclabs/cbor";
import { fromHex } from "@harmoniclabs/uint8array-utils";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Plutus Data helpers for Cardano types
const TRUE = new DataConstr(1n, []);
const FALSE = new DataConstr(0n, []);
const NOTHING = new DataConstr(1n, []);
function Just(x: Data): DataConstr {
  return new DataConstr(0n, [x]);
}

const NEG_INF = new DataConstr(0n, []);
const POS_INF = new DataConstr(2n, []);
function Finite(x: bigint): DataConstr {
  return new DataConstr(1n, [new DataI(x)]);
}

function IntervalBound(boundType: DataConstr, inclusive: boolean): DataConstr {
  return new DataConstr(0n, [boundType, inclusive ? TRUE : FALSE]);
}

function Interval(lower: DataConstr, upper: DataConstr): DataConstr {
  return new DataConstr(0n, [lower, upper]);
}

function TxOutRef(txId: Uint8Array, index: bigint): DataConstr {
  return new DataConstr(0n, [new DataB(txId), new DataI(index)]);
}

function Address(paymentCred: DataConstr, stakeCred: Data): DataConstr {
  return new DataConstr(0n, [paymentCred, stakeCred]);
}

function ScriptCredential(hash: Uint8Array): DataConstr {
  return new DataConstr(1n, [new DataB(hash)]);
}

function TxOut(
  addr: DataConstr,
  value: Data,
  datum: DataConstr,
  refScript: Data,
): DataConstr {
  return new DataConstr(0n, [addr, value, datum, refScript]);
}

function Input(outRef: DataConstr, txOut: DataConstr): DataConstr {
  return new DataConstr(0n, [outRef, txOut]);
}

// Value as Map<PolicyId, Map<AssetName, Int>>
function lovelaceValue(amount: bigint): DataMap {
  const innerMap = new DataMap([
    new DataPair(new DataB(new Uint8Array(0)), new DataI(amount)),
  ]);
  return new DataMap([
    new DataPair(new DataB(new Uint8Array(0)), innerMap),
  ]);
}

export type EvalResult = {
  accepted: boolean;
  cpuSteps: bigint;
  memUnits: bigint;
};

export class PlutusHTLCEvaluator {
  private validatorTerm: any;
  private scriptHash = fromHex(
    "272e87e6a260e90df2efbeae71872bdf43a680b76dac6da1018e99c4",
  );
  private fakeTxId = new Uint8Array(32); // all zeros

  constructor() {
    const blueprintPath = resolve(
      __dirname,
      "../../../cardano/plutus.json",
    );
    const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
    const validator = blueprint.validators.find(
      (v: { title: string }) => v.title === "htlc.htlc.spend",
    );

    // Unwrap CBOR to get flat-encoded UPLC bytes
    const cborObj = Cbor.parse(fromHex(validator.compiledCode));
    const program = parseUPLC(cborObj.buffer, "flat");
    this.validatorTerm = program.body;
  }

  static sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha256").update(data).digest());
  }

  /**
   * Evaluate a withdraw attempt through the real Plutus CEK machine.
   */
  evaluateWithdraw(
    preimage: Uint8Array,
    preimageHash: Uint8Array,
    sender: Uint8Array,
    receiver: Uint8Array,
    deadline: bigint,
    signatories: Uint8Array[],
    txLowerBound: bigint | null,
    txUpperBound: bigint | null,
  ): EvalResult {
    const datum = this.buildDatum(preimageHash, sender, receiver, deadline);
    const redeemer = new DataConstr(0n, [new DataB(preimage)]); // Withdraw { preimage }
    return this.evaluate(datum, redeemer, signatories, txLowerBound, txUpperBound);
  }

  /**
   * Evaluate a reclaim attempt through the real Plutus CEK machine.
   */
  evaluateReclaim(
    preimageHash: Uint8Array,
    sender: Uint8Array,
    receiver: Uint8Array,
    deadline: bigint,
    signatories: Uint8Array[],
    txLowerBound: bigint | null,
    txUpperBound: bigint | null,
  ): EvalResult {
    const datum = this.buildDatum(preimageHash, sender, receiver, deadline);
    const redeemer = new DataConstr(1n, []); // Reclaim
    return this.evaluate(datum, redeemer, signatories, txLowerBound, txUpperBound);
  }

  private buildDatum(
    preimageHash: Uint8Array,
    sender: Uint8Array,
    receiver: Uint8Array,
    deadline: bigint,
  ): DataConstr {
    return new DataConstr(0n, [
      new DataB(preimageHash),
      new DataB(sender),
      new DataB(receiver),
      new DataI(deadline),
    ]);
  }

  private evaluate(
    datum: DataConstr,
    redeemer: Data,
    signatories: Uint8Array[],
    txLowerBound: bigint | null,
    txUpperBound: bigint | null,
  ): EvalResult {
    const txOutRef = TxOutRef(this.fakeTxId, 0n);

    // Build validity range
    const lower = IntervalBound(
      txLowerBound !== null ? Finite(txLowerBound) : NEG_INF,
      true,
    );
    const upper = IntervalBound(
      txUpperBound !== null ? Finite(txUpperBound) : POS_INF,
      true,
    );
    const validRange = Interval(lower, upper);

    // Build mock TxInfo (Plutus V3 — 16 fields)
    const scriptAddr = Address(ScriptCredential(this.scriptHash), NOTHING);
    const mockInput = Input(
      txOutRef,
      TxOut(scriptAddr, lovelaceValue(10_000_000n), new DataConstr(0n, []), NOTHING),
    );

    const txInfo = new DataConstr(0n, [
      new DataList([mockInput]),                         // 0: inputs
      new DataList([]),                                  // 1: reference_inputs
      new DataList([]),                                  // 2: outputs
      new DataI(200_000n),                               // 3: fee
      new DataMap([]),                                   // 4: mint
      new DataList([]),                                  // 5: certificates
      new DataMap([]),                                   // 6: withdrawals
      validRange,                                        // 7: validity_range
      new DataList(signatories.map((s) => new DataB(s))),// 8: signatories
      new DataMap([]),                                   // 9: redeemers
      new DataMap([]),                                   // 10: datums
      new DataB(this.fakeTxId),                          // 11: id
      new DataMap([]),                                   // 12: votes
      new DataList([]),                                  // 13: proposal_procedures
      NOTHING,                                           // 14: current_treasury_amount
      NOTHING,                                           // 15: treasury_donation
    ]);

    // Plutus V3 ScriptContext: Constr(0, [txInfo, redeemer, scriptInfo])
    // SpendingScript = Constr(1, [txOutRef, Just(datum)])
    const scriptInfo = new DataConstr(1n, [txOutRef, Just(datum)]);
    const scriptContext = new DataConstr(0n, [txInfo, redeemer, scriptInfo]);

    // Apply the validator to the ScriptContext (V3: single argument)
    const applied = new Application(
      this.validatorTerm,
      UPLCConst.data(scriptContext),
    );

    // Run the CEK machine
    const { result, budgetSpent } = Machine.eval(applied);

    return {
      accepted: (result as any).tag !== 5, // tag 5 = CEKError
      cpuSteps: BigInt((budgetSpent as any).cpu ?? (budgetSpent as any).steps ?? 0),
      memUnits: BigInt((budgetSpent as any).mem ?? (budgetSpent as any).memory ?? 0),
    };
  }
}
