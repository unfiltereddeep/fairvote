import { initializeApp, getApp, getApps } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDQ9YWBbbBAYiysSZL24ta7dm9CE9OAV4Y",
  authDomain: "fair-vote-8e693.firebaseapp.com",
  projectId: "fair-vote-8e693",
  storageBucket: "fair-vote-8e693.firebasestorage.app",
  messagingSenderId: "18630005830",
  appId: "1:18630005830:web:d41ca9532073fdf082e647",
  measurementId: "G-2WMTKQHW9Q",
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
export const analytics =
  app && typeof window !== "undefined" ? getAnalytics(app) : null;
