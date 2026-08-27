import Joi from 'joi';

/**
 * Creates an Express middleware that validates request body/query/params
 * against a Joi schema.
 *
 * @param {Object} schemas - { body?: Joi.Schema, query?: Joi.Schema, params?: Joi.Schema }
 * @returns {Function} Express middleware
 */
export function validate(schemas) {
  return (req, res, next) => {
    const errors = [];

    for (const [source, schema] of Object.entries(schemas)) {
      if (!schema) continue;
      const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        errors.push(
          ...error.details.map((d) => ({
            source,
            field: d.path.join('.'),
            message: d.message,
          }))
        );
      } else {
        req[source] = value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    next();
  };
}

export default validate;
