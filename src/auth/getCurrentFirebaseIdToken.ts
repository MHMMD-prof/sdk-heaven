import { firebaseAuth } from './firebase';

export async function getCurrentFirebaseIdToken(forceRefresh = false) {
  const currentUser = firebaseAuth.currentUser;

  if (!currentUser) {
    throw new Error('A signed-in user is required.');
  }

  return currentUser.getIdToken(forceRefresh);
}
