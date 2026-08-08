import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { 
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection, getDocs, addDoc, deleteDoc, doc, query, where, setDoc, updateDoc, getDoc, limit,
  arrayUnion, writeBatch, getCountFromServer
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD11SNM_AnIdg3QHItPgwbt0C49301r6u8",
  authDomain: "fir-c028b.firebaseapp.com",
  projectId: "fir-c028b",
  storageBucket: "fir-c028b.firebasestorage.app",
  messagingSenderId: "854138360743",
  appId: "1:854138360743:web:ec2d944a8cd6e9d08a5c82",
  measurementId: "G-1FF3QRR682"
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
