/* eslint-disable react-native/no-inline-styles */
// TokenizeData.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

// Import VGSCollect SDK inputs
import {
  VGSCollect,
  VGSTextInput,
  VGSCardInput,
  VGSCVCInput,
  VGSError,
  VGSErrorCode,
  VGSCollectLogger,
  VGSTokenizationConfiguration,
} from '@vgs/collect-react-native';
import type { VGSTextInputState } from '@vgs/collect-react-native';

// Enable VGSCollect SDK logs. Do not use in production!!!
if (process.env.NODE_ENV !== 'production') {
  VGSCollectLogger.getInstance().enable();
}

// Set your tenant ID and environment.
const collector = new VGSCollect('tenantId', 'sandbox');
// Tokenization API JWT token https://www.verygoodsecurity.com/docs/api/vault/#description/authentication-and-authorization
const token = '<your_token_here>'

const TokenizeData = () => {
  const [formFieldsState, setFormFieldsState] = useState<{
    [key: string]: VGSTextInputState;
  }>({
    card_holder: { isValid: false } as VGSTextInputState,
    card_number: { isValid: false } as VGSTextInputState,
    expiration_date: { isValid: false } as VGSTextInputState,
    card_cvc: { isValid: false } as VGSTextInputState,
  });

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

  // Handle tokenize request
  const handleSubmit = async () => {
    if (!areAllFieldsValid()) {
      return; // Prevent submission if any field is invalid
    }

    // Replace with your actual token
    collector.setCustomHeaders({ Authorization: 'Bearer '+ token });

    try {
      const { status, data } = await collector.createAliases();
      if (status >= 200 && status < 300) {
        try {
          setLabelStatus('- SUCCESS!- ');
          console.log('Success:', data);
        } catch (error) {
          setLabelStatus('- FAILED! -');
          console.warn(
            'Error parsing response body. Body can be empty or your <vaultId> is wrong!',
            error
          );
        }
      } else {
        setLabelStatus('FAILED!');
        console.warn(`Server responded with error: ${status}\n${data}`);
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
          default:
            console.error('VGSError:', error.code, error.message);
        }
      } else {
        console.error('Network or unexpected error:', error);
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Add Card details:</Text>
        <VGSTextInput
          testID="card_holder"
          collector={collector}
          fieldName="card_holder"
          type="cardHolderName"
          placeholder="Card Holder Name"
          tokenization={VGSTokenizationConfiguration.presets.cardHolderName}
          onStateChange={(state: any) =>
            handleFieldStateChange('card_holder', state)
          }
          containerStyle={[
            styles.inputContainer, // Container-specific styles
            {
              borderColor: formFieldsState.card_holder?.isValid
                ? formFieldsState.card_holder?.isValid
                  ? 'green'
                  : 'red'
                : 'lightgrey',
            },
          ]}
          textStyle={[
            styles.inputText, // text-specific styles
          ]}
        />
        <VGSCardInput
          testID="card_number"
          collector={collector}
          fieldName="card_number"
          iconPosition="right"
          placeholder="4111 1111 1111 1111"
          onStateChange={(state: any) =>
            handleFieldStateChange('card_number', state)
          }
          tokenization={VGSTokenizationConfiguration.presets.card}
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
          <VGSTextInput
            testID="expiration_date"
            collector={collector}
            fieldName="expiration_date"
            type="expDate"
            placeholder="MM/YY"
            tokenization={VGSTokenizationConfiguration.presets.expDate}
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
          <VGSCVCInput
            testID="card_cvc"
            collector={collector}
            fieldName="card_cvc"
            placeholder="CVC/CVV"
            tokenization={VGSTokenizationConfiguration.presets.cvc}
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
          <Text style={{ color: 'white' }}>Tokenize</Text>
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
});

export default TokenizeData;
