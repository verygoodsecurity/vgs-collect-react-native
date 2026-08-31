import { generateUUID } from '../Utils';

/**
 * FormAnalyticsDetails
 *
 * Immutable form-scoped analytics context.
 * Identifies events related to a specific `VGSCollect` instance.
 */
class FormAnalyticsDetails {
  /** Form ID to correlate fields to a single collector instance. */
  readonly formId: string;
  readonly sessionFormId?: string;
  readonly tnt: string;
  readonly env: string;

  /**
   * Creates a new form analytics details object.
   *
   * @param tenantId - Vault tenant identifier.
   * @param environment - Environment label (`sandbox`, `live`, `live-<region>`).
   */
  constructor(
    tenantId: string,
    environment: string,
    options?: {
      formId?: string;
      sessionFormId?: string;
    }
  ) {
    this.formId = options?.formId ?? generateUUID();
    this.sessionFormId = options?.sessionFormId;
    this.tnt = tenantId;
    this.env = environment;
  }

  withSessionFormId(sessionFormId: string): FormAnalyticsDetails {
    return new FormAnalyticsDetails(this.tnt, this.env, {
      formId: this.formId,
      sessionFormId,
    });
  }
}
export default FormAnalyticsDetails;
