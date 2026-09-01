import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { API, TOKEN_KEY, ApiError, api } from "./api";
import { DEMO_TOKEN, enableDemoSession } from "./demo-mode";
import { getFirebaseAuth, hasFirebasePhoneAuthConfig } from "./firebase";

const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME || "Grabtu";
type Mode = "phone-login" | "phone-signup";
type Plan = "starter" | "growth" | "business" | "pro";
type PhoneConfirmation = { confirm(code: string): Promise<{ user: { getIdToken(): Promise<string>; phoneNumber?: string | null } }> };
type MandateConfirmation = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayCheckout = { open(): void };
type RazorpayConstructor = new (options: {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  image: string;
  prefill: { name: string; contact: string };
  theme: { color: string };
  handler: (response: MandateConfirmation) => void;
  modal: { ondismiss: () => void };
}) => RazorpayCheckout;
const signupPlans: Array<{ id: Exclude<Plan, "pro">; name: string; price: string; description: string }> = [
  { id: "starter", name: "Starter", price: "₹1,499", description: "For getting started" },
  { id: "growth", name: "Growth", price: "₹3,499", description: "For busy dining rooms" },
  { id: "business", name: "Business", price: "₹7,999", description: "For growing groups" },
];

async function postPublic<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the Grabtu server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || "Request failed", response.status, data.code);
  return data as T;
}

function normalizePhone(value: string) {
  return value.trim();
}

async function loadRazorpayCheckout() {
  const existing = window.Razorpay;
  if (existing) return existing;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout. Check your connection and try again."));
    document.head.appendChild(script);
  });
  if (!window.Razorpay) throw new Error("Razorpay Checkout did not initialize");
  return window.Razorpay;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const location = useMemo(() => new URL(window.location.href), []);
  const initialMode: Mode = location.pathname === "/signup" || location.searchParams.get("mode") === "signup" ? "phone-signup" : "phone-login";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(location.searchParams.get("phone") || "+91");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [restaurantName, setRestaurantName] = useState(location.searchParams.get("restaurant") || "");
  const [ownerName, setOwnerName] = useState(location.searchParams.get("owner") || "");
  const [plan, setPlan] = useState<Plan>("starter");
  const selectedPlan = signupPlans.find(option => option.id === plan) || signupPlans[0];
  const [demoAvailable, setDemoAvailable] = useState(false);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaElementRef = useRef<HTMLDivElement | null>(null);
  const confirmationRef = useRef<PhoneConfirmation | null>(null);

  function clearRecaptchaVerifier() {
    try {
      recaptchaRef.current?.clear();
    } catch {
      // Firebase may already have released the verifier after a failed request.
    }
    recaptchaRef.current = null;
    recaptchaElementRef.current?.remove();
    recaptchaElementRef.current = null;
  }

  useEffect(() => {
    setDemoAvailable(import.meta.env.DEV || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    return clearRecaptchaVerifier;
  }, []);

  function resetPhoneFlow() {
    setOtp("");
    setOtpSent(false);
    setVerificationToken("");
    setVerifiedPhone("");
    confirmationRef.current = null;
    setError("");
    setNotice("");
    clearRecaptchaVerifier();
  }

  function switchMode(next: Mode) {
    if (next !== mode) {
      resetPhoneFlow();
      setMode(next);
    }
  }

  function getRecaptchaVerifier() {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase phone auth is not configured yet");
    clearRecaptchaVerifier();
    const element = document.createElement("div");
    element.className = "recaptcha-slot";
    element.setAttribute("aria-hidden", "true");
    document.body.appendChild(element);
    recaptchaElementRef.current = element;
    const verifier = new RecaptchaVerifier(auth, element, { size: "invisible" });
    recaptchaRef.current = verifier;
    return verifier;
  }

  async function sendPhoneOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setVerificationToken("");
    try {
      if (!hasFirebasePhoneAuthConfig()) throw new Error("Add the Firebase client env vars to enable phone OTP sign-in.");
      const nextPhone = normalizePhone(phone);
      if (!nextPhone.startsWith("+")) throw new Error("Enter your phone number in international format, for example +919876543210.");
      if (mode === "phone-signup" && (!restaurantName.trim() || !ownerName.trim())) {
        throw new Error("Add your restaurant name and owner name before sending the code.");
      }
      const verifier = getRecaptchaVerifier();
      const auth = getFirebaseAuth();
      if (!auth) throw new Error("Firebase phone auth is not configured yet");
      const result = await signInWithPhoneNumber(auth, nextPhone, verifier);
      setOtpSent(true);
      setNotice(`We sent a code to ${nextPhone}. Enter it to continue.`);
      confirmationRef.current = result as unknown as PhoneConfirmation;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the phone verification code");
    } finally {
      clearRecaptchaVerifier();
      setBusy(false);
    }
  }

  async function completeWithVerifiedPhone(nextToken: string) {
    if (mode === "phone-signup") {
      const data = await postPublic<{ token: string; checkoutUrl: string | null; mandateSetupRequired: boolean; razorpayKeyId: string | null; providerSubscriptionId: string | null }>("/api/auth/firebase/signup", {
        idToken: nextToken,
        restaurantName,
        ownerName,
        plan,
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      if (data.razorpayKeyId && data.providerSubscriptionId) {
        const Razorpay = await loadRazorpayCheckout();
        const confirmation = await new Promise<MandateConfirmation | null>(resolve => {
          const checkout = new Razorpay({
            key: data.razorpayKeyId!,
            subscription_id: data.providerSubscriptionId!,
            name: PRODUCT_NAME,
            description: `${signupPlans.find(option => option.id === plan)?.name || PRODUCT_NAME} plan · first charge after 14-day trial`,
            image: "/favicon.svg",
            prefill: { name: ownerName.trim(), contact: verifiedPhone || normalizePhone(phone) },
            theme: { color: "#17372b" },
            handler: response => resolve(response),
            modal: { ondismiss: () => resolve(null) },
          });
          checkout.open();
        });
        if (!confirmation) {
          setNotice("Your account and free trial are ready. Authorize the recurring mandate from Billing before the trial ends.");
          onLogin(data.token);
          return;
        }
        await api("/api/admin/billing/verify-mandate", data.token, { method: "POST", body: JSON.stringify(confirmation) });
        onLogin(data.token);
        return;
      }
      onLogin(data.token);
      return;
    }

    const data = await postPublic<{ token: string }>("/api/auth/firebase/login", { idToken: nextToken });
    localStorage.setItem(TOKEN_KEY, data.token);
    onLogin(data.token);
  }

  async function verifyPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const confirmationResult = confirmationRef.current;
      if (!confirmationResult) throw new Error("Send a verification code first.");
      if (!otp.trim()) throw new Error("Enter the six-digit verification code.");
      const credential = await confirmationResult.confirm(otp.trim());
      const nextToken = await credential.user.getIdToken();
      setVerificationToken(nextToken);
      setVerifiedPhone(credential.user.phoneNumber || phone);
      await completeWithVerifiedPhone(nextToken);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "PHONE_ACCOUNT_NOT_FOUND") {
        setMode("phone-signup");
        setNotice("No restaurant account is linked to that phone yet. Fill in the restaurant details below to create a free trial.");
        setError("");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not verify the phone code");
    } finally {
      setBusy(false);
    }
  }

  async function continueWithVerifiedPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!verificationToken) throw new Error("Verify the phone number first.");
      await completeWithVerifiedPhone(verificationToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not continue with the verified phone");
    } finally {
      setBusy(false);
    }
  }

  async function openDemoSession() {
    enableDemoSession();
    localStorage.setItem(TOKEN_KEY, DEMO_TOKEN);
    onLogin(DEMO_TOKEN);
  }

  return (
    <main className="login">
      <form
        onSubmit={otpSent ? (verificationToken && mode === "phone-signup" ? continueWithVerifiedPhone : verifyPhoneCode) : sendPhoneOtp}
      >
        <div className="auth-wordmark grabtu-wordmark" aria-label={PRODUCT_NAME}>{PRODUCT_NAME}<span>.</span></div>
        <p>RESTAURANT CONSOLE</p>
        <h1>{mode === "phone-login" ? "SIGN IN WITH PHONE OTP." : "START YOUR 14-DAY FREE TRIAL."}</h1>

        <div className="auth-tabs" role="tablist" aria-label="Authentication method">
          <button type="button" className={mode === "phone-login" ? "auth-tab active" : "auth-tab"} onClick={() => switchMode("phone-login")}>
            Sign in
          </button>
          <button type="button" className={mode === "phone-signup" ? "auth-tab active" : "auth-tab"} onClick={() => switchMode("phone-signup")}>
            Start trial
          </button>
        </div>

        {mode === "phone-signup" && (
          <>
            <label>
              Restaurant name
              <input value={restaurantName} onChange={event => setRestaurantName(event.currentTarget.value)} required minLength={2} placeholder="The Copper Table" />
            </label>
            <label>
              Owner name
              <input value={ownerName} onChange={event => setOwnerName(event.currentTarget.value)} required minLength={2} placeholder="Asha Patel" />
            </label>
            <fieldset className="premium-plan-field">
              <legend>Choose your plan</legend>
              <div className="premium-select-shell">
                <select
                  className="premium-select"
                  value={plan}
                  onChange={event => setPlan(event.currentTarget.value as Plan)}
                  aria-describedby="selected-plan-summary"
                >
                  {signupPlans.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name} — {option.price} / month
                    </option>
                  ))}
                </select>
                <span className="premium-select-arrow" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
                </span>
              </div>
              <p id="selected-plan-summary" className="premium-select-summary">
                {selectedPlan.description} · {selectedPlan.price} / month after the 14-day trial
              </p>
            </fieldset>
          </>
        )}

        <label>
          Phone number
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+919876543210"
            value={phone}
            onChange={event => setPhone(event.currentTarget.value)}
            required
          />
        </label>

        {otpSent && (
          <>
            <label>
              Verification code
              <input
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={otp}
                onChange={event => setOtp(event.currentTarget.value)}
                required
              />
            </label>
            {verifiedPhone && <div className="auth-pill" role="status">Verified: {verifiedPhone}</div>}
          </>
        )}

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div role="status" className="toast-inline">{notice}</div>}

        {!otpSent ? (
          <button disabled={busy}>{busy ? "Sending code…" : mode === "phone-signup" ? "Send code to create trial" : "Send code to sign in"}</button>
        ) : verificationToken && mode === "phone-signup" ? (
          <button disabled={busy}>{busy ? "Creating trial…" : "Create trial"}</button>
        ) : (
          <button disabled={busy}>{busy ? "Verifying…" : "Verify and continue"}</button>
        )}

        {otpSent && (
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setOtp("");
              setOtpSent(false);
              setVerificationToken("");
              setVerifiedPhone("");
              confirmationRef.current = null;
            }}
          >
            Change phone number
          </button>
        )}

        {mode === "phone-login" ? (
          <button type="button" className="secondary-action" onClick={() => switchMode("phone-signup")}>
            Start a free trial
          </button>
        ) : (
          <button type="button" className="secondary-action" onClick={() => switchMode("phone-login")}>
            I already have an account
          </button>
        )}

        {demoAvailable && (
          <button type="button" className="secondary-action" onClick={() => void openDemoSession()}>
            Open local demo
          </button>
        )}

        <small>We never ask for passwords. If you need a restaurant account, verify the phone number tied to that account or create a new trial.</small>
      </form>
    </main>
  );
}
