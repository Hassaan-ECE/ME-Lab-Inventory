export function isSafeExternalUrl(
  value: string,
  options?: { allowImplicitHttps?: boolean },
): boolean;

export function toSafeExternalUrl(
  value: string,
  options?: { allowImplicitHttps?: boolean },
): string | null;
