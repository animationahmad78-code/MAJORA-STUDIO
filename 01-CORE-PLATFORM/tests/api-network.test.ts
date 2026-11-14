import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, login } from '../apps/web/src/api';

afterEach(() => vi.unstubAllGlobals());

it('shows a recoverable Persian message when the login API is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(login('test', 'temporary')).rejects.toMatchObject({
    status: 0,
    errorCode: 'NETWORK_UNAVAILABLE',
    message: expect.stringContaining('ارتباط با سرور برقرار نشد')
  } satisfies Partial<ApiError>);
});
