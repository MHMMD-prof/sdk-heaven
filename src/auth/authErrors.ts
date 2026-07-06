export function getAuthErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'هذا البريد لديه حساب بالفعل.';
    case 'auth/invalid-email':
      return 'أدخل بريدا إلكترونيا صحيحا.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'البريد أو كلمة المرور غير صحيحة.';
    case 'auth/too-many-requests':
      return 'محاولات كثيرة. انتظر قليلا ثم حاول مرة أخرى.';
    case 'auth/weak-password':
      return 'استخدم كلمة مرور من 6 أحرف على الأقل.';
    default:
      return 'تعذر إكمال الطلب. حاول مرة أخرى.';
  }
}
