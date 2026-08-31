# AGENTS.md

**Package Version: 1.1.7**

This guide is tailored for autonomous engineering agents integrating `@vgs/collect-react-native` into React Native applications. It focuses on deterministic, automatable steps: environment assessment, field setup, secure submission and tokenization flows, privacy compliance, testing, maintenance, and safe upgrade workflows.

Documentation Source of Truth Across Versions
- The canonical durable instruction source for this repository lives at `skills/vgs-collect-react-native-guide/references/AGENTS.md`.
- Repository root `AGENTS.md` points to that canonical file so root-path workflows continue to work in a normal checkout.
- The single public AI skill entrypoint lives at `skills/vgs-collect-react-native-guide/SKILL.md`. It routes task type and version selection, then defers package rules and invariants to this file.
- The installed skill bundle must ship `skills/vgs-collect-react-native-guide/references/AGENTS.md` so standalone skill installs receive this policy file automatically.
- This bundled file is the agent-instruction snapshot available to an installed public skill.
- If the target project's package version differs from the `Package Version` header, agents MUST disclose that the bundled guidance may be outdated and show `npx skills check` followed by `npx skills update`. Agents must not run an update or silently reinstall the skill without an explicit user request.
- If the package version cannot be determined, agents SHOULD disclose that this bundled snapshot is being used without claiming it is the latest available version.
- Maintainers update this bundled snapshot in the source repository; runtime agents consume it as immutable guidance.
- Release tags MUST be created only after `AGENTS.md`, `README.md`, and `skills/vgs-collect-react-native-guide/SKILL.md` match the shipped package behavior for that release.

Authoritative integration instructions for autonomous engineering agents implementing the `@vgs/collect-react-native` package. Follow these guidelines to ensure secure, correct, reproducible handling of sensitive data. Use ONLY documented public API exported from `src/index.tsx`:

Public Exports Surface
- Classes / Objects: `VGSCollect`, `VGSCollectLogger`, `VGSTokenizationConfiguration`, `ExpDateSeparateSerializer`.
- Validators & Errors: imported via root barrel (e.g. `import { NotEmptyRule, VGSError, VGSErrorCode } from '@vgs/collect-react-native';`). Do NOT import using relative subpaths like `@vgs/collect-react-native/utils/validators` or `./utils/validators` – these are not published subpath exports.
- Components: `VGSTextInput`, `VGSCardInput`, `VGSCVCInput`.
- Types: `VGSCollectSessionOptions`, `VGSTextInputState`, `VGSCardAttributes`, `VGSAuthHandler`, `VGSCardAttributesWillBeginCallback`, `VGSCardAttributesSuccessCallback`, `VGSCardAttributesLookupResponse`, `VGSCardAttributesLookupResponseCallback`, `VGSCardAttributesErrorCallback` plus validator rule classes implementing the `ValidationRule` interface (all available through the root package import).

Never access un-exported internals or mutate private fields. Import ONLY from the package root entrypoint. Do not fork package logic.

---
## 1. Core Purpose & Mental Model
`VGSCollect` orchestrates secure client-side collection of sensitive form data (PAN, CVC, expiration, SSN, etc.), validates fields, builds a vault URL, and submits or tokenizes values so raw data never reaches your backend. UI input components encapsulate masking + validation; you interact through their props and error handling via `VGSError`.

Sensitive data flow:
1. Instantiate `VGSCollect(vaultId, environment)`.
2. Render input components pointing to the collector via `collector` prop and unique `fieldName` that matches Vault Route configuration.
3. User enters data → component applies mask & validation rules.
4. Call `collector.submit()` or `collector.tokenize()` / `collector.createAliases()` / `collector.createCard()` after validation; handle response tokens/aliases only.

Success Criteria For Any Agent Task
1. No logs of raw PAN, CVC, SSN, expiration values (only non-sensitive metadata e.g. last4 or brand if provided by state).
2. All fields validated (no submission if `VGSErrorCode.InputDataIsNotValid` would be thrown).
3. Aliases/tokens surfaced to app layer only after successful submit/tokenize; raw inputs never persisted.
4. Field names align with Vault Routes.
5. No hardcoded secrets (vaultId, routeId, access token supplied via app config).
6. Public API only; no monkey-patching or reflection.

---
## 2. Environment & Configuration
Required before rendering fields:
- `vaultId`: Non-empty alphanumeric; agent must fail fast if empty.
- `environment`: `'sandbox'` or `'live'` (or region `'live-eu'`, etc. using prefix `live-`). Lowercase normalized.

Optional configuration methods (chainable pattern acceptable):
- `setRouteId(routeId: string)`: Adds route segment to constructed base URL: `<vaultId>-<routeId>.<environment>.verygoodproxy.com`.
- `setCname(cname: string)`: Validates custom hostname asynchronously; await this before submit if used.
- `setCustomHeaders(headers: Record<string,string>)`: Adds user-defined headers (avoid injecting sensitive values like PAN). Analytics headers auto-included.

Do NOT derive environment from user input at runtime; treat as static app config.

---
## 3. Field Registration & UI Components
You do NOT call `registerField` directly—components do. Use component props:
- `collector`: instance of `VGSCollect` (mandatory).
- `fieldName`: String; MUST mirror Vault Route field key.
- `type`: One of supported input types (see below).
- `mask`: Optional custom mask (use with caution; defaults chosen for security/usability).
- `validationRules`: Replace defaults entirely when supplied (must re-provide any needed built-ins like Luhn or expiration date rules).
- `maxLength`: Optional max character count passed to the underlying React Native TextInput.
- `onStateChange`: Callback receiving `VGSTextInputState` for UI validity feedback (never persist raw values from state).

Components:
- `VGSTextInput`: Generic configurable field; set `type` as needed.
- `VGSCardInput`: Pre-wired for card numbers; dynamic brand handling.
- `VGSCVCInput`: Pre-wired for CVC/CVV; updates mask/length when card brand changes.

Supported `type` values (string): `text`, `card`, `cardHolderName`, `expDate`, `cvc`, `ssn`. Each supplies default mask + validators:
- `card`: Mask like `#### #### #### ####` (brand adaptive). Includes payment card rule (length, brand, Luhn).
- `cvc`: Numeric pattern + length rule (3/4 digits). Updated automatically with brand (agent should not re-implement logic).
- `expDate`: Pattern `##/##` (MM/YY) or override `##/####` for long year in Vault submission flows; CMP create/update accepts MM/YY only. Includes expiration validation (not past, month 01–12).
- `cardHolderName`: Typically pattern for letters/spaces; may override with custom rules.
- `ssn`: Mask `###-##-####` pattern; treat as sensitive for logging even if not flagged internally.
- `text`: No defaults; supply custom rules if needed.

Mask placeholders:
- `#` digit; `@` any letter; `a` lowercase; `A` uppercase; `*` alphanumeric.

---
## 4. Validation Rules (Public Surface)
Available (import from validators export): `NotEmptyRule`, `LengthRule`, `LengthMatchRule`, `PatternRule`, `CardExpDateRule`, `PaymentCardRule`, `LuhnCheckRule`, `MatchFieldRule`, `ABARoutingNumberRule`.

Usage Example (custom name field rule set):
```tsx
<VGSTextInput
  collector={collector}
  fieldName="card_holder"
  type="cardHolderName"
  validationRules={[
    new NotEmptyRule('required'),
    new LengthRule(2, 40, 'length'),
    new PatternRule('^[a-zA-Z0-9 \-\']{2,40}$', 'pattern'),
  ]}
  onStateChange={s => setNameValid(s.isValid)}
/>
```
Errors surfaced on submit via thrown `VGSError` with `code === VGSErrorCode.InputDataIsNotValid` and `details` map keyed by `fieldName` → array of messages. Agent must iterate details and map to user-friendly UI messages (no raw user input interpolation into messages).

---
## 5. Submission & Tokenization APIs
Methods on `VGSCollect`:
- `VGSCollect.session(form, vaultId, environment?, options?)`: Loads remote form configuration. Remote configuration wins; on load failure the Promise still resolves with a collector using `options.configuration` when supplied, and calls `options.onError`.
- `submit(path?: string, method?: string, extraData?: Record<string,any>, customRequestStructure?: Record<string,any>)`: Validates fields, constructs URL, merges extraData. Returns `{status, response}` where `response` is the Fetch Response object. Parse JSON cautiously (may be empty on some error codes).
- `tokenize()`: Tokenizes fields configured with `tokenizationConfig`; returns `{ status, data }` where `data` is alias mapping.
- `createAliases()`: Similar to `tokenize()` but uses newer Vault API version (`v2`). Keep alias ordering assumptions intact—never reorder collected data.
- `createCard(extraData?: Record<string,any>)`: Uses `authHandler` to fetch a JWT, validates fields, and posts `{ data: { attributes, meta } }`. CMP requires canonical collected keys `pan`, `exp_month`, and `exp_year`; expiration is MM/YY and is sent as numeric month and two-digit year. Pass supported extra attributes directly; the legacy `{ data: { attributes } }` envelope remains accepted for migration compatibility. Secure collected values and SDK request metadata take precedence. The SDK caches the token and refreshes once on 401/403.
- `updateCard(cardId, extraData?: Record<string,any>)`: Uses `authHandler` to PATCH populated CVC and/or MM/YY expiration values. CMP accepts only `cvc`, `exp_month`, and `exp_year`; at least one must be present. It shares the token cache and one-refresh behavior.
- `updateCardWithToken(cardId, token, extraData?)`: Explicit-token update variant with no token caching or automatic refresh.
- `isFieldValueEqual(fieldName: string, value: string)`: Internal helper used by `MatchFieldRule` for secure cross-field comparison (no direct need to call in typical integrations).

CMP field contract:
- Create requires `pan`, `exp_month`, and `exp_year`; optional attributes are `cvc`, `cardholder`, `token_type`, and `wallet_type`.
- Update accepts only `cvc`, `exp_month`, and `exp_year`.
- User-defined card metadata belongs in `data.meta`, not in update attributes.
- Canonical CMP field names are independent of configurable Vault Route field names. Prefer the `VGSTextInput.CardNumber`, `.ExpDate`, `.CVC`, and `.CardHolder` convenience inputs, which supply the canonical defaults.

Tokenization Field Setup:
Use `tokenizationConfig` prop inside component (if exposed) or future adapter logic: object implementing `{ storage, format }`. For expiration date with `ExpDateSeparateSerializer` you receive `exp_month` and `exp_year` pieces; mapping preserved automatically.

Custom Request Structure Example:
```tsx
await collector.submit('/post', 'POST', {}, {
  payment: { card: '{{ pan }}', cvc: '{{ cvc }}' }
});
```
Placeholders replaced with collected sensitive values during submission (never log the final payload).

Error Handling Pattern:
```tsx
try {
  const { status, response } = await collector.submit('/post');
  if (response.ok) {
    const json = await response.json();
    // handle alias JSON depending on backend route
  } else {
    // map status to user message
  }
} catch (e) {
  if (e instanceof VGSError) {
    if (e.code === VGSErrorCode.InputDataIsNotValid) { /* iterate e.details */ }
    else { /* configuration or URL error */ }
  } else { /* network/unexpected */ }
}
```

Do NOT retry automatically on validation errors—prompt user correction.

---
## 6. Logger & Analytics
- Logger: `VGSCollectLogger.getInstance().enable()` to opt-in (default disabled). Allowed logging: request metadata, non-sensitive payload structure, status codes. Forbidden: raw PAN, CVC, SSN values. Never call logger methods with raw field values.
- Analytics: Transparent; can opt-out if available through `VGSAnalyticsClient` (not exported directly here—avoid accessing unless documented). If disabled, do not attempt manual replication.

Safe Redacted Logging Example (card last4 only if component state supplies it):
```tsx
if (state.meta?.last4 && state.isValid) {
  VGSCollectLogger.getInstance().logInfo?.(`card last4=${state.meta.last4}`);
}
```
(Confirm available method names; avoid if not exported—prefer generic integration-level logging outside the package.)

---
## 7. Security Rules For Agents
Mandatory Checks:
- Never persist raw field values in Redux, AsyncStorage, files, or analytics.
- No console.log of user-entered sensitive data. Run regex scan before commit: pattern for 13–19 consecutive digits; reject if found unredacted.
- Vault / route IDs configurable via environment (e.g. `.env` or build-time constants) not hardcoded production values.
- JWT tokens managed via `authHandler` callback; SDK caches and refreshes automatically. Never store tokens globally in app code.
- Always handle thrown `VGSError` and branch on `error.code`.

Forbidden Actions:
- Calling private methods (anything not exported).
- Modifying package source as a means to change behavior.
- Re-implementing tokenization or encryption.

---
## 8. Form Validity Strategy
Enable submit button only when all tracked field states are valid. Pattern:
```tsx
const allValid = [cardState, cvcState, expState, nameState].every(s => s?.isValid);
<Button disabled={!allValid} onPress={handleSubmit} />
```
Do not rely solely on client-side disabled state; submission still validates server-side and may throw.

---
## 9. Common Integration Recipes
Add Card Form:
1. Initialize collector: `const collector = new VGSCollect(vaultId, 'sandbox')`.
2. Render `VGSCardInput` (fieldName "pan") + `VGSCVCInput` ("cvc") + `VGSTextInput` for name ("card_holder") + expiration (type `expDate`, fieldName "exp_date").
3. Track validity in `onStateChange` callbacks.
4. On submit call `collector.submit('/post')` and process response.

Add Tokenization Flow:
1. Provide `tokenizationConfig` for fields needing aliases (e.g. card number). Storage & format reflect desired alias output.
2. Call `collector.tokenize()`; receive mapping `{'pan': 'tok_...'}` or for serialized expiration `{'exp_month': 'tok_', 'exp_year': 'tok_'}`.

Custom Expiration Serializer:
```tsx
<VGSTextInput
  collector={collector}
  fieldName="expDate"
  type="expDate"
  serializer={new ExpDateSeparateSerializer()}
  onStateChange={...}
/>
```
(Ensure serializer prop is supported; if not documented publicly, refrain.)

Card Management (create card):
```tsx
// New way (recommended): uses authHandler
collector.setAuthHandler(async () => {
  const response = await fetch('https://yourapi.com/auth/token');
  const { token } = await response.json();
  return token;
});
await collector.createCard({ token_type: 'pan' });
```
Pass extra attributes directly. Use the wrapped `{ data: { attributes } }` form only when preserving a legacy integration.

SDK auth-handler requests cache tokens in memory and refresh once on 401/403 responses. This lifecycle is shared by lookup, create, and update operations.

Replacing the auth handler prevents any token returned later by the previous handler from entering the shared cache. Create and update retries refresh only authorization and reuse the original validated request payload; they do not read secure field values again.

Custom Structure Wrapping:
Use `customRequestStructure` placeholders to embed sensitive data inside nested JSON while keeping collection deterministic.

---
## 10. Error Codes (Selected)
From exported errors: handle at least:
- `InvalidVaultConfiguration`: Vault/route/cname config bad.
- `InvalidFormConfiguration`: Invalid form parameter passed to `VGSCollect.session()`.
- `SessionInitializationFailed`: Internal remote configuration response errors delivered to the session `onError` callback; the collector still resolves with its inline fallback when available.
- `InputDataIsNotValid`: One or more fields invalid (inspect `details`).
- `InvalidConfigurationURL`: Built URL fails validation.
- `AuthHandlerNotSet`: `authHandler` missing when required (e.g., `createCard`, card attributes lookup).
- `IvalidAccessToken`: (typo in code, treat as access token invalid) for empty, prefix-only (for example, `Bearer `), or invalid JWTs.
Map each to user-friendly message; never expose internal details or raw data.

---
## 11. Performance & Concurrency
- Instantiate single `VGSCollect` per form/screen; reuse until unmount.
- Avoid parallel submissions: gate with `inFlight` flag; ignore additional taps until previous promise resolves.
- Await `setCname()` before first submission if using custom hostname.
- Keep validation synchronous (rules are local); no need for debounced server checks.

---
## 12. Testing Guidance
Minimum agent-maintained tests (Jest / React Native Testing Library):
1. Card number valid vs invalid triggers error on `submit` (simulate invalid value, expect thrown `VGSError`).
2. Expiration date past month returns validation error.
3. Tokenization returns alias map for configured field. Mock `fetch` to supply tokenization response.
4. `createCard` without `authHandler` throws `VGSError`.
5. Custom request structure replaces placeholders correctly.

Ensure tests never log full PAN (`4111111111111111` acceptable for test but not printed).

---
## 13. Security & Privacy Checklist (Pre-Merge)
[ ] No `console.log` with raw sensitive values.
[ ] All submit flows catch `VGSError` and branch by `code`.
[ ] Field names match Vault Routes.
[ ] JWT tokens managed via `authHandler`; SDK handles caching and refresh.
[ ] No private API usage (imports only from package root exports).
[ ] Tests cover validation failure & success paths.

---
## 14. Card Attributes Lookup
The SDK supports automatic card attributes lookup at 11 digits when configured via `VGSCollect.session()` or manually enabled.

**Configuration:**
```tsx
// Via session (automatically applies includedCardAttributes from form config)
const collector = await VGSCollect.session('checkout-form', vaultId, 'sandbox');

// Or manually configure
const collector = new VGSCollect(vaultId, 'sandbox');
collector.setIncludedCardAttributes(['card_type', 'issuer', 'bin']);
```

**Auth Handler (Required for Lookup):**
Provide a Promise-based handler returning JWT token:
```tsx
collector.setAuthHandler(async () => {
  // Fetch JWT from your backend
  const response = await fetch('https://yourapi.com/auth/token');
  const { token } = await response.json();
  return token;
});
```

**Lifecycle Callbacks:**
```tsx
// Optional: Notified before lookup request starts
collector.setWillBeginCardAttributesLookup(() => {
  console.log('Starting card attributes lookup...');
});

// Handle successful lookup
collector.setDidRetrieveCardAttributes((attributes: VGSCardAttributes) => {
  console.log('Card attributes:', attributes);
  // The complete parsed backend response is preserved without unwrapping.
  // For a wrapped response, read fields from attributes.data.
});

// Handle lookup errors
collector.setDidFailToRetrieveCardAttributes((error: Error) => {
  console.error('Lookup failed:', error);
  // Handle auth failures, network errors, etc.
});

// Receive status, parsed data, and the native Fetch response for every result.
collector.setCardAttributesLookupResponse((lookupResponse) => {
  if (lookupResponse.type === 'success') {
    const attributes: VGSCardAttributes = lookupResponse.data;
    console.log('Lookup status:', lookupResponse.status, attributes);
  }
});
```

**Behavior:**
- Lookup triggers automatically when the user types 11 digits in the first registered `VGSCardInput` field. Use one card field per collector for lookup flows.
- Prevents duplicate requests for same BIN (first 11 digits).
- Results delivered only if user hasn't changed the first 11 digits.
- The success callback receives the complete parsed backend response object. The SDK does not unwrap `data` or reshape backend-defined nested attributes.
- If user deletes below 11 digits, state resets and next 11-digit entry triggers new lookup.
- Response keys and nesting are backend-defined; integrations must not assume a flattened schema.

**Security:**
- JWT token requested on-demand via `authHandler` when lookup needed.
- If `authHandler` not set, lookup fails with `VGSErrorCode.AuthHandlerNotSet`.
- Empty token triggers `VGSErrorCode.IvalidAccessToken`.
- Never log JWT tokens or raw card numbers.

**Example Integration:**
```tsx
import { VGSCollect, VGSCardInput, type VGSCardAttributes } from '@vgs/collect-react-native';

const [cardAttributes, setCardAttributes] = useState<VGSCardAttributes | null>(null);

const lookupData =
  cardAttributes?.data &&
  typeof cardAttributes.data === 'object' &&
  !Array.isArray(cardAttributes.data)
    ? (cardAttributes.data as VGSCardAttributes)
    : cardAttributes;

const collector = new VGSCollect(vaultId, 'sandbox');
collector.setIncludedCardAttributes(['card_type', 'issuer']);
collector.setAuthHandler(async () => {
  const token = await fetchJWTFromBackend();
  return token;
});
collector.setDidRetrieveCardAttributes(setCardAttributes);

return (
  <View>
    <VGSCardInput collector={collector} fieldName="pan" />
    {typeof lookupData?.issuing_organization === 'string' && (
      <Text>Bank: {lookupData.issuing_organization}</Text>
    )}
  </View>
);
```

---
## 15. Glossary
- Vault ID: Unique tenant ID for secure proxying.
- Route ID: Optional path segment enabling route-specific host mapping.
- CNAME: Custom hostname pointing to VGS infrastructure.
- PAN: Card number; never logged.
- Alias / Token: Non-sensitive substitution returned by VGS tokenization.
- Serializer: Splits a composite field into multiple keys for submission/tokenization.
- Validation Rule: Object evaluating input returning error strings.
- Card Attributes: Metadata about a card (BIN, brand, type, issuer, country) retrieved via lookup service.

---
## 16. Quick Reference Snippets
Initialize Collector:
```tsx
const collector = new VGSCollect(process.env.VGS_VAULT_ID!, 'sandbox');
```
Card Field:
```tsx
<VGSCardInput
  collector={collector}
  fieldName="pan"
  onStateChange={s => setCardValid(s.isValid)}
/>
```
Submit:
```tsx
if (!formValid) return;
try {
  const { status, response } = await collector.submit('/post');
  if (response.ok) { const body = await response.json(); /* handle */ }
} catch (e) { /* see error pattern */ }
```
Tokenize:
```tsx
const { status, data } = await collector.tokenize();
// data: { pan: 'tok_...', exp_month: 'tok_...' }
```
Create Card:
```tsx
// With authHandler (recommended)
collector.setAuthHandler(async () => {
  const token = await fetchJWTFromBackend();
  return token;
});
await collector.createCard();
```
Custom Structure:
```tsx
await collector.submit('/post', 'POST', {}, { payment: { number: '{{ pan }}', cvc: '{{ cvc }}' }});
```

---
## 17. Final Rule
If uncertain between two approaches, choose the one that:
1. Requires fewer assumptions about internal package behavior.
2. Never touches raw sensitive data post-submit.
3. Avoids reimplementing validation already provided.
4. Uses only documented exports.

End of AGENTS.md
