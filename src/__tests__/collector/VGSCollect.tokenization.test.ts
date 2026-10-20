import {
  ExpDateSeparateSerializer,
  VGSCollect,
  VGSCollectLogger,
  VGSErrorCode,
  VGSTokenizationConfiguration,
} from '../../index';
import VGSAnalyticsClient from '../../utils/analytics/AnalyticsClient';
import { tokenizationConfigValidation } from '../../utils/tokenization/TokenizationConfiguration';

const originalFetch = global.fetch;
const pan = '4111'.repeat(4);
const config = VGSTokenizationConfiguration.presets.card;
const serializer = new ExpDateSeparateSerializer('exp_month', 'exp_year');

describe.each(['tokenize', 'createAliases'] as const)(
  '%s response',
  (method) => {
    let collector: VGSCollect;
    let fetchMock: jest.Mock;

    const registerCard = () =>
      collector.registerField(
        'pan',
        () => pan,
        () => [],
        config,
        'card'
      );
    const registerPlain = () => {
      collector.registerField(
        'cardholder',
        () => 'Jane Doe',
        () => []
      );
      collector.registerField(
        'expiration',
        () => serializer.serialize('1229'),
        () => []
      );
    };
    const response = (
      data: unknown = [
        { aliases: [{ format: config.format, alias: 'alias-pan' }] },
      ]
    ) => ({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ data }),
    });

    beforeEach(() => {
      jest
        .spyOn(VGSAnalyticsClient.getInstance(), 'trackFormEvent')
        .mockImplementation(() => {});
      collector = new VGSCollect('tenant', 'sandbox');
      fetchMock = jest.fn().mockResolvedValue(response());
      global.fetch = fetchMock;
    });

    afterEach(() => {
      VGSCollectLogger.getInstance().disable();
      jest.restoreAllMocks();
      global.fetch = originalFetch;
    });

    it('returns aliases and serialized plain values but sends only tokenized values', async () => {
      registerCard();
      registerPlain();
      await expect(collector[method]()).resolves.toEqual({
        status: 201,
        data: {
          pan: 'alias-pan',
          cardholder: 'Jane Doe',
          exp_month: '12',
          exp_year: '29',
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain(method === 'tokenize' ? '/tokens' : '/aliases');
      expect(JSON.parse(options.body)).toEqual({
        data: [{ value: pan, storage: config.storage, format: config.format }],
      });
    });

    it('returns plain-only data without a request', async () => {
      registerPlain();
      await expect(collector[method]()).resolves.toEqual({
        status: 200,
        data: { cardholder: 'Jane Doe', exp_month: '12', exp_year: '29' },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    describe.each(['card', 'cvc'] as const)(
      'non-tokenized %s field',
      (type) => {
        it.each([false, true])(
          'omits values with tokenized fields=%s',
          async (withTokenizedField) => {
            if (withTokenizedField) registerCard();
            registerPlain();
            const getValue = jest.fn(() => (type === 'card' ? pan : '123'));
            collector.registerField(
              'custom_sensitive_name',
              getValue,
              () => [],
              undefined,
              type
            );

            const result = await collector[method]();
            expect(result.data).toEqual({
              ...(withTokenizedField ? { pan: 'alias-pan' } : {}),
              cardholder: 'Jane Doe',
              exp_month: '12',
              exp_year: '29',
            });
            expect(getValue).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(withTokenizedField ? 1 : 0);
          }
        );

        it('omits fields when an invalid storage policy disables tokenization', async () => {
          const invalidConfig = {
            ...VGSTokenizationConfiguration.presets[type],
            storage:
              type === 'card'
                ? VGSTokenizationConfiguration.storage.VOLATILE
                : VGSTokenizationConfiguration.storage.PERSISTENT,
          };
          const validated = tokenizationConfigValidation(invalidConfig, type);
          expect(validated).toBe(false);
          collector.registerField(
            'protected',
            () => (type === 'card' ? pan : '123'),
            () => [],
            validated || undefined,
            type
          );
          await expect(collector[method]()).resolves.toEqual({
            status: 200,
            data: {},
          });
          expect(fetchMock).not.toHaveBeenCalled();
        });

        it('returns an empty result when only protected fields are registered', async () => {
          collector.registerField(
            'custom_sensitive_name',
            () => (type === 'card' ? pan : '123'),
            () => [],
            undefined,
            type
          );
          await expect(collector[method]()).resolves.toEqual({
            status: 200,
            data: {},
          });
          expect(fetchMock).not.toHaveBeenCalled();
        });

        it('still validates excluded fields', async () => {
          collector.registerField(
            'custom_sensitive_name',
            () => '',
            () => ['required'],
            undefined,
            type
          );
          await expect(collector[method]()).rejects.toMatchObject({
            code: VGSErrorCode.InputDataIsNotValid,
            details: { custom_sensitive_name: ['required'] },
          });
          expect(fetchMock).not.toHaveBeenCalled();
        });

        it.each([false, true])(
          'blocks serializer collisions with protected field first=%s',
          async (protectedFirst) => {
            const registerProtected = () =>
              collector.registerField(
                'protected',
                () => 'secret',
                () => [],
                undefined,
                type
              );
            if (protectedFirst) registerProtected();
            collector.registerField(
              'other',
              () => ({ protected: 'plain-value', allowed: 'keep' }),
              () => []
            );
            if (!protectedFirst) registerProtected();
            await expect(collector[method]()).resolves.toEqual({
              status: 200,
              data: { allowed: 'keep' },
            });
          }
        );

        it('returns aliases for explicitly tokenized protected fields', async () => {
          const fieldConfig = VGSTokenizationConfiguration.presets[type];
          collector.registerField(
            'protected',
            () => (type === 'card' ? pan : '123'),
            () => [],
            fieldConfig,
            type
          );
          fetchMock.mockResolvedValue(
            response([
              {
                aliases: [
                  { format: fieldConfig.format, alias: 'protected-alias' },
                ],
              },
            ])
          );
          await expect(collector[method]()).resolves.toMatchObject({
            data: { protected: 'protected-alias' },
          });
        });
      }
    );

    it('keeps the empty-form result', async () => {
      await expect(collector[method]()).resolves.toEqual({
        status: 200,
        data: {},
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'validates plain fields with tokenized fields=%s',
      async (withCard) => {
        if (withCard) registerCard();
        collector.registerField(
          'cardholder',
          () => '',
          () => ['required']
        );
        await expect(collector[method]()).rejects.toMatchObject({
          code: VGSErrorCode.InputDataIsNotValid,
          details: { cardholder: ['required'] },
        });
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('keeps serializer keys and alias ordering for tokenized expiration', async () => {
      collector.registerField(
        'expiration',
        () => serializer.serialize('1229'),
        () => [],
        config
      );
      collector.registerField(
        'cardholder',
        () => 'Jane Doe',
        () => []
      );
      fetchMock.mockResolvedValue(
        response([
          { aliases: [{ format: config.format, alias: 'alias-month' }] },
          { aliases: [{ format: config.format, alias: 'alias-year' }] },
        ])
      );
      await expect(collector[method]()).resolves.toMatchObject({
        data: {
          exp_month: 'alias-month',
          exp_year: 'alias-year',
          cardholder: 'Jane Doe',
        },
      });
    });

    describe.each([false, true])(
      'validation snapshot with aliases=%s',
      (withAliases) => {
        beforeEach(() => {
          if (withAliases) registerCard();
        });

        it.each(['edit', 'unregister'])(
          'rejects invalid captured fields after a synchronous %s',
          async (change) => {
            let value = 'invalid';
            collector.registerField(
              'name',
              () => value,
              () => (value === 'valid' ? [] : ['invalid'])
            );
            const pending = collector[method]();
            if (change === 'edit') value = 'valid';
            else collector.unregisterField('name');
            await expect(pending).rejects.toMatchObject({
              code: VGSErrorCode.InputDataIsNotValid,
              details: { name: ['invalid'] },
            });
            expect(fetchMock).not.toHaveBeenCalled();
          }
        );

        it.each(['edit', 'register'])(
          'keeps a valid snapshot after a synchronous %s',
          async (change) => {
            let value = 'valid';
            const validate = jest.fn(() =>
              value === 'valid' ? [] : ['invalid']
            );
            collector.registerField('name', () => value, validate);
            const pending = collector[method]();
            if (change === 'edit') value = 'invalid';
            else
              collector.registerField(
                'newField',
                () => '',
                () => ['required']
              );
            await expect(pending).resolves.toEqual({
              status: withAliases ? 201 : 200,
              data: {
                ...(withAliases ? { pan: 'alias-pan' } : {}),
                name: 'valid',
              },
            });
            expect(validate).toHaveBeenCalledTimes(1);
          }
        );

        it('keeps the validated snapshot while CNAME validation is pending', async () => {
          let releaseCname!: () => void;
          const cnameValidation = new Promise<void>((resolve) => {
            releaseCname = resolve;
          });
          const awaitCname = jest
            .spyOn(collector as any, 'awaitCnameValidation')
            .mockReturnValue(cnameValidation);
          collector.registerField(
            'name',
            () => 'original',
            () => []
          );
          const pending = collector[method]();
          await Promise.resolve();
          expect(awaitCname).toHaveBeenCalledTimes(1);
          collector.unregisterField('name');
          collector.registerField(
            'newField',
            () => '',
            () => ['required']
          );
          releaseCname();
          await expect(pending).resolves.toEqual({
            status: withAliases ? 201 : 200,
            data: {
              ...(withAliases ? { pan: 'alias-pan' } : {}),
              name: 'original',
            },
          });
        });

        it('validates excluded CVC fields before they can unmount', async () => {
          collector.registerField(
            'security_code',
            () => '',
            () => ['required'],
            undefined,
            'cvc'
          );
          const pending = collector[method]();
          collector.unregisterField('security_code');
          await expect(pending).rejects.toMatchObject({
            code: VGSErrorCode.InputDataIsNotValid,
            details: { security_code: ['required'] },
          });
          expect(fetchMock).not.toHaveBeenCalled();
        });
      }
    );

    it('ignores inherited registry entries during validation and collection', async () => {
      const inheritedValue = jest.fn(() => 'unexpected');
      const inheritedValidation = jest.fn(() => ['invalid']);
      const fields = (collector as any).fields;
      Object.setPrototypeOf(fields, {
        inheritedField: {
          getSubmitValue: inheritedValue,
          getValidationErrors: inheritedValidation,
        },
      });
      registerPlain();
      await expect(collector[method]()).resolves.toEqual({
        status: 200,
        data: { cardholder: 'Jane Doe', exp_month: '12', exp_year: '29' },
      });
      expect(inheritedValue).not.toHaveBeenCalled();
      expect(inheritedValidation).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps submitted values and alias formats after fields change or unmount', async () => {
      let name = 'Jane Doe';
      registerCard();
      const getName = jest.fn(() => name);
      collector.registerField('cardholder', getName, () => []);
      fetchMock.mockImplementation(async () => {
        name = 'Changed Name';
        collector.unregisterField('pan');
        collector.unregisterField('cardholder');
        return response();
      });
      await expect(collector[method]()).resolves.toMatchObject({
        data: { pan: 'alias-pan', cardholder: 'Jane Doe' },
      });
      expect(getName).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
      'reserves tokenized keys with plain field first=%s',
      async (plainFirst) => {
        const registerCollision = () =>
          collector.registerField(
            'other',
            () => ({ pan: 'plain-value' }),
            () => []
          );
        if (plainFirst) registerCollision();
        registerCard();
        if (!plainFirst) registerCollision();
        await expect(collector[method]()).resolves.toMatchObject({
          data: { pan: 'alias-pan' },
        });
        fetchMock.mockResolvedValue(response([{ aliases: [] }]));
        await expect(collector[method]()).resolves.toMatchObject({ data: {} });
      }
    );

    it('does not copy inherited serializer keys or change the result prototype', async () => {
      const value = Object.create({ inherited: 'omit' });
      Object.defineProperty(value, '__proto__', {
        value: 'plain',
        enumerable: true,
      });
      value.own = 'keep';
      collector.registerField(
        'custom',
        () => value,
        () => []
      );
      const result = await collector[method]();
      expect(result.data).toEqual(
        JSON.parse('{"__proto__":"plain","own":"keep"}')
      );
      expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    });

    it('preserves unsuccessful HTTP responses without plain values', async () => {
      registerCard();
      registerPlain();
      const failed = { ok: false, status: 400 };
      fetchMock.mockResolvedValue(failed);
      const result = await collector[method]();
      expect(result).toEqual({ status: 400, data: failed });
      expect(result.data).toBe(failed);
    });

    it.each(['network', 'parse'])(
      'preserves %s failures without plain values',
      async (failure) => {
        registerCard();
        registerPlain();
        const error = new Error('Request failed');
        if (failure === 'network') fetchMock.mockRejectedValue(error);
        else
          fetchMock.mockResolvedValue({
            ...response(),
            json: async () => {
              throw error;
            },
          });
        await expect(collector[method]()).rejects.toBe(error);
      }
    );

    it.each(['success', 'network', 'plain-only', 'invalid-expiration'])(
      'keeps values and credentials out of enabled logs on %s',
      async (outcome) => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const errorLog = jest
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        VGSCollectLogger.getInstance().enable();
        collector.setCustomHeaders({ authorization: 'test-credential' });
        if (outcome !== 'plain-only') registerCard();
        registerPlain();
        if (outcome === 'invalid-expiration') {
          collector.registerField(
            'expiration',
            () => serializer.serialize('invalid-expiration-input'),
            () => ['invalid']
          );
        }
        if (outcome === 'network')
          fetchMock.mockRejectedValue(new Error('Request failed'));
        if (outcome === 'network' || outcome === 'invalid-expiration') {
          await expect(collector[method]()).rejects.toBeDefined();
        } else {
          await collector[method]();
        }
        const output = JSON.stringify([
          ...log.mock.calls,
          ...errorLog.mock.calls,
        ]);
        for (const sensitive of [
          pan,
          'Jane Doe',
          'invalid-expiration-input',
          'test-credential',
        ]) {
          expect(output.includes(sensitive)).toBe(false);
        }
      }
    );
  }
);
