import { inputTypeDefaults } from '../../components/VGSInputType';
import { validateInput } from '../../utils/validators/Validator';

describe('inputTypeDefaults', () => {
  it('returns the correctly spelled CVC length validation error', () => {
    const validationRules = inputTypeDefaults.cvc.validationRules ?? [];

    expect(validateInput('12', validationRules)).toContain('INVALID_CVC_LENGTH');
  });
});
