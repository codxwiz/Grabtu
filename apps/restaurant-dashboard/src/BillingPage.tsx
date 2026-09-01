import { useEffect, useRef, useState } from "react";
import { SupportTicketsCard } from "./SupportTicketsCard";
import type { Billing, SupportTicket } from "./types";

const money = (amount: number, currency = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const title = (value: string) => value.toLowerCase() === "business" || value.toLowerCase() === "pro" ? "BUSINESS" : value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
const safeInvoiceUrl = (value?: string | null) => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
};

type BillingPageProps = {
  billing: Billing | null;
  supportTickets: SupportTicket[];
  onCheckout: (plan: string) => void;
  onCancel: () => void;
  onCreateSupportTicket: (data: { subject: string; category: string; priority: string; message: string }) => Promise<boolean>;
};

export function BillingPage({ billing, supportTickets, onCheckout, onCancel, onCreateSupportTicket }: BillingPageProps) {
  const [supportOpen, setSupportOpen] = useState(false);
  const supportCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!supportOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSupportOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => supportCloseRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [supportOpen]);

  if (!billing) return <div className="empty-state">Loading billing…</div>;
  const currentPlan = billing.currentPlan || (billing.subscription?.plan === "pro" ? "business" : billing.subscription?.plan || "starter");
  const isTrial = billing.subscription?.status.toUpperCase() === "TRIALING";
  const mandateConnected = isTrial && Boolean(billing.mandateAuthorized);

  function cancel() {
    const message = isTrial
      ? "Cancel automatic renewal? Your trial will remain available until its scheduled end, and no subscription charge will be made."
      : "Cancel this plan at the end of the current billing period?";
    if (window.confirm(message)) onCancel();
  }

  return (
    <div className="billing-grid">
      <section className="chart-card billing-plans-card">
        <div className="billing-heading">
          <div><p className="eyebrow">SUBSCRIPTION</p><h2>Choose a plan</h2><p className="billing-subtitle">Scale your restaurant operations as your service grows.</p></div>
          <span className="billing-live"><i /> {isTrial ? "14-day trial" : "Billing active"}</span>
        </div>
        <div className="plan-list">
          {billing.plans.map(plan => {
            const isCurrent = currentPlan === plan.plan;
            return (
              <article className={`plan-card ${isCurrent ? "current" : ""}`} key={plan.plan}>
                {isCurrent && <span className="plan-ribbon">CURRENT PLAN</span>}
                <div className="plan-main">
                  <div className="plan-title-row"><b>{title(plan.plan)}</b><span>{plan.plan === "starter" ? "For getting started" : plan.plan === "growth" ? "For busy dining rooms" : "For growing groups"}</span></div>
                  <div className="plan-price">{plan.amount ? money(plan.amount, plan.currency) : "Free"}<small>{plan.amount ? "/ month" : "forever"}</small></div>
                  <div className="plan-limits"><span>Tables <b>{plan.limits.tables}</b></span><span>Staff <b>{plan.limits.staff}</b></span><span>Menu items <b>{plan.limits.menuItems}</b></span></div>
                </div>
                <button
                  className={isCurrent && !isTrial ? "current-plan-button" : "plan-choose-button"}
                  disabled={isCurrent && !isTrial}
                  onClick={() => onCheckout(plan.plan)}
                >
                  {isCurrent ? (isTrial ? (mandateConnected ? "Review recurring mandate" : "Authorize recurring mandate") : "✓ Current plan") : `Choose ${title(plan.plan)}`}
                </button>
              </article>
            );
          })}
          <article className={`plan-card enterprise-plan ${currentPlan === "enterprise" ? "current" : ""}`}>
            {currentPlan === "enterprise" && <span className="plan-ribbon">SPECIAL EVENT ACTIVE</span>}
            <div className="plan-main">
              <div className="plan-title-row"><b>SPECIAL EVENT SETUP</b><span>For private events and temporary service</span></div>
              <div className="plan-price">Custom<small>tailored setup</small></div>
              <div className="enterprise-feature-list"><span>Event-ready configuration</span></div>
            </div>
            <button type="button" className="plan-choose-button enterprise-contact" onClick={() => setSupportOpen(true)}>Request</button>
          </article>
        </div>
        {billing.subscription?.cancelAtPeriodEnd && <div className="billing-alert warning"><span>!</span><div><b>Automatic renewal cancelled</b><small>{isTrial ? "Your trial remains available until its scheduled end. No subscription charge will be made." : "Your plan stays active until the end of the current billing period."}</small></div></div>}
        {billing.subscription && !billing.subscription.cancelAtPeriodEnd && (isTrial || currentPlan !== "starter") && <button className="cancel-plan-button" onClick={cancel}>{isTrial ? "Cancel automatic renewal" : "Cancel plan at period end"} <span>→</span></button>}
        {billing.subscription && <div className="billing-footnote">{isTrial ? (billing.subscription.cancelAtPeriodEnd ? "Trial ends" : "First charge") : "Next renewal"} <b>{new Date(billing.subscription.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b></div>}
      </section>

      <section className="chart-card invoices-card">
        <div className="billing-heading invoice-heading"><div><p className="eyebrow">BILLING HISTORY</p><h2>Invoices</h2><p className="billing-subtitle">Your latest subscription receipts and payment status.</p></div><span className="invoice-count">{billing.invoices.length} total</span></div>
        {billing.invoices.length === 0 ? <div className="empty-state invoice-empty"><span>▤</span><b>No invoices yet</b><p>Invoices will appear after your first paid billing period.</p></div> : <div className="invoice-list">
          {billing.invoices.map(invoice => { const invoiceUrl = safeInvoiceUrl(invoice.hostedUrl); return <div className="invoice-row" key={invoice.id}>
            <div className="invoice-icon" aria-hidden="true">▤</div><div className="invoice-id"><b>{invoice.number}</b><small>{new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</small></div><div className="invoice-status"><span className={`invoice-pill ${invoice.status.toLowerCase()}`}>{invoice.status}</span></div><strong className="invoice-amount">{money(invoice.amount, invoice.currency)}</strong>{invoiceUrl ? <a className="invoice-action" aria-label={`View invoice ${invoice.number}`} href={invoiceUrl} target="_blank" rel="noreferrer">View <span aria-hidden="true">↗</span></a> : <span className="invoice-action unavailable" aria-label={`Invoice document for ${invoice.number} is not available yet`}>Unavailable</span>}
          </div>; })}
        </div>}
      </section>

      {supportOpen && <div className="support-request-modal" role="dialog" aria-modal="true" aria-label="Special event support request" onMouseDown={event => { if (event.target === event.currentTarget) setSupportOpen(false); }}>
        <div className="support-request-dialog">
          <button ref={supportCloseRef} type="button" className="support-request-close" aria-label="Close support request" onClick={() => setSupportOpen(false)}>×</button>
          <SupportTicketsCard tickets={supportTickets} onCreate={onCreateSupportTicket} />
        </div>
      </div>}
    </div>
  );
}
