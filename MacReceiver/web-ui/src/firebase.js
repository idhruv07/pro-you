import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { 
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection, getDocs, addDoc, deleteDoc, doc, query, where, setDoc, updateDoc, getDoc, limit,
  arrayUnion, writeBatch, getCountFromServer
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAWHfdhsN3HC432m8w1x5yWbEiHCgSNq58",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "pro-you-app.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "pro-you-app",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "pro-you-app.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "459551321254",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:459551321254:web:839c581c4e5bd66789d867"
};

let memoizedApp = null;
let memoizedAuth = null;
let memoizedFirestore = null;
let memoizedProvider = null;

export const initFirebase = () => {
  if (!memoizedApp) {
    if (!getApps().length) {
      memoizedApp = initializeApp(firebaseConfig);
    } else {
      memoizedApp = getApps()[0];
    }
  }

  if (!memoizedAuth) {
    memoizedAuth = getAuth(memoizedApp);
  }

  if (!memoizedFirestore) {
    try {
      memoizedFirestore = initializeFirestore(memoizedApp, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (e) {
      memoizedFirestore = getFirestore(memoizedApp);
    }

    // ── Emulator: auto-connect ONLY in local development (DEV mode) when VITE_USE_EMULATOR=true ──
    if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true') {
      try {
        connectFirestoreEmulator(memoizedFirestore, '127.0.0.1', 8080);
        console.log('%c🔧 EMULATOR MODE — Firestore → localhost:8080', 'color: orange; font-weight: bold');
      } catch (e) {
        // Already connected (hot-reload safe)
      }
    }
  }

  if (!memoizedProvider) {
    memoizedProvider = new GoogleAuthProvider();
    memoizedProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  }

  return { 
    app: memoizedApp, 
    auth: memoizedAuth, 
    firestore: memoizedFirestore, 
    provider: memoizedProvider 
  };
};

export { 
  signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, GoogleAuthProvider,
  collection, getDocs, addDoc, deleteDoc, doc, query, where, setDoc, updateDoc, getDoc, limit,
  arrayUnion, writeBatch, getCountFromServer
};
