import assert from "node:assert/strict";
import test from "node:test";
import { allocateInvoiceTaxes, reconcileSettlementAmounts, signedInventoryQuantity } from "./operations-platform.js";

test("receipts increase inventory while waste and transfers decrease it",()=>{
  assert.equal(signedInventoryQuantity("RECEIPT",4.5),4.5);
  assert.equal(signedInventoryQuantity("RETURN",2),2);
  assert.equal(signedInventoryQuantity("WASTE",3),-3);
  assert.equal(signedInventoryQuantity("TRANSFER",1.25),-1.25);
  assert.equal(signedInventoryQuantity("CONSUMPTION",7),-7);
});

test("inventory quantity rejects zero and non-finite input",()=>{
  assert.throws(()=>signedInventoryQuantity("RECEIPT",0));
  assert.throws(()=>signedInventoryQuantity("RECEIPT",Number.NaN));
});

test("settlement reconciliation matches exact provider net",()=>{
  assert.deepEqual(reconcileSettlementAmounts(100_000,2_000,360,97_640),{expectedNet:97_640,status:"MATCHED",mismatchReason:null});
});

test("settlement reconciliation explains a mismatch",()=>{
  assert.deepEqual(reconcileSettlementAmounts(100_000,2_000,360,97_000),{expectedNet:97_640,status:"MISMATCH",mismatchReason:"Expected net 97640, received 97000"});
});

test("GST allocation preserves the expected invoice tax after rounding",()=>{
  const lines=allocateInvoiceTaxes([{name:"Dish A",quantity:1,unitPrice:99,taxRate:5},{name:"Dish B",quantity:2,unitPrice:49,taxRate:5}],5,10,false);
  assert.equal(lines.reduce((sum,line)=>sum+line.cgstAmount+line.sgstAmount+line.igstAmount,0),10);
  assert.equal(lines.reduce((sum,line)=>sum+line.totalAmount,0),207);
  assert.equal(lines.every(line=>line.igstAmount===0),true);
});

test("interstate GST is allocated entirely to IGST",()=>{
  const[line]=allocateInvoiceTaxes([{name:"Service",quantity:1,unitPrice:1000,taxRate:18,taxAmount:180}],18,180,true);
  assert.equal(line.cgstAmount,0);
  assert.equal(line.sgstAmount,0);
  assert.equal(line.igstAmount,180);
});
