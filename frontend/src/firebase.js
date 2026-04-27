import { initializeApp } from "firebase/app";
import { getAuth }       from "firebase/auth";
import { getFirestore }  from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyDIRIwSsaPN9cNCLEcyf189kcf6y2INJII",
  authDomain:        "cityshield-ai.firebaseapp.com",
  projectId:         "cityshield-ai",
  storageBucket:     "cityshield-ai.firebasestorage.app",
  messagingSenderId: "68732815643",
  appId:             "1:68732815643:web:931eee54500b143fbf6bbe",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;