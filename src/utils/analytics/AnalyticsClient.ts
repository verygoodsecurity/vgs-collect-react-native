import { Platform } from 'react-native';
import type FormAnalyticsDetails from './FormAnalyticsDetails';
import { generateUUID } from '../Utils';
const VGSCOLLECT_SDK_VERSION = '1.1.4';

export enum AnalyticsEventType {
  FieldInit = 'Init',
  HostnameValidation = 'HostnameValidation',
  BeforeSubmit = 'BeforeSubmit',
  Submit = 'Submit',
  Scan = 'Scan',
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
    const data = {
      ...extraData,
      type: type.toString(), // Store enum value as string
      status: status.toString(), // Store enum value as string
      ua: this.userAgentData,
      version: VGSCOLLECT_SDK_VERSION, // Replace with actual SDK version
      source: 'rnSDK',
      localTimestamp: Date.now(),
      vgsCollectSessionId: this.vgsCollectSessionId,
    };
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
}

export default VGSAnalyticsClient;
