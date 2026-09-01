<p align="center">
  <a href="https://www.verygoodsecurity.com/" rel="nofollow">
    <img src="https://avatars0.githubusercontent.com/u/17788525" width="128" alt="VGS Logo">
  </a>
  <h3 align="center">VGS Collect React Native Package</h3>

  <p align="center">
    Securely collect, tokenize, and manage sensitive data in your React Native applications with ease.
    <br />
    <a href="https://www.verygoodsecurity.com/docs/vgs-collect/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://www.npmjs.com/package/@vgs/collect-react-native">NPM (@vgs/collect-react-native)</a>
  </p>
</p>

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Installation](#installation)
- [AI Agent Integration](#ai-agent-integration)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [UI Inputs](#ui-inputs)
  - [Masking Inputs](#masking-inputs)
  - [Custom Validation](#custom-validation)
- [iOS Privacy Manifest](#ios-privacy-manifest)
- [Privacy](#privacy)
- [Documentation](#documentation)
- [Releases](#releases)
- [License](#license)

## Introduction

The `@vgs/collect-react-native` package by Very Good Security (VGS) enables you to securely collect and manage sensitive data such as credit card information and Social Security Numbers (SSNs) within your React Native applications. Leveraging VGS's data protection infrastructure ensures that sensitive information is handled securely, simplifying compliance and enhancing user trust.

## Features

- **Secure Data Collection:** Tokenize sensitive data before it reaches your servers.
- **Customizable Input Components:** Pre-built components for various data types (e.g., Card Number, CVC, Expiration Date, Social Security Number).
- **Real-time Validation:** Instant feedback on input validity to enhance user experience.
- **Pre-defined Masking:** Automatically setup input masks based on data type.
- **Easy Integration:** Simple setup and integration with existing React Native projects.
- **Compliance Ready:** Assists in achieving PCI DSS compliance by minimizing the handling of sensitive data.

## Installation

Install the `@vgs/collect-react-native` package using npm or yarn:

```bash
# Using npm
npm install @vgs/collect-react-native

# Using yarn
yarn add @vgs/collect-react-native
```
Ensure you have React Native set up in your project. If not, follow the official React Native "Getting Started" guide.

## AI Agent Integration

This repository ships a public AI skill at [`skills/vgs-collect-react-native-guide/SKILL.md`](./skills/vgs-collect-react-native-guide/SKILL.md) for teams integrating `@vgs/collect-react-native` into an app.

Recommended: install the skill with `skills.sh`. This is the easiest way to give a compatible AI agent the repository-specific guidance it needs for `@vgs/collect-react-native` integrations.

The installed skill bundle includes `references/AGENTS.md`, and repository root `AGENTS.md` points to that same file, so a compatible skill-aware agent receives the durable integration policy automatically as part of the skill download without maintaining two copies.

What the skill is useful for:
- choosing the correct VGS Collect flow, such as proxy submission, tenant tokenization, alias creation, or card creation
- asking a clarifying question when a card-entry request is ambiguous and the flow is not specified
- steering non-card collection requests such as SSN or generic sensitive fields toward the correct field and tokenization APIs instead of card-specific ones
- keeping generated guidance aligned with the installed package version when that version can be detected
- following the integration rules in [`AGENTS.md`](./AGENTS.md) for public APIs, validation, privacy, and testing expectations automatically

Install the skill with `skills.sh`:
```bash
npx skills add https://github.com/verygoodsecurity/vgs-collect-react-native --skill vgs-collect-react-native-guide
```

If your AI tool does not support skills yet, you can still copy [`AGENTS.md`](./AGENTS.md) into the agent context manually. That file is the authoritative integration guide for supported public APIs, security constraints, validation rules, migration expectations, and testing requirements.

Minimal System Prompt Example:
```text
You are an autonomous engineering agent integrating the VGS Collect React Native package into an existing app.
Use the full contents of AGENTS.md as the authoritative policy.
Constraints:
- Only public exports from package root (no internal imports).
- No raw sensitive data (PAN, CVC, SSN, exp date) in logs or tests.
- Validate all registered fields before submission or tokenization.
- Never persist raw field values; only use provided state booleans/metadata.
Goals:
1. Add a secure card form (card number, name, exp, cvc) with redacted logging (brand + last4 only when valid).
2. Implement a flow that submits data to the sandbox tenant and returns aliases.
3. Provide Jest tests for valid/invalid card number and past expiration edge case.
Return: Modified source files only. Do not commit secrets.
```

## Prerequisites
Create an organization in the <a href="https://dashboard.verygoodsecurity.com/dashboard/" target="_blank">VGS Dashboard</a>. A sandbox tenant is created for you automatically. Configure its routes in the Dashboard, then use the tenant ID to start collecting data.

## Example app
You can check our example application [here](./example/src/App.tsx). To run the example application, follow these steps:
``` bash
# 1. Download package repository
# 2. In root folder run:
npm install
# 3. Navigate to example folder
cd example
# 4. Build example app for iOS or Android
npm run ios
# 5. Later you can start expo server(optional)
npx expo start --clear
```
## Quick Start

Import the package components:
```javascript
import { VGSCollect, VGSTextInput } from '@vgs/collect-react-native';
```
Initialize VGSCollect:
```javascript
const collector = new VGSCollect('yourTenantId', 'sandbox'); // Use the live environment in production.
```

Initialize a session-backed collector:
```javascript
// Loads remote session config and enables form-driven card lookup when configured.
const collector = await VGSCollect.session('checkout-form', 'yourTenantId', 'sandbox');

// Remote configuration wins. If loading fails, the collector is still returned
// with this optional inline fallback, and onError receives the load failure.
const collectorWithFallback = await VGSCollect.session(
  'checkout-form',
  'yourTenantId',
  'sandbox',
  {
    configuration: {
      cardAttributes: { enable: true, parameters: ['issuer', 'card_type'] },
    },
    onError: () => showConfigurationWarning(),
  }
);

// Skip remote session config by passing undefined, null, or blank form.
const collectorWithoutConfig = await VGSCollect.session(undefined, 'yourTenantId', 'sandbox');
```
Create Secure Input Fields:
```javascript
<VGSTextInput
  containerStyle={styles.inputContainer}
  textStyle={styles.inputText}
  collector={collector}
  fieldName="card_holder"
  type="cardHolderName"
  placeholder="Name"
  onStateChange={handleFieldStateChange}
/>
```
Handle Form Submission:
```javascript
// Handle submit request
const handleSubmit = async () => {
  try {
    const { status, response } = await collector.submit('/post', 'POST');
    if (response.ok) {
      try {
        const responseBody = await response.json();
        const json = JSON.stringify(responseBody, null, 2);
        console.log('Success:', json);
      } catch (error) {
        console.warn(
          'Could not parse the response body. It may be empty, or the tenant ID may be incorrect.',
          error
        );
      }
    } else {
      console.warn(`Server responded with error: ${status}\n${response}`);
    }
  } catch (error) {
    if (error instanceof VGSError) {
      switch (error.code) {
        case VGSErrorCode.InputDataIsNotValid:
          for (const fieldName in error.details) {
            console.error(
              `Not valid fieldName: ${fieldName}: ${error.details[fieldName].join(', ')}`
            );
          }
          break;
        default:
          console.error('VGSError:', error.code, error.message);
      }
    } else {
      console.error('Network or unexpected error:', error);
    }
  }
};
```
Each input must use a `fieldName` that matches the field key in the tenant route configuration. VGS uses this key for redact and reveal operations.

### Card Attributes Lookup Response

`setDidRetrieveCardAttributes` receives the complete parsed backend response object without unwrapping or reshaping it. This preserves backend-defined wrappers and nested attributes and matches the VGS Collect iOS callback contract.

```javascript
collector.setDidRetrieveCardAttributes((attributes) => {
  const lookupData = attributes.data ?? attributes;
  // Read backend-defined fields without assuming a flattened response.
});
```

Use the raw lookup response callback when you also need the request status and native Fetch response. On success, its `data` property is typed as `VGSCardAttributes` and contains the same complete parsed backend payload delivered to `setDidRetrieveCardAttributes`.

```javascript
collector.setCardAttributesLookupResponse((lookupResponse) => {
  if (lookupResponse.type === 'success') {
    console.log('Lookup status:', lookupResponse.status);
  } else {
    console.warn('Lookup failed with status:', lookupResponse.status);
  }
});
```

### Create Card

Use `createCard(extraData?)` with `setAuthHandler(...)`. Extra data is merged into `data.attributes`; collected secure fields take precedence. The SDK caches the token in memory and refreshes it once after a 401/403 response. CMP requires the canonical collected keys `pan`, `exp_month`, and `exp_year`; the convenience inputs and expiration serializer provide these defaults. CMP expiration uses `MM/YY`, with numeric request values such as `exp_month: 4` and `exp_year: 28`.

The auth handler may return a raw token or a `Bearer <token>` value. Empty and prefix-only values such as `Bearer ` are rejected with `VGSErrorCode.IvalidAccessToken`.

Replacing the auth handler prevents an earlier pending handler from repopulating the shared token cache. A 401/403 retry refreshes only the authorization token and reuses the original validated request payload, even if field values change while the token refresh is pending.

Pass attributes directly, as shown below. For migration compatibility, the SDK also accepts the legacy `{ data: { attributes: ... } }` envelope without nesting it; SDK-collected secure fields and SDK request metadata still take precedence.

```javascript
collector.setAuthHandler(fetchJWTFromBackend);
await collector.createCard({
  cardholder: { address: { country: 'US' } },
  token_type: 'pan',
});
```

### Update Card

Use `updateCard(cardId)` to PATCH an existing card. Registered `cvc` and `expDate` values are included when populated:

```javascript
await collector.updateCard('card_123');

// Explicit tokens bypass the collector's token cache and automatic refresh.
await collector.updateCardWithToken('card_123', accessToken);
```

Behavior:
- `cvc` and `expDate` are optional; blank values are omitted.
- When either secure field has a value, it must be valid.
- At least one of `cvc`, `exp_month`, or `exp_year` must be present.
- CMP expiration accepts `MM/YY`; `MM/YYYY` is rejected.
- Only `cvc`, `exp_month`, and `exp_year` are accepted update attributes.
- Only the first registered `cvc` and `expDate` fields are used for this request.
- Auth-handler requests retry once with a fresh token after HTTP 401/403; explicit-token requests do not retry or cache the token.
- Auth-handler retries reuse the original validated update payload rather than reading field values again.

## UI Inputs

The package provides pre-built UI input components for securely collecting sensitive data. The following input components are available:

* **`VGSTextInput`:** A versatile, customizable input component. 
    * **Field Types:** You can configure the input's behavior by setting the `type` prop. 
        * Supported types: 
            * `'text'`: General-purpose text input with no predefined settings.
            * `'card'`: For collecting card numbers.
            * `'cardHolderName'`: For collecting card holder names.
            * `'expDate'`: For collecting card expiration dates.
            * `'cvc'`: For collecting CVC/CVV codes.
            * `'ssn'`: For collecting social security numbers.
        * Each type includes default configurations for:
            * **Validation Rules:** Enforces data integrity and compliance.
            * **Input Mask:** Provides visual guidance and improves user experience.
            * **Keyboard Type:** Optimizes the on-screen keyboard for the input type.
* **`VGSCardInput`:** A specialized input component for collecting card numbers. 
    * **Features:** 
        * Predefined `type='card'`.
        * Dynamically displays the detected card brand based on user input.
* **`VGSCVCInput`:** A specialized input component for collecting CVC/CVV codes.
    * **Features:** 
        * Predefined `type='cvc'`.
        * Displays an icon to guide users in entering the CVC/CVV code.

## Masking Inputs

VGS Input components allow you to apply a mask to the input field using the mask prop. This prop accepts a string pattern that defines how the input should be formatted. It uses placeholder characters to define the allowed characters in each position of the mask. The following placeholders are supported:

-  `#`: Any digit (0-9)
-  `@`: Any letter (a-zA-Z)
-  `a`: Any lowercase letter (a-z)
-  `A`: Any uppercase letter (A-Z)
-  `*`: Any alphanumeric character (a-zA-Z0-9)

Here's how to use the mask prop:
```javascript
<VGSTextInput
  //... other props
  mask="#### #### #### ####" // Example mask for a credit card number
/>
```

## Custom Validation

VGS Input components allow you to re-define default or add custom validation rules to ensure that the input data meets certain criteria. You can use the validationRules prop to pass an array of ValidationRule objects.

Here's a list of the available validation rules:

-  `NotEmptyRule`: Checks if the input is not empty.
-  `LengthRule`: Validates the input length against a minimum and maximum length.
-  `LengthMatchRule`: Checks if the input has an exact specified length.
-  `PatternRule`: Validates the input against a regular expression pattern.
-  `CardExpDateRule`: Checks if the input is a valid card expiration date in the specified format ('mmyy' or 'mmyyyy').
-  `PaymentCardRule`: Validates if the input is a valid payment card number based on the card brand and Luhn check.
-  `LuhnCheckRule`: Performs a Luhn check on the input to validate its integrity (commonly used for credit card numbers).

Here's how to set validation rules:
```javascript
import { NotEmptyRule, LengthRule, PatternRule } from '@vgs/collect-react-native';

<VGSTextInput
  //... other props
  validationRules={[
    new NotEmptyRule('This field is required'),
    new LengthRule(5, 10, 'Length must be between 5 and 10 characters'),
    new PatternRule('/^[a-zA-Z]+$/', 'Only letters are allowed'),
  ]}
/>
```
## iOS Privacy Manifest
The package **does not directly embed** the Privacy Manifest file into your iOS project. Instead, manually copy and update the privacy information from the VGS <a href="https://github.com/verygoodsecurity/vgs-collect-react-native/blob/main/PrivacyInfo.xcprivacy">Privacy Manifest file</a>. Follow the instructions in our <a href="https://docs.verygoodsecurity.com/vault/developer-tools/vgs-collect/react-native-sdk">documentation</a>.


### Privacy
The package tracks a few key metrics about feature usage to guide improvements. No personal or raw sensitive data is tracked.

You can opt-out of metrics collection via `VGSAnalyticsClient`:
```
VGSAnalyticsClient.getInstance().shouldCollectAnalytics = false
```

### Documentation
-  Package Documentation: https://docs.verygoodsecurity.com/vault/developer-tools/vgs-collect/react-native-sdk

### Releases
To follow `@vgs/collect-react-native` updates and changes, check the <a href="https://github.com/verygoodsecurity/vgs-collect-react-native/releases">releases page</a>.

## License

The VGS Collect React Native package is released under the MIT license. See <a href="https://github.com/verygoodsecurity/vgs-collect-react-native/blob/main/LICENSE">LICENSE</a> for details.
