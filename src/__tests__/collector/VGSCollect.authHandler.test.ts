import VGSCollect from '../../collector/VGSCollect';
import VGSAnalyticsClient, {
  AnalyticEventStatus,
  AnalyticsEventType,
} from '../../utils/analytics/AnalyticsClient';
import { VGSError, VGSErrorCode } from '../../utils/errors';

const tenantId = 'tntva123test';
const environment = 'sandbox';
const originalFetch = global.fetch;
const platformSdkIdentifier = 'rnSDK';
const validCreateCardFields = {
  pan: '4111111111111111',
  exp_month: '04',
  exp_year: '28',
};

describe('VGSCollect - Auth Handler & JWT Token Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        prepaid_type: 'NONRELOADABLE',
        card_category: 'CLASSIC',
        bin: '411111',
        issuing_organization: 'Mock Bank',
        maximum_pan_length: 16,
        regulation_status: 'UNREGULATED',
        brand: 'VISA',
        version: 'v20260302',
        issuing_country_code: '56',
        card_type: 'DEBIT',
        cobadged_brands: 'BANCONTACT',
        issuing_country_name: 'BELGIUM',
        card_commercial_type: 'PERSONAL',
      }),
    } as any);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('setAuthHandler', () => {
    it('should store the auth handler function', () => {
      const collector = new VGSCollect(tenantId, environment);
      const mockHandler = jest.fn().mockResolvedValue('jwt-token');
      collector.setAuthHandler(mockHandler);
      expect((collector as any).authHandler).toBe(mockHandler);
    });

    it('should allow replacing auth handler', () => {
      const collector = new VGSCollect(tenantId, environment);
      const firstHandler = jest.fn().mockResolvedValue('token1');
      const secondHandler = jest.fn().mockResolvedValue('token2');

      collector.setAuthHandler(firstHandler);
      (collector as any).cachedJwtToken = 'token1';
      collector.setAuthHandler(secondHandler);

      expect((collector as any).authHandler).toBe(secondHandler);
      expect((collector as any).cachedJwtToken).toBeUndefined();
    });

    it('should not cache a token resolved by a stale auth handler', async () => {
      let resolveFirstToken!: (token: string) => void;
      const firstHandler = jest.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveFirstToken = resolve;
          })
      );
      const secondHandler = jest.fn().mockResolvedValue('second-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(firstHandler);

      const firstRequest = (collector as any).getOrFetchJwt({
        authHandlerMessage: 'auth handler required',
      });
      collector.setAuthHandler(secondHandler);
      resolveFirstToken('first-token');

      await expect(firstRequest).resolves.toBe('first-token');
      expect((collector as any).cachedJwtToken).toBeUndefined();

      await expect(
        (collector as any).getOrFetchJwt({
          authHandlerMessage: 'auth handler required',
        })
      ).resolves.toBe('second-token');
      expect((collector as any).cachedJwtToken).toBe('second-token');
    });

    it('should accept async function returning Promise<string>', () => {
      const collector = new VGSCollect(tenantId, environment);
      const mockHandler = async (): Promise<string> => {
        return Promise.resolve('async-token');
      };

      collector.setAuthHandler(mockHandler);
      expect((collector as any).authHandler).toBe(mockHandler);
    });
  });

  describe('CMP analytics sanitization', () => {
    it('should preserve allowlisted content categories', () => {
      const analyticsClient = VGSAnalyticsClient.getInstance();
      const sendSpy = jest
        .spyOn(analyticsClient as any, 'sendAnalyticsRequest')
        .mockImplementation(() => {});

      analyticsClient.trackEvent(
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Success,
        { content: ['textField', 'custom_data'] }
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: ['textField', 'custom_data'],
        })
      );
      sendSpy.mockRestore();
    });

    it('should redact unrecognized content values', () => {
      const analyticsClient = VGSAnalyticsClient.getInstance();
      const sendSpy = jest
        .spyOn(analyticsClient as any, 'sendAnalyticsRequest')
        .mockImplementation(() => {});

      analyticsClient.trackEvent(
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Success,
        { content: ['textField', 'customer-supplied-value'] }
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content: '[REDACTED]' })
      );
      sendSpy.mockRestore();
    });

    it('should include a numeric status code for CMP transport failures', async () => {
      const collector = new VGSCollect(tenantId, environment);
      const transportError = Object.assign(new Error('Network unavailable'), {
        code: -1009,
      });
      global.fetch = jest.fn().mockRejectedValue(transportError);
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});

      await expect(
        (collector as any).submitDataToServer(
          'https://api.test.com/cards',
          'POST',
          {},
          {
            upstream: 'cmp',
            operation: 'cardCreate',
            content: ['textField'],
          }
        )
      ).rejects.toBe(transportError);

      expect(trackSpy).toHaveBeenLastCalledWith(
        expect.anything(),
        AnalyticsEventType.Submit,
        AnalyticEventStatus.Failed,
        {
          statusCode: -1009,
          error: 'transport_error',
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        }
      );
      trackSpy.mockRestore();
    });
  });

  describe('JWT Token Caching', () => {
    it('should cache JWT token after first fetch', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('cached-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      // Mock internal methods
      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCard();

      expect(mockAuthHandler).toHaveBeenCalledTimes(1);
      expect((collector as any).cachedJwtToken).toBe('cached-token');
    });

    it('should reuse cached token for subsequent calls', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('cached-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      // Mock internal methods
      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      // First call
      await collector.createCard();

      // Second call
      await collector.createCard();

      expect(mockAuthHandler).toHaveBeenCalledTimes(1); // Only called once
      expect((collector as any).cachedJwtToken).toBe('cached-token');
    });

    it('should support automatic token refresh on auth errors', async () => {
      // Test documents that token refresh is supported
      // Implementation details of retry logic tested via integration tests
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      // Mock successful card creation
      const mockPerformCreateCard = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });

      (collector as any).performCreateCard = mockPerformCreateCard;

      const result = await collector.createCard();

      expect(result.status).toBe(200);
    });

    it('should not refresh on other error status codes', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('valid-token');

      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 400,
        response: { ok: false, json: async () => ({}) },
      });

      const result = await collector.createCard();

      expect(mockAuthHandler).toHaveBeenCalledTimes(1); // Only called once
      expect(result.status).toBe(400);
    });

    it('should categorize non-auth CMP response failures without response data', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('valid-token'));
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ sensitive_backend_detail: 'not tracked' }),
      } as any);
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});

      await collector.createCard();

      expect(trackSpy).toHaveBeenCalledWith(
        expect.anything(),
        AnalyticsEventType.Submit,
        AnalyticEventStatus.Failed,
        expect.objectContaining({
          statusCode: 422,
          error: 'request_failed',
          upstream: 'cmp',
          operation: 'cardCreate',
        })
      );
      trackSpy.mockRestore();
    });
  });

  describe('createCard() without token parameter', () => {
    it('should throw error if authHandler not set', async () => {
      const collector = new VGSCollect(tenantId, environment);
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});

      await expect(collector.createCard()).rejects.toThrow(
        'authHandler is required for createCard()'
      );
      expect(trackSpy).toHaveBeenCalledWith(
        expect.anything(),
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Failed,
        expect.objectContaining({
          statusCode: VGSErrorCode.AuthHandlerNotSet,
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        })
      );
      trackSpy.mockRestore();
    });

    it('should throw VGSError with correct error code if authHandler not set', async () => {
      const collector = new VGSCollect(tenantId, environment);

      try {
        await collector.createCard();
        fail('Should have thrown VGSError');
      } catch (error) {
        expect(error).toBeInstanceOf(VGSError);
        expect((error as VGSError).code).toBe(VGSErrorCode.AuthHandlerNotSet);
      }
    });

    it('should use cached token if available', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('new-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      // Pre-populate cache
      (collector as any).cachedJwtToken = 'cached-token';

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCard();

      expect(mockAuthHandler).not.toHaveBeenCalled();
      expect((collector as any).validateAccessToken).toHaveBeenCalledWith(
        'cached-token',
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        })
      );
    });

    it('should fetch token if cache is empty', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('fresh-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCard();

      expect(mockAuthHandler).toHaveBeenCalledTimes(1);
      expect((collector as any).cachedJwtToken).toBe('fresh-token');
    });

    it('should merge extraData with request payload', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');

      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCard({ custom: 'data', meta: 'info' });

      const [url, method, requestBody, analyticsData, requestOptions] =
        mockSubmit.mock.calls[0];
      expect(url).toBe('https://api.test.com');
      expect(method).toBe('POST');
      expect(requestBody.meta).toBeUndefined();
      expect(requestBody.data.attributes).toEqual(
        expect.objectContaining({
          custom: 'data',
          meta: 'info',
          pan: '4111111111111111',
        })
      );
      expect(requestBody.data.meta).toEqual(
        expect.objectContaining({
          _source: 'vgs-collect',
          _medium: platformSdkIdentifier,
        })
      );
      expect(requestBody.data.meta).not.toHaveProperty('_formId');
      expect(analyticsData).toEqual(
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField', 'custom_data'],
        })
      );
      expect(requestOptions).toEqual(
        expect.objectContaining({
          requestHeaders: expect.objectContaining({
            'Content-Type': 'application/vnd.api+json',
          }),
        })
      );
    });

    it('should accept the legacy wrapped extraData envelope without nesting it', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest.fn().mockResolvedValue({
        ...validCreateCardFields,
        cardholder: 'Taylor Doe',
      });
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCard({
        trace_id: 'trace-123',
        data: {
          type: 'cards',
          attributes: {
            pan: 'caller-value',
            token_type: 'pan',
            cardholder: { address: { city: 'Kyiv' } },
          },
          meta: {
            caller: 'preserved',
            _source: 'caller-value',
          },
        },
      });

      const [, , requestBody] = mockSubmit.mock.calls[0];
      expect(requestBody).toEqual({
        trace_id: 'trace-123',
        data: {
          type: 'cards',
          attributes: {
            pan: '4111111111111111',
            exp_month: 4,
            exp_year: 28,
            token_type: 'pan',
            cardholder: {
              name: 'Taylor Doe',
              address: { city: 'Kyiv' },
            },
          },
          meta: {
            caller: 'preserved',
            _source: 'vgs-collect',
            _medium: platformSdkIdentifier,
            _version: '1.2.1',
          },
        },
      });
      expect(requestBody.data.attributes).not.toHaveProperty('data');
    });

    it('should map cardholder name into the canonical nested attribute', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest.fn().mockResolvedValue({
        ...validCreateCardFields,
        cardholder: 'Taylor Doe',
      });
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCard({
        cardholder: { address: { city: 'Kyiv' } },
      });

      const [, , requestBody] = mockSubmit.mock.calls[0];
      expect(requestBody).toEqual({
        data: {
          attributes: {
            pan: '4111111111111111',
            exp_month: 4,
            exp_year: 28,
            cardholder: {
              name: 'Taylor Doe',
              address: { city: 'Kyiv' },
            },
          },
          meta: expect.objectContaining({
            _source: 'vgs-collect',
            _medium: platformSdkIdentifier,
            _version: '1.2.1',
          }),
        },
      });
    });

    it('should reject noncanonical field names required by CMP', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest.fn().mockResolvedValue({
        card_number: '4111111111111111',
        exp_month: '04',
        exp_year: '28',
      });
      (collector as any).submitDataToServer = jest.fn();

      await expect(collector.createCard()).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequired: ['pan'],
        },
      });
      expect((collector as any).submitDataToServer).not.toHaveBeenCalled();
    });

    it('should reject four-digit CMP expiration years', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest.fn().mockResolvedValue({
        pan: '4111111111111111',
        exp_month: '04',
        exp_year: '2028',
      });

      await expect(collector.createCard()).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequiredValid: ['exp_year'],
        },
      });
    });

    it('should work with empty extraData', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      const result = await collector.createCard();

      expect(result.status).toBe(200);
    });

    it('should handle authHandler promise rejection', async () => {
      const authError = Object.assign(new Error('Auth service unavailable'), {
        code: -1009,
      });
      const mockAuthHandler = jest.fn().mockRejectedValue(authError);
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});

      await expect(collector.createCard()).rejects.toThrow(
        'Auth service unavailable'
      );
      expect(trackSpy).toHaveBeenCalledWith(
        expect.anything(),
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Failed,
        expect.objectContaining({
          statusCode: -1009,
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        })
      );
      expect(trackSpy.mock.calls[0]?.[3]).not.toHaveProperty('error');
      trackSpy.mockRestore();
    });

    it('should reject a Bearer prefix without an auth-handler token', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('Bearer '));

      await expect(collector.createCard()).rejects.toMatchObject({
        code: VGSErrorCode.IvalidAccessToken,
      });
      expect((collector as any).cachedJwtToken).toBeUndefined();
    });

    it('should return response with status and response object', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      const mockResponse = {
        ok: true,
        status: 201,
        json: async () => ({ id: 'card_123' }),
      };

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 201,
        response: mockResponse,
      });

      const result = await collector.createCard();

      expect(result).toEqual({
        status: 201,
        response: mockResponse,
      });
    });
  });

  describe('createCardWithToken() - Explicit Token Method', () => {
    it('should preserve the legacy createCard(token, extraData) overload', async () => {
      const collector = new VGSCollect(tenantId, environment);
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 201,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCard('legacy-token', { token_type: 'pan' });

      expect(mockSubmit.mock.calls[0][2].data.attributes).toEqual(
        expect.objectContaining({
          pan: '4111111111111111',
          exp_month: 4,
          exp_year: 28,
          token_type: 'pan',
        })
      );
      expect(mockSubmit.mock.calls[0][4].requestHeaders.Authorization).toBe(
        'Bearer legacy-token'
      );
      expect((collector as any).cachedJwtToken).toBeUndefined();
    });

    it('should preserve a metadata-only legacy data envelope', async () => {
      const collector = new VGSCollect(tenantId, environment);
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 201,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCard('legacy-token', {
        data: { meta: { source: 'mobile' } },
      });

      const requestBody = mockSubmit.mock.calls[0][2];
      expect(requestBody.data.attributes).toEqual({
        pan: '4111111111111111',
        exp_month: 4,
        exp_year: 28,
      });
      expect(requestBody.data.attributes).not.toHaveProperty('data');
      expect(requestBody.data.meta).toEqual({
        source: 'mobile',
        _source: 'vgs-collect',
        _medium: platformSdkIdentifier,
        _version: '1.2.1',
      });
    });

    it('should accept token directly as parameter', async () => {
      const collector = new VGSCollect(tenantId, environment);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      const result = await collector.createCardWithToken('legacy-token');

      expect((collector as any).validateAccessToken).toHaveBeenCalledWith(
        'legacy-token',
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        })
      );
      expect(result.status).toBe(200);
    });

    it('should preserve an existing Bearer prefix', async () => {
      const collector = new VGSCollect(tenantId, environment);
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCardWithToken('Bearer existing-token');

      expect(mockSubmit.mock.calls[0][4].requestHeaders.Authorization).toBe(
        'Bearer existing-token'
      );
    });

    it('should reject a Bearer prefix without an explicit token', async () => {
      const collector = new VGSCollect(tenantId, environment);

      await expect(
        collector.createCardWithToken('Bearer ')
      ).rejects.toMatchObject({
        code: VGSErrorCode.IvalidAccessToken,
      });
    });

    it('should not require authHandler to be set', async () => {
      const collector = new VGSCollect(tenantId, environment);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await expect(
        collector.createCardWithToken('direct-token')
      ).resolves.toBeDefined();
    });

    it('should accept extraData as second parameter', async () => {
      const collector = new VGSCollect(tenantId, environment);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');

      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.createCardWithToken('token', { source: 'mobile' });

      const [url, method, requestBody, analyticsData, requestOptions] =
        mockSubmit.mock.calls[0];
      expect(url).toBe('https://api.test.com');
      expect(method).toBe('POST');
      expect(requestBody.meta).toBeUndefined();
      expect(requestBody.data.attributes).toEqual(
        expect.objectContaining({
          source: 'mobile',
          pan: '4111111111111111',
        })
      );
      expect(requestBody.data.meta).toEqual(
        expect.objectContaining({
          _source: 'vgs-collect',
          _medium: platformSdkIdentifier,
        })
      );
      expect(requestBody.data.meta).not.toHaveProperty('_formId');
      expect(analyticsData).toEqual(
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField', 'custom_data'],
        })
      );
      expect(requestOptions).toEqual(
        expect.objectContaining({
          requestHeaders: expect.objectContaining({
            'Content-Type': 'application/vnd.api+json',
          }),
        })
      );
    });

    it('should work without extraData parameter', async () => {
      const collector = new VGSCollect(tenantId, environment);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      const result = await collector.createCardWithToken('token');

      expect(result.status).toBe(200);
    });

    it('should validate token using validateAccessToken', async () => {
      const collector = new VGSCollect(tenantId, environment);

      const mockValidate = jest.fn();
      (collector as any).validateAccessToken = mockValidate;
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCardWithToken('validate-me');

      expect(mockValidate).toHaveBeenCalledWith(
        'validate-me',
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardCreate',
          content: ['textField'],
        })
      );
    });

    it('should return same response format as createCard()', async () => {
      const collector = new VGSCollect(tenantId, environment);

      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({ id: 'card_456' }),
      };

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: mockResponse,
      });

      const result = await collector.createCardWithToken('token');

      expect(result).toEqual({
        status: 200,
        response: mockResponse,
      });
    });

    it('should not populate shared cache from explicit-token createCardWithToken', async () => {
      const collector = new VGSCollect(tenantId, environment);

      (collector as any).validateAccessToken = jest.fn(
        (token: string) => token
      );
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCardWithToken('explicit-token');

      expect((collector as any).cachedJwtToken).toBeUndefined();
    });
  });

  describe('createCard custom metadata', () => {
    const prepareCollector = (
      collector = new VGSCollect(tenantId, environment)
    ) => {
      collector.setAuthHandler(jest.fn().mockResolvedValue('test-token'));
      jest
        .spyOn(collector as any, 'collectFieldData')
        .mockResolvedValue(validCreateCardFields);
      return collector;
    };
    const captureSubmit = (collector: VGSCollect): jest.SpyInstance =>
      jest.spyOn(collector as any, 'submitDataToServer').mockResolvedValue({
        status: 201,
        response: { ok: true },
      });

    beforeEach(() => {
      jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it.each(['authHandler', 'legacyToken', 'explicitToken'])(
      'routes separate metadata through the %s call family',
      async (family) => {
        const collector = prepareCollector();
        const submit = captureSubmit(collector);
        const extraData = { token_type: 'pan', meta: 'legacy-attribute' };
        const meta = { orderId: 'order-123', empty: '', spacing: '  value  ' };
        const result =
          family === 'authHandler'
            ? await collector.createCard(extraData, meta)
            : family === 'legacyToken'
              ? await collector.createCard('token', extraData, meta)
              : await collector.createCardWithToken('token', extraData, meta);
        expect(result).toEqual({ status: 201, response: { ok: true } });
        const body = submit.mock.calls[0]![2];
        expect(body.data.attributes).toEqual({
          pan: validCreateCardFields.pan,
          exp_month: 4,
          exp_year: 28,
          ...extraData,
        });
        expect(body.data.meta).toEqual({
          ...meta,
          _source: 'vgs-collect',
          _medium: 'rnSDK',
          _version: '1.2.1',
        });
        expect(submit.mock.calls[0]![3].content).toEqual([
          'textField',
          'custom_data',
        ]);
        expect(extraData).toEqual({
          token_type: 'pan',
          meta: 'legacy-attribute',
        });
        expect(meta).toEqual({
          orderId: 'order-123',
          empty: '',
          spacing: '  value  ',
        });
      }
    );

    it.each([
      {},
      { token_type: 'pan', meta: 'attribute' },
      { data: { meta: { orderId: 7, _formId: 'legacy-form' } } },
      {
        data: {
          attributes: { token_type: 'pan' },
          meta: { object: { flag: true }, _formId: 'legacy-form' },
        },
      },
    ])(
      'preserves the complete existing body with undefined or empty metadata: %j',
      async (extraData) => {
        const collector = prepareCollector();
        const submit = captureSubmit(collector);
        await collector.createCard(extraData);
        await collector.createCard(extraData, undefined);
        await collector.createCard(extraData, {});
        expect(submit.mock.calls[1]![2]).toEqual(submit.mock.calls[0]![2]);
        expect(submit.mock.calls[2]![2]).toEqual(submit.mock.calls[0]![2]);
        expect(submit.mock.calls[1]![4].logOverrides).toEqual(
          submit.mock.calls[0]![4].logOverrides
        );
        expect(submit.mock.calls[2]![4].logOverrides).toEqual(
          submit.mock.calls[0]![4].logOverrides
        );
      }
    );

    it('overlays only new custom strings while preserving arbitrary legacy values and formId', async () => {
      const collector = prepareCollector();
      const submit = captureSubmit(collector);
      const extraData = {
        data: {
          attributes: {},
          meta: {
            orderId: 7,
            legacyObject: { flag: true },
            _formId: 'legacy-form',
            _source: 'spoofed',
          },
        },
      };
      await collector.createCard(extraData, {
        orderId: 'new-order',
        integration: 'checkout',
        _formId: 'new-form',
      });
      expect(submit.mock.calls[0]![2].data.meta).toEqual({
        orderId: 'new-order',
        integration: 'checkout',
        legacyObject: { flag: true },
        _formId: 'legacy-form',
        _source: 'vgs-collect',
        _medium: 'rnSDK',
        _version: '1.2.1',
      });
      expect(extraData.data.meta.orderId).toBe(7);
    });

    it.each(['_source', '_medium', '_version', '_formId'])(
      'does not read or validate new reserved %s values',
      async (key) => {
        const collector = prepareCollector();
        const submit = captureSubmit(collector);
        const getter = jest.fn(() => {
          throw new Error('must not read reserved value');
        });
        const meta = Object.defineProperty({ orderId: 'order-123' }, key, {
          enumerable: true,
          get: getter,
        });
        await collector.createCard(undefined, meta);
        expect(getter).not.toHaveBeenCalled();
        expect(submit.mock.calls[0]![2].data.meta.orderId).toBe('order-123');
        expect(submit.mock.calls[0]![2].data.meta._formId).toBeUndefined();
      }
    );

    it('ignores non-string reserved values and copies only own enumerable string entries safely', async () => {
      const collector = prepareCollector();
      const submit = captureSubmit(collector);
      const meta = Object.assign(Object.create(null), {
        _source: 7,
        _medium: null,
        _version: {},
        _formId: false,
        __type: 'custom-type',
        __proto__: 'unused-literal',
      });
      Object.defineProperty(meta, '__proto__', {
        value: 'custom-proto',
        enumerable: true,
      });
      Object.defineProperty(meta, 'hidden', {
        value: 'hidden',
        enumerable: false,
      });
      meta[Symbol('symbol')] = 'symbol-value';
      await collector.createCard(undefined, meta);
      const body = submit.mock.calls[0]![2];
      const serialized = JSON.parse(JSON.stringify(body));
      expect(serialized.data.meta.__type).toBe('custom-type');
      expect(serialized.data.meta.__proto__).toBe('custom-proto');
      expect(Object.hasOwn(body.data.meta, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(body.data.meta)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(meta)).toBeNull();
      expect(body.data.meta.hidden).toBeUndefined();
      expect(Object.getOwnPropertySymbols(body.data.meta)).toEqual([]);
      expect(body.data.meta._source).toBe('vgs-collect');
      expect(body.data.meta._formId).toBeUndefined();
    });

    it('preserves session form identity and supports metadata-only creation', async () => {
      jest.spyOn(VGSCollect as any, 'loadConfiguration').mockResolvedValue({
        payload: { form_name: 'checkout-form', config: {} },
        statusCode: 200,
        latency: 1,
      });
      const collector = prepareCollector(
        await VGSCollect.session('checkout-form', tenantId, environment)
      );
      const submit = captureSubmit(collector);
      await collector.createCard(undefined, {
        orderId: 'order-123',
        _formId: 'spoofed',
      });
      expect(submit.mock.calls[0]![2].data.meta).toMatchObject({
        orderId: 'order-123',
        _formId: 'checkout-form',
      });
      expect(submit.mock.calls[0]![3].content).toEqual(['textField']);
    });

    it.each([
      null,
      [],
      'text',
      7,
      true,
      new Date(),
      new (class Meta {})(),
      { orderId: 7 },
      { orderId: false },
      { orderId: null },
      { orderId: [] },
      { orderId: {} },
      { orderId: Object('boxed') },
    ])(
      'rejects invalid new metadata categorically before CMP submission: %j',
      async (meta) => {
        const collector = prepareCollector();
        const submit = captureSubmit(collector);
        await expect(
          collector.createCard(undefined, meta as any)
        ).rejects.toMatchObject({
          code: VGSErrorCode.InputDataIsNotValid,
          message: 'VGSCollect: Input data not valid!',
          details: { VGSSDKErrorInputDataRequiredValid: ['meta'] },
        });
        expect(submit).not.toHaveBeenCalled();
      }
    );

    it('preserves secure field validation with new metadata', async () => {
      const collector = prepareCollector();
      const submit = captureSubmit(collector);
      collector.registerField(
        'pan',
        () => '',
        () => ['required']
      );
      await expect(
        collector.createCard(undefined, { orderId: 'order-123' })
      ).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: { pan: ['required'] },
      });
      expect(submit).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'preserves custom metadata in request/error logs without adding it to analytics (failure=%s)',
      async (failure) => {
        const collector = prepareCollector();
        const logger = (collector as any).logger;
        const logRequest = jest
          .spyOn(logger, 'logRequest')
          .mockImplementation(() => {});
        const logError = jest
          .spyOn(logger, 'logRequestError')
          .mockImplementation(() => {});
        const fetch = jest.fn();
        global.fetch = fetch;
        const error = new Error('Network unavailable');
        if (failure) fetch.mockRejectedValue(error);
        else fetch.mockResolvedValue({ status: 201, ok: true });
        const meta = JSON.parse(
          '{"orderId":"synthetic-order","__proto__":"custom-proto"}'
        );
        const request = collector.createCard(undefined, meta);
        if (failure) await expect(request).rejects.toBe(error);
        else await expect(request).resolves.toMatchObject({ status: 201 });
        expect(
          JSON.parse(fetch.mock.calls[0]![1].body).data.meta
        ).toMatchObject(meta);
        const loggedMeta = (logRequest.mock.calls[0]![2] as any).data.meta;
        expect(loggedMeta.orderId).toBe('synthetic-order');
        expect(loggedMeta.__proto__).toBe('custom-proto');
        expect(Object.getPrototypeOf(loggedMeta)).toBe(Object.prototype);
        if (failure)
          expect(logError.mock.calls[0]![3]).toEqual(
            logRequest.mock.calls[0]![2]
          );
        const events = (
          VGSAnalyticsClient.getInstance().trackFormEvent as jest.Mock
        ).mock.calls;
        expect(JSON.stringify(events)).not.toContain('synthetic-order');
        expect(JSON.stringify(events)).not.toContain('custom-proto');
        const cmpEvents = events.filter(
          (event) => event[3]?.upstream === 'cmp'
        );
        expect(cmpEvents).toHaveLength(2);
        for (const event of cmpEvents) {
          expect(event[3].content).toEqual(['textField']);
          expect(event[3].operation).toBe('cardCreate');
        }
      }
    );

    it.each([401, 403])(
      'snapshots accepted metadata through a %s refresh',
      async (status) => {
        const collector = prepareCollector();
        const handler = jest
          .fn()
          .mockResolvedValueOnce('first-token')
          .mockResolvedValueOnce('new-token');
        collector.setAuthHandler(handler);
        const meta: Record<string, string> = { orderId: 'original-order' };
        const submit = captureSubmit(collector);
        submit.mockImplementationOnce(async () => {
          delete meta.orderId;
          meta.changed = 'new-value';
          return { status, response: { ok: false } };
        });
        await collector.createCard(undefined, meta);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(submit.mock.calls[1]![2]).toBe(submit.mock.calls[0]![2]);
        expect(submit.mock.calls[1]![2].data.meta.orderId).toBe(
          'original-order'
        );
        expect(submit.mock.calls[1]![2].data.meta.changed).toBeUndefined();
        expect(
          submit.mock.calls[1]![4].logOverrides.payload.data.meta.orderId
        ).toBe('original-order');
      }
    );
  });

  describe('updateCard()', () => {
    const registerField = (
      collector: VGSCollect,
      fieldName: string,
      value: string,
      type: 'cvc' | 'expDate',
      validationErrors: string[] = []
    ) => {
      collector.registerField(
        fieldName,
        () => value,
        () => validationErrors,
        undefined,
        type,
        [],
        undefined,
        () => value
      );
    };

    it('should throw error if authHandler not set', async () => {
      const collector = new VGSCollect(tenantId, environment);
      registerField(collector, 'cvc', '123', 'cvc');

      await expect(collector.updateCard('card_123')).rejects.toThrow(VGSError);
      await expect(collector.updateCard('card_123')).rejects.toMatchObject({
        code: VGSErrorCode.AuthHandlerNotSet,
      });
    });

    it('should reject blank cardId before requesting auth token', async () => {
      const collector = new VGSCollect(tenantId, environment);
      const mockAuthHandler = jest.fn().mockResolvedValue('token');
      collector.setAuthHandler(mockAuthHandler);
      registerField(collector, 'cvc', '123', 'cvc');
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});

      await expect(collector.updateCard('   ')).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequired: ['cardId'],
        },
      });
      expect(mockAuthHandler).not.toHaveBeenCalled();
      expect(trackSpy).not.toHaveBeenCalled();
      trackSpy.mockRestore();
    });

    it.each(['card/123', '.', '..'])(
      'should reject invalid cardId %s before requesting auth token',
      async (cardId) => {
        const collector = new VGSCollect(tenantId, environment);
        const mockAuthHandler = jest.fn().mockResolvedValue('token');
        collector.setAuthHandler(mockAuthHandler);

        await expect(collector.updateCard(cardId)).rejects.toMatchObject({
          code: VGSErrorCode.InputDataIsNotValid,
          details: {
            VGSSDKErrorInputDataRequired: ['cardId'],
          },
        });
        expect(mockAuthHandler).not.toHaveBeenCalled();
      }
    );

    it('should construct PATCH request body with cvc and expiration fields', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      registerField(collector, 'cvc', '123', 'cvc');
      registerField(collector, 'exp_date', '0428', 'expDate');

      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.updateCard('card_123');

      expect(mockSubmit).toHaveBeenCalledWith(
        'https://sandbox.vgsapi.com/cards/card_123',
        'PATCH',
        expect.objectContaining({
          data: {
            attributes: {
              cvc: '123',
              exp_month: 4,
              exp_year: 28,
            },
          },
        }),
        expect.objectContaining({
          upstream: 'cmp',
          operation: 'cardUpdate',
          content: ['textField'],
        }),
        expect.objectContaining({
          requestHeaders: expect.objectContaining({
            'Authorization': 'Bearer token',
            'Content-Type': 'application/vnd.api+json',
          }),
        })
      );
    });

    it('should omit blank expiration and allow cvc-only update', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      registerField(collector, 'cvc', '123', 'cvc');
      registerField(collector, 'exp_date', '', 'expDate', ['INVALID_EXP_DATE']);

      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.updateCard('card_123');

      const [, , requestBody] = mockSubmit.mock.calls[0];
      expect(requestBody.data.attributes).toEqual({
        cvc: '123',
      });
    });

    it('should reject invalid populated expiration date', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      registerField(collector, 'cvc', '123', 'cvc');
      registerField(collector, 'exp_date', '1328', 'expDate', [
        'INVALID_EXP_DATE',
      ]);

      await expect(collector.updateCard('card_123')).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequiredValid: ['exp_date'],
        },
      });
    });

    it('should reject update attributes not supported by CMP', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      await expect(
        collector.updateCard('card_123', { nickname: 'Primary' })
      ).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequiredValid: ['nickname'],
        },
      });
    });

    it('should reject an update without mutable fields', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      await expect(collector.updateCard('card_123')).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequired: [
            'cvc, exp_month, or exp_year',
          ],
        },
      });
    });

    it('should reject MM/YYYY expiration values for CMP updates', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      registerField(collector, 'exp_date', '042028', 'expDate');

      await expect(collector.updateCard('card_123')).rejects.toMatchObject({
        code: VGSErrorCode.InputDataIsNotValid,
        details: {
          VGSSDKErrorInputDataRequiredValid: ['exp_date'],
        },
      });
    });

    it('should update with an explicit Bearer token without caching it', async () => {
      const collector = new VGSCollect(tenantId, environment);
      registerField(collector, 'cvc', '123', 'cvc');
      const mockSubmit = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });
      (collector as any).submitDataToServer = mockSubmit;

      await collector.updateCardWithToken('card_123', 'Bearer explicit-token');

      expect(mockSubmit.mock.calls[0][4].requestHeaders.Authorization).toBe(
        'Bearer explicit-token'
      );
      expect((collector as any).cachedJwtToken).toBeUndefined();
    });
  });

  describe('Token Refresh Retry Logic', () => {
    it('should reuse the original create payload after an auth retry', async () => {
      let resolveFirstResponse!: (result: {
        status: number;
        response: any;
      }) => void;
      let fieldValues = { ...validCreateCardFields };
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(
        jest
          .fn()
          .mockResolvedValueOnce('expired-token')
          .mockResolvedValueOnce('refreshed-token')
      );
      (collector as any).validateFields = jest.fn();
      const collectFieldData = jest.fn(async () => ({ ...fieldValues }));
      (collector as any).collectFieldData = collectFieldData;
      const submitDataToServer = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstResponse = resolve;
            })
        )
        .mockResolvedValueOnce({
          status: 201,
          response: { ok: true },
        });
      (collector as any).submitDataToServer = submitDataToServer;

      const createRequest = collector.createCard();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(submitDataToServer).toHaveBeenCalledTimes(1);

      fieldValues = {
        pan: '5555555555554444',
        exp_month: '05',
        exp_year: '29',
      };
      resolveFirstResponse({ status: 401, response: { ok: false } });

      await expect(createRequest).resolves.toMatchObject({ status: 201 });
      expect(collectFieldData).toHaveBeenCalledTimes(1);
      expect(submitDataToServer).toHaveBeenCalledTimes(2);
      expect(submitDataToServer.mock.calls[1][2]).toBe(
        submitDataToServer.mock.calls[0][2]
      );
      expect(submitDataToServer.mock.calls[1][2].data.attributes).toMatchObject(
        {
          pan: validCreateCardFields.pan,
          exp_month: 4,
          exp_year: 28,
        }
      );
    });

    it('should reuse the original update payload after an auth retry', async () => {
      let resolveFirstResponse!: (result: {
        status: number;
        response: any;
      }) => void;
      let cvc = '123';
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(
        jest
          .fn()
          .mockResolvedValueOnce('expired-token')
          .mockResolvedValueOnce('refreshed-token')
      );
      const getCvc = jest.fn(() => cvc);
      collector.registerField('cvc', getCvc, () => [], undefined, 'cvc');
      const submitDataToServer = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstResponse = resolve;
            })
        )
        .mockResolvedValueOnce({
          status: 200,
          response: { ok: true },
        });
      (collector as any).submitDataToServer = submitDataToServer;

      const updateRequest = collector.updateCard('card_123');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(submitDataToServer).toHaveBeenCalledTimes(1);

      cvc = '999';
      resolveFirstResponse({ status: 403, response: { ok: false } });

      await expect(updateRequest).resolves.toMatchObject({ status: 200 });
      expect(getCvc).toHaveBeenCalledTimes(1);
      expect(submitDataToServer).toHaveBeenCalledTimes(2);
      expect(submitDataToServer.mock.calls[1][2]).toBe(
        submitDataToServer.mock.calls[0][2]
      );
      expect(submitDataToServer.mock.calls[1][2]).toEqual({
        data: { attributes: { cvc: '123' } },
      });
    });

    it('should handle 401 responses gracefully', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      // Mock performCreateCard to return 401
      const mockPerformCreateCard = jest.fn().mockResolvedValue({
        status: 401,
        response: { ok: false, json: async () => ({}) },
      });

      (collector as any).performCreateCard = mockPerformCreateCard;

      const result = await collector.createCard();

      // Function completes and returns response
      expect(result).toBeDefined();
      expect(result.status).toBe(401);
    });

    it('should return success on first attempt if token valid', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('valid-token');

      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      const result = await collector.createCard();

      expect(mockAuthHandler).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(200);
    });

    it('should work with successful responses', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(jest.fn().mockResolvedValue('fresh-token'));

      // Mock performCreateCard for success
      const mockPerformCreateCard = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true },
      });

      (collector as any).performCreateCard = mockPerformCreateCard;

      const result = await collector.createCard();

      expect(result.status).toBe(200);
    });
  });

  describe('Token Sharing Between Features', () => {
    it('should share cached token between createCard and card attributes lookup', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('shared-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);

      // First call createCard (caches token)
      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCard();
      expect(mockAuthHandler).toHaveBeenCalledTimes(1);

      // Now trigger card attributes lookup (should reuse cached token)
      collector.setIncludedCardAttributes(['card_type']);
      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      // Token should be reused, authHandler not called again
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(mockAuthHandler).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should cache token from card attributes lookup for createCard', async () => {
      const mockAuthHandler = jest.fn().mockResolvedValue('shared-token');
      const collector = new VGSCollect(tenantId, environment);
      collector.setAuthHandler(mockAuthHandler);
      collector.setIncludedCardAttributes(['card_type']);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      // Trigger card attributes lookup first
      (collector as any).notifyCardInputChange('41111111111');
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockAuthHandler).toHaveBeenCalledTimes(1);
      expect((collector as any).cachedJwtToken).toBe('shared-token');

      // Now call createCard (should reuse cached token)
      (collector as any).validateAccessToken = jest.fn();
      (collector as any).validateFields = jest.fn();
      (collector as any).collectFieldData = jest
        .fn()
        .mockResolvedValue(validCreateCardFields);
      (collector as any).buildCmpAPIUrl = jest
        .fn()
        .mockReturnValue('https://api.test.com');
      (collector as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      await collector.createCard();
      expect(mockAuthHandler).toHaveBeenCalledTimes(1); // Still 1
    });
  });
});
