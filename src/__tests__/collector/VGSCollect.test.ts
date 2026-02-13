// VGSCollect.test.ts
import VGSCollect from '../../collector/VGSCollect';
import APIHostnameValidator from '../../utils/url/APIHostnameValidator';
import { PaymentCardBrandsManager } from '../../utils/paymentCards/PaymentCardBrandsManager';
import { VGSError } from '../../utils/errors';

// --- Mocks ---
// Mock the APIHostnameValidator module
jest.mock('../../utils/url/APIHostnameValidator', () => ({
  __esModule: true,
  default: {
    validateCustomHostname: jest.fn(),
    normalizeHostname: jest.fn((url: string) => {
      const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      try {
        return new URL(withScheme).hostname;
      } catch (error) {
        return null;
      }
    }),
  },
}));

// Mock PaymentCardBrandsManager
jest.mock('../../utils/paymentCards/PaymentCardBrandsManager', () => {
  const instance = {
    getBrandByName: jest.fn(),
  };
  return {
    PaymentCardBrandsManager: {
      getInstance: () => instance,
    },
  };
});

// A helper to reset the global fetch mock between tests
const originalFetch = global.fetch;
afterEach(() => {
  jest.clearAllMocks();
  global.fetch = originalFetch;
});

describe('VGSCollect', () => {
  const tenantId = 'tenant';
  const environment = 'sandbox';

  describe('setRouteId', () => {
    it('should set the routeId when letters, numbers and dashes are provided', () => {
      const collect = new VGSCollect(tenantId, environment);
      const routeId = 'ROUTE-ABC-123';
      collect.setRouteId(routeId);
      // Access private property via casting
      expect((collect as any).routeId).toBe(routeId);
    });

    it('should throw an error if routeId is not a string', () => {
      const collect = new VGSCollect(tenantId, environment);
      // @ts-ignore: Passing a non-string to force error
      expect(() => collect.setRouteId(123)).toThrow(
        'VGSCollect: Invalid routeId error'
      );
    });

    it('should throw an error if routeId contains unsupported symbols', () => {
      const collect = new VGSCollect(tenantId, environment);
      expect(() => collect.setRouteId('route_123')).toThrow(
        'VGSCollect: Invalid routeId error'
      );
    });
  });

  describe('setCustomHeaders', () => {
    it('should set custom headers correctly', () => {
      const collect = new VGSCollect(tenantId, environment);
      const headers = { Authorization: 'Bearer token' };
      collect.setCustomHeaders(headers);
      expect((collect as any).customHeaders).toEqual(headers);
    });
  });

  describe('setCname', () => {
    it('should validate and set cname if valid', async () => {
      // Mock APIHostnameValidator to resolve as valid
      (
        APIHostnameValidator.validateCustomHostname as jest.Mock
      ).mockResolvedValue(true);
      const collect = new VGSCollect(tenantId, environment);
      await collect.setCname('example.com');
      expect(APIHostnameValidator.validateCustomHostname).toHaveBeenCalledWith(
        'example.com',
        tenantId
      );
      expect((collect as any).cname).toBe('example.com');
    });

    it('should store normalized hostname for URL-style cname input', async () => {
      (
        APIHostnameValidator.validateCustomHostname as jest.Mock
      ).mockResolvedValue(true);
      const collect = new VGSCollect(tenantId, environment);
      await collect.setCname('https://example.com/path?x=1');
      expect((collect as any).cname).toBe('example.com');
    });

    it('should set cname to undefined if validation fails', async () => {
      // Mock APIHostnameValidator to resolve as false
      (
        APIHostnameValidator.validateCustomHostname as jest.Mock
      ).mockResolvedValue(false);
      const collect = new VGSCollect(tenantId, environment);
      await collect.setCname('invalid.com');
      expect((collect as any).cname).toBeUndefined();
    });

    it('should handle errors during validation', async () => {
      // Mock APIHostnameValidator to reject
      (
        APIHostnameValidator.validateCustomHostname as jest.Mock
      ).mockRejectedValue(new Error('Validation error'));
      const collect = new VGSCollect(tenantId, environment);
      await expect(collect.setCname('error.com')).rejects.toThrow(
        'Validation error'
      );
      expect((collect as any).cname).toBeUndefined();
    });
  });

  describe('buildUrl', () => {
    // We test the private buildUrl method via type assertion.
    it('should build URL using default base when no cname is provided', () => {
      const collect = new VGSCollect(tenantId, environment);
      // Set a routeId so that baseUrl uses tenantId-routeId...
      const routeId = 'ROUTE-ABC-123';
      collect.setRouteId(routeId);
      const buildUrl = (collect as any).buildUrl.bind(collect);
      const url = buildUrl(collect.BASE_VAULT_URL, '/my/path');
      expect(url).toBe(
        `https://tenant-${routeId.toLowerCase()}.sandbox.verygoodproxy.com/my/path`
      );
    });

    it('should build URL using cname and remove extra slashes', () => {
      const collect = new VGSCollect(tenantId, environment);
      // Directly set the cname (bypassing validation)
      (collect as any).cname = 'example.com/';
      const buildUrl = (collect as any).buildUrl.bind(collect);
      // Leading slash in path should be trimmed
      const url = buildUrl(collect.BASE_VAULT_URL, '/another/path');
      expect(url).toBe('https://example.com/another/path');
    });

    it('should preserve query params and dots in path', () => {
      const collect = new VGSCollect(tenantId, environment);
      const buildUrl = (collect as any).buildUrl.bind(collect);
      const url = buildUrl(
        collect.BASE_VAULT_URL,
        '/v1/cards/123.json?foo=1&bar=2'
      );
      expect(url).toBe(
        `https://${tenantId}.${environment}.verygoodproxy.com/v1/cards/123.json?foo=1&bar=2`
      );
    });

    it('should encode reserved path characters instead of stripping them', () => {
      const collect = new VGSCollect(tenantId, environment);
      const buildUrl = (collect as any).buildUrl.bind(collect);
      const url = buildUrl(collect.BASE_VAULT_URL, '/my/<script>path');
      expect(url).toBe(
        `https://${tenantId}.${environment}.verygoodproxy.com/my/%3Cscript%3Epath`
      );
    });
  });

  describe('registerField and unregisterField', () => {
    it('should register a field and then unregister it', () => {
      const collect = new VGSCollect(tenantId, environment);
      const dummyGetValue = jest.fn(() => 'value');
      const dummyValidation = jest.fn(() => []);
      collect.registerField('field1', dummyGetValue, dummyValidation);
      expect((collect as any).fields.field1).toBeDefined();

      collect.unregisterField('field1');
      expect((collect as any).fields.field1).toBeUndefined();
    });
  });

  describe('updateFieldByType', () => {
    it('should update fields of a specific type and invoke updateCallback', () => {
      const collect = new VGSCollect(tenantId, environment);
      const dummyGetValue = jest.fn(() => 'value');
      const dummyValidation = jest.fn(() => []);
      const updateCallback = jest.fn();

      // Register two fields: one with type 'cvc' and one with a different type.
      collect.registerField(
        'field1',
        dummyGetValue,
        dummyValidation,
        undefined,
        'cvc',
        [],
        updateCallback
      );
      collect.registerField(
        'field2',
        dummyGetValue,
        dummyValidation,
        undefined,
        'text'
      );

      collect.updateFieldByType('cvc', { mask: '###', validationRules: [] });
      const field1 = (collect as any).fields.field1;
      const field2 = (collect as any).fields.field2;
      expect(field1.mask).toBe('###');
      // Callback should have been called.
      expect(updateCallback).toHaveBeenCalledWith({
        mask: '###',
        validationRules: [],
      });
      // Field2 should remain unchanged.
      expect(field2.mask).toBeUndefined();
    });
  });

  describe('updateCvcFieldForBrand', () => {
    it('should update CVC fields based on the card brand', () => {
      const collect = new VGSCollect(tenantId, environment);
      const dummyGetValue = jest.fn(() => '123');
      const dummyValidation = jest.fn(() => []);
      const updateCallback = jest.fn();
      collect.registerField(
        'cvcField',
        dummyGetValue,
        dummyValidation,
        undefined,
        'cvc',
        [],
        updateCallback
      );

      // Setup the PaymentCardBrandsManager mock.
      const brand = {
        cvcLengths: [3, 4],
      };
      const managerInstance = PaymentCardBrandsManager.getInstance();
      (managerInstance.getBrandByName as jest.Mock).mockReturnValue(brand);

      collect.updateCvcFieldForBrand('visa');

      // Check that the field was updated: mask should be '####' (because max length is 4)
      const field = (collect as any).fields.cvcField;
      expect(field.mask).toBe('####');
      expect(updateCallback).toHaveBeenCalledWith({
        mask: '####',
        validationRules: expect.any(Array),
      });
    });

    it('should do nothing if brand is not found', () => {
      const collect = new VGSCollect(tenantId, environment);
      const dummyGetValue = jest.fn(() => '123');
      const dummyValidation = jest.fn(() => []);
      collect.registerField(
        'cvcField',
        dummyGetValue,
        dummyValidation,
        undefined,
        'cvc'
      );

      const managerInstance = PaymentCardBrandsManager.getInstance();
      (managerInstance.getBrandByName as jest.Mock).mockReturnValue(null);

      // Should not throw and field remains unchanged.
      expect(() => collect.updateCvcFieldForBrand('unknown')).not.toThrow();
      const field = (collect as any).fields.cvcField;
      expect(field.mask).toBeUndefined();
    });
  });

  describe('findFieldNameByType', () => {
    it('should find the first field with the given type', () => {
      const collect = new VGSCollect(tenantId, environment);
      const dummyGetValue = jest.fn(() => 'val');
      const dummyValidation = jest.fn(() => []);
      collect.registerField(
        'field1',
        dummyGetValue,
        dummyValidation,
        undefined,
        'text'
      );
      collect.registerField(
        'field2',
        dummyGetValue,
        dummyValidation,
        undefined,
        'cvc'
      );

      expect(collect.findFieldNameByType('cvc')).toBe('field2');
      expect(collect.findFieldNameByType('text')).toBe('field1');
    });

    it('should return undefined if no field matches the type', () => {
      const collect = new VGSCollect(tenantId, environment);
      expect(collect.findFieldNameByType('nonexistent')).toBeUndefined();
    });
  });

  describe('applyCustomStructure (private)', () => {
    it('should replace placeholders in a string template', () => {
      const collect = new VGSCollect(tenantId, environment);
      const applyTemplate = (collect as any).applyCustomStructure.bind(collect);
      const template = 'Hello, {{ name }}!';
      const sensitiveData = { name: 'Alice' };
      expect(applyTemplate(template, sensitiveData)).toBe('Hello, Alice!');
    });

    it('should process arrays recursively', () => {
      const collect = new VGSCollect(tenantId, environment);
      const applyTemplate = (collect as any).applyCustomStructure.bind(collect);
      const template = ['{{ a }}', '{{ b }}'];
      const sensitiveData = { a: '1', b: '2' };
      expect(applyTemplate(template, sensitiveData)).toEqual(['1', '2']);
    });

    it('should process objects recursively', () => {
      const collect = new VGSCollect(tenantId, environment);
      const applyTemplate = (collect as any).applyCustomStructure.bind(collect);
      const template = { x: '{{ x }}', y: { z: '{{ z }}' } };
      const sensitiveData = { x: 'foo', z: 'bar' };
      expect(applyTemplate(template, sensitiveData)).toEqual({
        x: 'foo',
        y: { z: 'bar' },
      });
    });
  });

  describe('submitDataToServer (private)', () => {
    it('should return an object with { status, response } on a successful fetch', async () => {
      const collect = new VGSCollect(tenantId, environment);
      const fakeFetchResponse = {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
      global.fetch = jest.fn().mockResolvedValue(fakeFetchResponse);

      const submitDataToServer = (collect as any).submitDataToServer.bind(
        collect
      );
      const url = 'https://example.com/api';
      const method = 'POST';
      const data = { key: 'value' };

      const result = await submitDataToServer(url, method, data);

      // We expect { status, response }
      expect(result.status).toBe(200);
      expect(result.response).toBe(fakeFetchResponse);
    });

    it('should return an object with { status, response } even if response.ok is false', async () => {
      const collect = new VGSCollect(tenantId, environment);
      const fakeFetchResponse = {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found' }),
      };
      global.fetch = jest.fn().mockResolvedValue(fakeFetchResponse);

      const submitDataToServer = (collect as any).submitDataToServer.bind(
        collect
      );
      const result = await submitDataToServer(
        'https://example.com/api',
        'GET',
        {}
      );

      // No throw for non-2xx. We simply return { status, response }
      expect(result.status).toBe(404);
      expect(result.response).toBe(fakeFetchResponse);
    });

    it('should throw an Error on actual network failure (fetch reject)', async () => {
      const collect = new VGSCollect(tenantId, environment);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const submitDataToServer = (collect as any).submitDataToServer.bind(
        collect
      );

      await expect(
        submitDataToServer('https://example.com/api', 'POST', {})
      ).rejects.toThrow('Network error');
    });
  });

  describe('submit', () => {
    it('should return { status, response } on success', async () => {
      const collect = new VGSCollect(tenantId, environment);
      // Stub collectFieldData to return dummy data.
      (collect as any).collectFieldData = jest
        .fn()
        .mockResolvedValue({ field: 'value' });
      (collect as any).awaitCnameValidation = jest
        .fn()
        .mockResolvedValue(undefined);
      (collect as any).buildUrl = jest
        .fn()
        .mockReturnValue('https://test.com/submit');
      (collect as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 200,
        response: {
          ok: true,
          json: async () => ({ success: true }),
        },
      });

      const result = await collect.submit('/submit');
      expect(result.status).toBe(200);
      // "result.response" is the fetch Response
      expect(result.response.ok).toBe(true);
      const body = await result.response.json();
      expect(body).toEqual({ success: true });
    });

    it('should return { status, response } if server responds with error (non-2xx)', async () => {
      const collect = new VGSCollect(tenantId, environment);
      (collect as any).collectFieldData = jest
        .fn()
        .mockResolvedValue({ field: 'value' });
      (collect as any).awaitCnameValidation = jest
        .fn()
        .mockResolvedValue(undefined);
      (collect as any).buildUrl = jest
        .fn()
        .mockReturnValue('https://test.com/submit');
      (collect as any).submitDataToServer = jest.fn().mockResolvedValue({
        status: 400,
        response: {
          ok: false,
          json: async () => ({ error: 'Bad Request' }),
        },
      });

      const result = await collect.submit('/submit');
      expect(result.status).toBe(400);
      expect(result.response.ok).toBe(false);
      const body = await result.response.json();
      expect(body).toEqual({ error: 'Bad Request' });
    });

    it('should throw if fetch rejects', async () => {
      const collect = new VGSCollect(tenantId, environment);
      (collect as any).collectFieldData = jest
        .fn()
        .mockResolvedValue({ field: 'value' });
      (collect as any).awaitCnameValidation = jest
        .fn()
        .mockResolvedValue(undefined);
      (collect as any).buildUrl = jest
        .fn()
        .mockReturnValue('https://test.com/submit');
      (collect as any).submitDataToServer = jest
        .fn()
        .mockRejectedValue(new Error('Server error'));

      await expect(collect.submit('/submit')).rejects.toThrow('Server error');
    });
    it('should throw a VGSError if fields fail validation', async () => {
      const collect = new VGSCollect(tenantId, environment);
      // Register a field that intentionally fails validation
      collect.registerField(
        'failingField',
        () => 'some invalid value',
        () => ['Field is not valid']
      );
      // Attempt to submit, expecting VGSError due to validation failure
      await expect(collect.submit('/submit')).rejects.toThrow(VGSError);
    });
  });
  describe('tokenize', () => {
    let collect: VGSCollect;

    beforeEach(() => {
      collect = new VGSCollect(tenantId, environment);
      // mocked data
      (collect as any).collectFieldTokenizationData = jest.fn();
      (collect as any).prepareSubmission = jest.fn();
      (collect as any).submitDataToServer = jest.fn();
      (collect as any).parseTokenizationResponse = jest.fn();
      (collect as any).BASE_TOKENIZATION_URL = 'vault-api.verygoodvault.com';
    });

    it('should return empty data when collectedData is empty', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [],
        fieldMappings: [],
      });

      (collect as any).prepareSubmission.mockResolvedValue({
        url: 'mocked_url',
      }); // Mock prepareSubmission

      (collect as any).submitDataToServer.mockResolvedValue({
        // Mock submitDataToServer for success
        status: 200,
        response: { ok: true, json: async () => ({}) },
      });

      const result = await collect.tokenize();
      expect(result).toEqual({ status: 200, data: {} });
    });

    it('should return processed data on successful tokenization', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }], // fieldMappings should be an array
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockResolvedValue({
        status: 200,
        response: {
          ok: true,
          json: async () => ({
            data: [
              { aliases: [{ format: 'format', alias: 'tokenized_value' }] },
            ],
          }),
        },
      });
      (collect as any).parseTokenizationResponse.mockReturnValue({
        field: 'tokenized_value', // Corrected return value
      });

      const result = await collect.tokenize();

      expect(result).toEqual({
        status: 200,
        data: { field: 'tokenized_value' }, // Corrected expectation
      });
      expect((collect as any).parseTokenizationResponse).toHaveBeenCalledWith(
        {
          data: [{ aliases: [{ format: 'format', alias: 'tokenized_value' }] }],
        }, // Corrected args
        [{ key: 'field', fieldName: 'field' }] // Corrected args
      );
    });

    it('should return original response on failed tokenization', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }],
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockResolvedValue({
        status: 400,
        response: {
          ok: false,
          json: async () => ({ error: 'Bad Request' }),
        },
      });

      const result = await collect.tokenize();

      expect(result).toEqual({
        status: 400,
        data: {
          ok: false,
          json: expect.any(Function),
        },
      });
      expect((collect as any).parseTokenizationResponse).not.toHaveBeenCalled();
    });

    it('should handle errors during tokenization', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }], // fieldMappings should be an array
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockRejectedValue(
        new Error('Network error')
      );

      try {
        await collect.tokenize();
        fail('Tokenize should have thrown an error'); // Ensure that an error is thrown
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toEqual('Network error');
      }
    });

    it('should handle empty response data', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }],
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockResolvedValue({
        status: 200,
        response: {
          ok: true,
          json: async () => ({ data: [] }), // Empty data array
        },
      });
      (collect as any).parseTokenizationResponse.mockReturnValue({});

      const result = await collect.tokenize();
      expect(result).toEqual({ status: 200, data: {} });
    });

    it('should handle missing aliases in response', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }],
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockResolvedValue({
        status: 200,
        response: {
          ok: true,
          json: async () => ({ data: [{}] }), // Missing aliases
        },
      });
      (collect as any).parseTokenizationResponse.mockReturnValue({});

      const result = await collect.tokenize();
      expect(result).toEqual({ status: 200, data: {} });
    });

    it('should handle missing format in aliases', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }],
      });
      (collect as any).prepareSubmission.mockResolvedValue({
        url: `https://${tenantId}.${environment}.${(collect as any).BASE_TOKENIZATION_URL}/aliases`,
      });
      (collect as any).submitDataToServer.mockResolvedValue({
        status: 200,
        response: {
          ok: true,
          json: async () => ({
            data: [{ aliases: [{ alias: 'tokenized_value' }] }],
          }), // Missing format
        },
      });
      (collect as any).parseTokenizationResponse.mockReturnValue({});

      const result = await collect.tokenize();
      expect(result).toEqual({ status: 200, data: {} });
    });

    it('should handle errors in collectFieldTokenizationData', async () => {
      (collect as any).collectFieldTokenizationData.mockRejectedValue(
        new Error('Collect error')
      );

      try {
        await collect.tokenize();
        fail('Tokenize should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toEqual('Collect error');
      }
    });

    it('should handle errors in prepareSubmission', async () => {
      (collect as any).collectFieldTokenizationData.mockResolvedValue({
        collectedData: [{ field: 'value' }],
        fieldMappings: [{ key: 'field', fieldName: 'field' }],
      });
      (collect as any).prepareSubmission.mockRejectedValue(
        new Error('Prepare error')
      );

      try {
        await collect.tokenize();
        fail('Tokenize should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toEqual('Prepare error');
      }
    });
  });
});
