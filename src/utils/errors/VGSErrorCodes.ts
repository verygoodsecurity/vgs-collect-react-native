/** Error codes for VGS Collect SDK errors */
export enum VGSErrorCode {
  // *** Text input data errors ***
  // When input data is not valid, but required to be valid
  InputDataIsNotValid = 1001,
  // *** Files data errors ***
  // When can't find file on device
  InputFileNotFound = 1101,
  // When file format not supported
  InputFileTypeIsNotSupported = 1102,
  // When file size is larger then allowed limit
  InputFileSizeExceedsTheLimit = 1103,
  // When can't get access to file source
  SourceNotAvailable = 1150,
  // *** Other errors ***
  // When token is null or empty.
  IvalidAccessToken = 1300,
  // When authHandler is not set but required.
  AuthHandlerNotSet = 1301,
  // When the response object is not an HTTP response where required.
  UnexpectedResponseType = 1400,
  // When the response body format is empty or malformed.
  UnexpectedResponseDataFormat = 1401,
  // When form parameter is invalid.
  InvalidFormConfiguration = 1460,
  // When VGS config URL is not valid.
  InvalidVaultConfiguration = 1470,
  // When VGS config URL is not valid.
  InvalidConfigurationURL = 1480,
  // When session initialization fails due to configuration load error.
  SessionInitializationFailed = 1490,
}
