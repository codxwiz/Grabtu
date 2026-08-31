import { useState, type FormEvent } from "react";
import type { Order } from "@whitelabel/shared-types";
import type { CardMerchantConfig, PaymentMethodAdmin } from "./types";

type Props = {
  methods: PaymentMethodAdmin[];
  cardMerchant: CardMerchantConfig | null;
  verificationOrders: Order[];
  canConfigureUpi: boolean;
  canConfigureCard: boolean;
  canVerifyPayments: boolean;
  onAdd: (data: Omit<PaymentMethodAdmin, "id" | "qrImageData">) => Promise<boolean>;
  onToggle: (method: PaymentMethodAdmin) => Promise<boolean>;
  onDelete: (method: PaymentMethodAdmin) => Promise<boolean>;
  onConnectCard: (data: { provider: "razorpay"; keyId: string; keySecret: string }) => Promise<boolean>;
  onDisconnectCard: () => Promise<boolean>;
  onVerifyPayment: (order: Order, status: "paid" | "pending") => Promise<boolean>;
  onRefreshVerification: () => Promise<void>;
};

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function PaymentsPage({ methods, cardMerchant, verificationOrders, canConfigureUpi, canConfigureCard, canVerifyPayments, onAdd, onToggle, onDelete, onConnectCard, onDisconnectCard, onVerifyPayment, onRefreshVerification }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const reviewOrders = verificationOrders.filter(order => order.paymentStatus === "reported" || order.paymentStatus === "pay_at_counter");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("upi-add");
    setError("");
    const ok = await onAdd({
      provider: String(data.get("provider")),
      displayName: String(data.get("displayName")).trim(),
      upiId: String(data.get("upiId")).trim().toLowerCase(),
      phone: String(data.get("phone") || "").trim() || undefined,
      isActive: true,
    });
    setBusy("");
    if (ok) form.reset();
  }

  async function connectCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("card-connect");
    setError("");
    const ok = await onConnectCard({ provider: "razorpay", keyId: String(data.get("keyId")).trim(), keySecret: String(data.get("keySecret")) });
    setBusy("");
    if (ok) form.reset();
  }

  async function verify(order: Order, status: "paid" | "pending") {
    if (status === "paid" && !window.confirm(`Confirm that ${money(order.totalAmount)} was received for ${order.id}?`)) return;
    setBusy(`verify-${order.id}-${status}`);
    await onVerifyPayment(order, status);
    setBusy("");
  }

  async function disconnectCard() {
    if (!window.confirm("Disconnect Razorpay? Card checkout will immediately disappear from the guest menu.")) return;
    setBusy("card-disconnect");
    await onDisconnectCard();
    setBusy("");
  }

  return <div className="payment-settings-stack">
    {error && <div className="error" role="alert">{error}</div>}
    {!canConfigureUpi && <div className="notice read-only-notice" role="note"><b>Read-only payment settings</b><p>You can inspect configured methods. Only an owner or manager can change payment destinations.</p></div>}

    {canVerifyPayments && <section className="merchant-connect-card payment-review-card" aria-labelledby="payment-review-title">
      <div className="merchant-connect-heading"><div><p className="eyebrow">MANUAL PAYMENT REVIEW</p><h2 id="payment-review-title">Verify guest payments</h2><p>Check the restaurant’s bank or UPI app before confirming. Confirmation releases paid orders into production.</p></div><button type="button" className="secondary-action" disabled={busy === "review-refresh"} onClick={() => { setBusy("review-refresh"); void onRefreshVerification().finally(() => setBusy("")); }}>{busy === "review-refresh" ? "Refreshing…" : "Refresh"}</button></div>
      {reviewOrders.length === 0 ? <div className="empty-state payment-review-empty"><b>No payments waiting for review</b><p>Reported UPI and pay-at-counter orders will appear here.</p></div> : <div className="payment-review-list">
        {reviewOrders.map(order => <article key={order.id} className="payment-review-row">
          <div><b>{order.tableLabel}</b><small>{order.id} · {new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small></div>
          <span className={`status ${order.paymentStatus === "reported" ? "review-status" : ""}`}>{order.paymentStatus === "reported" ? "Guest reported UPI" : "Pay at counter"}</span>
          <strong>{money(order.totalAmount)}</strong>
          <div className="payment-review-actions"><button type="button" disabled={busy.startsWith(`verify-${order.id}`)} onClick={() => void verify(order, "paid")}>{busy === `verify-${order.id}-paid` ? "Confirming…" : "Confirm received"}</button>{order.paymentStatus === "reported" && <button type="button" className="secondary-action" disabled={busy.startsWith(`verify-${order.id}`)} onClick={() => void verify(order, "pending")}>Not received</button>}</div>
        </article>)}
      </div>}
    </section>}

    <div className="payment-layout"><section><div className="notice"><b>Dynamic UPI</b><p>Each guest receives an order-specific QR with the exact amount. Use a bank or PSP-issued merchant UPI ID.</p><p><strong>Important:</strong> personal or unverified UPI IDs may be warned or blocked by the guest’s payment app.</p></div>
      {methods.length === 0 ? <div className="empty-state"><b>No UPI destination configured</b><p>{canConfigureUpi ? "Add the restaurant’s verified merchant UPI ID to accept QR payments." : "Ask the owner or manager to configure a payment destination."}</p></div> : <div className="payment-cards">{methods.map(method => <article key={method.id} className={!method.isActive ? "unavailable" : ""}><div className="generated-qr-mark" aria-hidden="true">UPI</div><div><h2>{method.displayName}</h2><p>{method.upiId || "UPI ID unavailable"}</p>{method.phone && <small>{method.phone}</small>}<span className={method.isActive ? "status active-status" : "status"}>{method.isActive ? "Dynamic payment enabled" : "Hidden"}</span></div>{canConfigureUpi && <div className="payment-method-actions"><button type="button" className="secondary-action" disabled={busy === `method-${method.id}`} onClick={() => { setBusy(`method-${method.id}`); void onToggle(method).finally(() => setBusy("")); }}>{busy === `method-${method.id}` ? "Saving…" : method.isActive ? "Disable" : "Enable"}</button>{!method.isActive && <button type="button" className="danger-action" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Delete ${method.displayName}? Payment history will be preserved.`)) { setBusy(`method-${method.id}`); void onDelete(method).finally(() => setBusy("")); } }}>Delete</button>}</div>}</article>)}</div>}
    </section>
    {canConfigureUpi && <form className="item-form" onSubmit={submit} aria-busy={busy === "upi-add"}><h2>Add UPI destination</h2><label>Preferred UPI app<select name="provider" required><option value="google_pay">Google Pay</option><option value="phonepe">PhonePe</option><option value="paytm">Paytm</option><option value="bhim">BHIM</option><option value="other">Other UPI app</option></select></label><label>Restaurant name<input name="displayName" placeholder="Copper & Clove" required minLength={2} maxLength={60} /></label><label>Merchant UPI ID<input name="upiId" placeholder="restaurant@bank" pattern="[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /><small>Use the merchant VPA issued by the restaurant’s bank or payment provider.</small></label><label>Registered phone (optional)<input name="phone" inputMode="tel" placeholder="+919876543210" pattern="\+?[0-9]{10,15}" /></label><button disabled={busy === "upi-add"}>{busy === "upi-add" ? "Saving…" : "Save UPI destination"}</button></form>}
    </div>

    <section className="merchant-connect-card">
      <div className="merchant-connect-heading"><div><p className="eyebrow">CARD PAYMENTS</p><h2>{cardMerchant?.connected ? "Razorpay connected" : canConfigureCard ? "Connect a merchant gateway" : "Merchant card gateway"}</h2><p>The platform creates each order on the server, verifies Razorpay signatures, and confirms captured payments by webhook.</p></div><span className={cardMerchant?.enabled ? "status active-status" : "status"}>{cardMerchant?.enabled ? "Live for customers" : cardMerchant?.connected ? "Test mode · hidden" : "Not connected"}</span></div>
      {cardMerchant?.connected ? <><div className="merchant-connected"><div><small>Provider</small><b>Razorpay</b></div><div><small>Key ID</small><b>{cardMerchant.maskedKeyId}</b></div><div><small>Customer visibility</small><b>{cardMerchant.enabled ? "Card checkout shown" : "Hidden until live keys"}</b></div>{canConfigureCard && <button type="button" className="secondary-action" disabled={busy === "card-disconnect"} onClick={() => void disconnectCard()}>{busy === "card-disconnect" ? "Disconnecting…" : "Disconnect"}</button>}</div><div className="notice"><b>Razorpay webhook</b><p>Add this URL in Razorpay and subscribe to payment.captured, payment.failed, order.paid, and refund.processed.</p><code>{cardMerchant.webhookUrl}</code>{cardMerchant.webhookSecret && <><p><strong>Copy this webhook secret now. It is shown only once:</strong></p><code>{cardMerchant.webhookSecret}</code></>}</div></> : canConfigureCard ? <form className="merchant-key-form" onSubmit={connectCard}><label>Gateway<select name="provider" disabled><option value="razorpay">Razorpay</option></select></label><label>Key ID<input name="keyId" autoComplete="off" placeholder="rzp_live_…" pattern="rzp_(test|live)_[A-Za-z0-9]+" required /></label><label>Key Secret<input name="keySecret" type="password" autoComplete="new-password" minLength={8} maxLength={200} required /><small>Encrypted before storage and never returned to this browser.</small></label><button disabled={busy === "card-connect"}>{busy === "card-connect" ? "Verifying…" : "Verify and connect"}</button></form> : <div className="empty-state"><b>Owner access required</b><p>Only the restaurant owner can connect or disconnect card merchant credentials.</p></div>}
      {canConfigureCard && <p className="merchant-help">Generate live API keys in Razorpay Dashboard → Account &amp; Settings → API Keys. Test keys can be connected for testing, but cannot accept live payments.</p>}
    </section>
  </div>;
}
