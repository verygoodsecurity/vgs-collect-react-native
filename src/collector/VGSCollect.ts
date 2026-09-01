// VGSCollect.ts
import APIHostnameValidator from '../utils/url/APIHostnameValidator';
import { LengthRule, PatternRule } from '../utils/validators';
import { ValidationRule } from '../utils/validators/Validator';
import { PaymentCardBrandsManager } from '../utils/paymentCards/PaymentCardBrandsManager';
import type { VGSTokenizationConfiguration } from '../utils/tokenization/TokenizationConfiguration';
import { VGSError, VGSErrorCode } from '../utils/errors';
import type {
  VGSCardAttributes,
  VGSAuthHandler,
  VGSCardAttributesWillBeginCallback,
  VGSCardAttributesSuccessCallback,
  VGSCardAttributesLookupResponse,
  VGSCardAttributesLookupResponseCallback,
  VGSCardAttributesErrorCallback,
} from '../types/CardAttributesTypes';
import VGCollectLogger, {
  VGSLogLevel,
  VGSLogSeverity,
} from '../utils/logger/VGSCollectLogger';
import VGSAnalyticsClient, {
  AnalyticEventStatus,
  VGSCOLLECT_SDK_VERSION,
} from '../utils/analytics/AnalyticsClient';
import { AnalyticsEventType } from '../utils/analytics/AnalyticsClient';
import FormAnalyticsDetails from '../utils/analytics/FormAnalyticsDetails';
import {
  getTypeAnalyticsString,
  type VGSInputType,
} from '../components/VGSInputType';
import { CardManagementAPIPath } from './CardManagementAPI';
import { getVaultAPIPath, VaultAPIVersion } from './VaultAPI';

type FieldUpdateCallback = (config: {
  mask?: string;
  validationRules?: ValidationRule[];
}) => void;

interface TokenizationFieldMapping {
  /** The key to use in the final output (if a serializer split the value, this is the sub-key, e.g. "month") */
  key: string;
  /** The registered field name (used to look up the field config) */
  fieldName: string;
}

interface FieldConfig {
  getSubmitValue: () => string | Record<string, string>;
  getValidationErrors: () => string[];
  getRawValue?: () => string;
  mask?: string;
  validationRules?: ValidationRule[];
  type?: string;
  tokenizationConfig?: VGSTokenizationConfiguration;
  updateCallback?: FieldUpdateCallback;
}

interface RequestLogOverrides {
  headers?: Record<string, any>;
  payload?: Record<string, any>;
}

interface CmpRequestSnapshot {
  payload?: Record<string, any>;
}

interface SessionConfigurationPayload {
  form_name?: string;
  version?: string;
  config?: {
    cardAttributes?: {
      enable?: boolean;
      parameters?: string[];
    };
  };
}

export interface VGSCollectSessionOptions {
  /** Inline form configuration used when the remote configuration cannot be loaded. */
  configuration?: SessionConfigurationPayload['config'];
  /** Receives remote session configuration errors without preventing collector creation. */
  onError?: (error: unknown) => void;
}

interface SessionConfigurationLoadTelemetry {
  configFile: string;
  configFileStatusCode?: number;
  configFileLatency: number;
}

interface SessionConfigurationLoadResult extends SessionConfigurationLoadTelemetry {
  payload: SessionConfigurationPayload;
}

interface SessionConfigurationLegacyLoadResult {
  payload: SessionConfigurationPayload;
  statusCode: number;
  latency: number;
}

type SessionConfigurationLike =
  | SessionConfigurationPayload
  | SessionConfigurationLoadResult
  | SessionConfigurationLegacyLoadResult;

type CmpOperation = 'cardCreate' | 'cardUpdate';

const CMP_REQUIRED_FIELDS_KEY = 'VGSSDKErrorInputDataRequired';
const CMP_INVALID_FIELDS_KEY = 'VGSSDKErrorInputDataRequiredValid';
const CMP_CREATE_REQUIRED_FIELDS = ['pan', 'exp_month', 'exp_year'] as const;
const CMP_UPDATE_ALLOWED_FIELDS = new Set(['cvc', 'exp_month', 'exp_year']);

const isResponseLike = (
  value: unknown
): value is {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  clone?: () => any;
} => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean' &&
    typeof (value as { status?: unknown }).status === 'number'
  );
};
/**
 * VGSCollect
 *
 * Public orchestrator for secure collection and submission/tokenization of sensitive input data.
 * Responsibilities:
 * - Field lifecycle: register/unregister, type-specific updates, brand-aware CVC adjustments.
 * - Validation: invokes per-field `getValidationErrors()` and throws `VGSError` on failures.
 * - Networking: builds vault or API URLs and performs `fetch` with analytics + custom headers.
 * - Tokenization: collects configured fields and maps aliases back to original field keys.
 * - CNAME: optional custom hostname validation gated before any submission.
 */
class VGSCollect {
  private static readonly CARD_ATTRIBUTES_LOOKUP_SANDBOX_URL =
    'https://card-enrichment-api.sandbox.verygoodvault.com/cardattributes/enriched';
  private static readonly CARD_ATTRIBUTES_LOOKUP_PRODUCTION_URL =
    'https://card-enrichment-api.live.verygoodvault.com/cardattributes/enriched';
  private static cardAttributesLookupEndpointOverride:
    'sandbox' | 'production' | undefined;
  private static suppressCreateInitAnalytics = false;

  private tenantId: string;
  private environment: string;
  private routeId?: string;
  private cname?: string;
  private customHeaders: Record<string, string> = {};
  private isCnameValidating: boolean = false;
  private cnameValidationPromise: Promise<boolean> | null = null;
  private fields: Record<string, FieldConfig> = {};
  private logger: VGCollectLogger = VGCollectLogger.getInstance();
  private analyticsClient = VGSAnalyticsClient.getInstance();
  private formAnalyticsDetails: FormAnalyticsDetails;
  private includedCardAttributes: string[] = [];

  // Card Attributes Lookup state
  private authHandler?: VGSAuthHandler;
  private authHandlerGeneration = 0;
  private willBeginCardAttributesLookup?: VGSCardAttributesWillBeginCallback;
  private didRetrieveCardAttributes?: VGSCardAttributesSuccessCallback;
  private cardAttributesLookupResponse?: VGSCardAttributesLookupResponseCallback;
  private didFailToRetrieveCardAttributes?: VGSCardAttributesErrorCallback;
  private requestedDigits11?: string;
  private inFlightDigits11?: string;
  private lookupStartedAt: Record<string, number> = {};
  private cachedJwtToken?: string;

  /**
   * Creates a new collector bound to a Vault.
   *
   * @param id - Vault ID, alphanumeric (e.g., `tnt12345`).
   * @param environment - Deployment environment: `sandbox`, `live`, or `live-<region>`.
   * @throws {VGSError} When configuration is invalid (tenant or environment).
   */
  public constructor(id: string, environment: string = 'sandbox') {
    VGSCollect.validateConfig(id, environment);
    this.tenantId = id;
    this.environment = environment.toLowerCase();
    this.formAnalyticsDetails = new FormAnalyticsDetails(id, environment);

    if (!VGSCollect.suppressCreateInitAnalytics) {
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.CollectInit,
        AnalyticEventStatus.Success,
        { formType: 'create' }
      );
    }
  }

  /**
   * Overrides the card attributes lookup endpoint selection.
   * When unset, the endpoint follows the collector environment.
   *
   * @param endpoint - Optional endpoint target for controlled environments such as tests.
   */
  public static setCardAttributesLookupEndpoint(
    endpoint?: 'sandbox' | 'production'
  ) {
    VGSCollect.cardAttributesLookupEndpointOverride = endpoint;
  }

  /**
   * Creates a new collector instance with form configuration.
   *
   * @param form - Form identifier (e.g., `checkout-form`).
   * @param vaultId - Vault ID (e.g., `tnt12345`).
   * @param environment - Deployment environment: `sandbox`, `live`, or `live-<region>`.
   * @param options - Optional inline fallback configuration and remote-load error callback.
   * @returns Promise resolving to configured VGSCollect instance.
   * @throws {VGSError} When form, vaultId, or environment is invalid.
   */
  public static async session(
    form: string | null | undefined,
    vaultId: string,
    environment: string = 'sandbox',
    options: VGSCollectSessionOptions = {}
  ): Promise<VGSCollect> {
    VGSCollect.validateConfig(vaultId, environment);
    const collector = VGSCollect.createCollectorWithoutInitAnalytics(
      vaultId,
      environment
    );
    const normalizedForm =
      typeof form === 'string' ? VGSCollect.normalizeSessionForm(form) : form;

    if (normalizedForm === null || normalizedForm === undefined) {
      collector.analyticsClient.trackFormEvent(
        collector.formAnalyticsDetails,
        AnalyticsEventType.CollectInit,
        AnalyticEventStatus.Success,
        VGSCollect.buildSessionAnalyticsExtraData()
      );
      return collector;
    }

    VGSCollect.validateForm(normalizedForm);
    collector.formAnalyticsDetails =
      collector.formAnalyticsDetails.withSessionFormId(normalizedForm);

    try {
      const loadedConfig = await VGSCollect.loadConfiguration(
        normalizedForm,
        vaultId
      );
      const config = VGSCollect.normalizeSessionConfigurationResult(
        normalizedForm,
        loadedConfig
      );

      collector.setIncludedCardAttributes(
        VGSCollect.resolveIncludedCardAttributes(config.payload.config)
      );

      collector.analyticsClient.trackFormEvent(
        collector.formAnalyticsDetails,
        AnalyticsEventType.CollectInit,
        AnalyticEventStatus.Success,
        VGSCollect.buildSessionAnalyticsExtraData({
          configFile: config.configFile,
          statusCode: config.configFileStatusCode,
          latency: config.configFileLatency,
        })
      );

      return collector;
    } catch (error) {
      const telemetry = VGSCollect.getSessionTelemetryFromError(error);
      collector.setIncludedCardAttributes(
        VGSCollect.resolveIncludedCardAttributes(options.configuration)
      );
      options.onError?.(error);
      collector.analyticsClient.trackFormEvent(
        collector.formAnalyticsDetails,
        AnalyticsEventType.CollectInit,
        AnalyticEventStatus.Success,
        VGSCollect.buildSessionAnalyticsExtraData(
          telemetry
            ? {
                configFile: telemetry.configFile,
                statusCode: telemetry.configFileStatusCode,
                latency: telemetry.configFileLatency,
              }
            : undefined
        )
      );
      return collector;
    }
  }

  /**
   * Sets the Vault Route ID to shape the base hostname.
   * Host becomes `<tenantId>-<routeId>.<environment>.verygoodproxy.com`.
   *
   * @param routeId - Route identifier configured in Vault.
   *                  Allowed symbols: letters, numbers and `-`.
   * @throws {VGSError} If `routeId` is invalid.
   */
  public setRouteId(routeId: string) {
    this.validateRouteId(routeId);
    this.routeId = routeId;
  }

  /**
   * Adds custom HTTP headers to subsequent requests.
   *
   * @param headers - Key/value header pairs. Avoid including sensitive values.
   */
  public setCustomHeaders(headers: Record<string, string>) {
    this.customHeaders = headers;
  }

  /**
   * Sets and validates a custom CNAME hostname.
   * Submission is gated until validation completes.
   *
   * @param cname - Custom hostname pointing to VGS (e.g., `payments.example.com`).
   * @returns Promise that resolves once validation finishes.
   */
  public async setCname(cname: string): Promise<void> {
    if (this.isCnameValidating) {
      // If already validating, wait for the existing promise
      await this.cnameValidationPromise;
    }

    const normalizedCname = APIHostnameValidator.normalizeHostname(cname);
    this.isCnameValidating = true;
    this.cnameValidationPromise = new Promise<boolean>((resolve, reject) => {
      APIHostnameValidator.validateCustomHostname(cname, this.tenantId)
        .then((isValid) => {
          this.isCnameValidating = false;
          this.cname = isValid ? (normalizedCname ?? undefined) : undefined;
          this.analyticsClient.trackFormEvent(
            this.formAnalyticsDetails,
            AnalyticsEventType.HostnameValidation,
            isValid ? AnalyticEventStatus.Success : AnalyticEventStatus.Failed,
            { hostname: normalizedCname ?? cname }
          );
          resolve(isValid);
        })
        .catch((error) => {
          this.analyticsClient.trackFormEvent(
            this.formAnalyticsDetails,
            AnalyticsEventType.HostnameValidation,
            AnalyticEventStatus.Failed,
            { hostname: normalizedCname ?? cname }
          );
          this.isCnameValidating = false;
          this.cname = undefined;
          reject(error);
        });
    });

    await this.cnameValidationPromise;
  }

  /**
   * Sets the auth handler used by authenticated CMP operations and card lookup.
   * Replacing the handler clears any JWT cached from the previous handler and
   * prevents pending requests from that handler from repopulating the cache.
   *
   * @param handler - Async function returning a valid JWT token string.
   */
  public setAuthHandler(handler: VGSAuthHandler) {
    if (this.authHandler !== handler) {
      this.cachedJwtToken = undefined;
    }
    this.authHandler = handler;
    this.authHandlerGeneration += 1;
  }

  /**
   * Sets callback invoked before starting a card attributes lookup request.
   *
   * @param callback - Function called when lookup begins.
   */
  public setWillBeginCardAttributesLookup(
    callback: VGSCardAttributesWillBeginCallback
  ) {
    this.willBeginCardAttributesLookup = callback;
  }

  /**
   * Sets callback invoked when card attributes lookup succeeds.
   *
   * @param callback - Function receiving card attributes data.
   */
  public setDidRetrieveCardAttributes(
    callback: VGSCardAttributesSuccessCallback
  ) {
    this.didRetrieveCardAttributes = callback;
  }

  /**
   * Sets callback invoked when card attributes lookup completes with raw response details.
   *
   * @param callback - Function receiving success or failure response metadata.
   */
  public setCardAttributesLookupResponse(
    callback: VGSCardAttributesLookupResponseCallback
  ) {
    this.cardAttributesLookupResponse = callback;
  }

  /**
   * Sets callback invoked when card attributes lookup fails.
   *
   * @param callback - Function receiving error details.
   */
  public setDidFailToRetrieveCardAttributes(
    callback: VGSCardAttributesErrorCallback
  ) {
    this.didFailToRetrieveCardAttributes = callback;
  }

  /**
   * Sets included card attributes to fetch during lookup.
   *
   * @param attributes - Array of card attribute names (e.g., ['card_type', 'issuer']).
   */
  public setIncludedCardAttributes(attributes: string[]) {
    this.includedCardAttributes = attributes;
  }

  /**
   * Registers a field with the collector.
   * Typically invoked by SDK input components on mount.
   *
   * @param fieldName - Unique field key matching Vault Route mapping (e.g., `pan`, `cvc`).
   * @param getSubmitValue - Getter returning raw value or a serialized object (e.g., `{ month, year }`).
   * @param getValidationErrors - Getter returning validation messages; empty when valid.
   * @param tokenizationConfig - Optional config enabling tokenization for this field.
   * @param type - Field type string (e.g., `card`, `cvc`, `expDate`).
   * @param validationRules - Optional override rules; if provided, defaults are replaced.
   * @param updateCallback - Optional notifier invoked when mask/rules change (e.g., brand updates).
   * @returns For card-type fields, returns a callback to notify of input changes; otherwise undefined.
   */
  registerField(
    fieldName: string,
    getSubmitValue: () => string | Record<string, string>,
    getValidationErrors: () => string[],
    tokenizationConfig?: VGSTokenizationConfiguration,
    type?: VGSInputType,
    validationRules: ValidationRule[] = [],
    updateCallback?: FieldUpdateCallback,
    getRawValue?: () => string
  ): ((rawInput: string) => void) | undefined {
    this.fields[fieldName] = {
      getSubmitValue: getSubmitValue,
      getValidationErrors,
      getRawValue,
      tokenizationConfig,
      type,
      validationRules,
      updateCallback,
    };
    this.analyticsClient.trackFormEvent(
      this.formAnalyticsDetails,
      AnalyticsEventType.FieldInit,
      AnalyticEventStatus.Success,
      { field: getTypeAnalyticsString(type ?? 'text') }
    );

    // For card-type fields, return callback for notifying input changes
    if (type === 'card') {
      return (rawInput: string) =>
        this.handlePotentialCardAttributesLookup(fieldName, rawInput);
    }
    return undefined;
  }

  /**
   * Notifies collector of card field raw input change.
   * Internal method accessed via callback returned from registerField.
   *
   * @param rawInput - Raw card number string (unmasked).
   * @private
   */
  // @ts-expect-error - Used indirectly via callback returned from registerField
  private notifyCardInputChange(rawInput: string, fieldName?: string): void {
    this.handlePotentialCardAttributesLookup(
      fieldName ?? this.findFieldNameByType('card'),
      rawInput
    );
  }
  /**
   * Unregisters a previously registered field.
   * Call on component unmount to prevent stale references.
   *
   * @param fieldName - Field key to remove.
   */
  public unregisterField(fieldName: string): void {
    delete this.fields[fieldName];
  }

  /**
   * Submits collected data to the Vault upstream.
   * Validates fields, awaits CNAME validation, builds URL, then performs `fetch`.
   *
   * @param path - API path under the Vault host (e.g., `/post`).
   * @param method - HTTP method, default `POST`.
   * @param extraData - Additional non-sensitive payload to merge.
   * @param customRequestStructure - Optional template object with `{{ fieldName }}` placeholders.
   * @returns Promise resolving `{ status, response }` (native Fetch Response).
   * @throws {VGSError} When input data invalid or URL configuration fails.
   */
  public async submit(
    path: string = '',
    method: string = 'POST',
    extraData: Record<string, any> = {},
    customRequestStructure?: Record<string, any>
  ): Promise<{ status: number; response: any } | never> {
    try {
      const { data: finalPayload, url } = await this.prepareSubmission(
        async () => {
          // Collect the input field data.
          const collectedData = await this.collectFieldData();
          // If a custom structure is provided, apply it to wrap the input data.
          const wrappedData = customRequestStructure
            ? this.applyCustomStructure(customRequestStructure, collectedData)
            : collectedData;
          // Merge non-input extraData with the wrapped input data.
          return { ...wrappedData, ...extraData };
        },
        this.BASE_VAULT_URL,
        path
      );
      const { status, response } = await this.submitDataToServer(
        url,
        method,
        finalPayload
      );
      // Log the response
      this.logger.logResponse(response);
      return { status, response };
    } catch (error) {
      throw error;
    }
  }

  public async createAliases(): Promise<{
    status: number;
    data: Record<string, string> | any;
  }> {
    try {
      return await this._handleTokenization(
        VaultAPIVersion.v2,
        this.collectFieldTokenizationData.bind(this)
      );
    } catch (error) {
      throw error;
    }
  }

  private buildCmpAPIUrl(path: string): string {
    const environment = this.environment.toLowerCase();
    const baseUrl =
      environment === 'sandbox'
        ? 'https://sandbox.vgsapi.com'
        : 'https://vgsapi.com';

    return `${baseUrl}${path}`;
  }

  private buildCmpAnalyticsData(
    operation: CmpOperation,
    extraData: Record<string, any> = {}
  ): Record<string, any> {
    const content = ['textField'];
    if (Object.keys(extraData).length > 0) {
      content.push('custom_data');
    }

    return {
      upstream: 'cmp',
      operation,
      content,
    };
  }

  private buildCmpRequestMeta() {
    return {
      _source: 'vgs-collect',
      _medium: 'rnSDK',
      ...(this.formAnalyticsDetails.sessionFormId
        ? { _formId: this.formAnalyticsDetails.sessionFormId }
        : {}),
      _version: VGSCOLLECT_SDK_VERSION,
    };
  }

  private deepMerge(
    base: Record<string, any>,
    override: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      const existingValue = result[key];
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existingValue &&
        typeof existingValue === 'object' &&
        !Array.isArray(existingValue)
      ) {
        result[key] = this.deepMerge(existingValue, value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private getErrorStatusCode(error: unknown): number {
    if (!this.isRecord(error)) {
      return 0;
    }

    const code = error.code;
    return typeof code === 'number' && Number.isFinite(code) ? code : 0;
  }

  private async getOrFetchJwt(options: {
    analyticsData?: Record<string, any>;
    authHandlerMessage: string;
    forceRefresh?: boolean;
  }): Promise<string> {
    const { analyticsData, authHandlerMessage, forceRefresh = false } = options;

    if (forceRefresh) {
      this.cachedJwtToken = undefined;
    }

    if (this.cachedJwtToken) {
      return this.cachedJwtToken;
    }

    if (!this.authHandler) {
      const error = new VGSError(
        VGSErrorCode.AuthHandlerNotSet,
        authHandlerMessage
      );
      this.trackBeforeSubmitFailure(error.code, analyticsData);
      throw error;
    }

    const authHandler = this.authHandler;
    const authHandlerGeneration = this.authHandlerGeneration;
    let token: string;

    try {
      token = await authHandler();
    } catch (error) {
      if (analyticsData) {
        this.trackBeforeSubmitFailure(
          this.getErrorStatusCode(error),
          analyticsData
        );
      }
      throw error;
    }

    const normalizedToken = this.normalizeAccessToken(token);
    this.validateAccessToken(normalizedToken, analyticsData);
    if (
      this.authHandler === authHandler &&
      this.authHandlerGeneration === authHandlerGeneration
    ) {
      this.cachedJwtToken = normalizedToken;
    }
    return normalizedToken;
  }

  private trackBeforeSubmitFailure(
    failure: number | string,
    extraData?: Record<string, any>
  ) {
    const failureData =
      typeof failure === 'number'
        ? { statusCode: failure, ...extraData }
        : { error: failure, ...extraData };

    this.analyticsClient.trackFormEvent(
      this.formAnalyticsDetails,
      AnalyticsEventType.BeforeSubmit,
      AnalyticEventStatus.Failed,
      failureData
    );
  }

  private makeCmpInputValidationError(
    requiredFields: string[],
    invalidFields: string[]
  ): VGSError {
    const details: Record<string, string[]> = {};

    if (requiredFields.length > 0) {
      details[CMP_REQUIRED_FIELDS_KEY] = requiredFields;
      this.logger.log({
        severity: VGSLogSeverity.WARNING,
        text: `CMP request validation failed. Required fields are empty or missing: ${requiredFields.join(
          ', '
        )}`,
        logLevel: VGSLogLevel.WARNING,
      });
    }

    if (invalidFields.length > 0) {
      details[CMP_INVALID_FIELDS_KEY] = invalidFields;
      this.logger.log({
        severity: VGSLogSeverity.WARNING,
        text: `CMP request validation failed. Fields did not pass validation: ${invalidFields.join(
          ', '
        )}`,
        logLevel: VGSLogLevel.WARNING,
      });
    }

    return new VGSError(
      VGSErrorCode.InputDataIsNotValid,
      'VGSCollect: Input data not valid!',
      details
    );
  }

  private collectUpdateCardAttributes(
    analyticsData: Record<string, any>,
    extraData: Record<string, any> = {}
  ): Record<string, any> {
    const unsupportedFields = Object.keys(extraData).filter(
      (fieldName) => !CMP_UPDATE_ALLOWED_FIELDS.has(fieldName)
    );
    const attributes: Record<string, any> = Object.fromEntries(
      Object.entries(extraData).filter(([fieldName]) =>
        CMP_UPDATE_ALLOWED_FIELDS.has(fieldName)
      )
    );
    const invalidFields: string[] = [...unsupportedFields];

    const cvcFieldEntry = this.getFieldEntryByType('cvc');
    if (cvcFieldEntry) {
      const [fieldName, field] = cvcFieldEntry;
      const cvcValue = this.getFieldRawValue(field).trim();
      const effectiveFieldName = fieldName || 'cvc';

      if (cvcValue && field.getValidationErrors().length > 0) {
        invalidFields.push(effectiveFieldName);
      } else if (cvcValue) {
        attributes.cvc = cvcValue;
      }
    }

    const expDateFieldEntry = this.getFieldEntryByType('expDate');
    if (expDateFieldEntry) {
      const [fieldName, field] = expDateFieldEntry;
      const expDateValue = this.getFieldRawValue(field).trim();
      const effectiveFieldName = fieldName || 'expDate';

      if (expDateValue) {
        if (field.getValidationErrors().length > 0) {
          invalidFields.push(effectiveFieldName);
        } else {
          const parsedExpiration = this.parseUpdateCardExpiration(expDateValue);
          if (!parsedExpiration) {
            invalidFields.push(effectiveFieldName);
          } else {
            attributes.exp_month = parsedExpiration.month;
            attributes.exp_year = parsedExpiration.year;
          }
        }
      }
    }

    if (invalidFields.length > 0) {
      const error = this.makeCmpInputValidationError([], invalidFields);
      this.trackBeforeSubmitFailure(error.code, analyticsData);
      throw error;
    }

    if (Object.keys(attributes).length === 0) {
      const error = this.makeCmpInputValidationError(
        ['cvc, exp_month, or exp_year'],
        []
      );
      this.trackBeforeSubmitFailure(error.code, analyticsData);
      throw error;
    }

    return attributes;
  }

  private parseUpdateCardExpiration(
    value: string
  ): { month: number; year: number } | null {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 4) {
      return null;
    }

    const month = Number.parseInt(digits.slice(0, 2), 10);
    const year = Number.parseInt(digits.slice(2), 10);

    if (!Number.isInteger(month) || !Number.isInteger(year)) {
      return null;
    }

    return {
      month,
      year,
    };
  }

  private getFieldEntryByType(
    inputType: string
  ): [string, FieldConfig] | undefined {
    return Object.entries(this.fields).find(
      ([, field]) => field && field.type === inputType
    );
  }

  private getFieldRawValue(field: FieldConfig): string {
    const rawValue = field.getRawValue?.();
    if (typeof rawValue === 'string') {
      return rawValue;
    }

    const submitValue = field.getSubmitValue();
    if (typeof submitValue === 'string') {
      return submitValue;
    }

    if (submitValue && typeof submitValue === 'object') {
      const expMonth = submitValue.exp_month;
      const expYear = submitValue.exp_year;
      if (typeof expMonth === 'string' && typeof expYear === 'string') {
        return `${expMonth}${expYear}`;
      }
    }

    return '';
  }

  private redactHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    return {
      ...headers,
      Authorization: headers.Authorization ? 'Bearer [REDACTED]' : '',
    };
  }

  private redactCmpPayload(payload: Record<string, any>): Record<string, any> {
    const redactedPayload = {
      ...payload,
      data:
        payload.data && typeof payload.data === 'object'
          ? {
              ...payload.data,
              attributes: this.redactAttributeValues(
                payload.data.attributes ?? {}
              ),
            }
          : payload.data,
    };

    return redactedPayload;
  }

  private redactAttributeValues(attributes: Record<string, any>) {
    return Object.fromEntries(
      Object.entries(attributes).map(([key]) => [key, '[REDACTED]'])
    );
  }

  private isAuthFailureStatus(status: number): boolean {
    return status === 401 || status === 403;
  }

  private normalizeAccessToken(token: unknown): string {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    return normalizedToken.replace(/^Bearer(?:\s+|$)/i, '').trim();
  }

  private buildAuthorizationHeader(token: string): string {
    return `Bearer ${token}`;
  }

  private normalizeCardId(cardId: string): string | null {
    const normalizedCardId = cardId.trim();
    if (
      !normalizedCardId ||
      normalizedCardId.includes('/') ||
      normalizedCardId === '.' ||
      normalizedCardId === '..'
    ) {
      return null;
    }
    return normalizedCardId;
  }

  private parseCmpInteger(
    value: unknown,
    minimum: number,
    maximum: number
  ): number | null {
    const normalizedValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d+$/.test(value)
          ? Number.parseInt(value, 10)
          : Number.NaN;

    return Number.isInteger(normalizedValue) &&
      normalizedValue >= minimum &&
      normalizedValue <= maximum
      ? normalizedValue
      : null;
  }

  private buildCreateCardAttributes(
    fieldValues: Record<string, any>,
    extraData: Record<string, any>,
    analyticsData: Record<string, any>
  ): Record<string, any> {
    const attributes = this.deepMerge({}, extraData);
    const requiredFields: string[] = [];
    const invalidFields: string[] = [];
    const pan = fieldValues.pan;
    const expMonth = this.parseCmpInteger(fieldValues.exp_month, 1, 12);
    const expYear = this.parseCmpInteger(fieldValues.exp_year, 0, 99);

    for (const fieldName of CMP_CREATE_REQUIRED_FIELDS) {
      if (fieldValues[fieldName] === undefined || fieldValues[fieldName] === '') {
        requiredFields.push(fieldName);
      }
    }

    if (pan !== undefined && (typeof pan !== 'string' || pan.trim() === '')) {
      invalidFields.push('pan');
    }
    if (fieldValues.exp_month !== undefined && expMonth === null) {
      invalidFields.push('exp_month');
    }
    if (fieldValues.exp_year !== undefined && expYear === null) {
      invalidFields.push('exp_year');
    }

    if (requiredFields.length > 0 || invalidFields.length > 0) {
      const error = this.makeCmpInputValidationError(
        requiredFields,
        invalidFields
      );
      this.trackBeforeSubmitFailure(error.code, analyticsData);
      throw error;
    }

    attributes.pan = pan;
    attributes.exp_month = expMonth;
    attributes.exp_year = expYear;
    if (fieldValues.cvc !== undefined) {
      attributes.cvc = fieldValues.cvc;
    }
    if (fieldValues.cardholder !== undefined) {
      const cardholder =
        attributes.cardholder &&
        typeof attributes.cardholder === 'object' &&
        !Array.isArray(attributes.cardholder)
          ? { ...attributes.cardholder }
          : {};
      cardholder.name = fieldValues.cardholder;
      attributes.cardholder = cardholder;
    }

    return attributes;
  }

  private buildCreateCardPayload(
    fieldValues: Record<string, any>,
    extraData: Record<string, any>,
    analyticsData: Record<string, any>
  ): Record<string, any> {
    const wrappedData = this.isRecord(extraData.data) ? extraData.data : null;
    const wrappedAttributes =
      wrappedData && this.isRecord(wrappedData.attributes)
        ? wrappedData.attributes
        : null;
    const attributeExtraData = wrappedData
      ? (wrappedAttributes ?? {})
      : extraData;
    const sdkPayload = {
      data: {
        attributes: this.buildCreateCardAttributes(
          fieldValues,
          attributeExtraData,
          analyticsData
        ),
        meta: this.buildCmpRequestMeta(),
      },
    };

    return wrappedData ? this.deepMerge(extraData, sdkPayload) : sdkPayload;
  }

  /**
   * Creates a card via Card Management API with explicit JWT token.
   * Prefer createCard() with authHandler when automatic token management is wanted.
   *
   * @param token - JWT Access token (`Authorization: Bearer <token>`).
   * @param extraData - Optional attributes, or a legacy `{ data: { attributes } }` envelope.
   * @returns Promise resolving `{ status, response }` (native Fetch Response).
   * @throws {VGSError} If access token invalid or inputs fail validation.
   */
  public async createCardWithToken(
    token: string,
    extraData?: Record<string, any>
  ): Promise<{ status: number; response: any }> {
    return this.performCreateCard(token, extraData ?? {});
  }

  /**
   * Creates a card via Card Management API. The object form uses authHandler;
   * the legacy string form uses the supplied token without caching or refresh.
   *
   * @param extraData - Optional attributes, or a legacy `{ data: { attributes } }` envelope.
   * @param token - Legacy explicit JWT token overload.
   * @returns Promise resolving `{ status, response }` (native Fetch Response).
   * @throws {VGSError} If authHandler not set, inputs fail validation, or request fails.
   */
  public async createCard(
    extraData?: Record<string, any>
  ): Promise<{ status: number; response: any }>;
  public async createCard(
    token: string,
    extraData?: Record<string, any>
  ): Promise<{ status: number; response: any }>;
  public async createCard(
    tokenOrExtraData?: string | Record<string, any>,
    extraData?: Record<string, any>
  ): Promise<{ status: number; response: any }> {
    if (typeof tokenOrExtraData === 'string') {
      return this.createCardWithToken(tokenOrExtraData, extraData);
    }

    return this.createCardWithAuthHandler(tokenOrExtraData ?? {});
  }

  /**
   * Internal method to create card using authHandler with automatic token refresh on expiration.
   */
  private async createCardWithAuthHandler(
    extraData: Record<string, any>
  ): Promise<{ status: number; response: any }> {
    const analyticsData = this.buildCmpAnalyticsData('cardCreate', extraData);
    const requestSnapshot: CmpRequestSnapshot = {};
    const token = await this.getOrFetchJwt({
      analyticsData,
      authHandlerMessage:
        'authHandler is required for createCard(). Set it via setAuthHandler() or provide token directly.',
    });
    const result = await this.performCreateCard(
      token,
      extraData,
      requestSnapshot
    );

    if (this.isAuthFailureStatus(result.status)) {
      const refreshedToken = await this.getOrFetchJwt({
        analyticsData,
        forceRefresh: true,
        authHandlerMessage:
          'authHandler is required for createCard(). Set it via setAuthHandler() or provide token directly.',
      });
      return this.performCreateCard(
        refreshedToken,
        extraData,
        requestSnapshot
      );
    }

    return result;
  }

  /**
   * Internal method to perform the actual card creation request.
   */
  private async performCreateCard(
    token: string,
    extraData: Record<string, any>,
    requestSnapshot: CmpRequestSnapshot = {}
  ): Promise<{ status: number; response: any }> {
    const analyticsData = this.buildCmpAnalyticsData('cardCreate', extraData);
    const normalizedToken = this.normalizeAccessToken(token);
    this.validateAccessToken(normalizedToken, analyticsData);
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      'Authorization': this.buildAuthorizationHeader(normalizedToken),
    };
    if (!requestSnapshot.payload) {
      this.validateFields(analyticsData);
      const fieldsData = await this.collectFieldData();
      requestSnapshot.payload = this.buildCreateCardPayload(
        fieldsData,
        extraData,
        analyticsData
      );
    }
    const submitData = requestSnapshot.payload;
    const url = this.buildCmpAPIUrl(CardManagementAPIPath.Cards);
    return this.submitDataToServer(url, 'POST', submitData, analyticsData, {
      requestHeaders: headers,
      logOverrides: {
        headers: this.redactHeaders(headers),
        payload: this.redactCmpPayload(submitData),
      },
    });
  }

  /**
   * Updates an existing card via Card Management API using authHandler for JWT token.
   * Only `cvc`, `exp_month`, and `exp_year` are accepted update attributes.
   * Automatically retries once with a refreshed token on 401/403.
   */
  public async updateCard(
    cardId: string,
    extraData: Record<string, any> = {}
  ): Promise<{ status: number; response: any }> {
    const analyticsData = this.buildCmpAnalyticsData('cardUpdate', extraData);
    const requestSnapshot: CmpRequestSnapshot = {};
    const normalizedCardId = this.normalizeCardId(cardId);

    if (!normalizedCardId) {
      const error = this.makeCmpInputValidationError(['cardId'], []);
      throw error;
    }

    const token = await this.getOrFetchJwt({
      analyticsData,
      authHandlerMessage:
        'authHandler is required for updateCard(). Set it via setAuthHandler().',
    });
    const result = await this.performUpdateCard(
      normalizedCardId,
      token,
      extraData,
      requestSnapshot
    );

    if (this.isAuthFailureStatus(result.status)) {
      const refreshedToken = await this.getOrFetchJwt({
        analyticsData,
        forceRefresh: true,
        authHandlerMessage:
          'authHandler is required for updateCard(). Set it via setAuthHandler().',
      });
      return this.performUpdateCard(
        normalizedCardId,
        refreshedToken,
        extraData,
        requestSnapshot
      );
    }

    return result;
  }

  /** Updates an existing card using an explicit token without caching it. */
  public async updateCardWithToken(
    cardId: string,
    token: string,
    extraData: Record<string, any> = {}
  ): Promise<{ status: number; response: any }> {
    const normalizedCardId = this.normalizeCardId(cardId);
    if (!normalizedCardId) {
      const error = this.makeCmpInputValidationError(['cardId'], []);
      throw error;
    }
    return this.performUpdateCard(normalizedCardId, token, extraData);
  }

  private async performUpdateCard(
    cardId: string,
    token: string,
    extraData: Record<string, any> = {},
    requestSnapshot: CmpRequestSnapshot = {}
  ): Promise<{ status: number; response: any }> {
    const analyticsData = this.buildCmpAnalyticsData('cardUpdate', extraData);
    const normalizedToken = this.normalizeAccessToken(token);
    this.validateAccessToken(normalizedToken, analyticsData);
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      'Authorization': this.buildAuthorizationHeader(normalizedToken),
    };
    if (!requestSnapshot.payload) {
      const attributes = this.collectUpdateCardAttributes(
        analyticsData,
        extraData
      );
      requestSnapshot.payload = {
        data: { attributes },
      };
    }
    const submitData = requestSnapshot.payload;
    const url = this.buildCmpAPIUrl(
      `${CardManagementAPIPath.Cards}/${encodeURIComponent(cardId)}`
    );

    return this.submitDataToServer(url, 'PATCH', submitData, analyticsData, {
      requestHeaders: headers,
      logOverrides: {
        headers: this.redactHeaders(headers),
        payload: this.redactCmpPayload(submitData),
      },
    });
  }

  /**
   * Tokenizes fields configured with `tokenizationConfig` using Vault API v1.
   * Returns an alias map keyed by original field names (and serializer sub-keys).
   *
   * @returns Promise resolving `{ status, data }`, where `data` is alias mapping.
   */
  public async tokenize(): Promise<{
    status: number;
    data: Record<string, string> | any;
  }> {
    try {
      return await this._handleTokenization(
        VaultAPIVersion.v1,
        this.collectFieldTokenizationData.bind(this)
      );
    } catch (error) {
      throw error;
    }
  }

  private async _handleTokenization(
    apiVersion: VaultAPIVersion,
    collectedDataFetcher: () => Promise<{
      collectedData: any[];
      fieldMappings: TokenizationFieldMapping[];
    }>
  ): Promise<{ status: number; data: Record<string, string> | any } | never> {
    const apiPath = getVaultAPIPath(apiVersion);
    const { collectedData, fieldMappings } = await collectedDataFetcher();
    const { url } = await this.prepareSubmission(
      () => Promise.resolve({ data: collectedData }),
      this.BASE_VAULT_URL,
      apiPath
    );

    if (collectedData.length === 0) {
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.Submit,
        AnalyticEventStatus.Success,
        { statusCode: 200 }
      );
      this.logger.log({
        logLevel: VGSLogLevel.WARNING,
        text: 'No data to tokenize!',
        severity: VGSLogSeverity.WARNING,
      });
      return { status: 200, data: {} };
    }

    const upstreamData =
      apiVersion === VaultAPIVersion.v1 ? 'tokenization' : 'vaultApi';
    const { status, response } = await this.submitDataToServer(
      url,
      'POST',
      {
        data: collectedData,
      },
      { upstream: upstreamData }
    );

    if (!response.ok) {
      this.logger.logTokenizationResponse(response, {});
      return { status, data: response };
    }

    const responseJson = await response.json();
    const result = this.parseTokenizationResponse(responseJson, fieldMappings);
    this.logger.logTokenizationResponse(response, result);
    return { status, data: result };
  }

  /**
   *  Collects submit data form fields, handling asynchronous operations.
   * @returns {Promise<Record<string, any>>} An object containing the field data.
   */
  private async collectFieldData(): Promise<Record<string, any>> {
    const collectedData: Record<string, any> = {};

    for (const fieldName in this.fields) {
      const field = this.fields[fieldName];
      if (!field) continue;
      const submitValue = field.getSubmitValue();
      if (typeof submitValue === 'object' && submitValue !== null) {
        Object.assign(collectedData, submitValue);
      } else if (submitValue !== undefined) {
        collectedData[fieldName] = submitValue;
      }
    }
    return collectedData;
  }

  // Helper method for preparing a submission
  private async prepareSubmission<T>(
    dataCollector: () => Promise<T>,
    baseUrl: string,
    path: string
  ): Promise<{ data: T; url: string }> {
    const data = await dataCollector();
    // Will throw VGSError if validation fails
    this.validateFields();
    await this.awaitCnameValidation();
    const url = this.buildUrl(baseUrl, path);
    return { data, url };
  }

  // Helper method for checking if CNAME validation is in progress
  private async awaitCnameValidation() {
    if (this.isCnameValidating && this.cnameValidationPromise) {
      await this.cnameValidationPromise;
    }
  }

  /**
   *  Collects data from fields with tokenization config, handling asynchronous operations.
   * @returns {Promise<Record<string, any>>} An object containing the field data.
   */
  private async collectFieldTokenizationData(): Promise<{
    collectedData: Array<Record<string, any>>; // an array of field data objects
    fieldMappings: TokenizationFieldMapping[];
  }> {
    const collectedData: Array<Record<string, any>> = [];
    const fieldMappings: TokenizationFieldMapping[] = [];

    for (const fieldName in this.fields) {
      const field = this.fields[fieldName];
      if (!field || field.tokenizationConfig === undefined) continue;

      const submitValue = field.getSubmitValue();

      if (typeof submitValue === 'object' && submitValue !== null) {
        // For fields with a serializer, iterate over its keys.
        for (const key in submitValue) {
          const config = field.tokenizationConfig;
          const fieldData = {
            value: submitValue[key],
            storage: config.storage,
            format: config.format,
          };
          collectedData.push(fieldData);
          // Store a mapping that keeps track of the parent field and the specific sub-key.
          fieldMappings.push({ key, fieldName });
        }
      } else {
        // For simple fields, use the field name as both.
        const config = field.tokenizationConfig;
        const fieldData = {
          value: submitValue,
          storage: config.storage,
          format: config.format,
        };
        collectedData.push(fieldData);
        fieldMappings.push({ key: fieldName, fieldName });
      }
    }
    return { collectedData, fieldMappings };
  }

  private parseTokenizationResponse(
    responseJson: any,
    fieldMappings: TokenizationFieldMapping[]
  ): Record<string, string> {
    const tokenizedData: Record<string, string> = {};
    responseJson.data.forEach((item: any, index: number) => {
      const mapping = fieldMappings[index];
      if (mapping) {
        // Get the tokenization config from the registered field
        const config = this.fields[mapping.fieldName]?.tokenizationConfig;
        const requestedFormat = config?.format;
        // Find the alias for the requested format
        const alias = item.aliases.find(
          (a: any) => a.format === requestedFormat
        )?.alias;
        if (alias) {
          // Use the mapping key (which might be a sub-key like "month") as the output key.
          tokenizedData[mapping.key] = alias;
        }
      }
    });
    return tokenizedData;
  }

  /**
   * Validates all registered fields via `getValidationErrors()`.
   * Throws `VGSError` with `VGSErrorCode.InputDataIsNotValid` when any field has errors.
   */
  private validateFields(analyticsData?: Record<string, any>) {
    const errors: Record<string, string[]> = {};
    for (const fieldName in this.fields) {
      const field = this.fields[fieldName];
      if (!field) continue;

      const validationErrors = field.getValidationErrors();
      if (validationErrors.length > 0) {
        errors[fieldName] = validationErrors;
      }
    }
    if (Object.keys(errors).length > 0) {
      const errorCode = VGSErrorCode.InputDataIsNotValid;
      this.trackBeforeSubmitFailure(errorCode, analyticsData);
      this.logger.log({
        severity: VGSLogSeverity.WARNING,
        text: `Input data not valid in fields: ${Object.keys(errors)}`,
        logLevel: VGSLogLevel.WARNING,
      });
      throw new VGSError(
        errorCode,
        'VGSCollect: Input data not valid!',
        errors
      );
    }
  }

  /**
   * Validates the Card Management access token.
   * Throws `VGSError` with `VGSErrorCode.IvalidAccessToken` if empty.
   */
  private validateAccessToken(
    token: string,
    analyticsData?: Record<string, any>
  ): void {
    if (token.length > 0) {
      return;
    }

    const errorCode = VGSErrorCode.IvalidAccessToken;
    this.trackBeforeSubmitFailure(errorCode, analyticsData);
    this.logger.log({
      severity: VGSLogSeverity.ERROR,
      text: `Access token is required for authenticated CMP request.`,
      logLevel: VGSLogLevel.WARNING,
    });
    throw new VGSError(errorCode, 'VGSCollect: Access token is null or empty!');
  }

  /**
   * Performs the HTTP request using `fetch` and tracks analytics.
   *
   * @param url - Absolute destination URL.
   * @param method - HTTP method.
   * @param data - JSON payload to send.
   * @param analyticsData - Optional context for analytics (e.g., upstream type).
   * @returns Promise resolving `{ status, response }`.
   * @throws Propagates network errors after analytics tracking.
   */
  private async submitDataToServer(
    url: string,
    method: string,
    data: Record<string, any>,
    analyticsData?: Record<string, any>,
    options?: {
      requestHeaders?: Record<string, string>;
      logOverrides?: RequestLogOverrides;
    }
  ): Promise<{ status: number; response: any } | never> {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...VGSAnalyticsClient.getInstance().collectHTTPHeaders,
        ...this.customHeaders,
        ...options?.requestHeaders,
      };
      this.logger.logRequest(
        url,
        options?.logOverrides?.headers ?? headers,
        options?.logOverrides?.payload ?? data
      );
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Success,
        { statusCode: 200, ...analyticsData }
      );
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(data),
      });
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.Submit,
        response.ok ? AnalyticEventStatus.Success : AnalyticEventStatus.Failed,
        {
          statusCode: response.status,
          ...(!response.ok && analyticsData?.upstream === 'cmp'
            ? { error: 'request_failed' }
            : {}),
          ...analyticsData,
        }
      );
      return { status: response.status, response };
    } catch (error) {
      const errorMessage = 'transport_error';
      this.logger.logRequestError(
        error instanceof Error ? error : new Error(errorMessage),
        url,
        options?.logOverrides?.headers ?? options?.requestHeaders ?? {},
        options?.logOverrides?.payload ?? data
      );
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.Submit,
        AnalyticEventStatus.Failed,
        {
          statusCode: this.getErrorStatusCode(error),
          error: errorMessage,
          ...analyticsData,
        }
      );
      throw error;
    }
  }

  BASE_VAULT_URL = 'verygoodproxy.com';
  private buildUrl(baseDomain: string, path: string = ''): string {
    const baseUrl = this.cname
      ? `https://${this.cname.replace(/\/+$/, '')}`
      : `https://${this.getBaseUrl(baseDomain)}`;

    const normalizedPath = path.replace(/^\/+/, '');
    const resultUrl = `${baseUrl}/${normalizedPath}`;
    const parsedUrl = this.parseURL(resultUrl);

    if (parsedUrl) {
      // Return a canonical URL so reserved chars are encoded, not stripped.
      let canonicalUrl = parsedUrl.toString();
      if (!resultUrl.endsWith('/') && canonicalUrl.endsWith('/')) {
        canonicalUrl = canonicalUrl.slice(0, -1);
      }
      return canonicalUrl;
    } else {
      throw new VGSError(VGSErrorCode.InvalidConfigurationURL, 'Invalid URL', {
        URL: resultUrl,
      });
    }
  }

  private getBaseUrl(baseDomain: string): string {
    const defaultBaseDomain = baseDomain || this.BASE_VAULT_URL;
    if (defaultBaseDomain === this.BASE_VAULT_URL && this.routeId) {
      return `${this.tenantId}-${this.routeId}.${this.environment}.${defaultBaseDomain}`;
    }
    return `${this.tenantId}.${this.environment}.${defaultBaseDomain}`;
  }

  private parseURL(string: string): URL | null {
    try {
      return new URL(string);
    } catch (error) {
      return null;
    }
  }

  getFieldRules(fieldName: string): ValidationRule[] | undefined {
    return this.fields[fieldName]?.validationRules;
  }

  /**
   * Returns a comparator function for a specific field.
   * Allows secure equality checks without exposing raw values.
   * Intended for `MatchFieldRule` use.
   *
   * @param fieldName - Field to compare against.
   * @returns Function accepting a value and returning boolean equality.
   */
  getFieldComparator(fieldName: string): (value: string) => boolean {
    return (value: string) => {
      const field = this.fields[fieldName];
      if (!field) return false;
      const otherValue = field.getSubmitValue();
      if (typeof otherValue !== 'string') return false;
      return value === otherValue;
    };
  }
  /**
   * Bulk-updates all fields of a given `type` with new mask/rules.
   * Triggers each field's `updateCallback` for UI synchronization.
   *
   * @param type - Field type string (e.g., `cvc`).
   * @param config - New mask and/or validation rules to apply.
   */
  updateFieldByType(
    type: string,
    config: { mask?: string; validationRules?: ValidationRule[] }
  ) {
    for (const fieldName in this.fields) {
      if (this.fields[fieldName]?.type === type) {
        // Update the field's config internally
        this.fields[fieldName] = {
          ...this.fields[fieldName],
          ...config,
        };
        // Invoke the update callback to notify the VGSTextInput component
        this.fields[fieldName].updateCallback?.(config);
      }
    }
  }
  /**
   * Adjusts all `cvc` fields when card brand changes.
   * Uses brand-specific CVC lengths to set mask and validation rules.
   *
   * @param brandName - Detected payment card brand name.
   */
  updateCvcFieldForBrand(brandName: string) {
    const manager = PaymentCardBrandsManager.getInstance();
    const brand = manager.getBrandByName(brandName);
    if (!brand) return;

    // E.g., brand.cvcLengths = [3,4] for some cards
    const cvcLengths = brand.cvcLengths ?? [3];
    const minLen = Math.min(...cvcLengths);
    const maxLen = Math.max(...cvcLengths);

    // Decide on mask (#=digit)
    const cvcMask = maxLen === 4 ? `####` : `###`;

    // Example: length rule, numeric pattern rule, required, etc.
    const cvcRules: ValidationRule[] = [
      new PatternRule(`\\d*$`, `CVC must be numeric.`),
      new LengthRule(minLen, maxLen, `CVC length not valid.`),
    ];

    // Update EVERY field whose type is "cvc"
    this.updateFieldByType(`cvc`, {
      mask: cvcMask,
      validationRules: cvcRules,
    });
  }

  /**
   * Finds the first registered field name for the given `type`.
   *
   * @param inputType - Field type to search for.
   * @returns Matching field name or `undefined`.
   */
  findFieldNameByType(inputType: string): string | undefined {
    return this.getFieldEntryByType(inputType)?.[0];
  }

  /**
   * Recursively applies a custom structure template to the collected sensitive data.
   * It replaces any placeholder string matching the pattern {{ fieldName }}
   * with the corresponding value from the sensitiveData.
   *
   * @param template - The custom JSON structure template.
   * @param sensitiveData - The object containing collected sensitive fields.
   * @returns The final object with the placeholders replaced by actual values.
   */
  private applyCustomStructure(
    template: any,
    sensitiveData: Record<string, any>
  ): any {
    if (typeof template === 'string') {
      return template.replace(/{{\s*(\w+)\s*}}/g, (_match, fieldName) => {
        return sensitiveData[fieldName] !== undefined
          ? sensitiveData[fieldName]
          : '';
      });
    } else if (Array.isArray(template)) {
      return template.map((item) =>
        this.applyCustomStructure(item, sensitiveData)
      );
    } else if (typeof template === 'object' && template !== null) {
      const result: any = {};
      for (const key in template) {
        result[key] = this.applyCustomStructure(template[key], sensitiveData);
      }
      return result;
    }
    return template;
  }

  // MARK: - Card Attributes Lookup

  /**
   * Entry point invoked when a card field's raw input changes.
   * Triggers lookup at 11 digits if includedCardAttributes is configured.
   *
   * @param rawInput - Raw card number string (digits only).
   */
  private handlePotentialCardAttributesLookup(
    fieldName: string | undefined,
    rawInput: string
  ) {
    if (this.includedCardAttributes.length === 0) {
      return;
    }

    const digitsOnly = rawInput.replace(/\D/g, '');

    if (digitsOnly.length < 11) {
      if (this.inFlightDigits11) {
        delete this.lookupStartedAt[this.inFlightDigits11];
      }
      this.requestedDigits11 = undefined;
      this.inFlightDigits11 = undefined;
      return;
    }

    if (!fieldName || this.findFieldNameByType('card') !== fieldName) {
      return;
    }

    const first11 = digitsOnly.slice(0, 11);

    if (
      this.requestedDigits11 === first11 ||
      this.inFlightDigits11 === first11
    ) {
      return;
    }

    this.requestedDigits11 = first11;
    this.inFlightDigits11 = first11;
    this.lookupStartedAt[first11] = Date.now();
    this.willBeginCardAttributesLookup?.();

    void this.performCardAttributesRequest(first11);
  }

  /**
   * Performs card attributes lookup request to enrichment API.
   *
   * @param digits11 - First 11 digits of card number.
   */
  private async performCardAttributesRequest(
    digits11: string,
    isRetry: boolean = false
  ): Promise<void> {
    const requestUrl = this.buildCardAttributesLookupUrl();
    const payload = {
      number: digits11,
      filter: this.includedCardAttributes,
    };
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const logHeaders = this.redactHeaders({
      ...baseHeaders,
      Authorization: 'Bearer [REDACTED]',
    });
    const logPayload = {
      ...payload,
      number: '[REDACTED]',
    };
    let headers = baseHeaders;

    try {
      const token = await this.getOrFetchJwt({
        authHandlerMessage:
          'authHandler is required for card attributes lookup.',
        forceRefresh: isRetry,
      });
      headers = {
        ...baseHeaders,
        Authorization: this.buildAuthorizationHeader(token),
      };
    } catch (error) {
      const lookupError =
        error instanceof VGSError
          ? error
          : new VGSError(
              VGSErrorCode.IvalidAccessToken,
              `Auth handler failed to provide token: ${
                error instanceof Error ? error.message : 'Unknown auth error.'
              }`,
              { error }
            );
      this.finishLookupIfCurrent(
        digits11,
        this.makeLookupFailureResponse(lookupError)
      );
      return;
    }

    this.logger.log({
      severity: VGSLogSeverity.WARNING,
      text: `Card attributes lookup request method: POST`,
      logLevel: VGSLogLevel.WARNING,
    });
    this.logger.logRequest(requestUrl, logHeaders, logPayload);

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!isResponseLike(response)) {
        const error = new VGSError(
          VGSErrorCode.UnexpectedResponseType,
          'Card attributes lookup response is invalid.'
        );
        this.finishLookupIfCurrent(
          digits11,
          this.makeLookupFailureResponse(error, response)
        );
        return;
      }

      const parsedData = await this.readResponseBody(response);

      if (!response.ok) {
        if (!isRetry && this.isAuthFailureStatus(response.status)) {
          this.cachedJwtToken = undefined;
          return this.performCardAttributesRequest(digits11, true);
        }
        this.finishLookupIfCurrent(
          digits11,
          this.makeLookupFailureResponse(
            undefined,
            response,
            parsedData,
            response.status
          )
        );
        return;
      }

      const attributes = this.parseCardAttributesResponse(parsedData);
      if (!attributes) {
        const error = new VGSError(
          VGSErrorCode.UnexpectedResponseDataFormat,
          'Card attributes lookup response has invalid data shape.'
        );
        this.finishLookupIfCurrent(
          digits11,
          this.makeLookupFailureResponse(error, response, parsedData)
        );
        return;
      }

      this.finishLookupIfCurrent(
        digits11,
        {
          type: 'success',
          status: response.status,
          data: attributes,
          response,
        },
        attributes
      );
    } catch (error) {
      const lookupError =
        error instanceof Error
          ? error
          : new Error('Card attributes lookup request failed.');
      this.logger.logRequestError(
        lookupError,
        requestUrl,
        logHeaders,
        logPayload
      );
      this.finishLookupIfCurrent(
        digits11,
        this.makeLookupFailureResponse(lookupError)
      );
    }
  }

  private makeLookupFailureResponse(
    error?: unknown,
    response?: any,
    data?: unknown,
    statusOverride?: number
  ): VGSCardAttributesLookupResponse {
    if (error instanceof VGSError) {
      return {
        type: 'failure',
        status: error.code,
        data,
        response,
        error,
      };
    }

    if (error instanceof Error) {
      const maybeErrorCode = (error as Error & { code?: number }).code;
      const errorCode =
        typeof maybeErrorCode === 'number'
          ? maybeErrorCode
          : (statusOverride ?? 0);
      return {
        type: 'failure',
        status: errorCode,
        data,
        response,
        error,
      };
    }

    return {
      type: 'failure',
      status:
        statusOverride ?? (isResponseLike(response) ? response.status : 0),
      data,
      response,
    };
  }

  private async readResponseBody(response: {
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
    clone?: () => any;
  }): Promise<unknown> {
    const jsonReader =
      typeof response.clone === 'function' ? response.clone() : response;

    if (typeof jsonReader.json === 'function') {
      try {
        return await jsonReader.json();
      } catch {
        // Try reading the body as text to preserve non-JSON error payloads.
      }
    }

    const textReader =
      typeof response.clone === 'function' ? response.clone() : response;

    if (typeof textReader.text === 'function') {
      try {
        return await textReader.text();
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private parseCardAttributesResponse(data: unknown): VGSCardAttributes | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    if (Object.keys(data).length === 0) {
      return null;
    }

    return data as VGSCardAttributes;
  }

  private trackCardLookupEvent(
    response: VGSCardAttributesLookupResponse,
    startedAt?: number
  ) {
    this.analyticsClient.trackFormEvent(
      this.formAnalyticsDetails,
      AnalyticsEventType.CardLookup,
      response.type === 'success'
        ? AnalyticEventStatus.Success
        : AnalyticEventStatus.Failed,
      {
        error: this.cardLookupAnalyticsError(response),
        statusCode: this.cardLookupAnalyticsStatusCode(response),
        latency:
          typeof startedAt === 'number'
            ? Math.max(Date.now() - startedAt, 0)
            : 0,
      }
    );
  }

  private cardLookupAnalyticsStatusCode(
    response: VGSCardAttributesLookupResponse
  ): number | null {
    return isResponseLike(response.response) ? response.response.status : null;
  }

  private cardLookupAnalyticsError(
    response: VGSCardAttributesLookupResponse
  ): string {
    if (response.type === 'success') {
      return '';
    }
    if (isResponseLike(response.response) && !response.response.ok) {
      return 'http_error';
    }
    if (response.error instanceof VGSError) {
      return 'invalid_response';
    }
    if (response.error instanceof Error) {
      return 'network_error';
    }
    return 'unknown_error';
  }

  private buildLookupError(response: VGSCardAttributesLookupResponse): Error {
    if (response.type === 'failure' && response.error) {
      return response.error;
    }

    return new Error(
      `Card attributes lookup failed with status: ${response.status}`
    );
  }

  private clearLookupState() {
    this.inFlightDigits11 = undefined;
  }

  private buildCardAttributesLookupUrl(): string {
    if (VGSCollect.cardAttributesLookupEndpointOverride === 'sandbox') {
      return VGSCollect.CARD_ATTRIBUTES_LOOKUP_SANDBOX_URL;
    }
    if (VGSCollect.cardAttributesLookupEndpointOverride === 'production') {
      return VGSCollect.CARD_ATTRIBUTES_LOOKUP_PRODUCTION_URL;
    }
    return this.environment.startsWith('live')
      ? VGSCollect.CARD_ATTRIBUTES_LOOKUP_PRODUCTION_URL
      : VGSCollect.CARD_ATTRIBUTES_LOOKUP_SANDBOX_URL;
  }

  /**
   * Validates and delivers lookup result only if request is still current.
   * Guards against race conditions when user edits card number during lookup.
   *
   * @param digits11 - First 11 digits from original request.
   * @param lookupResponse - Success or failure response payload.
   * @param attributes - Card attributes if lookup succeeded.
   */
  private finishLookupIfCurrent(
    digits11: string,
    lookupResponse: VGSCardAttributesLookupResponse,
    attributes?: VGSCardAttributes
  ): void {
    const startedAt = this.lookupStartedAt[digits11];
    delete this.lookupStartedAt[digits11];

    if (this.inFlightDigits11 !== digits11) {
      return;
    }

    const cardField = this.getFieldEntryByType('card')?.[1];
    if (!cardField) {
      this.clearLookupState();
      return;
    }

    const currentDigitsOnly = this.getFieldRawValue(cardField).replace(
      /\D/g,
      ''
    );
    if (
      currentDigitsOnly.length < 11 ||
      currentDigitsOnly.slice(0, 11) !== digits11
    ) {
      this.clearLookupState();
      return;
    }

    this.trackCardLookupEvent(lookupResponse, startedAt);
    this.clearLookupState();

    try {
      this.cardAttributesLookupResponse?.(lookupResponse);
    } catch (callbackError) {
      this.logger.log({
        severity: VGSLogSeverity.WARNING,
        text: `Card attributes response callback details: ${String(
          callbackError
        )}`,
        logLevel: VGSLogLevel.WARNING,
      });
    }

    if (lookupResponse.type === 'failure') {
      try {
        this.didFailToRetrieveCardAttributes?.(
          this.buildLookupError(lookupResponse)
        );
      } catch (callbackError) {
        this.logger.log({
          severity: VGSLogSeverity.WARNING,
          text: `Card attributes failure callback details: ${String(
            callbackError
          )}`,
          logLevel: VGSLogLevel.WARNING,
        });
      }
      return;
    }

    if (!attributes) {
      return;
    }

    try {
      this.didRetrieveCardAttributes?.(attributes);
    } catch (callbackError) {
      this.logger.log({
        severity: VGSLogSeverity.WARNING,
        text: `Card attributes success callback details: ${String(
          callbackError
        )}`,
        logLevel: VGSLogLevel.WARNING,
      });
    }
  }

  /**
   * Validates form parameter format.
   * @param form - Form identifier to validate.
   * @throws {VGSError} If form is invalid.
   */
  private static validateForm(form: string) {
    const pattern = /^[A-Za-z0-9_-]+$/;
    if (
      !form ||
      typeof form !== 'string' ||
      form.length > 50 ||
      !pattern.test(form)
    ) {
      throw new VGSError(
        VGSErrorCode.InvalidFormConfiguration,
        'VGSCollect.session() Error: Invalid form parameter!'
      );
    }
  }

  private static getCollectS3FileName(form: string): string {
    return VGSCollect.encodeUtf8Hex(form);
  }

  private static normalizeSessionForm(form: string) {
    const normalizedForm = form.trim();
    return normalizedForm.length > 0 ? normalizedForm : null;
  }

  private static buildSessionConfigUrl(form: string, vaultId: string): string {
    const configFileName = VGSCollect.getCollectS3FileName(form);
    return `https://js.verygoodvault.com/session-configuration/${vaultId}/${configFileName}.json`;
  }

  private static encodeUtf8Hex(value: string): string {
    const encoded = encodeURIComponent(value);
    const bytes: number[] = [];

    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === '%') {
        bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(encoded.charCodeAt(i));
      }
    }

    return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private static resolveIncludedCardAttributes(config?: {
    cardAttributes?: {
      enable?: boolean;
      parameters?: string[];
    };
  }): string[] {
    if (config?.cardAttributes?.enable !== true) {
      return [];
    }

    const rawParameters = Array.isArray(config.cardAttributes.parameters)
      ? config.cardAttributes.parameters
      : [];
    const sanitized = rawParameters
      .map((parameter) => parameter.trim())
      .filter((parameter) => parameter.length > 0);

    return Array.from(new Set(sanitized));
  }

  private static buildSessionAnalyticsExtraData(metrics?: {
    configFile: string;
    statusCode?: number;
    latency?: number;
  }) {
    return {
      formType: 'session',
      ...(metrics
        ? {
            configFile: metrics.configFile,
            ...(typeof metrics.statusCode === 'number'
              ? { configFileStatusCode: metrics.statusCode }
              : {}),
            ...(typeof metrics.latency === 'number'
              ? { configFileLatency: metrics.latency }
              : {}),
          }
        : {}),
    };
  }

  /**
   * Loads configuration for a given form.
   * Fetches the remote session configuration over HTTPS.
   * @param form - Form identifier.
   * @param vaultId - Vault ID.
   * @returns Promise resolving to configuration object.
   */
  private static async loadConfiguration(
    form: string,
    vaultId: string
  ): Promise<SessionConfigurationLoadResult> {
    const url = VGSCollect.buildSessionConfigUrl(form, vaultId);
    const configFile = `${VGSCollect.getCollectS3FileName(form)}.json`;
    const startedAt = Date.now();
    let response: unknown;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw VGSCollect.attachSessionTelemetry(error, {
        configFile,
        configFileStatusCode: undefined,
        configFileLatency: Math.max(Date.now() - startedAt, 0),
      });
    }

    const latency = Math.max(Date.now() - startedAt, 0);

    if (!isResponseLike(response)) {
      throw VGSCollect.attachSessionTelemetry(
        new VGSError(
          VGSErrorCode.SessionInitializationFailed,
          'Session configuration response is invalid.'
        ),
        {
          configFile,
          configFileStatusCode: undefined,
          configFileLatency: latency,
        }
      );
    }

    if (!response.ok) {
      throw VGSCollect.attachSessionTelemetry(response, {
        configFile,
        configFileStatusCode: response.status,
        configFileLatency: latency,
      });
    }

    let payload: unknown;
    try {
      if (typeof response.json !== 'function') {
        throw new Error('Session configuration response is not valid JSON.');
      }
      payload = await response.json();
    } catch {
      throw VGSCollect.attachSessionTelemetry(
        new VGSError(
          VGSErrorCode.SessionInitializationFailed,
          'Session configuration response is not valid JSON.',
          {
            statusCode: response.status,
            latency,
          }
        ),
        {
          configFile,
          configFileStatusCode: response.status,
          configFileLatency: latency,
        }
      );
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw VGSCollect.attachSessionTelemetry(
        new VGSError(
          VGSErrorCode.SessionInitializationFailed,
          'Session configuration response must be an object.',
          {
            statusCode: response.status,
            latency,
          }
        ),
        {
          configFile,
          configFileStatusCode: response.status,
          configFileLatency: latency,
        }
      );
    }

    return {
      payload: payload as SessionConfigurationPayload,
      configFile,
      configFileStatusCode: response.status,
      configFileLatency: latency,
    };
  }

  private static attachSessionTelemetry<T>(
    error: T,
    telemetry: SessionConfigurationLoadTelemetry
  ): T {
    if (typeof error === 'object' && error !== null) {
      (
        error as T & {
          sessionConfigTelemetry?: SessionConfigurationLoadTelemetry;
        }
      ).sessionConfigTelemetry = telemetry;
      return error;
    }

    return Object.assign(new Error('Session configuration request failed.'), {
      sessionConfigTelemetry: telemetry,
    }) as T;
  }

  private static getSessionTelemetryFromError(
    error: unknown
  ): SessionConfigurationLoadTelemetry | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    return (
      error as { sessionConfigTelemetry?: SessionConfigurationLoadTelemetry }
    ).sessionConfigTelemetry;
  }

  private static normalizeSessionConfigurationResult(
    form: string,
    config: SessionConfigurationLike
  ): SessionConfigurationLoadResult {
    if ('payload' in config && 'configFile' in config) {
      return config;
    }

    if ('payload' in config) {
      return {
        payload: config.payload,
        configFile: `${VGSCollect.getCollectS3FileName(form)}.json`,
        configFileStatusCode: config.statusCode,
        configFileLatency: config.latency,
      };
    }

    return {
      payload: config,
      configFile: `${VGSCollect.getCollectS3FileName(form)}.json`,
      configFileStatusCode: 200,
      configFileLatency: 0,
    };
  }

  private static createCollectorWithoutInitAnalytics(
    vaultId: string,
    environment: string
  ): VGSCollect {
    VGSCollect.suppressCreateInitAnalytics = true;
    try {
      return new VGSCollect(vaultId, environment);
    } finally {
      VGSCollect.suppressCreateInitAnalytics = false;
    }
  }

  private static validateConfig(tenantId: string, env: string) {
    const pattern = /^[a-zA-Z0-9]+$/;
    if (!tenantId || typeof tenantId !== 'string' || !pattern.test(tenantId)) {
      throw new VGSError(
        VGSErrorCode.InvalidVaultConfiguration,
        'VGSCollect -init Error: Invalid tenantId!'
      );
    }
    const lowerCaseEnv = env.toLowerCase();

    const ENVIRONMENTS = ['sandbox', 'live', 'live-'];
    if (lowerCaseEnv.startsWith('live-')) {
      return;
    }
    if (
      !ENVIRONMENTS.some(
        (allowedEnv) => allowedEnv.toLowerCase() === lowerCaseEnv
      )
    ) {
      throw new VGSError(
        VGSErrorCode.InvalidVaultConfiguration,
        `VGSCollect -init Error: Available environments are: 'sandbox', 'live' or 'live-' with specified region`
      );
    }
  }

  private validateRouteId(routeId: string) {
    const routeIdPattern = /^(?=.*[a-z0-9])[a-z0-9-]+$/i;

    if (
      !routeId ||
      typeof routeId !== 'string' ||
      !routeIdPattern.test(routeId)
    ) {
      throw new VGSError(
        VGSErrorCode.InvalidVaultConfiguration,
        'VGSCollect: Invalid routeId error'
      );
    }
  }
}

export default VGSCollect;
