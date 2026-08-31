import VGSCollect from '../../collector/VGSCollect';
import { VGSErrorCode } from '../../utils/errors';
import VGSAnalyticsClient, {
  AnalyticEventStatus,
  AnalyticsEventType,
} from '../../utils/analytics/AnalyticsClient';

const tenantId = 'tntva123test';
const environment = 'sandbox';
const originalFetch = global.fetch;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildMockLookupResponse = (number: string) => {
  const firstDigit = number[0];
  let brand = 'UNKNOWN';
  if (firstDigit === '4') brand = 'VISA';
  else if (firstDigit === '5') brand = 'MASTERCARD';
  else if (firstDigit === '3') brand = 'AMEX';

  return {
    prepaid_type: 'NONRELOADABLE',
    card_category: 'CLASSIC',
    bin: number.slice(0, 6),
    issuing_organization: 'Mock Bank',
    maximum_pan_length: firstDigit === '3' ? 15 : 16,
    regulation_status: 'UNREGULATED',
    brand,
    version: 'v20260302',
    issuing_country_code: '56',
    card_type: 'DEBIT',
    cobadged_brands: brand === 'VISA' ? 'BANCONTACT' : '',
    issuing_country_name: 'BELGIUM',
    card_commercial_type: 'PERSONAL',
  };
};

describe('VGSCollect - Card Attributes Lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    VGSCollect.setCardAttributesLookupEndpoint('sandbox');
    global.fetch = jest.fn().mockImplementation(async (_url, options) => {
      const requestBody =
        typeof options?.body === 'string' ? JSON.parse(options.body) : {};
      const number =
        typeof requestBody.number === 'string'
          ? requestBody.number
          : '00000000000';

      await wait(50);
      return {
        ok: true,
        status: 200,
        json: async () => buildMockLookupResponse(number),
      } as any;
    });
  });

  afterEach(() => {
    VGSCollect.setCardAttributesLookupEndpoint();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Configuration Methods', () => {
    describe('setIncludedCardAttributes', () => {
      it('should store included attributes array', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type', 'issuer', 'bin']);
        expect((collector as any).includedCardAttributes).toEqual([
          'card_type',
          'issuer',
          'bin',
        ]);
      });

      it('should accept empty array to disable lookup', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setIncludedCardAttributes([]);
        expect((collector as any).includedCardAttributes).toEqual([]);
      });

      it('should allow updating attributes configuration', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        expect((collector as any).includedCardAttributes).toEqual([
          'card_type',
        ]);

        collector.setIncludedCardAttributes(['issuer', 'bin']);
        expect((collector as any).includedCardAttributes).toEqual([
          'issuer',
          'bin',
        ]);
      });
    });

    describe('setWillBeginCardAttributesLookup', () => {
      it('should store the callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const mockCallback = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockCallback);
        expect((collector as any).willBeginCardAttributesLookup).toBe(
          mockCallback
        );
      });

      it('should allow replacing callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const firstCallback = jest.fn();
        const secondCallback = jest.fn();

        collector.setWillBeginCardAttributesLookup(firstCallback);
        collector.setWillBeginCardAttributesLookup(secondCallback);

        expect((collector as any).willBeginCardAttributesLookup).toBe(
          secondCallback
        );
      });
    });

    describe('setDidRetrieveCardAttributes', () => {
      it('should store the success callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const mockCallback = jest.fn();
        collector.setDidRetrieveCardAttributes(mockCallback);
        expect((collector as any).didRetrieveCardAttributes).toBe(mockCallback);
      });

      it('should allow replacing callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const firstCallback = jest.fn();
        const secondCallback = jest.fn();

        collector.setDidRetrieveCardAttributes(firstCallback);
        collector.setDidRetrieveCardAttributes(secondCallback);

        expect((collector as any).didRetrieveCardAttributes).toBe(
          secondCallback
        );
      });
    });

    describe('setDidFailToRetrieveCardAttributes', () => {
      it('should store the error callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const mockCallback = jest.fn();
        collector.setDidFailToRetrieveCardAttributes(mockCallback);
        expect((collector as any).didFailToRetrieveCardAttributes).toBe(
          mockCallback
        );
      });

      it('should allow replacing callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const firstCallback = jest.fn();
        const secondCallback = jest.fn();

        collector.setDidFailToRetrieveCardAttributes(firstCallback);
        collector.setDidFailToRetrieveCardAttributes(secondCallback);

        expect((collector as any).didFailToRetrieveCardAttributes).toBe(
          secondCallback
        );
      });
    });

    describe('setCardAttributesLookupResponse', () => {
      it('should store the raw response callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const mockCallback = jest.fn();
        collector.setCardAttributesLookupResponse(mockCallback);
        expect((collector as any).cardAttributesLookupResponse).toBe(
          mockCallback
        );
      });

      it('should allow replacing raw response callback', () => {
        const collector = new VGSCollect(tenantId, environment);
        const firstCallback = jest.fn();
        const secondCallback = jest.fn();

        collector.setCardAttributesLookupResponse(firstCallback);
        collector.setCardAttributesLookupResponse(secondCallback);

        expect((collector as any).cardAttributesLookupResponse).toBe(
          secondCallback
        );
      });
    });
  });

  describe('Lookup Trigger Logic', () => {
    describe('lookup endpoint selection', () => {
      it('should use sandbox lookup endpoint when override is set for sandbox environment', async () => {
        const collector = new VGSCollect(tenantId, 'sandbox');
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

        collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );
        (collector as any).notifyCardInputChange('41111111111');

        await new Promise((resolve) => setTimeout(resolve, 300));

        const lookupCall = (global.fetch as jest.Mock).mock.calls.find(
          (call) =>
            call[0] ===
            'https://card-enrichment-api.sandbox.verygoodvault.com/cardattributes/enriched'
        );
        expect(lookupCall).toBeDefined();
      });

      it('should use sandbox lookup endpoint when override is set for live environment', async () => {
        const collector = new VGSCollect(tenantId, 'live');
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

        collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );
        (collector as any).notifyCardInputChange('41111111111');

        await new Promise((resolve) => setTimeout(resolve, 300));

        const lookupCall = (global.fetch as jest.Mock).mock.calls.find(
          (call) =>
            call[0] ===
            'https://card-enrichment-api.sandbox.verygoodvault.com/cardattributes/enriched'
        );
        expect(lookupCall).toBeDefined();
      });

      it('should resolve lookup endpoint from the collector environment by default', () => {
        VGSCollect.setCardAttributesLookupEndpoint();

        const sandboxCollector = new VGSCollect(tenantId, 'sandbox');
        const liveCollector = new VGSCollect(tenantId, 'live');

        expect((sandboxCollector as any).buildCardAttributesLookupUrl()).toBe(
          'https://card-enrichment-api.sandbox.verygoodvault.com/cardattributes/enriched'
        );
        expect((liveCollector as any).buildCardAttributesLookupUrl()).toBe(
          'https://card-enrichment-api.live.verygoodvault.com/cardattributes/enriched'
        );
      });
    });

    describe('card input notification via registerField callback', () => {
      it('should not trigger lookup if includedCardAttributes is empty', () => {
        const collector = new VGSCollect(tenantId, environment);
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        // Register card field and get callback
        const notifyCallback = collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );

        // Use callback to notify
        notifyCallback?.('41111111111');

        expect(mockWillBegin).not.toHaveBeenCalled();
      });

      it('should not trigger lookup when input has less than 11 digits', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        // Register card field and get callback
        const notifyCallback = collector.registerField(
          'pan',
          () => '4111111111',
          () => [],
          undefined,
          'card'
        );

        notifyCallback?.('4111111111'); // 10 digits

        expect(mockWillBegin).not.toHaveBeenCalled();
      });

      it('should trigger lookup at exactly 11 digits when attributes configured', async () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('mock-token'));
        const mockWillBegin = jest.fn();
        const mockDidRetrieve = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);
        collector.setDidRetrieveCardAttributes(mockDidRetrieve);

        // Register card field and get callback
        const notifyCallback = collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );

        notifyCallback?.('41111111111');

        expect(mockWillBegin).toHaveBeenCalledTimes(1);

        // Wait for async lookup request
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(mockDidRetrieve).toHaveBeenCalledWith(
          expect.objectContaining({
            brand: 'VISA',
            card_type: 'DEBIT',
            bin: '411111',
            issuing_organization: 'Mock Bank',
          })
        );
      });

      it('should trigger lookup with more than 11 digits', async () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('mock-token'));
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        const notifyCallback = collector.registerField(
          'pan',
          () => '4111111111111111',
          () => [],
          undefined,
          'card'
        );

        notifyCallback?.('4111111111111111');

        expect(mockWillBegin).toHaveBeenCalledTimes(1);
      });

      it('should reset state when user deletes below 11 digits', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);

        // Set up initial state as if lookup was triggered
        (collector as any).requestedDigits11 = '41111111111';
        (collector as any).inFlightDigits11 = '41111111111';

        // Access private method for test
        (collector as any).notifyCardInputChange('4111111'); // 7 digits

        expect((collector as any).requestedDigits11).toBeUndefined();
        expect((collector as any).inFlightDigits11).toBeUndefined();
      });

      it('should not reset state when user types more digits beyond 11', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);

        // Set up initial state
        (collector as any).requestedDigits11 = '41111111111';
        (collector as any).inFlightDigits11 = '41111111111';

        // Access private method for test
        (collector as any).notifyCardInputChange('4111111111111111'); // 16 digits

        expect((collector as any).requestedDigits11).toBe('41111111111');
        expect((collector as any).inFlightDigits11).toBe('41111111111');
      });
    });

    describe('Deduplication', () => {
      it('should prevent duplicate requests for same BIN', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );

        (collector as any).notifyCardInputChange('41111111111');
        (collector as any).notifyCardInputChange('41111111111'); // Same BIN

        expect(mockWillBegin).toHaveBeenCalledTimes(1);
      });

      it('should allow new request for different BIN', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        let currentValue = '41111111111';
        collector.registerField(
          'pan',
          () => currentValue,
          () => [],
          undefined,
          'card'
        );

        (collector as any).notifyCardInputChange('41111111111');

        // Manually reset to simulate completion
        (collector as any).requestedDigits11 = undefined;
        (collector as any).inFlightDigits11 = undefined;

        currentValue = '51111111111';
        (collector as any).notifyCardInputChange('51111111111'); // Different BIN

        expect(mockWillBegin).toHaveBeenCalledTimes(2);
      });

      it('should allow retry after state reset', () => {
        const collector = new VGSCollect(tenantId, environment);
        collector.setIncludedCardAttributes(['card_type']);
        collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
        const mockWillBegin = jest.fn();
        collector.setWillBeginCardAttributesLookup(mockWillBegin);

        collector.registerField(
          'pan',
          () => '41111111111',
          () => [],
          undefined,
          'card'
        );

        (collector as any).notifyCardInputChange('41111111111');

        // User deletes below 11 digits (triggers reset)
        (collector as any).notifyCardInputChange('411111111'); // 9 digits

        // User types 11 digits again
        (collector as any).notifyCardInputChange('41111111111');

        expect(mockWillBegin).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Race Condition Handling', () => {
    it('should discard result if inFlightDigits11 changed', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      // Register a card field with initial value
      let cardValue = '41111111111';
      collector.registerField(
        'pan',
        () => cardValue,
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      // Simulate user changing input before response arrives
      (collector as any).inFlightDigits11 = '51111111111';

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).not.toHaveBeenCalled();
    });

    it('should discard result if user input first 11 digits changed', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      let currentValue = '41111111111';
      collector.registerField(
        'pan',
        () => currentValue,
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      // User changes first 11 digits
      currentValue = '51111111111';

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).not.toHaveBeenCalled();
    });

    it('should accept result if first 11 digits match', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      // Card value with 16 digits (first 11 match trigger)
      collector.registerField(
        'pan',
        () => '4111111111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledTimes(1);
    });

    it('should accept result if user typed more digits with same prefix', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      let currentValue = '41111111111';
      collector.registerField(
        'pan',
        () => currentValue,
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      // User continues typing (same first 11)
      currentValue = '4111111111199';

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledTimes(1);
    });
  });

  describe('Card Attributes Responses', () => {
    it('should preserve the complete wrapped backend response', async () => {
      const backendResponse = {
        data: {
          card_brand: 'VISA',
          card_type: 'CREDIT',
          enriched_attributes: {
            card_properties: {
              issuer_bin: '411111',
              country_letter_code: 'US',
            },
            bank: {
              issuer_name: 'Sandbox Bank',
            },
          },
        },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      } as any);

      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      const mockRawResponse = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);
      collector.setCardAttributesLookupResponse(mockRawResponse);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(backendResponse);
      expect(mockRawResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          status: 200,
          data: backendResponse,
        })
      );
    });

    it('should return visa attributes for cards starting with 4', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'VISA' })
      );
    });

    it('should return mastercard attributes for cards starting with 5', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '51111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('51111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'MASTERCARD' })
      );
    });

    it('should return amex attributes for cards starting with 3', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '37111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('37111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'AMEX' })
      );
    });

    it('should return unknown brand for cards starting with 6', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '60111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('60111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'UNKNOWN' })
      );
    });

    it('should return unknown brand for unrecognized cards', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '90111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('90111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'UNKNOWN' })
      );
    });

    it('should include BIN as first 6 digits', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '41234567890',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('41234567890');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '412345',
        })
      );
    });

    it('should return all required attributes in response', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type', 'issuer', 'bin']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidRetrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: expect.any(String),
          card_type: expect.any(String),
          bin: expect.any(String),
          issuing_organization: expect.any(String),
          version: expect.any(String),
        })
      );
    });

    it('should track successful lookup status, response code, and latency', async () => {
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');
      await wait(300);

      expect(trackSpy).toHaveBeenCalledWith(
        expect.anything(),
        AnalyticsEventType.CardLookup,
        AnalyticEventStatus.Success,
        expect.objectContaining({
          error: '',
          statusCode: 200,
          latency: expect.any(Number),
        })
      );
      trackSpy.mockRestore();
    });

    it('should preserve a Bearer prefix returned by authHandler', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(
        jest.fn().mockResolvedValue('Bearer existing-token')
      );
      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');
      await wait(300);

      const lookupCall = (global.fetch as jest.Mock).mock.calls.find(
        (call) =>
          call[0] ===
          'https://card-enrichment-api.sandbox.verygoodvault.com/cardattributes/enriched'
      );
      expect(lookupCall?.[1]?.headers?.Authorization).toBe(
        'Bearer existing-token'
      );
    });

    it('should build lookup filter only from configured parameters', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['bin', 'cardBrand']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );
      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      const lookupCall = (global.fetch as jest.Mock).mock.calls.find(
        (call) =>
          typeof call[1]?.body === 'string' &&
          call[1].body.includes('"number"') &&
          call[1].body.includes('"filter"')
      );
      expect(lookupCall).toBeDefined();

      const requestOptions = lookupCall?.[1];
      const requestBody = JSON.parse(requestOptions.body);
      expect(requestBody.filter).toEqual(['bin', 'cardBrand']);
    });
  });

  describe('Error Handling', () => {
    it('should invoke error callback if authHandler not set', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      const mockDidFail = jest.fn();
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VGSErrorCode.AuthHandlerNotSet,
          message: 'authHandler is required for card attributes lookup.',
        })
      );
    });

    it('should invoke error callback if authHandler returns empty token', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue(''));
      const mockDidFail = jest.fn();
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VGSErrorCode.IvalidAccessToken,
          message: 'VGSCollect: Access token is null or empty!',
        })
      );
    });

    it('should invoke error callback if authHandler promise rejects', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      const authError = new Error('Network error');
      collector.setAuthHandler(jest.fn().mockRejectedValue(authError));
      const mockDidFail = jest.fn();
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VGSErrorCode.IvalidAccessToken,
        })
      );
    });

    it('should drop lookup result if no card field is registered', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockDidRetrieve = jest.fn();
      const mockDidFail = jest.fn();
      collector.setDidRetrieveCardAttributes(mockDidRetrieve);
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      // No field registered, but notify called
      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect((collector as any).inFlightDigits11).toBeUndefined();
      expect(mockDidRetrieve).not.toHaveBeenCalled();
      expect(mockDidFail).not.toHaveBeenCalled();
    });

    it('should emit unexpected response type failure for invalid response objects', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({}),
      } as any);

      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockRawResponse = jest.fn();
      const mockDidFail = jest.fn();
      collector.setCardAttributesLookupResponse(mockRawResponse);
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockRawResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'failure',
          status: VGSErrorCode.UnexpectedResponseType,
        })
      );
      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VGSErrorCode.UnexpectedResponseType,
        })
      );
    });

    it('should emit unexpected response data format failure for malformed success payloads', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      } as any);

      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockRawResponse = jest.fn();
      const mockDidFail = jest.fn();
      collector.setCardAttributesLookupResponse(mockRawResponse);
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockRawResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'failure',
          status: VGSErrorCode.UnexpectedResponseDataFormat,
        })
      );
      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: VGSErrorCode.UnexpectedResponseDataFormat,
        })
      );
    });

    it('should include text payload in raw response when lookup error body is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        clone: () => ({
          json: async () => {
            throw new Error('not json');
          },
          text: async () => 'lookup failed upstream',
        }),
      } as any);

      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      const mockRawResponse = jest.fn();
      const mockDidFail = jest.fn();
      collector.setCardAttributesLookupResponse(mockRawResponse);
      collector.setDidFailToRetrieveCardAttributes(mockDidFail);

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockRawResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'failure',
          status: 422,
          data: 'lookup failed upstream',
        })
      );
      expect(mockDidFail).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Card attributes lookup failed with status: 422',
        })
      );
    });

    it('should track lookup HTTP failures using a privacy-safe category', async () => {
      const trackSpy = jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'unavailable' }),
      } as any);
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));
      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');
      await wait(300);

      expect(trackSpy).toHaveBeenCalledWith(
        expect.anything(),
        AnalyticsEventType.CardLookup,
        AnalyticEventStatus.Failed,
        expect.objectContaining({
          error: 'http_error',
          statusCode: 503,
          latency: expect.any(Number),
        })
      );
      trackSpy.mockRestore();
    });
  });

  describe('Callback Invocation Order', () => {
    it('should invoke willBegin before didRetrieve', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('token'));

      const invocationOrder: string[] = [];
      collector.setWillBeginCardAttributesLookup(() => {
        invocationOrder.push('willBegin');
      });
      collector.setCardAttributesLookupResponse(() => {
        invocationOrder.push('response');
      });
      collector.setDidRetrieveCardAttributes(() => {
        invocationOrder.push('didRetrieve');
      });

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(invocationOrder).toEqual(['willBegin', 'response', 'didRetrieve']);
    });

    it('should invoke willBegin before didFail on error', async () => {
      const collector = new VGSCollect(tenantId, environment);
      collector.setIncludedCardAttributes(['card_type']);
      collector.setAuthHandler(jest.fn().mockResolvedValue('')); // Empty token

      const invocationOrder: string[] = [];
      collector.setWillBeginCardAttributesLookup(() => {
        invocationOrder.push('willBegin');
      });
      collector.setCardAttributesLookupResponse(() => {
        invocationOrder.push('response');
      });
      collector.setDidFailToRetrieveCardAttributes(() => {
        invocationOrder.push('didFail');
      });

      collector.registerField(
        'pan',
        () => '41111111111',
        () => [],
        undefined,
        'card'
      );

      (collector as any).notifyCardInputChange('41111111111');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(invocationOrder).toEqual(['willBegin', 'response', 'didFail']);
    });
  });
});
