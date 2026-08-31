/* eslint-disable react-native/no-inline-styles */
// CreateCard.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
/// Import VGSCollect SDK inputs
import {
  VGSCollect,
  VGSTextInput,
  VGSError,
  VGSErrorCode,
  VGSCollectLogger,
} from '@vgs/collect-react-native';
import type {
  VGSTextInputState,
  VGSCardAttributes,
  VGSCardAttributesLookupResponse,
} from '@vgs/collect-react-native';

// Enable VGSCollect SDK logs. Do not use in production!!!
if (process.env.NODE_ENV !== 'production') {
  VGSCollectLogger.getInstance().enable();
}

const CreateCard = () => {
  // Initialize collector with session (async)
  const [collector, setCollector] = useState<VGSCollect | null>(null);
  const [cardAttributes, setCardAttributes] =
    useState<VGSCardAttributes | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [formFieldsState, setFormFieldsState] = useState<{
    [key: string]: VGSTextInputState;
  }>({
    card_number: { isValid: false } as VGSTextInputState,
    expiration_date: { isValid: false } as VGSTextInputState,
    card_cvc: { isValid: false } as VGSTextInputState,
  });

  // Initialize collector with session and configure card attributes lookup
  useEffect(() => {
    const initCollector = async () => {
      try {
        const formName = process.env.EXPO_PUBLIC_VGS_FORM_NAME;
        const vaultId = process.env.EXPO_PUBLIC_VGS_VAULT_ID;

        if (!formName || !vaultId) {
          throw new Error(
            'Missing EXPO_PUBLIC_VGS_FORM_NAME or EXPO_PUBLIC_VGS_VAULT_ID'
          );
        }

        // Pass `undefined` or blank form only when you intentionally want to skip
        // remote session config loading and card-attributes lookup configuration.
        const collect = await VGSCollect.session(formName, vaultId, 'sandbox');

        // Configure auth handler for createCard() and card attributes lookup.
        collect.setAuthHandler(async () => {
          console.log('Auth handler called for createCard/card attributes request');

          // This public value is only the URL of your backend token endpoint.
          // OAuth client credentials must never be embedded in the mobile app.
          const authEndpoint = process.env.EXPO_PUBLIC_CARD_ATTR_AUTH_ENDPOINT;

          if (!authEndpoint) {
            throw new Error(
              'Missing EXPO_PUBLIC_CARD_ATTR_AUTH_ENDPOINT'
            );
          }

          const response = await fetch(authEndpoint, { method: 'POST' });

          if (!response.ok) {
            throw new Error(`Auth token request failed with status: ${response.status}`);
          }

          const data: { token?: string } = await response.json();
          if (!data.token) {
            throw new Error('Auth token response missing token');
          }

          return data.token;
        });

        // Optional: Notify when lookup starts
        collect.setWillBeginCardAttributesLookup(() => {
          console.log('Starting card attributes lookup...');
          setIsLookingUp(true);
        });

        // Handle successful card attributes retrieval
        collect.setDidRetrieveCardAttributes(
          (attributes: VGSCardAttributes) => {
            console.log('Card attributes retrieved:', attributes);
            setCardAttributes(attributes);
            setIsLookingUp(false);
          }
        );

        collect.setCardAttributesLookupResponse(
          (lookupResponse: VGSCardAttributesLookupResponse) => {
            console.log(
              'Card attributes lookup response:',
              lookupResponse.type,
              lookupResponse.status
            );
          }
        );

        // Handle lookup errors
        collect.setDidFailToRetrieveCardAttributes((error: Error) => {
          console.warn(
            `Card attributes lookup failed: ${
              error.message || 'unknown error'
            }`
          );
          console.warn('Card attributes lookup error details:', error);
          setCardAttributes(null);
          setIsLookingUp(false);
        });

        setCollector(collect);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'status' in error &&
          typeof error.status === 'number'
        ) {
          console.error(
            `Failed to initialize collector. Session config request returned ${error.status}.`
          );
        } else {
          console.error('Failed to initialize collector:', error);
        }
      }
    };

    initCollector();
  }, []);

  const handleFieldStateChange = (
    fieldName: string,
    state: VGSTextInputState
  ) => {
    console.log('> Field state changed:', fieldName, state);
    setFormFieldsState((prevState) => ({
      ...prevState,
      [fieldName]: state,
    }));
  };

  // Check if all fields are valid
  const areAllFieldsValid = useCallback(() => {
    for (const fieldName in formFieldsState) {
      if (!formFieldsState[fieldName]?.isValid) {
        return false;
      }
    }
    return true;
  }, [formFieldsState]);

  // Set status label
  const [labelStatus, setLabelStatus] = useState('Waiting for data...');

  // Update labelStatus text when the validity of all fields changes
  useEffect(() => {
    setLabelStatus(
      areAllFieldsValid() ? '- Form is valid! -' : '- Form is not valid: -'
    );
  }, [areAllFieldsValid]);

  // Handle create card submit request
  const handleSubmit = async () => {
    if (!areAllFieldsValid() || !collector) {
      return; // Prevent submission if any field is invalid or collector not ready
    }
    try {
      // Use authHandler for JWT token (automatically managed by SDK)
      const { status, response } = await collector.createCard();
      if (response.ok) {
        try {
          const responseBody = await response.json();
          const json = JSON.stringify(responseBody, null, 2);
          setLabelStatus('- SUCCESS!- ');
          console.log('Success:', json);
        } catch (error) {
          setLabelStatus('- FAILED! -');
          console.warn(
            'Error parsing response body. Body can be empty or your <vaultId> is wrong!',
            error
          );
        }
      } else {
        setLabelStatus('FAILED!');
        console.warn(`Server responded with error: ${status}\n${response}`);
        if (status === 400) {
          console.error('Bad request! Check your VGSCollect config and input.');
        } else if (status === 500) {
          console.error('Server issue! Try again later.');
        }
      }
    } catch (error) {
      setLabelStatus('FAILED!');
      if (error instanceof VGSError) {
        switch (error.code) {
          case VGSErrorCode.InputDataIsNotValid:
            for (const fieldName in error.details) {
                console.error(
                  `Not valid fieldName: ${fieldName}: ${error.details[fieldName].join(', ')}`
                );
              }
              break;
          case VGSErrorCode.InvalidFormConfiguration:
            console.error('Invalid form configuration. Check form name and try again.');
            break;
          case VGSErrorCode.InvalidVaultConfiguration:
            console.error('Invalid vault configuration. Check vaultId/environment.');
            break;
          case VGSErrorCode.SessionInitializationFailed:
            console.error('Session initialization failed. Check network/config and retry.');
            break;
          case VGSErrorCode.IvalidAccessToken:
            console.error('Invalid access token! Check your token and try again.');
            break;
          case VGSErrorCode.AuthHandlerNotSet:
            console.error('authHandler is missing. Call setAuthHandler() before createCard().');
            break;
          default:
            console.error('VGSError:', error.code, error.message);
        }
      } else {
        console.error('Network or unexpected error:', error);
      }
    }
  };

  // Show loading until collector is initialized
  if (!collector) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Initializing VGS Collector...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Don't render inputs until collector is initialized
  if (!collector) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Initializing collector...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Add Card details:</Text>
        {/* Card Attributes Lookup Status */}
        {isLookingUp && (
          <View style={styles.lookupContainer}>
            <Text style={styles.lookupText}>🔍 Looking up card info...</Text>
          </View>
        )}
        {cardAttributes && (
          <View style={styles.attributesContainer}>
            <Text style={styles.attributesTitle}>Card Attributes (raw):</Text>
            <Text style={styles.attributesJson}>
              {JSON.stringify(cardAttributes, null, 2)}
            </Text>
          </View>
        )}
        <VGSTextInput.CardNumber
          testID="card_number"
          collector={collector}
          placeholder="4111 1111 1111 1111"
          onStateChange={(state: any) =>
            handleFieldStateChange('card_number', state)
          }
          containerStyle={[
            styles.inputContainer, // Container-specific styles
            {
              borderColor: formFieldsState.card_number?.isDirty
                ? formFieldsState.card_number?.isValid
                  ? 'green'
                  : 'red'
                : 'lightgrey',
            },
          ]}
          textStyle={[
            styles.inputText, // text-specific styles
          ]}
          iconStyle={{ width: 42, height: 24 }}
        />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <VGSTextInput.ExpDate
            testID="expiration_date"
            collector={collector}
            placeholder="MM/YY"
            onStateChange={(state) =>
              handleFieldStateChange('expiration_date', state)
            }
            containerStyle={[
              styles.inputContainer,
              {
                borderColor: formFieldsState.expiration_date?.isDirty
                  ? formFieldsState.expiration_date?.isValid
                    ? 'green'
                    : 'red'
                  : 'lightgrey',
                flex: 1,
                marginRight: 10,
              },
            ]}
            textStyle={styles.inputText}
          />
          <VGSTextInput.CVC
            testID="card_cvc"
            collector={collector}
            placeholder="CVC/CVV"
            onStateChange={(state) => handleFieldStateChange('card_cvc', state)}
            containerStyle={[
              styles.inputContainer, // Container-specific styles
              {
                borderColor: formFieldsState.card_cvc?.isDirty
                  ? formFieldsState.card_cvc?.isValid
                    ? 'green'
                    : 'red'
                  : 'lightgrey',
                flex: 1,
                marginLeft: 10,
              },
            ]}
            textStyle={[
              styles.inputText, // text-specific styles
            ]}
            iconStyle={{ width: 42, height: 24 }}
          />
        </View>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: areAllFieldsValid() ? 'blue' : 'gray' },
          ]}
          disabled={!areAllFieldsValid()}
          onPress={handleSubmit}
        >
          <Text style={{ color: 'white' }}>Create Card</Text>
        </TouchableOpacity>
        <Text style={styles.label}>{labelStatus}</Text>
        <ScrollView>
          {Object.keys(formFieldsState).map((fieldName) => {
            const state = formFieldsState[fieldName];
            return (
              <View key={fieldName} style={styles.stateContainer}>
                <Text
                  style={styles.stateHeader}
                >{`field_name: ${state?.fieldName}`}</Text>
                <Text>{`inputLength: ${state?.inputLength}`}</Text>
                <Text>{`isValid: ${state?.isValid}`}</Text>
                <Text>
                  {`validationErrors: [${
                    Array.isArray(state?.validationErrors)
                      ? state?.validationErrors
                          .filter((e) => typeof e === 'string')
                          .join(', ')
                      : ''
                  }]`}
                </Text>
                <Text>{`isFocused: ${state?.isFocused}`}</Text>
                <Text>{`isDirty: ${state?.isDirty}`}</Text>
                <Text>{`isEmpty: ${state?.isEmpty}`}</Text>
                {state?.isValid && 'cardBrand' in state && (
                  <Text>{`cardBrand: ${state?.cardBrand}`}</Text>
                )}
                {state?.isValid && 'cardBin' in state && (
                  <Text>{`cardBin: ${state?.cardBin}`}</Text>
                )}
                {state?.isValid &&
                  state?.type === 'card' &&
                  'last4' in state && <Text>{`last4: ${state?.last4}`}</Text>}
                {state?.isValid &&
                  state?.type === 'ssn' &&
                  'last4' in state && <Text>{`last4: ${state?.last4}`}</Text>}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'white',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  title: {
    fontSize: 20,
    marginBottom: 10,
  },
  inputContainer: {
    height: 50,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    marginBottom: 20,
  },
  inputText: {
    fontSize: 16,
    color: 'black',
  },
  stateContainer: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  stateHeader: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: 'blue',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  label: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 16,
    padding: 8,
  },
  lookupContainer: {
    backgroundColor: '#FFF9C4',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  lookupText: {
    fontSize: 14,
    color: '#F57C00',
  },
  attributesContainer: {
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  attributesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#2E7D32',
  },
  attributesJson: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#1B5E20',
  },
});

export default CreateCard;
