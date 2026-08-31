import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredKeys = [config.apiKey, config.authDomain, config.projectId, config.appId, config.messagingSenderId];

export function hasFirebasePhoneAuthConfig() {
  return requiredKeys.every(Boolean);
}

export function getFirebaseAuth() {
  if (!hasFirebasePhoneAuthConfig()) return null;
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}
