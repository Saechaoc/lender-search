/**
 * JWT fixtures for the pen-test suite (CONTEXT §D-01).
 *
 * Phase 1 uses HS256 with a test-only secret (RLS_TEST_JWT_SECRET) so the
 * pen tests are self-contained — no real Supabase project, no JWKS endpoint.
 * Phase 6 swaps to RS256 + Supabase JWKS verification.
 *
 * The JWT shape mirrors Supabase Auth's:
 *   {
 *     sub: <userId>,
 *     app_metadata: { tenant_id: <tenantId> },
 *     exp: <epoch + 1h>,
 *   }
 *
 * Phase 1 has no real auth path that consumes the JWT — the pen tests use
 * the JWT to construct a "tampered tenant_id" scenario, then call set_config
 * with the tampered claim and assert RLS still filters to zero rows. The
 * structural property is "even with a forged JWT, the GUC-only path doesn't
 * leak." Phase 6 adds JWT signature verification on top.
 */
import { SignJWT } from 'jose';

function getSecret(): Uint8Array {
  const secret = process.env.RLS_TEST_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'RLS_TEST_JWT_SECRET must be set (min 16 chars) to mint pen-test JWTs. See .env.local.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

export interface MintClaims {
  tenantId: string;
  userId?: string;
}

export async function mintJWT(claims: MintClaims): Promise<string> {
  return new SignJWT({
    sub: claims.userId ?? 'fixture-user',
    app_metadata: { tenant_id: claims.tenantId },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecret());
}

export interface ForgeClaims {
  /** The tenant the user "really" belongs to (used by future Phase 6 tests). */
  tenantId: string;
  /** The tenant the forged JWT claims (this is the tampered value). */
  tamperedTenantId: string;
}

/**
 * Forge a JWT that claims a DIFFERENT tenant than the user belongs to.
 *
 * At Phase 1, "user belongs to" doesn't exist (no user_tenant table). The
 * pen test extracts `app_metadata.tenant_id` from the forged JWT and calls
 * setTenantContext (well, set_config directly via pg) with that tampered
 * value, then asserts RLS still returns zero rows.
 */
export async function forgeJWT(claims: ForgeClaims): Promise<string> {
  // Phase 1: forging a JWT is identical to minting one with the tampered
  // value — there's no signature verification path yet. Phase 6 will mint
  // with a wrong key to exercise signature rejection.
  return mintJWT({ tenantId: claims.tamperedTenantId, userId: 'fixture-user' });
}

/**
 * Verify a JWT and return the tenant_id claim. Forward-looking; not used by
 * Phase 1 pen tests but ships now so Phase 6 has a clean reference for the
 * same secret/algorithm in tests.
 */
export async function extractTenantIdFromJWT(token: string): Promise<string> {
  // Phase 1: we trust the test-minted JWT; in Phase 6 jwtVerify would gate.
  const [, payloadB64] = token.split('.');
  if (!payloadB64) throw new Error('Malformed JWT');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  const tenantId = (payload as { app_metadata?: { tenant_id?: unknown } })?.app_metadata?.tenant_id;
  if (typeof tenantId !== 'string') throw new Error('JWT missing app_metadata.tenant_id');
  return tenantId;
}
