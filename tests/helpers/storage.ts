// Private-mode browsers are a supported target: Save and Records both promise
// to degrade instead of throwing, and the only way to check that is to take
// localStorage away.

export function withBrokenStorage(run: () => void): void {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const throwing = new Proxy({} as Storage, {
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => throwing });
  try {
    run();
  } finally {
    if (real) Object.defineProperty(window, 'localStorage', real);
  }
}
