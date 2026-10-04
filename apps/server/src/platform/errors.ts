/** Error envelope codes (docs/05-api/api-guidelines.md §3). */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ACCOUNT_DELETION_PENDING'
  | 'SUBSCRIPTION_REQUIRED'
  | 'RIGHTS_UNAVAILABLE'
  | 'PURCHASE_AVAILABLE'
  | 'CAPABILITY_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'ALREADY_EXISTS'
  | 'PRECONDITION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_MEDIA'
  | 'CHECKSUM_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'UPLOAD_MISSING'
  | 'INVALID_RELATION_STEP'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

export const errors = {
  validation: (details: Record<string, unknown>, message = 'Request validation failed.') =>
    new AppError(400, 'VALIDATION_FAILED', message, { details }),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'),
  forbidden: (message = 'This action is not allowed.') => new AppError(403, 'FORBIDDEN', message),
  denied: (
    code:
      'SUBSCRIPTION_REQUIRED' | 'RIGHTS_UNAVAILABLE' | 'PURCHASE_AVAILABLE' | 'CAPABILITY_DENIED',
    message: string,
  ) => new AppError(403, code, message),
  accountDeletionPending: () =>
    new AppError(403, 'ACCOUNT_DELETION_PENDING', 'This account is being deleted.'),
  /** Used for both "missing" and "not yours" so private existence is never revealed. */
  notFound: () => new AppError(404, 'NOT_FOUND', 'The resource was not found.'),
  invalidState: (message: string) => new AppError(409, 'INVALID_STATE', message),
  alreadyExists: (message: string) => new AppError(409, 'ALREADY_EXISTS', message),
  idempotencyReused: () =>
    new AppError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'The Idempotency-Key was already used with a different request.',
    ),
  idempotencyInProgress: () =>
    new AppError(
      409,
      'IDEMPOTENCY_IN_PROGRESS',
      'A request with this Idempotency-Key is still in progress.',
      { retryable: true },
    ),
  preconditionFailed: () =>
    new AppError(412, 'PRECONDITION_FAILED', 'The resource was modified by another request.'),
  preconditionRequired: () =>
    new AppError(428, 'PRECONDITION_REQUIRED', 'An If-Match header is required.'),
  payloadTooLarge: (code: 'PAYLOAD_TOO_LARGE' | 'QUOTA_EXCEEDED', message: string) =>
    new AppError(413, code, message),
  unprocessable: (
    code:
      | 'UNSUPPORTED_MEDIA'
      | 'CHECKSUM_MISMATCH'
      | 'SIZE_MISMATCH'
      | 'UPLOAD_MISSING'
      | 'INVALID_RELATION_STEP'
      | 'UNPROCESSABLE',
    message: string,
  ) => new AppError(422, code, message),
  unavailable: () =>
    new AppError(503, 'UNAVAILABLE', 'The service is temporarily unavailable.', {
      retryable: true,
    }),
};
