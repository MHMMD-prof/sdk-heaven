export function readAdminQueryParameter(search: string, name: string, maxLength = 200) {
  return new URLSearchParams(search).get(name)?.trim().slice(0, maxLength) || '';
}

export function setAdminQueryParameter(name: string, value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}${url.hash}`);
}
