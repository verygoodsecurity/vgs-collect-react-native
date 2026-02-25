import React, {
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { TextInput, View, StyleSheet } from 'react-native';
import type { AccessibilityRole } from 'react-native';
import VGSCollect from '../collector/VGSCollect';
import { type ValidationRule } from '../utils/validators/Validator';
import {
  tokenizationConfigValidation,
  type VGSTokenizationConfiguration,
} from '../utils/tokenization/TokenizationConfiguration';
import { type VGSSerializer } from '../utils/serializers/ExpDateSeparateSerializer';
import { validateInput } from '../utils/validators/Validator';
import { type VGSTextInputState } from './VGSTextInputState';
import { PaymentCardBrandsManager } from '../utils/paymentCards/PaymentCardBrandsManager';
import {
  getUnmaskedValue,
  maskInput,
  unmaskInput,
} from '../utils/masker/Masker';
import { type VGSInputType, inputTypeDefaults } from './VGSInputType';
import { DEFAULT_CARD_MASK_19 } from '../utils/paymentCards/PaymentCardBrand';
import { type AutoCompleteType } from './types/AutoCompleteType';

// Always provide a deterministic default placeholder color so that if a previous screen
// set a custom placeholderTextColor and a recycled native view is reused (during Fast Refresh
// or certain navigation optimizations), inputs without an explicit color don't inherit the
// stale one. This approximates the platform default neutral gray.
const DEFAULT_PLACEHOLDER_COLOR = '#9CA3AF';

/**
 * Props for predefined input wrappers.
 * Allow overriding `fieldName` and `type` while inheriting base props.
 */
export interface VGSPredefinedInputProps
  extends Omit<VGSTextInputProps, 'fieldName' | 'type'> {
  fieldName?: string;
  type?: VGSInputType;
}


/**
 * Props for the `VGSTextInputBase` component.
 * Public surface used by wrappers and direct usage.
 */
export interface VGSTextInputProps {
  /**
   * The VGSCollect instance to register the field with.
   */
  collector: VGSCollect;
  /**
   * The name of the field.
   */
  fieldName: string;
  /**
   * The type of the input field (e.g., 'card', 'cvc', 'expDate', 'text').
   */
  type?: VGSInputType;
  /**
   * The mask pattern for the input field (e.g., '#### #### #### ####' for card number).
   */
  mask?: string;
  /**
   * The divider to use when replacing non-mask characters on form submission.
   */
  divider?: string;
  /**
   * An optional array of serializers for the input field.
   */
  serializers?: VGSSerializer[];
  /**
   * An array of validation rules for the input field.
   */
  validationRules?: ValidationRule[];
  /**
   * A callback function that is invoked when the input field's state changes.
   */
  onStateChange?: (state: VGSTextInputState) => void;
  /**
   * The placeholder text for the input field.
   */
  placeholder?: string;
  /**
   * Maximum number of characters allowed in the input.
   */
  maxLength?: number;
  /**
   * Color of the placeholder text. If not provided, React Native default is used.
   */
  placeholderTextColor?: string;
  /**
   * The keyboard type for the input field (e.g., 'numeric', 'email-address').
   */
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  /**
   * Whether the input field should have secure text entry (e.g., for passwords).
   */
  secureTextEntry?: boolean;
  /**
   * Whether the input field should enable auto-correction.
   */
  autoCorrect?: boolean;
  /**
   * Style for the container view.
   */
  containerStyle?: object;
  /**
   * Style for the text input.
   */
  textStyle?: object;
  /**
   * Tokenization configuration for the input field
   */
  tokenization?: false | VGSTokenizationConfiguration;
  /**
   * Test id for testing purpose
   */
  testID?: string;
  /**
   * The autoComplete attribute for the input field.
   */
  autoComplete?: AutoCompleteType;
  /**
   * Sets whether autofill is enabled or disabled for the input field.
   * This property maps to the native `importantForAutofill` attribute on Android.
   * On iOS, autofill behavior is primarily controlled via the `autoComplete` prop.
   * Note: The `importantForAutofill` attribute is only available on Android API level 26 and above.
   */
  importantForAutofill?: 'auto' | 'no' | 'noExcludeDescendants' | 'yes' | 'yesExcludeDescendants';
   /**
    * Whether this input is accessible. Defaults to true.
    */
   accessible?: boolean;
   /**
    * Accessibility label describing the purpose of the field (will never include sensitive value).
    */
   accessibilityLabel?: string;
   /**
    * Optional accessibility hint providing extra guidance.
    */
   accessibilityHint?: string;
   /**
    * Optional override for accessibility role. Defaults to 'text'.
    */
  accessibilityRole?: AccessibilityRole;
}

/** Ref methods for `VGSTextInputBase` component. */
export interface VGSTextInputRef {
  focus(): void;
  blur(): void;
}

/**
 * Computes the effective maxLength for a masked input.
 * Ensures native input cannot exceed the visible mask length,
 * which avoids a transient over-limit character flicker.
 */
export const resolveEffectiveMaxLength = (
  maxLength?: number,
  mask?: string
): number | undefined => {
  if (!mask) return maxLength;

  if (typeof maxLength === 'number') {
    return Math.min(maxLength, mask.length);
  }

  return mask.length;
};

/**
 * Secure text input for collecting sensitive data with VGS.
 *
 * Behavior:
 * - Registers/unregisters field with `VGSCollect` and keeps state synced.
 * - Applies mask and validation rules based on `type` defaults and overrides.
 * - Supports tokenization via `tokenization` config.
 * - Emits `onStateChange` with validity and metadata for UI.
 */
export const VGSTextInputBase = forwardRef<VGSTextInputRef, VGSTextInputProps>((props, ref) => {
  const {
    collector,
    fieldName,
    type = 'text', // default field type if not provided
    onStateChange,
    placeholder,
    maxLength,
    placeholderTextColor,
    divider,
    secureTextEntry = false,
    autoCorrect = false,
    containerStyle,
    tokenization = false,
    textStyle: inputTextStyle,
    testID,
    accessible = true,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole = 'text',
  } = props;

  // Get defaults for the specified type
  const defaultConfig = inputTypeDefaults[type] ?? inputTypeDefaults.text;
  // Get tokenization config if available and valid
  const tokenize = tokenizationConfigValidation(tokenization, type);
  const tokenizationConfig = tokenize ? tokenize : undefined;
  // Merge user overrides with defaults
  const initialMask = props.mask ?? defaultConfig?.mask;
  const keyboardType =
    props.keyboardType ?? defaultConfig?.keyboardType ?? 'default';
  const mergedValidationRules: ValidationRule[] =
    props.validationRules ?? defaultConfig?.validationRules ?? [];
  // State to manage the current validation rules
  const [validationRules, setValidationRules] = useState<ValidationRule[]>(
    mergedValidationRules
  );
  // State to manage the current mask
  const [currentMask, setCurrentMask] = useState<string | undefined>(
    initialMask
  );
  const serializers = props.serializers;
  const [text, setText] = useState('');
  const [state, setState] = useState<VGSTextInputState>({
    type,
    isValid: validationRules.length === 0,
    isDirty: false,
    isEmpty: true,
    isFocused: false,
    inputLength: 0,
    validationErrors: [],
    fieldName,
  });
  const effectiveMaxLength = resolveEffectiveMaxLength(maxLength, currentMask);

  const textRef = React.useRef<string>(text);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Define the update callback to handle updates from VGSCollect
  const handleFieldConfigUpdate = (config: {
    mask?: string;
    validationRules?: ValidationRule[];
  }) => {
    // Apply the new mask to the current text
    const currentRawInput = unmaskInput(textRef.current, currentMask ?? '');
    const newMaskedInput = maskInput(currentRawInput, config.mask ?? '');
    setCurrentMask(config.mask);
    setValidationRules(config.validationRules ?? []);
    setText(newMaskedInput);
    // Need to unmask since new mask can cut current input
    const newRawInput = unmaskInput(newMaskedInput, config.mask ?? '');
    const errors = validateInput(newRawInput, config.validationRules ?? []);
    const isValid = errors.length === 0;
    // Use a timeout to defer state updates, avoiding state updates during render
    setTimeout(() => {
      const newState = {
        ...state,
        inputLength: newRawInput.length,
        isValid,
        isDirty: state.isDirty || newRawInput.length > 0,
        isEmpty: newRawInput.length === 0,
        validationErrors: errors,
      };
      setState(newState);
      onStateChange?.(newState);
    }, 0);
  };

  useEffect(() => {
    collector.registerField(
      fieldName,
      () => {
        const submitValue = getUnmaskedValue(
          textRef.current,
          currentMask,
          divider
        );

        if (serializers && type === 'expDate' && submitValue) {
          let serializedData: Record<string, string> = {};
          serializers.forEach((serializer) => {
            const result = serializer.serialize(submitValue as string);
            // for expDate we have Record<string, string> serializers
            if (typeof result === 'object' && result !== null) {
              serializedData = { ...serializedData, ...result };
            }
          });
          return serializedData; // Return only the serialized data
        }
        return submitValue as string;
      },
      () => {
        const rawInput = unmaskInput(textRef.current, currentMask ?? '');
        return validateInput(rawInput, validationRules);
      },
      tokenizationConfig,
      type,
      validationRules,
      handleFieldConfigUpdate
    );
    return () => {
      collector.unregisterField(fieldName);
    };
  }, [collector, fieldName, currentMask, divider, type, validationRules]);

  const handleFocus = () => {
    const newState = { ...state, isFocused: true };
    setState(newState);
    onStateChange?.(newState);
  };

  const handleBlur = () => {
    const newState = { ...state, isFocused: false };
    setState(newState);
    onStateChange?.(newState);
  };

  const handleChangeText = (input: string) => {
    let maskedInput = input;
    let rawInput = input;

    // If a mask is set, apply it
    if (currentMask) {
      maskedInput = maskInput(input, currentMask);
      rawInput = unmaskInput(maskedInput, currentMask);
    }

    // Retrieve validation rules from collector if available
    const errors = validateInput(rawInput, validationRules);
    const isValid = errors.length === 0;

    // Build the new state for this field
    let newState: VGSTextInputState = {
      ...state,
      type,
      isValid,
      isDirty: state.isDirty || rawInput.length > 0,
      isEmpty: rawInput.length === 0,
      inputLength: rawInput.length,
      validationErrors: errors,
      fieldName,
    };

    // Additional logic if type === "card"
    if (type === 'card') {
      // Remove whitespace/dashes
      const cleaned = rawInput.replace(/\s+|-/g, '');
      const manager = PaymentCardBrandsManager.getInstance();
      const detectedBrand = manager.detectBrand(cleaned);
      const brandName = detectedBrand ? detectedBrand.name : 'Unknown';

      // Only update if brand changed
      if (
        detectedBrand &&
        'cardBrand' in state &&
        brandName !== state.cardBrand
      ) {
        // Update the 'cvc' fields via VGSCollect
        collector.updateCvcFieldForBrand(brandName);
        // Apply the new mask
        const brandMask = detectedBrand?.mask || DEFAULT_CARD_MASK_19;
        setCurrentMask(brandMask);
        maskedInput = maskInput(cleaned, brandMask);
      }
      // Update newState with brand info
      newState = {
        ...newState,
        cardBrand: brandName,
        cardBin: isValid ? manager.getBin(cleaned, brandName) : undefined,
        last4: isValid && cleaned.length >= 12 ? cleaned.slice(-4) : undefined,
      };
    } else if (type === 'ssn') {
      // Example: store last 4 for SSN
      const cleaned = rawInput.replace(/\D/g, '');
      newState = {
        ...newState,
        last4: isValid && cleaned.length === 9 ? cleaned.slice(-4) : undefined,
      };
    }
    // Update our text display
    setText(maskedInput);
    setState(newState);
    onStateChange?.(newState);
  };

  useImperativeHandle(ref, () => ({
    focus: () => textInputRef.current?.focus(),
    blur: () => textInputRef.current?.blur(),
  }));

  const textInputRef = React.useRef<TextInput>(null);

  return (
    <View style={[containerStyle, styles.container]}>
      <TextInput
        value={text}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={effectiveMaxLength}
        // Always provide a concrete placeholderTextColor to prevent native view
        // from keeping a previous instance's color when this prop is omitted.
        placeholderTextColor={placeholderTextColor ?? DEFAULT_PLACEHOLDER_COLOR}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCorrect={autoCorrect}
        style={inputTextStyle}
        ref={textInputRef}
        testID={testID}
        underlineColorAndroid="transparent"
         accessible={accessible}
         accessibilityLabel={accessibilityLabel}
         accessibilityHint={accessibilityHint}
         accessibilityRole={accessibilityRole}
         accessibilityState={{ disabled: false, selected: state.isFocused, busy: state.validationErrors.length > 0 && state.isDirty }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
});

export default VGSTextInputBase;
