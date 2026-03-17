import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD_mU6uwQkMCIotINBy8iI61RF50oPRgGk",
  authDomain: "legends-gym-f05c7.firebaseapp.com",
  databaseURL: "https://legends-gym-f05c7-default-rtdb.firebaseio.com",
  projectId: "legends-gym-f05c7",
  storageBucket: "legends-gym-f05c7.firebasestorage.app",
  messagingSenderId: "681005373012",
  appId: "1:681005373012:web:d9351adedbb9619b643fc1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
