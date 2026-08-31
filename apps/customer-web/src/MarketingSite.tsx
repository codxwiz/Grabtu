import { useEffect, useState, type FormEvent } from "react";

const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME || "Grabtu";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "hello@grabtu.com";
const API = import.meta.env.VITE_API_ORIGIN || `${location.protocol}//${location.hostname}:4000`;
export type MarketingPageKey = "home" | "services" | "pricing" | "about" | "contact" | "not-found";
type LegalPageKey = "privacy" | "terms" | "retention" | "support" | "shipping" | "refunds";
type SharedProps = { dashboardHref: string; menuPreviewHref: string; currentPath: string };
type MarketingProps = SharedProps & { page: MarketingPageKey };

const nav = [["Menu", "/r/demo-bistro/table/T7"], ["Services", "/services"], ["Plans", "/pricing"], ["About us", "/about"], ["Contact", "/contact"]] as const;
const legalCopy: Record<LegalPageKey, { title: string; paragraphs: string[] }> = {
  privacy: { title: "Privacy policy", paragraphs: ["Restaurant account, staff, menu, table, order, and payment-reference data is processed to provide the service.", "Each restaurant controls its menu and staff access. Payment-card details are handled by the configured payment provider and are not stored by Grabtu."] },
  terms: { title: "Terms of service", paragraphs: ["Restaurant operators must keep account and staff access secure and use the service lawfully.", "Subscription limits, renewal terms, and available features are shown during checkout and in the Billing workspace."] },
  retention: { title: "Data retention", paragraphs: ["Operational data is retained while an account is active and as required for security, accounting, dispute handling, and legal compliance.", "Verified deletion requests are handled according to the operator's agreement and applicable law."] },
  support: { title: "Support", paragraphs: [`Restaurant operators can use the in-product support queue or contact ${SUPPORT_EMAIL}.`, "Never send passwords, OTPs, card numbers, private keys, or payment-provider secrets in a support request."] },
  shipping: { title: "Shipping and fulfilment", paragraphs: ["Grabtu is delivered digitally; no physical software is shipped.", "The restaurant displayed on a QR menu is responsible for food preparation, availability, fulfilment, and any delivery it separately offers."] },
  refunds: { title: "Cancellation and refunds", paragraphs: ["Food-order cancellations and refunds are handled by the restaurant according to preparation status and its displayed policy.", "Subscription cancellation can be requested before renewal. Fees for a service period already started are not automatically refundable unless required by law or agreed in writing."] },
};

function useSpaNavigation() {
  useEffect(() => {
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target || target.hasAttribute("download")) return;
      const next = new URL(target.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      event.preventDefault();
      window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    document.addEventListener("click", navigate);
    return () => document.removeEventListener("click", navigate);
  }, []);
}

function Header({ dashboardHref, menuPreviewHref, currentPath }: SharedProps) {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><a className="wordmark" href="/" aria-label={`${PRODUCT_NAME} home`}>{PRODUCT_NAME}<i>.</i></a><button className="menu-toggle" type="button" aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(value => !value)}>{open ? "Close" : "Menu"}</button><nav id="site-navigation" className={open ? "open" : ""} aria-label="Primary"><a className="mobile-home-link" href="/" aria-current={currentPath === "/" ? "page" : undefined}>Home</a>{nav.map(([label, href]) => <a key={label} href={label === "Menu" ? menuPreviewHref : href} aria-current={currentPath === href ? "page" : undefined}>{label}</a>)}</nav><a className="header-login" href={dashboardHref}>Restaurant login <span>↗</span></a></header>;
}

function Footer({ menuPreviewHref }: Pick<SharedProps, "menuPreviewHref">) {
  return <footer className="site-footer"><div><a className="wordmark footer-mark" href="/">{PRODUCT_NAME}<i>.</i></a><p>Restaurant service, without the service gaps.</p></div><div><small>EXPLORE</small><a href={menuPreviewHref}>Menu demo</a><a href="/services">Services</a><a href="/pricing">Plans</a></div><div><small>COMPANY</small><a href="/about">About us</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div><p className="footer-copy">© {new Date().getFullYear()} Grabtu<br />Made for modern hospitality.</p></footer>;
}

function ProductBoard() {
  return <div className="product-board" aria-label="Grabtu restaurant workflow preview"><div className="board-top"><span>GRABTU / SERVICE BOARD</span><span className="live-dot">LIVE</span></div><div className="board-grid"><article><small>01 — TABLE</small><b>T12</b><p>4 items · Paid</p></article><article><small>02 — KITCHEN</small><b>06:42</b><p>Preparing now</p></article><article><small>03 — SERVICE</small><b>Ready</b><p>Runner notified</p></article></div><div className="board-line"><span>Scan</span><i /><span>Order</span><i /><span>Prepare</span><i /><span>Serve</span></div></div>;
}

function Home({ dashboardHref, menuPreviewHref }: SharedProps) {
  return <><section className="hero"><p className="kicker">THE RESTAURANT OPERATING SYSTEM</p><h1><span>Less waiting.</span><em>More serving.</em></h1><div className="hero-bottom"><p>One beautifully simple system for QR menus, kitchen operations, staff, and payments.</p><div className="action-row"><a className="button black" href={`${dashboardHref}?mode=signup`}>Start with Grabtu <span>↗</span></a><a className="text-link" href={menuPreviewHref}>Explore the menu demo <span>→</span></a></div></div></section><ProductBoard /><section className="statement"><p>BUILT AROUND THE GUEST</p><h2>From the first scan to the final bill, every handoff feels effortless.</h2></section><section className="home-services"><article><b>01</b><h3>Scan &amp; order</h3><p>A branded, mobile-first menu guests can understand instantly.</p></article><article><b>02</b><h3>Cook in sync</h3><p>Live kitchen tickets keep every station moving together.</p></article><article><b>03</b><h3>Get paid</h3><p>UPI, card, or counter—clear for guests and staff.</p></article></section><section className="closing-cta"><p>READY WHEN YOU ARE</p><h2>Your next service<br />starts here.</h2><a className="button white" href={`${dashboardHref}?mode=signup`}>Set up your restaurant <span>↗</span></a></section></>;
}

function Services({ dashboardHref }: SharedProps) {
  const services = [
    ["01", "QR menu", "A fast, branded menu with live availability, options, table identity, and ordering built in."],
    ["02", "Kitchen display", "Orders move to the correct production station in real time, from acknowledgement to ready."],
    ["03", "Menu control", "Update categories, dishes, prices, modifiers, images, and availability without calling support."],
    ["04", "Staff access", "Give owners, managers, cashiers, waiters, and kitchen teams exactly the access they need."],
    ["05", "Payments", "Accept dynamic UPI, Razorpay card payments, or pay-at-counter with a clear verification queue."],
    ["06", "Billing", "Manage your Grabtu plan, renewal, invoices, and cancellation from the owner workspace."],
  ];
  return <><section className="inner-hero service-intro"><p className="kicker">SERVICES</p><h1>Everything your service needs.</h1><p className="page-lead">One connected flow for guests, the kitchen, and the people running the floor.</p></section><section className="service-list">{services.map(([number, title, body]) => <article key={number}><b>{number}</b><h2>{title}</h2><p>{body}</p></article>)}</section><section className="inline-cta"><h2>Put the whole restaurant on one rhythm.</h2><a className="button white" href={`${dashboardHref}?mode=signup`}>Start setup <span>↗</span></a></section></>;
}

function Pricing({ dashboardHref }: SharedProps) {
  const plans = [
    { name: "Starter", detail: "For cafés and compact teams starting with digital service.", features: ["QR menu & ordering", "KDS mode", "Menu management", "Core staff roles"] },
    { name: "Growth", detail: "For busy restaurants ready to connect service and payments.", features: ["Everything in Starter", "UPI & card payments", "Expanded tables and staff", "Priority support"], featured: true },
    { name: "Business", detail: "For larger operations that need capacity and hands-on support.", features: ["Everything in Growth", "Highest operating limits", "Advanced business controls", "Managed onboarding"] },
  ];
  return <><section className="inner-hero plans-intro"><p className="kicker">PLANS</p><h1>A plan for every pace.</h1><p className="page-lead">Start focused. Move up when your tables, menu, and team grow. Current pricing and billing terms are confirmed securely during checkout.</p></section><section className="plan-grid">{plans.map(plan => <article key={plan.name} className={plan.featured ? "featured" : ""}>{plan.featured && <span className="plan-label">MOST POPULAR</span>}<p className="kicker">{plan.name}</p><h2>{plan.name}</h2><p>{plan.detail}</p><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul><a className={`button ${plan.featured ? "white" : "black"}`} href={`${dashboardHref}?mode=signup`}>Choose {plan.name} <span>↗</span></a></article>)}</section><p className="pricing-note">All plans require a restaurant account. Taxes and the final recurring amount are shown before payment.</p></>;
}

function About() {
  return <><section className="inner-hero about-intro"><p className="kicker">ABOUT US</p><h1>Hospitality first.<br />Software second.</h1></section><section className="about-grid"><p className="kicker">WHY GRABTU</p><div><h2>We believe restaurant technology should disappear into great service.</h2><p>Grabtu brings the guest menu, kitchen workflow, staff access, and payment handoff into one calm operating system. Fewer disconnected screens. Fewer missed instructions. More time for the human part of hospitality.</p><p>We build for the reality of a working restaurant: fast changes, shared devices, changing shifts, uneven connectivity, and no patience for complicated training.</p></div></section><section className="principles"><article><b>01</b><h3>Clear by default</h3><p>Every action should be obvious at a glance.</p></article><article><b>02</b><h3>Built for the rush</h3><p>Reliable workflows matter most when the room is full.</p></article><article><b>03</b><h3>Your brand leads</h3><p>Guests see the restaurant—not the software behind it.</p></article></section></>;
}

function Contact() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending"); setMessage("");
    try {
      const response = await fetch(`${API}/api/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(data.get("name") || ""), email: String(data.get("email") || ""), phone: String(data.get("phone") || ""), message: String(data.get("message") || "") }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "We could not send your message.");
      form.reset(); setStatus("sent"); setMessage("Thanks. Your message is with our team and we'll be in touch.");
    } catch (reason) { setStatus("error"); setMessage(reason instanceof Error ? reason.message : "We could not send your message."); }
  }
  return <section className="contact-layout"><div className="contact-copy"><p className="kicker">CONTACT</p><h1>Let's talk<br />restaurants.</h1><p>Planning a new setup or replacing an old one? Tell us what your service looks like.</p><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div><div className="contact-card-wrap"><form className="contact-card" onSubmit={submit}><div className="form-heading"><p className="kicker">START A CONVERSATION</p><h2>Tell us about your restaurant.</h2><span>Our team typically responds within one business day.</span></div><div className="contact-short-fields"><label>Name<input name="name" autoComplete="name" minLength={2} maxLength={100} placeholder="Your name" required /></label><label>Email<input name="email" type="email" autoComplete="email" maxLength={200} placeholder="you@restaurant.com" required /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" inputMode="tel" pattern="[+0-9 ()-]{10,20}" placeholder="+91" required /></label></div><label className="message-field">Message<textarea name="message" rows={5} minLength={10} maxLength={2000} placeholder="Tell us about your locations, tables, and current service setup…" required /></label>{message && <p className={`form-status ${status}`} role={status === "error" ? "alert" : "status"}>{message}</p>}<button className="button black" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send message"}<span>↗</span></button></form></div></section>;
}

function NotFound() {
  return <section className="inner-hero"><p className="kicker">404</p><h1>This page is not on the menu.</h1><a className="button black" href="/">Return home <span>→</span></a></section>;
}

export function MarketingSite({ dashboardHref, menuPreviewHref, currentPath, page }: MarketingProps) {
  useSpaNavigation();
  useEffect(() => { document.title = `${page === "home" ? "Restaurant OS" : page.replace("-", " ")} — ${PRODUCT_NAME}`; }, [page]);
  const shared = { dashboardHref, menuPreviewHref, currentPath };
  return <div className="marketing-shell"><Header {...shared} /><main>{page === "home" ? <Home {...shared} /> : page === "services" ? <Services {...shared} /> : page === "pricing" ? <Pricing {...shared} /> : page === "about" ? <About /> : page === "contact" ? <Contact /> : <NotFound />}</main><Footer menuPreviewHref={menuPreviewHref} /></div>;
}

export function LegalPage({ kind, dashboardHref, menuPreviewHref, currentPath }: SharedProps & { kind: LegalPageKey }) {
  useSpaNavigation();
  const copy = legalCopy[kind];
  useEffect(() => { document.title = `${copy.title} — ${PRODUCT_NAME}`; }, [copy.title]);
  return <div className="marketing-shell"><Header dashboardHref={dashboardHref} menuPreviewHref={menuPreviewHref} currentPath={currentPath} /><main className="legal-page"><p className="kicker">LEGAL</p><h1>{copy.title}</h1>{copy.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</main><Footer menuPreviewHref={menuPreviewHref} /></div>;
}
