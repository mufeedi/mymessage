// Import the core Firebase SDK and the services you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBPeLsvQ0OfN0z5l7aI3hSi1_15Kpj5g5c",
  authDomain: "mymessage-19b4c.firebaseapp.com",
  projectId: "mymessage-19b4c",
  storageBucket: "mymessage-19b4c.firebasestorage.app",
  messagingSenderId: "868912897000",
  appId: "1:868912897000:web:14f0c4d947aff47b52225d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services and export them
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
