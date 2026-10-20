import type { TextInputProps } from 'react-native';
import { TextInput } from 'react-native';
import { VGSCollect, VGSTextInput } from '../../index';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, jest.fn()],
  useEffect: jest.fn(),
  useImperativeHandle: jest.fn(),
  useRef: (current: unknown) => ({ current }),
}));

jest.mock('react-native', () => ({
  TextInput: 'TextInput',
  View: 'View',
  Image: 'Image',
  StyleSheet: { create: (styles: object) => styles },
  Platform: { OS: 'ios', Version: 18 },
  Appearance: { getColorScheme: () => 'light' },
}));

// Effects stay inactive so this test only inspects native input props.
const findNativeInput = (element: any): any => {
  if (!element) return undefined;
  if (element.type === TextInput) return element;
  if (element.type?.render) {
    return findNativeInput(element.type.render(element.props, null));
  }
  const children = element.props?.children;
  if (Array.isArray(children)) {
    return children.map(findNativeInput).find(Boolean);
  }
  return findNativeInput(children);
};

describe.each([
  ['generic', VGSTextInput],
  ['cardholder', VGSTextInput.CardHolder],
  ['card number', VGSTextInput.CardNumber],
  ['expiration', VGSTextInput.ExpDate],
  ['CVC', VGSTextInput.CVC],
])('%s capitalization', (_name, component) => {
  it.each<TextInputProps['autoCapitalize']>([
    'none', 'sentences', 'words', 'characters', undefined,
  ])('forwards %s without a default override', (autoCapitalize) => {
    const input = findNativeInput({
      type: component,
      props: { collector: {} as VGSCollect, fieldName: 'field', autoCapitalize },
    });
    expect(input.type).toBe(TextInput);
    expect(input.props.autoCapitalize).toBe(autoCapitalize);
  });
});
