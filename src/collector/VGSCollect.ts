// VGSCollect.ts
import APIHostnameValidator from '../utils/url/APIHostnameValidator';
import { LengthRule, PatternRule } from '../utils/validators';
import { ValidationRule } from '../utils/validators/Validator';
import { PaymentCardBrandsManager } from '../utils/paymentCards/PaymentCardBrandsManager';
import type { VGSTokenizationConfiguration } from '../utils/tokenization/TokenizationConfiguration';
import { VGSError, VGSErrorCode } from '../utils/errors';
import VGCollectLogger, {
  VGSLogLevel,
  VGSLogSeverity,
} from '../utils/logger/VGSCollectLogger';
import VGSAnalyticsClient, {
  AnalyticEventStatus,
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
  mask?: string;
  validationRules?: ValidationRule[];
  type?: string;
  tokenizationConfig?: VGSTokenizationConfiguration;
  updateCallback?: FieldUpdateCallback;
}
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

  /**
   * Creates a new collector bound to a Vault.
   *
   * @param id - Vault ID, alphanumeric (e.g., `tnt12345`).
   * @param environment - Deployment environment: `sandbox`, `live`, or `live-<region>`.
   * @throws {VGSError} When configuration is invalid (tenant or environment).
   */
  public constructor(id: string, environment: string = 'sandbox') {
    this.validateConfig(id, environment);
    this.tenantId = id;
    this.environment = environment.toLowerCase();
    this.formAnalyticsDetails = new FormAnalyticsDetails(id, environment);
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
          this.cname = isValid ? normalizedCname ?? undefined : undefined;
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
   */
  registerField(
    fieldName: string,
    getSubmitValue: () => string | Record<string, string>,
    getValidationErrors: () => string[],
    tokenizationConfig?: VGSTokenizationConfiguration,
    type?: VGSInputType,
    validationRules: ValidationRule[] = [],
    updateCallback?: FieldUpdateCallback
  ) {
    this.fields[fieldName] = {
      getSubmitValue: getSubmitValue,
      getValidationErrors,
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

  private buildCmpAPIUrl(path: CardManagementAPIPath): string {
    const environment = this.environment.toLowerCase();
    const baseUrl =
      environment === 'sandbox'
        ? 'https://sandbox.vgsapi.com'
        : 'https://vgsapi.com';

    return `${baseUrl}${path}`;
  }

  /**
   * Creates a card via Card Management API.
   * Validates `token` and input fields, sets required headers, then POSTs to CMP.
   *
   * @param token - JWT Access token (`Authorization: Bearer <token>`).
   * @param extraData - Optional additional payload merged with `{ data: { attributes } }`.
   * @returns Promise resolving `{ status, response }` (native Fetch Response).
   * @throws {VGSError} If access token invalid or inputs fail validation.
   */
  public async createCard(token: string, extraData: Record<string, string> = {}): Promise<{ status: number; response: any }> {
    // will throw VGSError if validation fails
    this.validateAccessToken(token)
    this.validateFields();
    // set CMP API headers
    const headers = {"Content-Type": "application/vnd.api+json",
                      "Authorization": "Bearer "+token }
    this.setCustomHeaders(headers);
    // prepare cmp json data
    const fieldsData = await this.collectFieldData();
    const cmpData = { data: { attributes: fieldsData } };
    // Merge non-input extraData with the wrapped input data.
    const submitData = { ...cmpData, ...extraData };
    // get the URL for the cmp API
    const url = this.buildCmpAPIUrl(CardManagementAPIPath.Cards);
    return this.submitDataToServer(url, 'POST', submitData, { upstream: 'cmp' });
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
  private validateFields() {
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
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Failed,
        { statusCode: errorCode }
      );
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
  private validateAccessToken(token: string) {
    if (token.length > 0) {
      return
    }
      const errorCode = VGSErrorCode.IvalidAccessToken;
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Failed,
        { statusCode: errorCode }
      );
      this.logger.log({
        severity: VGSLogSeverity.ERROR,
        text: `Access token is required for -createCard(:) request!`,
        logLevel: VGSLogLevel.WARNING,
      });
      throw new VGSError(
        errorCode,
        'VGSCollect: Access token is null or empty!');
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
    analyticsData?: Record<string, any>
  ): Promise<{ status: number; response: any } | never> {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...VGSAnalyticsClient.getInstance().collectHTTPHeaders,
        ...this.customHeaders,
      };
      this.logger.logRequest(url, headers, data);
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.BeforeSubmit,
        AnalyticEventStatus.Success,
        { statusCode: 200, analyticsData }
      );
      const response = await fetch(url, {
        method,
        headers: headers,
        body: JSON.stringify(data),
      });
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.Submit,
        response.ok ? AnalyticEventStatus.Success : AnalyticEventStatus.Failed,
        { statusCode: response.status, analyticsData }
      );
      return { status: response.status, response };
    } catch (error) {
      var errorMessage = 'unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.analyticsClient.trackFormEvent(
        this.formAnalyticsDetails,
        AnalyticsEventType.Submit,
        AnalyticEventStatus.Failed,
        { error: errorMessage, analyticsData }
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
      return parsedUrl.toString();
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
    return Object.keys(this.fields).find(
      (fName) => this.fields[fName] && this.fields[fName].type === inputType
    );
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

  private validateConfig(tenantId: string, env: string) {
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
