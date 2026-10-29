export function viewerError(code, message, cause) {
  const error = new Error(message);
  error.name = 'PrintViewerError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
