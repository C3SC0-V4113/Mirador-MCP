import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export function extractBearerToken(authorizationHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export function safeTokenEquals(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isAuthorized(headers: IncomingHttpHeaders, expectedToken: string): boolean {
  return safeTokenEquals(extractBearerToken(headers.authorization), expectedToken);
}
