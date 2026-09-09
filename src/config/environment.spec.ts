import { parseTrustProxy } from './environment';

describe('proxy topology', () => {
  it('does not trust headers for local direct access', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('allows the single Nginx hop used by ECS', () => {
    expect(parseTrustProxy('1')).toBe(1);
  });

  it.each(['true', '2', 'loopback', ''])(
    'rejects unsupported trust configuration %s',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow('TRUST_PROXY');
    },
  );
});
