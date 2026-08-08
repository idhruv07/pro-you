import { initializeApp as initClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, setDoc, doc } from 'firebase/firestore';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// 1. Config for Old Project (fir-c028b) using Admin SDK to bypass read rules
const serviceAccount = JSON.parse(readFileSync('../server/serviceAccountKey.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const dbOld = admin.firestore();

// 2. Config for New Project (pro-you-app) using Client SDK
const newConfig = {
  apiKey: "AIzaSyAWHfdhsN3HC432m8w1x5yWbEiHCgSNq58",
  authDomain: "pro-you-app.firebaseapp.com",
  projectId: "pro-you-app",
  storageBucket: "pro-you-app.firebasestorage.app",
  messagingSenderId: "459551321254",
  appId: "1:459551321254:web:839c581c4e5bd66789d867"
};

const appNew = initClientApp(newConfig, 'newApp');
const dbNew = getClientFirestore(appNew);

async function copyCollection(collectionName) {
  console.log(`Copying collection: ${collectionName}`);
  const snapshot = await dbOld.collection(collectionName).get();
  console.log(`Found ${snapshot.size} documents in ${collectionName}`);
  
  const promises = [];
  let count = 0;
  
  for (const document of snapshot.docs) {
    const data = document.data();
    promises.push(
      setDoc(doc(dbNew, collectionName, document.id), data).then(() => {
        count++;
        if (count % 100 === 0) console.log(`Copied ${count}/${snapshot.size} from ${collectionName}`);
      })
    );
  }
  
  await Promise.all(promises);
  console.log(`Finished copying all ${count} documents for ${collectionName}`);
}

async function main() {
  try {
    await copyCollection('channels');
    await copyCollection('videos');
    await copyCollection('cache');
    await copyCollection('stats');
    console.log("MIGRATION COMPLETE!");
    process.exit(0);
  } catch (err) {
    console.error("MIGRATION ERROR:", err);
    process.exit(1);
  }
}

main();
