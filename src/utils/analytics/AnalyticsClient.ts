import { Platform } from 'react-native';
import type FormAnalyticsDetails from './FormAnalyticsDetails';
import { generateUUID } from '../Utils';
export const VGSCOLLECT_SDK_VERSION = '1.1.7';

export enum AnalyticsEventType {
  FieldInit = 'Init',
  CollectInit = 'CollectInit',
  HostnameValidation = 'HostnameValidation',
  BeforeSubmit = 'BeforeSubmit',
  Submit = 'Submit',
  Scan = 'Scan',
  CardLookup = 'CardLookup',
}

export enum AnalyticEventStatus {
  Success = 'Ok',
  Failed = 'Failed',
  Cancel = 'Cancel',
}

/**
 * AnalyticsClient
 *
 * Internal client for fire-and-forget analytics events.
 * Adds default headers to HTTP requests and encodes payloads as base64.
 */
class VGSAnalyticsClient {
  private static instance: VGSAnalyticsClient;
  private static readonly REDACTED_VALUE = '[REDACTED]';
  private static readonly SAFE_CONTENT_VALUES = new Set([
    'textField',
    'custom_data',
  ]);
  private static readonly SENSITIVE_KEY_NAMES = new Set([
    'authorization',
    'authtoken',
    'accesstoken',
    'body',
    'cardnumber',
    'content',
    'contents',
    'cvc',
    'cvv',
    'file',
    'filecontents',
    'jwt',
    'number',
    'pan',
    'payload',
    'ssn',
    'token',
    'value',
  ]);
  public shouldCollectAnalytics: boolean = true;

  private vgsCollectSessionId: string;
  private baseURL: string;
  defaultHttpHeaders: { [key: string]: string };
  userAgentData: { [key: string]: any };

  private constructor() {
    this.vgsCollectSessionId = generateUUID();
    this.baseURL = 'https://vgs-collect-keeper.apps.verygood.systems/';
    this.defaultHttpHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    this.userAgentData = this.getUserAgentData();
  }

  /** Returns the singleton analytics client. */
  public static getInstance(): VGSAnalyticsClient {
    if (!VGSAnalyticsClient.instance) {
      VGSAnalyticsClient.instance = new VGSAnalyticsClient();
    }
    return VGSAnalyticsClient.instance;
  }

  // Default headers included in VGSCollect HTTP requests
  collectHTTPHeaders: Record<string, string> = (() => {
    const version = Platform.Version;
    const trStatus = this.shouldCollectAnalytics ? 'default' : 'none';
    return {
      'vgs-client': `source=rnSDK&medium=vgs-collect&content=${VGSCOLLECT_SDK_VERSION}&osVersion=${version}&tr=${trStatus}`,
    };
  })();

  /** Builds user agent metadata for analytics payloads. */
  private getUserAgentData(): { [key: string]: any } {
    const platform = Platform.OS;
    const version = Platform.Version; // React Native version
    return {
      platform: platform === 'ios' ? 'iOS' : 'Android',
      osVersion: `${version}`,
      dependencyManager: 'RN',
    };
  }

  /**
   * Tracks a form-scoped event by merging `FormAnalyticsDetails`.
   *
   * @param formDetails - Form-scoped context (id, tenant, environment).
   * @param type - Event type.
   * @param status - Event status (defaults to Success).
   * @param extraData - Additional payload properties.
   */
  trackFormEvent(
    formDetails: FormAnalyticsDetails,
    type: AnalyticsEventType,
    status: AnalyticEventStatus = AnalyticEventStatus.Success,
    extraData: { [key: string]: any } = {}
  ): void {
    const data = { ...formDetails, ...extraData };
    this.trackEvent(type, status, data);
  }

  /**
   * Tracks a generic analytics event.
   *
   * @param type - Event type.
   * @param status - Event status.
   * @param extraData - Additional payload properties.
   */
  trackEvent(
    type: AnalyticsEventType,
    status: AnalyticEventStatus = AnalyticEventStatus.Success,
    extraData: { [key: string]: any } = {}
  ): void {
    const data = this.sanitizePayload({
      ...extraData,
      type: type.toString(), // Store enum value as string
      status: status.toString(), // Store enum value as string
      ua: this.userAgentData,
      version: VGSCOLLECT_SDK_VERSION, // Replace with actual SDK version
      source: 'rnSDK',
      localTimestamp: Date.now(),
      vgsCollectSessionId: this.vgsCollectSessionId,
    });
    this.sendAnalyticsRequest(data);
  }

  /** Sends the analytics payload to the collector endpoint if enabled. */
  private async sendAnalyticsRequest(data: {
    [key: string]: any;
  }): Promise<void> {
    if (!this.shouldCollectAnalytics) {
      return;
    }
    const url = `${this.baseURL}vgs`;
    const encodedJSON = this.encodeData(data);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.defaultHttpHeaders,
        body: encodedJSON,
      });

      if (!response.ok) {
        return;
      }
    } catch (error) {
      return;
    }
  }

  /** Base64 encodes the JSON payload for transport. */
  private encodeData(data: { [key: string]: any }): string {
    const jsonData = JSON.stringify(data);
    return btoa(jsonData); // Base64 encoding
  }

  private sanitizePayload(data: { [key: string]: any }): {
    [key: string]: any;
  } {
    return this.sanitizeValue(data) as { [key: string]: any };
  }

  private sanitizeValue(value: unknown, key?: string): unknown {
    if (key && this.isSafeAnalyticsContent(key, value)) {
      return [...value];
    }

    if (key && this.isSensitiveKey(key)) {
      return VGSAnalyticsClient.REDACTED_VALUE;
    }

    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<
        Record<string, unknown>
      >((accumulator, [entryKey, entryValue]) => {
        accumulator[entryKey] = this.sanitizeValue(entryValue, entryKey);
        return accumulator;
      }, {});
    }

    return value;
  }

  private isSafeAnalyticsContent(
    key: string,
    value: unknown
  ): value is string[] {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return (
      normalizedKey === 'content' &&
      Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'string' &&
          VGSAnalyticsClient.SAFE_CONTENT_VALUES.has(item)
      )
    );
  }

  private isSensitiveKey(key: string): boolean {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return VGSAnalyticsClient.SENSITIVE_KEY_NAMES.has(normalizedKey);
  }

  private sanitizeString(value: string): string {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/=]+\b/gi, 'Bearer [REDACTED]')
      .replace(
        /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g,
        VGSAnalyticsClient.REDACTED_VALUE
      )
      .replace(/\b\d{13,19}\b/g, VGSAnalyticsClient.REDACTED_VALUE);
  }
}

export default VGSAnalyticsClient;
