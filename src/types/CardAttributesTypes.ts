/**
 * Complete parsed card attributes response returned by the lookup service.
 * The structure is backend-defined and may include nested objects/arrays.
 */
export type VGSCardAttributes = Record<string, unknown>;

/**
 * Auth handler for retrieving JWT tokens used in authenticated SDK APIs.
 * Used by createCard() and reserved for auth-backed card attributes lookup flow.
 * Must return a Promise that resolves with a valid JWT token string.
 */
export type VGSAuthHandler = () => Promise<string>;

/**
 * Successful raw card attributes lookup response.
 * Exposes the parsed response payload alongside the underlying fetch response.
 */
export interface VGSCardAttributesLookupSuccessResponse {
  type: 'success';
  status: number;
  data: VGSCardAttributes;
  response: any;
}

/**
 * Failed raw card attributes lookup response.
 * Exposes parsed backend data when available and transport/SDK errors otherwise.
 */
export interface VGSCardAttributesLookupFailureResponse {
  type: 'failure';
  status: number;
  data?: unknown;
  response?: any;
  error?: Error;
}

/**
 * Raw card attributes lookup response union.
 */
export type VGSCardAttributesLookupResponse =
  | VGSCardAttributesLookupSuccessResponse
  | VGSCardAttributesLookupFailureResponse;

/**
 * Callback invoked before starting a card attributes lookup request.
 */
export type VGSCardAttributesWillBeginCallback = () => void;

/**
 * Callback invoked when card attributes lookup succeeds.
 */
export type VGSCardAttributesSuccessCallback = (
  attributes: VGSCardAttributes
) => void;

/**
 * Callback invoked when a card attributes lookup completes with raw response details.
 */
export type VGSCardAttributesLookupResponseCallback = (
  response: VGSCardAttributesLookupResponse
) => void;

/**
 * Callback invoked when card attributes lookup fails.
 */
export type VGSCardAttributesErrorCallback = (error: Error) => void;
