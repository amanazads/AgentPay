/**
 * Global error handler middleware.
 * Catches all unhandled errors and returns a consistent JSON response.
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Log the error (never expose stack traces in production)
  console.error(`[ERROR] ${req.method} ${req.path} — ${status}: ${message}`);
  if (status === 500) {
    console.error(err.stack);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.path}`,
  });
}

export default errorHandler;
