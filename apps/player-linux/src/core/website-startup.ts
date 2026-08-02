let evaluated = false;

/** Evaluates clear-on-restart once per application process. */
export function shouldClearWebsiteDataAtStartup(configured: boolean): boolean {
  if (evaluated) return false;
  evaluated = true;
  return configured;
}

export function resetWebsiteStartupGateForTests(): void {
  evaluated = false;
}
