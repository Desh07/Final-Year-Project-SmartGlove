import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, type Auth } from 'firebase/auth';
// @ts-ignore
import { getReactNativePersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyD0G6O8ksMmqdxlUWbVtUTbYkGb1qE34xE',
  authDomain: 'glove-b95ba.firebaseapp.com',
  projectId: 'glove-b95ba',
  databaseURL: 'https://glove-b95ba-default-rtdb.asia-southeast1.firebasedatabase.app/',
  storageBucket: 'glove-b95ba.firebasestorage.app',
  messagingSenderId: '610332069931',
  appId: '1:610332069931:web:227d3dd38d38df43cbda6e',
  measurementId: 'G-LVEFF64GTQ',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  auth = getAuth(app);
}

export { auth };
export const database = getDatabase(app);

export default app;
