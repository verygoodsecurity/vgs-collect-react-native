import { DEFAULT_CARD_MASK_19 } from '../utils/paymentCards/PaymentCardBrand';
import type { VGSTokenizationConfiguration } from '../utils/tokenization/TokenizationConfiguration';
import { PatternRule, PaymentCardRule, LengthRule } from '../utils/validators';
import {
  VGSVaultStorageType,
  VGSVaultAliasFormat,
} from '../utils/tokenization/TokenizationConfiguration';
import { CardExpDateRule } from '../utils/validators/CardExpDateRule';
import { ValidationRule } from '../utils/validators/Validator';

/**
 * Supported input types for `VGSTextInput` components.
 */
export type VGSInputType =
  | 'text'
  | 'card'
  | 'cardHolderName'
  | 'expDate'
  | 'date'
  | 'cvc'
  | 'ssn';

/**
 * Predefined defaults per input `type`.
 * Includes mask, keyboard type, and validation rules.
 * Consumers can override via `VGSTextInput` props.
 */
export const inputTypeDefaults: Record<
  VGSInputType,
  {
    mask?: string;
    keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
    validationRules?: ValidationRule[];
  }
> = {
  // For standard text input (no custom config)
  text: {
    mask: undefined,
    keyboardType: 'default',
    validationRules: [],
  },

  cardHolderName: {
    mask: undefined,
    keyboardType: 'default',
    // Basic pattern check: "Invalid cardholder name"
    validationRules: [
      new PatternRule(
        "^([a-zA-Z0-9\\ \\,\\.\\-\\']{2,})$",
        'INVALID_CARDHOLDER_NAME'
      ),
    ],
  },

  card: {
    mask: DEFAULT_CARD_MASK_19,
    keyboardType: 'numeric',
    validationRules: [new PaymentCardRule('INVALID_CARD_NUMBER', false)],
  },

  cvc: {
    mask: '###',
    keyboardType: 'numeric',
    validationRules: [
      new PatternRule('\\d*$', 'INVALID_CVC'),
      new LengthRule(3, 3, 'INVALID_CVC_LENGTH'),
    ],
  },

  expDate: {
    mask: '##/##', // e.g., "MM/YY
    keyboardType: 'numeric',
    validationRules: [new CardExpDateRule('mmyy', 'INVALID_EXP_DATE')],
  },

  date: {
    mask: '##-##-####', // e.g., "MM-DD-YYYY"
    keyboardType: 'numeric',
  },

  ssn: {
    mask: '###-##-####',
    keyboardType: 'numeric',
    validationRules: [
      new PatternRule(
        '^(?!000|666|9\\d{2})\\d{3}(-|\\s)?(?!00)\\d{2}(-|\\s)?(?!0000)\\d{4}$',
        'INVALID_SSN'
      ),
    ],
  },
};

// Default TokenizationConfig for each field type
export const VGSTokenizationConfigurationType: Record<
  VGSInputType,
  VGSTokenizationConfiguration
> = {
  text: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.UUID,
  },
  card: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.FPE_ACC_NUM_T_FOUR,
  },
  cvc: {
    storage: VGSVaultStorageType.VOLATILE,
    format: VGSVaultAliasFormat.NUM_LENGTH_PRESERVING,
  },
  expDate: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.UUID,
  },
  date: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.UUID,
  },
  ssn: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.FPE_SSN_T_FOUR,
  },
  cardHolderName: {
    storage: VGSVaultStorageType.PERSISTENT,
    format: VGSVaultAliasFormat.UUID,
  },
};

// String mapping used for analytics events
export function getTypeAnalyticsString(inputType: VGSInputType): string {
  switch (inputType) {
    case 'card':
      return 'card-number';
    case 'cardHolderName':
      return 'card-holder-name';
    case 'expDate':
      return 'card-expiration-date';
    case 'cvc':
      return 'card-security-code';
    case 'ssn':
      return 'ssn';
    case 'text':
      return 'text';
    default:
      return 'text';
  }
}
