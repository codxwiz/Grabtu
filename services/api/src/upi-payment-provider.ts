import { randomBytes } from "node:crypto";

export type UpiAppId = "google_pay" | "phonepe" | "paytm" | "generic_upi";
export type PaymentLaunchOption = { id: UpiAppId; label: string; launchUrl: string };

export function formatPaiseAsRupees(amountPaise: number) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) throw new Error("Invalid payment amount");
  return (amountPaise / 100).toFixed(2);
}

export function createUpiTransactionReference() {
  return `KN${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString("hex").toUpperCase()}`;
}

export function buildUpiPayload(input: { merchantVpa: string; merchantName: string; transactionReference: string; amountPaise: number; note: string; merchantCode?: string | null }) {
  const merchantVpa = input.merchantVpa.trim().toLowerCase();
  const merchantName = input.merchantName.trim();
  const transactionReference = input.transactionReference.trim();
  const note = input.note.trim();
  if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/.test(merchantVpa) || merchantVpa.length > 100) throw new Error("Invalid merchant UPI ID");
  if (!merchantName || merchantName.length > 60) throw new Error("Invalid merchant name");
  if (!/^[A-Za-z0-9]{1,35}$/.test(transactionReference)) throw new Error("Invalid UPI transaction reference");
  if (!note || note.length > 80) throw new Error("Invalid UPI payment note");
  const query = new URLSearchParams({
    pa: merchantVpa,
    pn: merchantName,
    tr: transactionReference,
    tn: note,
    am: formatPaiseAsRupees(input.amountPaise),
    cu: "INR",
  });
  if (input.merchantCode) query.set("mc", input.merchantCode);
  return `upi://pay?${query.toString()}`;
}

export function buildUpiLaunchOptions(qrPayload: string): PaymentLaunchOption[] {
  if (!qrPayload.startsWith("upi://pay?")) throw new Error("Invalid UPI payment link");
  const query = qrPayload.slice(qrPayload.indexOf("?") + 1);
  return [
    { id: "google_pay", label: "Google Pay", launchUrl: `tez://upi/pay?${query}` },
    { id: "phonepe", label: "PhonePe", launchUrl: `phonepe://pay?${query}` },
    { id: "paytm", label: "Paytm", launchUrl: `paytmmp://pay?${query}` },
    { id: "generic_upi", label: "Other UPI app", launchUrl: qrPayload },
  ];
}

export type ManualVerificationResult = { status: "requires_review"; message: string };

export interface PaymentProvider {
  verifyPayment(paymentId: string): Promise<ManualVerificationResult>;
}

export const manualUpiProvider: PaymentProvider = {
  async verifyPayment() {
    return { status: "requires_review", message: "Customer report received. Restaurant confirmation is required for this manual UPI provider." };
  },
};
