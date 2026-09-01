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
  return <header className="site-header"><a className="wordmark" href="/" aria-label={`${PRODUCT_NAME} home`}>{PRODUCT_NAME}<i>.</i></a><button className="menu-toggle" type="button" aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(value => !value)}>{open ? "Close" : "Menu"}</button><nav id="site-navigation" className={open ? "open" : ""} aria-label="Primary"><a className="mobile-home-link" href="/" aria-current={currentPath === "/" ? "page" : undefined} onClick={() => setOpen(false)}>Home</a>{nav.map(([label, href]) => <a key={label} href={label === "Menu" ? menuPreviewHref : href} aria-current={currentPath === href ? "page" : undefined} onClick={() => setOpen(false)}>{label === "Menu" ? "Guest View" : label}</a>)}<a className="mobile-login-link" href={dashboardHref} onClick={() => setOpen(false)}>Restaurant login <span>↗</span></a></nav><a className="header-login" href={dashboardHref}>Restaurant login <span>↗</span></a></header>;
}

function Footer({ menuPreviewHref }: Pick<SharedProps, "menuPreviewHref">) {
  return <footer className="site-footer"><div><a className="wordmark footer-mark" href="/">{PRODUCT_NAME}<i>.</i></a><p>Restaurant service, without the service gaps.</p></div><div><small>EXPLORE</small><a href={menuPreviewHref}>Menu demo</a><a href="/services">Services</a><a href="/pricing">Plans</a></div><div><small>COMPANY</small><a href="/about">About us</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div><p className="footer-copy">© {new Date().getFullYear()} Grabtu<br />Made for modern hospitality.</p></footer>;
}

function ProductBoard() {
  return <div className="product-board" aria-label="Grabtu restaurant workflow preview"><div className="board-top"><span>GRABTU / SERVICE BOARD</span><span className="live-dot">LIVE</span></div><div className="board-grid"><article><small>01 — TABLE</small><b>T12</b><p>4 items · Paid</p></article><article><small>02 — KITCHEN</small><b>06:42</b><p>Preparing now</p></article><article><small>03 — SERVICE</small><b>Ready</b><p>Runner notified</p></article></div><div className="board-line"><span>Scan</span><i /><span>Order</span><i /><span>Prepare</span><i /><span>Serve</span></div></div>;
}

function Home({ dashboardHref, menuPreviewHref }: SharedProps) {
  return <><section className="hero"><p className="kicker">THE RESTAURANT OPERATING SYSTEM</p><div className="hero-showcase"><div className="hero-copy"><h1><span>Less waiting.</span><em>More serving.</em></h1><div className="hero-bottom"><p>One beautifully simple system for QR menus, kitchen operations, staff, and payments.</p><div className="action-row"><a className="button black" href={`${dashboardHref}?mode=signup`}>Start with Grabtu <span>↗</span></a><a className="text-link" href={menuPreviewHref}>Explore the menu demo <span>→</span></a></div></div></div><figure className="hero-dashboard"><figcaption><span>RESTAURANT DASHBOARD</span><span>LIVE OPERATIONS</span></figcaption><img src="/dashboard-preview.jpg" alt="Grabtu restaurant dashboard showing live kitchen tickets and a waiter request" fetchPriority="high" /></figure></div></section><ProductBoard /><section className="statement"><p>BUILT AROUND THE GUEST</p><h2><span>From the first scan to </span><span>the final bill, every </span><span>handoff feels effortless.</span></h2></section><section className="home-services"><article><h3>Scan &amp; order</h3><p>A branded, mobile-first menu guests can understand instantly.</p></article><article><h3>Cook in sync</h3><p>Live kitchen tickets keep every station moving together.</p></article><article><h3>Get paid</h3><p>UPI, card, or counter—clear for guests and staff.</p></article></section><section className="home-premium"><div><p className="kicker">PREMIUM OPERATIONS</p><h2>More room for the rush.</h2><p>Growth and Business plans increase your operating capacity while keeping the same simple workflow your team already knows.</p><a className="text-link" href="/pricing">Compare every plan <span>→</span></a></div><dl aria-label="Business plan capacity"><div><dt>60</dt><dd>Tables</dd></div><div><dt>20</dt><dd>Staff members</dd></div><div><dt>150</dt><dd>Menu items</dd></div><div><dt>90</dt><dd>Days of reporting</dd></div></dl></section><section className="closing-cta"><p>READY WHEN YOU ARE</p><h2>Your next service<br />starts here.</h2><a className="button white" href={`${dashboardHref}?mode=signup`}>Set up your restaurant <span>↗</span></a></section></>;
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
    { name: "Starter", price: "₹1,499", detail: "For cafés and compact teams moving their first service flow online.", capacity: "5 tables · 2 staff · 15 menu items", features: ["QR menu and guest ordering", "Live kitchen display mode", "Menu and availability control", "7 days of operational reporting"] },
    { name: "Growth", price: "₹3,499", detail: "For busy restaurants connecting the dining room, kitchen, and payments.", capacity: "20 tables · 6 staff · 45 menu items", features: ["Everything in Starter", "UPI, card, and counter payments", "30 days of operational reporting", "Priority support"], featured: true },
    { name: "Business", price: "₹7,999", detail: "For higher-volume operations that need more capacity and hands-on setup.", capacity: "60 tables · 20 staff · 150 menu items", features: ["Everything in Growth", "90 days of operational reporting", "Highest operating limits", "Managed onboarding"] },
  ];
  const comparison = [
    ["QR menu & ordering", "Included", "Included", "Included"],
    ["Kitchen display mode", "Included", "Included", "Included"],
    ["Menu & availability control", "Included", "Included", "Included"],
    ["Tables", "Up to 5", "Up to 20", "Up to 60"],
    ["Staff members", "Up to 2", "Up to 6", "Up to 20"],
    ["Menu items", "Up to 15", "Up to 45", "Up to 150"],
    ["Operational reporting", "7 days", "30 days", "90 days"],
    ["Guest payments", "Counter", "UPI, card & counter", "UPI, card & counter"],
    ["Support", "Standard", "Priority", "Priority + onboarding"],
    ["Plan billing & invoices", "Included", "Included", "Included"],
  ];
  const faqs = [
    ["Is there a trial?", "Yes. New restaurant accounts receive a 14-day trial. Your selected subscription begins after the trial when the recurring payment mandate is active."],
    ["Can I change plans later?", "Yes. Owners can review the current plan, change subscription level, view invoices, and request cancellation from the Billing workspace."],
    ["Do guests need to install an app?", "No. Guests open the restaurant menu from its table QR code in their mobile browser, place an order, and choose an available payment method."],
    ["What makes Business the premium plan?", "Business raises the supported capacity to 60 tables, 20 staff members, and 150 menu items, extends operational reporting to 90 days, and includes managed onboarding."],
    ["Are payment-provider fees included?", "The Grabtu subscription covers the software plan. Any payment-provider charges, applicable taxes, and final recurring terms are shown separately before payment."],
  ];
  return <><section className="inner-hero plans-intro"><h1>A plan for every pace.</h1></section><section className="premium-promise" aria-label="What every Grabtu plan includes"><div><p className="kicker">EVERY PLAN STARTS COMPLETE</p></div><ul><li>Mobile-first QR menu</li><li>Real-time kitchen display</li><li>Staff access by role</li><li>Owner billing and invoices</li></ul></section><section className="plan-grid">{plans.map(plan => <article key={plan.name} className={plan.featured ? "featured" : ""}>{plan.featured && <span className="plan-label">MOST POPULAR</span>}<p className="kicker">{plan.name}</p><h2>{plan.name}</h2><p className="plan-price"><strong>{plan.price}</strong><span>/ month</span></p><p className="plan-detail">{plan.detail}</p><p className="plan-capacity">{plan.capacity}</p><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul><a className={`button ${plan.featured ? "white" : "black"}`} href={`${dashboardHref}?mode=signup`}>Choose {plan.name} <span>↗</span></a></article>)}</section><p className="pricing-note">All amounts are in INR and billed monthly. Taxes and final recurring terms are confirmed securely before payment.</p><section className="comparison-section"><div className="section-heading"><p className="kicker">PLAN COMPARISON</p><h2>See exactly what changes.</h2><p>Start with the capacity you need today. Upgrade when service gets busier.</p></div><div className="comparison-scroll" tabIndex={0} aria-label="Scrollable plan comparison"><table><caption className="sr-only">Comparison of Grabtu Starter, Growth, and Business plans</caption><thead><tr><th scope="col">Capability</th><th scope="col">Starter</th><th scope="col">Growth</th><th scope="col">Business</th></tr></thead><tbody>{comparison.map(([capability, starter, growth, business]) => <tr key={capability}><th scope="row">{capability}</th><td>{starter}</td><td>{growth}</td><td>{business}</td></tr>)}</tbody></table></div><p className="comparison-hint">On smaller screens, swipe the table sideways to compare all plans.</p></section><section className="business-spotlight"><div><p className="kicker">THE PREMIUM EXPERIENCE</p><h2>Business is built for a fuller room.</h2><p>More tables, more staff, and a larger menu should not create more operational noise. Business keeps every core workflow connected and adds the capacity, reporting history, and onboarding support needed for higher-volume service.</p><div className="business-actions"><a className="button white" href={`${dashboardHref}?mode=signup`}>Start Business <span>↗</span></a><a className="text-link light" href="/contact">Talk to our team <span>→</span></a></div></div><dl><div><dt>01</dt><dd><strong>Managed onboarding</strong><span>Guided setup for your menu, tables, staff roles, and service workflow.</span></dd></div><div><dt>02</dt><dd><strong>Premium capacity</strong><span>Operate with up to 60 tables, 20 staff members, and 150 menu items.</span></dd></div><div><dt>03</dt><dd><strong>Longer visibility</strong><span>Review up to 90 days of operational reporting from the owner workspace.</span></dd></div></dl></section><section className="pricing-faq"><div className="section-heading"><p className="kicker">GOOD TO KNOW</p><h2>Before you choose.</h2></div><div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section><section className="pricing-final"><p className="kicker">START WITH CONFIDENCE</p><h2>Choose today.<br />Scale tomorrow.</h2><div><a className="button black" href={`${dashboardHref}?mode=signup`}>Start 14-day trial <span>↗</span></a><a className="text-link" href="/contact">Discuss your setup <span>→</span></a></div></section></>;
}

function About() {
  return <><section className="inner-hero about-intro"><p className="kicker">ABOUT US</p><h1>Hospitality first.<br />Software second.</h1></section><section className="about-grid"><p className="kicker">WHY GRABTU</p><div><h2><span>We believe restaurant </span><span>technology should disappear </span><span>into great service.</span></h2><p>Grabtu brings the guest menu, kitchen workflow, staff access, and payment handoff into one calm operating system. Fewer disconnected screens. Fewer missed instructions. More time for the human part of hospitality.</p><p>We build for the reality of a working restaurant: fast changes, shared devices, changing shifts, uneven connectivity, and no patience for complicated training.</p></div></section><section className="principles"><article><b>01</b><h3>Clear by default</h3><p>Every action should be obvious at a glance.</p></article><article><b>02</b><h3>Built for the rush</h3><p>Reliable workflows matter most when the room is full.</p></article><article><b>03</b><h3>Your brand leads</h3><p>Guests see the restaurant—not the software behind it.</p></article></section></>;
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
  useEffect(() => {
    const label = page === "home" ? "Restaurant OS" : page === "not-found" ? "Page not found" : `${page.charAt(0).toUpperCase()}${page.slice(1).replace("-", " ")}`;
    document.title = `${label} — ${PRODUCT_NAME}`;
  }, [page]);
  const shared = { dashboardHref, menuPreviewHref, currentPath };
  return <div className="marketing-shell"><a className="skip-link" href="#main-content">Skip to content</a><Header {...shared} /><main id="main-content" tabIndex={-1}>{page === "home" ? <Home {...shared} /> : page === "services" ? <Services {...shared} /> : page === "pricing" ? <Pricing {...shared} /> : page === "about" ? <About /> : page === "contact" ? <Contact /> : <NotFound />}</main><Footer menuPreviewHref={menuPreviewHref} /></div>;
}

export function LegalPage({ kind, dashboardHref, menuPreviewHref, currentPath }: SharedProps & { kind: LegalPageKey }) {
  useSpaNavigation();
  const copy = legalCopy[kind];
  useEffect(() => { document.title = `${copy.title} — ${PRODUCT_NAME}`; }, [copy.title]);
  return <div className="marketing-shell"><a className="skip-link" href="#main-content">Skip to content</a><Header dashboardHref={dashboardHref} menuPreviewHref={menuPreviewHref} currentPath={currentPath} /><main id="main-content" className="legal-page" tabIndex={-1}><p className="kicker">LEGAL</p><h1>{copy.title}</h1>{copy.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</main><Footer menuPreviewHref={menuPreviewHref} /></div>;
}
