export function derivePayrollProgressEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  return endpoint
    .replace(/livekitToken(?:\/)?$/, 'payrollProgress')
    .replace(/livekittoken-/i, 'payrollprogress-');
}
