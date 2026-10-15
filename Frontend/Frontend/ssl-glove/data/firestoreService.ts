import { get, push, ref, serverTimestamp, set, update } from 'firebase/database';
import { database } from '../firebaseConfig';

export type UserProfile = {
  name: string;
  email: string;
  phone: string;
  device: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type SavedPhrasesMap = Record<string, string[]>;

export type EmergencyContact = {
  name: string;
  phone: string;
  relation?: string;
  createdAt?: unknown;
};

export type SosMessage = {
  message: string;
  createdAt?: unknown;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const snapshot = await get(ref(database, `users/${uid}`));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.val() as UserProfile;
};

export const saveUserProfile = async (uid: string, profile: UserProfile) => {
  await update(ref(database, `users/${uid}`), {
    ...profile,
    updatedAt: serverTimestamp(),
  });
};

export const saveUserPhrases = async (uid: string, phrases: SavedPhrasesMap) => {
  await set(ref(database, `users/${uid}/data/phrases`), {
    phrasesByLanguage: phrases,
    updatedAt: serverTimestamp(),
  });
};

export const addEmergencyContact = async (
  uid: string,
  contact: EmergencyContact
) => {
  const listRef = ref(database, `users/${uid}/emergencyContacts`);
  const newRef = push(listRef);
  await set(newRef, {
    ...contact,
    createdAt: serverTimestamp(),
  });
};

export const addSosMessage = async (uid: string, message: SosMessage) => {
  const listRef = ref(database, `users/${uid}/sosMessages`);
  const newRef = push(listRef);
  await set(newRef, {
    ...message,
    createdAt: serverTimestamp(),
  });
};

export const createCloudBackup = async (uid: string, payload: unknown) => {
  const listRef = ref(database, `users/${uid}/backups`);
  const newRef = push(listRef);
  await set(newRef, {
    payload,
    createdAt: serverTimestamp(),
  });
};
