export function resolveNativeAppCheckProviders(production: boolean) {
  return production
    ? { android: 'playIntegrity' as const, apple: 'appAttestWithDeviceCheckFallback' as const }
    : { android: 'debug' as const, apple: 'debug' as const };
}
