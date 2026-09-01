import {
  notifyCardInputAfterTextSync,
  resolveEffectiveMaxLength,
  shouldUpdateCardMask,
} from '../../components/VGSTextInputBase';
import { maskInput } from '../../utils/masker/Masker';
import { PaymentCardBrandsManager } from '../../utils/paymentCards/PaymentCardBrandsManager';

describe('resolveEffectiveMaxLength', () => {
  it('returns provided maxLength when mask is not set', () => {
    expect(resolveEffectiveMaxLength(10)).toBe(10);
  });

  it('returns mask length when maxLength is not set', () => {
    expect(resolveEffectiveMaxLength(undefined, '##-##-##')).toBe(8);
  });

  it('caps maxLength to mask length when both are set', () => {
    expect(resolveEffectiveMaxLength(12, '#### ####')).toBe(9);
  });

  it('keeps smaller maxLength when it is below mask length', () => {
    expect(resolveEffectiveMaxLength(4, '#### ####')).toBe(4);
  });
});

describe('shouldUpdateCardMask', () => {
  it('updates the mask when a brand is detected on the first interaction', () => {
    const cardNumber = '378282246310005';
    const amex = PaymentCardBrandsManager.getInstance().detectBrand(cardNumber);

    expect(shouldUpdateCardMask(amex?.name, undefined)).toBe(true);
    expect(maskInput(cardNumber, amex?.mask ?? '')).toBe('3782 822463 10005');
  });

  it('does not update the mask when the detected brand has not changed', () => {
    expect(shouldUpdateCardMask('amex', 'amex')).toBe(false);
  });
});

describe('notifyCardInputAfterTextSync', () => {
  it('updates the raw-value source before starting card lookup', () => {
    const textRef = { current: '4111 1111 11' };
    const notify = jest.fn(() => {
      expect(textRef.current).toBe('4111 1111 111');
    });

    notifyCardInputAfterTextSync(
      textRef,
      '4111 1111 111',
      '41111111111',
      notify
    );

    expect(notify).toHaveBeenCalledWith('41111111111');
  });
});
